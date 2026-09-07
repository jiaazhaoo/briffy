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
const links = require('./links');
const boilerplate = require('./boilerplate');
const story = require('./story');
const { CJK } = require('./segment');
const index = require('./index-db');
const { localDateKey } = require('./store');

let store;
function init(deps) { store = deps.store; }

const MAX_ITEMS = 40;   // as many as a daily-recap-sized context comfortably holds
// 一句话问出来的东西最多留这么几条。40 是给「把这段时间给我」用的；一个具体的问题给四十条，
// 结果是每条只摊到五百字，而含着答案的那几条正需要一千多。少而长。
const KEEP = 16;
// 一条查询最多贡献这么几条。**卡得紧是有道理的**：一个问题有好几个面（起点、终点、停车），
// 让第一条查询把名额吃光，剩下的面就一条也进不来——今天量到的正是这个，把词揉成一句只捞回
// 1/7，拆成五条各取前 3 捞回 3/7。
const PER_QUERY = 3;
// 检索够到的那几条之外，再沿链补这么多。链是「说得出理由」的那一路（同一个罕见词、同一页、
// 同一段操作），它在库大起来之后**不会变差**，而向量会——所以补位交给它，不交给向量。
const CHAIN_ADD = 5;
const CHAIN_SEEDS = 8;   // 拿前几条当种子。再多就是让排在后面的、本来就不确定的那几条去开枝散叶
const CHAIN_SPAN = 16;   // 每个种子长这么大的一片就够——要的是近邻，不是整件事
// 短问句不当回声判据：「今天呢」这种三个字，正文里随手就撞上，挡掉的会是真记录。
const ECHO_MIN = 8;
// 只在短记录上判「整条是家具」。长记录里夹着一行家具是常态，不该因此整条丢掉。
const JUNK_MAX = 120;
// 上一轮带过来几条。带多了这一问就成了上一问的回声，带少了追问就没有主语。
const CARRY_TURNS = 2;   // 往回带几轮
const CARRY_EACH = 3;    // 每轮带那一轮排最前的几条
const CARRY_ROOM = 4;    // 一共最多占这么多格
// 手上那几条记录里最罕见的几个名字，直接当查询。**不经过模型**——名字和罕见度都是算出来的。
const SEED_QUERIES = 4;
const MAX_QUERIES = 10;  // 一问最多分这么多路。再多每路就只剩一两个名额，等于没分
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

/** 扩散要用的那一套：页面图、证据词倒排、向量邻居。都是现算的，谁也不落库。 */
function storyCtx() {
  try { learnFurniture(); } catch (_) { /* 用上一份 */ }
  const all = [];
  for (const key of store.listDates()) all.push(...store.loadDay(key));
  const fur = boilerplate.furniture();
  return {
    g: links.build(all),
    ev: evIdx,
    ids: all.map((e) => e.id),
    near: (x) => { try { return vector.related(index, x, { limit: 4 }); } catch (_) { return []; } },
  };
}

/**
 * 这几条记录里都有哪些名字，罕见的在前。
 *
 * 给改写那一步当菜单用。抽名字这件事已经有人做了（entity.js，滤掉网页家具和虚词，
 * 邮编日期数量走正则），这里只是把它取出来排个序——**不是新造一套抽取**。
 * @returns {string[]}
 */
function namesIn(ids) {
  learnFurniture();
  if (!evIdx) return [];
  const score = new Map();
  for (const id of new Set(ids)) {
    for (const k of evIdx.words.get(id) || []) {
      const df = evIdx.df.get(k) || 99;
      const t = evIdx.text.get(k);
      if (t && (score.get(t) === undefined || df < score.get(t))) score.set(t, df);
    }
  }
  return [...score.entries()].sort((a, b) => a[1] - b[1]).map(([t]) => t);
}

/** 上一轮真正用上的那几条。模型自己报的 used 是 1 起的下标，对应当时给它的 sources。 */
function usedIds(turn) {
  const t = turn || {};
  const ids = Array.isArray(t.ids) ? t.ids : [];
  const used = Array.isArray(t.used) ? t.used : [];
  const picked = used.map((n) => ids[Number(n) - 1]).filter(Boolean);
  return picked.length ? picked : ids;      // 没报 used 就退回全部，总比没有主语强
}

/**
 * 认出回声：正文里原样写着你问过的话的记录。
 *
 * 它们几乎都是上一次问答被复制回工作区留下的，里面带着上一次的答案——而那份答案是**摘要**，
 * 门牌号早在摘要里就没了。同时它们又是词面上最完美的命中（问题的每一个字它都有），
 * 所以不挡住的话，模型读的永远是自己上次说过的话，越读越薄。
 * @param {string[]} questions 这一场对话里问过的话
 * @returns {(id:string)=>boolean}
 */
function echoFilter(questions) {
  const qs = (questions || []).map((x) => String(x || '').replace(/\s+/g, '').toLowerCase())
    .filter((x) => x.length >= ECHO_MIN);
  if (!qs.length) return () => false;
  return (id) => {
    const e = store.getEntry(id);
    if (!e) return false;
    const t = `${e.title || ''} ${e.text || ''}`.replace(/\s+/g, '').toLowerCase();
    return qs.some((x) => t.includes(x));
  };
}

/**
 * 整条都是网页家具的记录，别占格子。
 *
 * 「English (Great Britain)」这种——一个语言选择条，被复制过好几回。它对任何问题都不是答案，
 * 但它短、干净、在向量空间里离哪儿都不远，所以每次都挤进来。实测第 2 问十六格里它占了三格。
 * 判据不新造：boilerplate 已经学过「哪些行是家具」（出现在三条以上记录里的行），
 * 一条记录**整条**就是这么一行，那它就是家具本身。
 *
 * 同一段文字重复存过好几遍的也只留一条：三条一模一样的记录给模型看，它读到的信息是一样的，
 * 占掉的却是三个格子。
 * @returns {(id:string)=>boolean}
 */
function junkFilter() {
  const fur = boilerplate.furniture();
  const body = new Set();
  return (id) => {
    const e = store.getEntry(id);
    if (!e) return true;
    const t = `${e.title || ''} ${e.text || ''}`.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!t) return true;
    if (body.has(t)) return true;                       // 一模一样的第二遍
    if (fur && t.length <= JUNK_MAX) {
      const lines = String(e.text || '').split('\n').map((x) => boilerplate.key(x)).filter(Boolean);
      if (lines.length && lines.every((x) => fur.has(x))) return true;
    }
    body.add(t);
    return false;
  };
}

/**
 * 从检索够到的这几条出发，沿链走一跳，补几条它们的近邻。
 *
 * 为什么补位交给链、不交给向量：今天量过，250 条的时候向量前十里排在正确答案前面的已经是
 * 「5381491216421114」「ipaslogo.com」和一行破折号——噪声和答案在同一个距离带（0.38~0.47）。
 * 噪声条数随库线性长，对的答案永远只有几条，所以**向量是唯一一个库越大越差的部件**。
 * 而链走的是硬证据：一个邮编在一百万条里仍然只指着那几条。
 * @returns {string[]}
 */
function chainAround(seeds, room) {
  const n = Math.min(CHAIN_ADD, Math.max(0, room));
  if (!n || !seeds.length) return [];
  try {
    const ctx = storyCtx();
    const have = new Set(seeds);
    const best = new Map();
    for (const seed of seeds.slice(0, CHAIN_SEEDS)) {
      for (const m of story.grow(seed, ctx, { max: CHAIN_SPAN }).members) {
        if (have.has(m.id)) continue;
        if ((best.get(m.id) || 0) < m.score) best.set(m.id, m.score);
      }
    }
    return [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => id);
  } catch (_) { return []; }        // 长不出来就算了，检索够到的那几条本来就是答案的大半
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
      })
      .catch((e) => console.warn('[ask] 向量补不了：', e.message || e));
  };
  const step = () => {
    let r;
    try { r = refresh({ budgetMs: 1500 }); } catch (e) { console.warn('[ask] 索引建不起来', e.message); return; }
    if (!r.done) { setTimeout(step, 800); return; }   // 留出空档，别把启动那几秒占满
    setTimeout(fillVectors, 800);
  };
  setTimeout(step, 3000);
}

/**
 * @param {string} question
 * @returns {Promise<null|{question:string, answer:string, used:number[], sources:Array,
 *   range:{from:string,to:string}|null, scored:boolean, noProvider:boolean, error:string, model:string}>}
 */
async function run(question, { limit = MAX_ITEMS, history = [] } = {}) {
  const q = String(question || '').trim();
  if (!q) return null;
  const today = localDateKey();
  try { refresh(); } catch (e) { console.warn('[ask] 索引没能追平', e.message); }

  const cfg0 = llm.config(store);
  // ① 这一问该拿什么去检索。模型不在就是空数组，下面退回原句——那时的行为和从前一模一样。
  // 改写的时候，把「上一轮真正用上的那几条记录里的名字」摆给它挑。它只能说出它见过的词，
  // 而上一次回答有没有把地名写出来是碰运气的——名字这一份不碰运气，是 entity.js 算出来的。
  const seeds = namesIn(history.slice(-CARRY_TURNS).flatMap((t) => usedIds(t).slice(0, CARRY_EACH)));
  const plan = llm.isConfigured(cfg0) ? await llm.searchPlan(cfg0, { question: q, history, seeds }).catch(() => []) : [];

  // 真正拿去检索的几条，**模型只出其中一部分**：
  //   · 原句和它的实词——这两条是地板。没有模型、模型抽风、改写全被滤掉，剩下的仍然是今天这套，
  //     不多不少。ask.js 顶上那条「不依赖模型也能定位」的保证就落在这儿。
  //   · 手上那几条记录里最罕见的几个名字，**直接当查询用，不经过模型**。让模型从菜单里挑，
  //     实测它挑不准：菜单里明明有 Runnymede，它挑走了 Thames / Path / Ultra / Challenge。
  //     名字是算出来的，罕见度也是算出来的，那就别让它猜——猜的部分留给「还该从哪个角度找」。
  //   · 模型出的那几条，补角度用。
  const plain = retrieve.select(index, q, { today, limit, getEntry: (id) => store.getEntry(id) });
  const queries = [];
  for (const x of [q, (plain.terms || []).join(' '), ...seeds.slice(0, SEED_QUERIES), ...plan]) {
    const s2 = String(x || '').trim();
    if (s2 && !queries.includes(s2)) queries.push(s2);
    if (queries.length >= MAX_QUERIES) break;
  }

  // ② 每条查询各自挑一小把，再并起来。**分开问，不揉成一句**——见 llm.searchPlan 那笔账。
  //
  // 回声在这里滤，不在 retrieve.rerank 里滤：那一层比的是「记录里有没有原样写着**这条查询**」，
  // 而改写之后送进去的是「Bishops Park」这种词，回声当然不含它，于是那道闸整个失效了。
  // 实测：第 2 问十六格里五格是回声（自己上一次的问答被复制回工作区留下的）。
  // 所以按**整场对话的问句**滤——记录里原样写着你问过的话，它就不是这句话的答案。
  const echoed = echoFilter([...history.map((t) => (t || {}).question), q]);
  const drop = junkFilter();
  // 上一轮读过的那几条记录，直接带过来。
  //
  // **一场对话的状态不是那几段文字，是那几条记录。** 实测栽在这儿两次：改写这一步只能说出
  // 上一次回答里出现过的词，而上一次回答说没说「Bishops Park」是碰运气的——同一个问题跑两遍，
  // 一遍说了（于是第 2 问找得到起点），一遍没说（于是第 2 问从零开始，答「未找到」）。
  // 而上一轮手上那条「赛程分前后半程」里从头到尾写着起点和终点，它跟回答说了什么无关。
  //
  // 带的是**上一轮真正用上的那几条**（模型自己报的 used），不是它当时手上的全部。带全部会把
  // 上一轮那些没用上的杂物（一条 GitHub 仓库、一条 Andrew Ng 的推）一路拖下去，越拖越脏。
  const carried = [];
  for (const t of history.slice(-CARRY_TURNS)) {
    for (const id of usedIds(t).slice(0, CARRY_EACH)) {
      if (!carried.includes(id) && store.getEntry(id)) carried.push(id);
    }
  }
  const seen = new Set();
  let pick = null;
  const room = KEEP - CHAIN_ADD;      // 给链留出位子，别让检索把格子占满
  // 每条查询各留一小串，最后**按名次横着取**：先把每条查询的第一名都收进来，再收第二名。
  // 顺着一条条查询收是错的，实测栽过：「起点地址」那条查询的第一名（Bishops Park, Fulham）
  // 排在第十六位，模型根本没读到它，回了一句「记录中未包含起点和终点的详细地址」——
  // 而答案就是它手上的最后一条。一个问题的几个面是**平级**的，收的时候就得平级。
  const lanes = [];
  for (const sub of queries) {
    const p = sub === q ? plain : retrieve.select(index, sub, { today, limit, getEntry: (id) => store.getEntry(id) });
    if (!pick && p.ids.length) pick = p;                    // 时间范围和词按第一条命中的算
    if (!p.ids.length) continue;
    const near = await vector.search(index, sub, { limit, cacheDir: store.paths().models, from: p.range ? p.range.from : '' })
      .catch(() => []);
    lanes.push(retrieve.fuse(p.ids, near, PER_QUERY * 3).filter((id) => !echoed(id) && !drop(id)));
  }
  const ids = [];
  for (const id of carried) {                       // 上一轮的先站住位子，它们是这一问的主语
    if (ids.length >= CARRY_ROOM || seen.has(id) || echoed(id) || drop(id)) continue;
    seen.add(id); ids.push(id);
  }
  for (let r = 0; r < PER_QUERY && ids.length < room; r++) {
    for (const lane of lanes) {
      if (ids.length >= room) break;
      const id = lane[r];
      if (id && !seen.has(id)) { seen.add(id); ids.push(id); }
    }
  }
  if (!pick) pick = plain;

  // ③ 沿链走一跳补位。找地址那次就靠它：Runnymede Pleasure Ground 和 Windsor Road 共用邮编
  //    TW20 0AE，检索只够到前者，一跳就把后者带上来了。
  for (const id of chainAround(ids, KEEP - ids.length)) {
    if (!seen.has(id) && !echoed(id) && !drop(id)) { seen.add(id); ids.push(id); }
  }

  const entries = ids.slice(0, KEEP).map((id) => store.getEntry(id)).filter(Boolean);

  const base = {
    question: q, answer: '', used: [], model: '',
    sources: entries, range: pick.range,
    scored: pick.scored, noProvider: false, error: '', total: index.stats().entries,
    inRange: pick.inRange, queries, ids: entries.map((e) => e.id),
  };
  if (!entries.length) return base;

  const cfg = cfg0;
  if (!llm.isConfigured(cfg)) return { ...base, noProvider: true };
  try {
    const r = await llm.answerQuestion(cfg, { question: q, entries, terms: pick.terms, history });
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

/**
 * 和这一条有关的记录，**一条按远近排好的清单**，每条都说得出为什么。
 *
 * 之前这里是四组分开列的边（摘自 / 从这一页摘的 / 同一程 / 同一个词），外加一张图谱。
 * 图谱做不成：十四张卡片、四十多条线，线上还写着字，实测就是一团乱麻，读不出任何东西。
 * 而分四组也不对——**你要的是「和这条最近的是哪几条」，不是「按证据种类分类的四张小表」**。
 *
 * 所以合成一条清单，用 story.grow 排：它本来就是按分数排好的，而且每条都带着
 * 它是被哪条边、哪一对词放进来的。左边写理由，右边写标题。
 * @returns {{related:{id:string, score:number, why:object}[]}}
 */
function linksOf(id) {
  const me = String(id || '');
  try {
    const s = story.grow(me, storyCtx(), { max: 14 });
    return {
      related: s.members
        .filter((m) => m.id !== me)
        .map((m) => ({ id: m.id, score: m.score, why: m.via || null })),
    };
  } catch (_) { return { related: [] }; }
}

/** 和这一条讲同一件事的那几条。空手是正常的：向量还没补齐，或者它确实没有近邻。 */
function relatedTo(id) {
  try { refresh(); } catch (_) { /* 索引没追平也照样能用已经建好的那部分 */ }
  try { return vector.related(index, String(id || '')); } catch (_) { return []; }
}

module.exports = { init, run, near, warm, refresh, relatedTo, linksOf, evidenceOf, MAX_ITEMS };
