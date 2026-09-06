'use strict';
// "Ask my log". recall.js picks the entries a question is about; the configured model then answers over
// only those and cites them by number. The recalled entries are returned either way — with no AI service
// configured, or when the call fails, a ranked list of the right records is still most of the answer.
const llm = require('./llm');
const recall = require('./recall');
const { localDateKey } = require('./store');
const { uiLanguage } = require('./languages');

let store;
function init(deps) { store = deps.store; }

const MAX_ITEMS = 40;   // as many as a daily-recap-sized context comfortably holds

/**
 * @param {string} question
 * @returns {Promise<null|{question:string, answer:string, used:number[], sources:Array,
 *   range:{from:string,to:string}|null, scored:boolean, noProvider:boolean, error:string, model:string}>}
 */
async function run(question, { limit = MAX_ITEMS } = {}) {
  const q = String(question || '').trim();
  if (!q) return null;
  const all = store.listEntries({ limit: Infinity });
  const hit = recall.recall(all, q, { today: localDateKey(), limit, lang: uiLanguage(store.getSettings().languages) });
  const base = {
    question: q, answer: '', used: [], model: '',
    sources: hit.entries, range: hit.range, scored: hit.scored,
    noProvider: false, error: '', total: all.length,
  };
  if (!hit.entries.length) return base;

  const cfg = llm.config(store);
  if (!llm.isConfigured(cfg)) return { ...base, noProvider: true };
  try {
    const r = await llm.answerQuestion(cfg, { question: q, entries: hit.entries });
    return { ...base, answer: r.answer, used: r.used, model: r.model };
  } catch (e) {
    return { ...base, error: e.message || String(e) };
  }
}

module.exports = { init, run, MAX_ITEMS };
