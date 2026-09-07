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
const links = require('./links');
const boilerplate = require('./boilerplate');
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

// 家具表多久重学一次。学一遍 12ms，但它要把所有天文件读一遍，所以不必每次 refresh 都学。
const FURNITURE_MS = 5 * 60 * 1000;
let furnitureAt = 0;

let evIdx = null;   // 证据词的倒排。82ms 建一次，之后每条记录只访问和它共用词的那几条。

/** 跨记录重复的那些行（语言选择条、Cookie 提示），外加证据词的倒排。都要整个工作区才算得出来。 */
function learnFurniture() {
  if (Date.now() - furnitureAt < FURNITURE_MS) return;
  furnitureAt = Date.now();
  try {
    const all = [];
    for (const key of store.listDates()) all.push(...store.loadDay(key));
    boilerplate.load(all.map((e) => String((e || {}).text || '')));
    const fur = boilerplate.furniture();
    evIdx = links.evidenceIndex(all, (e) => boilerplate.strip(String(e.text || ''), fur));
  } catch (_) { /* 学不到就只剩「成串短行」那一条规则，它不需要别的记录作证 */ }
}

/** 和这一条共用证据词的那几条，每条带着共用的词。空手是正常的：这一条上没有够罕见的词。 */
function evidenceOf(id) {
  try { learnFurniture(); } catch (_) { /* 用上一份 */ }
  if (!evIdx) return [];
  try { return links.evidenceFor(String(id || ''), evIdx); } catch (_) { return []; }
}

function refresh({ budgetMs = SYNC_BUDGET_MS } = {}) {
  index.open(store.userData, store.workspaceDir);
  index.useVecModel(vector.MODEL);
  learnFurniture();
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
/**
 * 这条记录身上挂着的全部边，**每一条都说得出自己的来路**。
 *
 * 三种边的证据不同，所以分开给，绝不合成一个「相关度」——合成的那一刻，唯一能调的又只剩阈值，
 * 而阈值这条路已经被量死了（见 src/main/links.js 顶上那笔账）。
 *
 * @returns {{source:object|null, clips:string[], run:string[], near:string[]}}
 *   source 摘自哪一页 · clips 这一页上摘了哪几条 · run 同一段操作里经过的别的页 · near 意思相近
 */
function linksOf(id) {
  const me = String(id || '');
  const out = { source: null, clips: [], run: [], evidence: [], near: [] };
  try {
    const all = [];
    for (const key of store.listDates()) all.push(...store.loadDay(key));
    const g = links.build(all);
    const l = links.linksOf(me, g);
    out.source = l.source;
    out.clips = l.clips;
    // 同一程给的是「那几页」，不是那一段里的每一条记录：一段 50 条的操作两两相连没有意义。
    // 页面名字照给，代表那一条用来点开——那一页本身多半没存过。
    out.run = l.run.pages.filter((p) => p.first).map((p) => ({ name: p.name, id: p.first }));
  } catch (_) { /* 边是加分项，没有也不该让详情打不开 */ }
  out.evidence = evidenceOf(me);
  out.near = relatedTo(me);
  return out;
}

/** 和这一条讲同一件事的那几条。空手是正常的：向量还没补齐，或者它确实没有近邻。 */
function relatedTo(id) {
  try { refresh(); } catch (_) { /* 索引没追平也照样能用已经建好的那部分 */ }
  try { return vector.related(index, String(id || '')); } catch (_) { return []; }
}

/**
 * 一条记录周围两跳的那张图。节点带 hop，**边带 kind**。
 *
 * 语义那张图照旧（vector.graph），再把「同一处 / 同一程」并进来。边的种类要一路带到界面上：
 * 一条「摘自」和一条「意思相近」的把握完全不同，画成同一根线就是在说它们一样可靠。
 * @returns {{nodes:{id:string,hop:number}[], edges:[string,string,string][]}}
 */
function graphOf(id) {
  const me = String(id || '');
  try { refresh(); } catch (_) { /* 用已经建好的那部分 */ }
  let base = { nodes: [], edges: [] };
  try { base = vector.graph(index, me); } catch (_) { base = { nodes: [], edges: [] }; }

  const hop = new Map(base.nodes.map((n) => [n.id, n.hop]));
  hop.set(me, 0);
  const edges = base.edges.map(([a, b]) => [a, b, 'near']);
  const add = (x, h) => { if (x && !hop.has(x)) hop.set(x, h); };

  try {
    const all = [];
    for (const key of store.listDates()) all.push(...store.loadDay(key));
    const g = links.build(all);
    const l = links.linksOf(me, g);

    if (l.source) {
      const page = l.source.page;
      if (page) { add(page, 1); edges.push([me, page, 'page']); }
      // 同一页上的兄弟：它们和我是同一处来的，这是这张图里最实的一圈
      const sibs = (g.pages.get(l.source.key) || { clips: [] }).clips;
      for (const sib of sibs.slice(0, 8)) {
        if (sib === me) continue;
        add(sib, page ? 2 : 1);
        edges.push([page || me, sib, 'page']);
      }
    }
    for (const c of l.clips.slice(0, 8)) { add(c, 1); edges.push([me, c, 'page']); }
    // 同一程连的是页面，不是那一段里的每一条记录——一段五十条两两相连没有意义
    // 共用证据词的那几条：这是唯一一种**能传递**的边，也是把停车那半边和报名那半边
    // 接起来的那一根（Ultra Challenge ↔ 赛程分前后半程，共用「50km」）。
    for (const ev of evidenceOf(me).slice(0, 5)) { add(ev.id, 1); edges.push([me, ev.id, 'word']); }
    const from = (l.source && l.source.page) || me;
    for (const p of l.run.pages.slice(0, 4)) {
      const to = p.first;
      if (!to || to === from || to === me) continue;
      add(to, 2);
      edges.push([from, to, 'run']);
    }
  } catch (_) { /* 边是加分项：语义那张图照样出得来 */ }

  const seen = new Set();
  const out = [];
  for (const [a, b, kind] of edges) {
    if (!hop.has(a) || !hop.has(b) || a === b) continue;
    const key = `${a < b ? a : b}|${a < b ? b : a}|${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([a, b, kind]);
  }
  return { nodes: [...hop].map(([nid, h]) => ({ id: nid, hop: h })), edges: out };
}

function topicEntries(id) {
  try { return index.topicMembers(String(id || '')); } catch (_) { return []; }
}

module.exports = { init, run, near, warm, refresh, topicList, topicEntries, relatedTo, linksOf, evidenceOf, graphOf, MAX_ITEMS };
