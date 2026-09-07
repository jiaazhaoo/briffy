'use strict';
// 「问我的记录」。索引挑出这个问题说的是哪些记录，模型只把它们写成一句回答，并按编号引用。
//
// 挑记录这一步**完全不经过模型**。这不是省事，是这个功能能成立的前提：
//
//   换掉 OpenRouter 换成本地 Ollama，索引不受影响；断网也照样定位得到。
//   没配任何 AI 服务时，返回的仍然是一份排好序的、正确的记录清单——那本来就是答案的大半。
//   延迟是确定的，不取决于对方的网络，也不取决于模型聪不聪明。
//
// 以前这里是 store.listEntries({ limit: Infinity })：把工作区每一天都读进内存再打分。20 万条实测
// 215MB 堆、707ms；按这个工作区的真实平均长度外推到 185 万条约 7GB——每问一次崩一次。现在只从索引
// 里拿命中的那几十个 id，再按 id 取回那几条。
const fs = require('fs');
const path = require('path');
const llm = require('./llm');
const retrieve = require('./retrieve');
const vector = require('./vector');
const topic = require('./topic');
const { CJK } = require('./segment');
const index = require('./index-db');
const { localDateKey } = require('./store');

let store;
function init(deps) { store = deps.store; }

const MAX_ITEMS = 40;   // as many as a daily-recap-sized context comfortably holds
// 一句话问出来的东西最多留这么几条。40 是给「把这段时间给我」用的；一个具体的问题给四十条，
// 结果是每条只摊到五百字，而含着答案的那几条正需要一千多。少而长。
const KEEP = 8;
// 第一次提问不该卡在建索引上。一个用了几年的工作区从零建要好几分钟，所以每次只做这么久，
// 剩下的下一次接着做；天是从新到旧建的，先补上的正好是最可能被问到的。
const SYNC_BUDGET_MS = 400;

function entriesDir() { return store.paths().entries; }

/**
 * 打开索引并追平工作区。可以随便调，没变过的天不会被重读。
 *
 * 读天文件走 fs，**不走 store.loadDay**：那个函数会把读过的每一天留在 store.days 里，而建索引要
 * 把每一天都读一遍——等于一边建索引一边把整个工作区钉进内存，正是这个索引要消灭的那件事。
 * 索引这边读完就扔，一天用完不留。
 */
function readDay(k) {
  try { return JSON.parse(fs.readFileSync(path.join(entriesDir(), `${k}.json`), 'utf8')); } catch (_) { return []; }
}

function refresh({ budgetMs = SYNC_BUDGET_MS } = {}) {
  index.open(store.userData, store.workspaceDir);
  index.useVecModel(vector.MODEL);
  return index.sync({ dir: entriesDir(), loadDay: readDay }, { budgetMs });
}

/**
 * 应用起来之后在后台把索引建完，这样第一次提问就已经是齐的。
 *
 * 倒排建完之后接着补向量，走的是同一条循环、同一个「限时、可中断、下次接着做」的形状——
 * 不为它新建第二套调度。实测每条记录 21ms，一天两百条累计四秒，和 OCR 一张截图 0.5 秒
 * 比起来是同一个量级，而 OCR 已经在跑了。所以新存的东西是**几秒钟**跟上，不是等到夜里。
 *
 * 顺序是先倒排后向量：倒排是那个会说「找不到」的一半，也是断网、换服务、模型跑不动时唯一
 * 还在工作的一半，它必须先齐。
 */
function warm() {
  const fillVectors = () => {
    vector.fill(index, readDay, { budgetMs: 1500, cacheDir: store.paths().models })
      .then((r) => {
        if (r.error) { console.warn('[ask] 向量补不了：', r.error); return; }   // 词面那一半照常工作
        if (!r.done) { setTimeout(fillVectors, 800); return; }
        setTimeout(groupAndName, 800);
      })
      .catch((e) => console.warn('[ask] 向量补不了：', e.message || e));
  };
  const step = () => {
    let r;
    try { r = refresh({ budgetMs: 1500 }); } catch (e) { console.warn('[ask] 索引建不起来', e.message); return; }
    if (!r.done) { setTimeout(step, 800); return; }   // 留出空档，别把启动那几秒占满
    setTimeout(fillVectors, 800);
  };
  // 向量补齐之后归堆。归堆是纯本地的，两百条跑一遍毫秒级；起名要过模型，一次只起几个，
  // 起完的名字会留着——同一个代表的堆重算之后还是它，不用再花一次调用。
  const groupAndName = async () => {
    try {
      const groups = topic.build(index, (id) => store.getEntry(id));
      index.putTopics(groups);
    } catch (e) { console.warn('[ask] 归堆失败', e.message || e); return; }
    const cfg = llm.config(store);
    if (!llm.isConfigured(cfg)) return;               // 没有 provider 就只有条数和抽出来的词
    for (const t of index.unnamedTopics(3)) {
      const items = index.topicMembers(t.id, 20)
        .map((id) => store.getEntry(id)).filter(Boolean)
        .map((e) => ({ title: e.title, text: e.text }));
      try {
        const name = await llm.topicName(cfg, { items });
        index.nameTopic(t.id, name);
      } catch (e) { console.warn('[ask] 主题起名失败', e.message || e); return; }
    }
    if (index.unnamedTopics(1).length) setTimeout(groupAndName, 2000);
  };
  setTimeout(step, 3000);
}

/**
 * @param {string} question
 * @returns {Promise<null|{question:string, answer:string, used:number[], sources:Array,
 *   range:{from:string,to:string}|null, scored:boolean, noProvider:boolean, error:string, model:string}>}
 */
async function run(question, { limit = MAX_ITEMS } = {}) {
  const q = String(question || '').trim();
  if (!q) return null;
  const today = localDateKey();
  try { refresh(); } catch (e) { console.warn('[ask] 索引没能追平', e.message); }

  // 词面先挑，不在这里截断——截断留到融合之后，否则向量能补的那几条已经被切掉了
  const pick = retrieve.select(index, q, { today, limit, getEntry: (id) => store.getEntry(id) });
  let ids = pick.ids.slice(0, KEEP);
  if (pick.ids.length) {
    const near = await vector.search(index, q, { limit, cacheDir: store.paths().models, from: pick.range ? pick.range.from : '' })
      .catch(() => []);
    ids = retrieve.fuse(pick.ids, near, KEEP);
  }
  const entries = ids.map((id) => store.getEntry(id)).filter(Boolean);

  const base = {
    question: q, answer: '', used: [], model: '',
    sources: entries, range: pick.range,
    scored: pick.scored, noProvider: false, error: '', total: index.stats().entries,
    inRange: pick.inRange,
  };
  if (!entries.length) return base;

  const cfg = llm.config(store);
  if (!llm.isConfigured(cfg)) return { ...base, noProvider: true };
  try {
    const r = await llm.answerQuestion(cfg, { question: q, entries, terms: pick.terms });
    return { ...base, answer: r.answer, used: r.used, model: r.model };
  } catch (e) {
    return { ...base, error: e.message || String(e) };
  }
}

/**
 * 搜索框的第二条腿：意思相近，但搜的那几个字一个都没写在里面。
 *
 * 和「问」那条路不一样，这里**不能**要求词面先命中——搜索框的价值恰恰是「搜跑步出得来徒步」，
 * 而那时候词面按定义就是空的。实测七个这样的词，词面能搜到 1 个，向量 5 个。
 * 安全性靠界面兜：这些结果在页面上是**标出来的**，不会和精确命中混在一起假装是同一回事。
 * @returns {Promise<string[]>} 记录 id，按相近程度排
 */
async function near(query, { exclude = [], limit = 12 } = {}) {
  const q = String(query || '').trim();
  // 门槛是为了别在打第一个字母时就去算向量。但**一个汉字就是一个完整的词**——「车」「猫」「书」
  // 都是正经查询，按字符数一刀切会把它们全挡在外面（实测「车」返回 0 条，而它本该找到
  // Ford focus 和那张接驳车的截图）。所以只对拉丁那种一个字母不成词的情况要求两个字符。
  if (!q || (q.length < 2 && !CJK.test(q))) return [];
  try { refresh(); } catch (_) { /* 索引没追平也照样能搜已经建好的那部分 */ }
  const skip = new Set(exclude || []);
  const ids = await vector.search(index, q, { limit: limit * 3, cacheDir: store.paths().models });
  return ids.filter((id) => !skip.has(id)).slice(0, limit);
}

/** 记录页上那一行主题。空手是正常的：向量还没补齐、或者这个工作区还没有成堆的东西。 */
function topicList() {
  // name 是模型起的，words 是没有模型时的那一份（离堆中心最近的那条的标题）。
  // 后者已经是一句完整的话，按空格拆开会把 "GitHub - blessonism/grok-icon-study" 拆散。
  try { return index.topics().map((t) => ({ ...t, name: t.name || t.words || '' })); }
  catch (_) { return []; }
}
/** 和这一条讲同一件事的那几条。空手是正常的：向量还没补齐，或者它确实没有近邻。 */
function relatedTo(id) {
  try { refresh(); } catch (_) { /* 索引没追平也照样能用已经建好的那部分 */ }
  try { return vector.related(index, String(id || '')); } catch (_) { return []; }
}

/** 一条记录周围两跳的那张图。节点带 hop（离中心几步），边是节点之间真的够近的那些。 */
function graphOf(id) {
  try { refresh(); } catch (_) { /* 用已经建好的那部分 */ }
  try { return vector.graph(index, String(id || '')); } catch (_) { return { nodes: [], edges: [] }; }
}

function topicEntries(id) {
  try { return index.topicMembers(String(id || '')); } catch (_) { return []; }
}

module.exports = { init, run, near, warm, refresh, topicList, topicEntries, relatedTo, graphOf, MAX_ITEMS };
