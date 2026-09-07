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
const index = require('./index-db');
const { localDateKey } = require('./store');

let store;
function init(deps) { store = deps.store; }

const MAX_ITEMS = 40;   // as many as a daily-recap-sized context comfortably holds
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
function refresh({ budgetMs = SYNC_BUDGET_MS } = {}) {
  index.open(store.userData, store.workspaceDir);
  const dir = entriesDir();
  const readDay = (k) => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, `${k}.json`), 'utf8')); } catch (_) { return []; }
  };
  return index.sync({ dir, loadDay: readDay }, { budgetMs });
}

/** 应用起来之后在后台把索引建完，这样第一次提问就已经是齐的。 */
function warm() {
  const step = () => {
    let r;
    try { r = refresh({ budgetMs: 1500 }); } catch (e) { console.warn('[ask] 索引建不起来', e.message); return; }
    if (!r.done) setTimeout(step, 800);          // 留出空档，别把启动那几秒占满
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

  const pick = retrieve.select(index, q, { today, limit });
  const entries = pick.ids.map((id) => store.getEntry(id)).filter(Boolean);

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

module.exports = { init, run, warm, refresh, MAX_ITEMS };
