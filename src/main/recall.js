'use strict';
// Retrieval for "ask my log": given a question in plain language, decide which entries it is about.
// Nothing here touches Electron, the network or a model, so `node dev/ask-test.js` exercises it directly.
//
// Two independent things are read out of the question:
//   1. time expressions ("上周", "last month", "2026-09-03") become a hard date filter;
//   2. the remaining content words are scored against every entry's title, summary, text and, for a
//      picture with no text, what the classifier saw in it.
// A question that is only a time expression ("上周我都在忙什么") ends up with zero terms — that is not a
// failure, it means "give me that whole stretch", so the range is returned unscored, newest first.
const { segment, CJK } = require('./segment');

// Function words only. The tagger's much larger stop list would be wrong here: it drops nouns such as
// 设置 / search / file, which are exactly the words a person types when looking for something.
const QUERY_STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'is', 'are',
  'was', 'were', 'be', 'been', 'am', 'do', 'did', 'does', 'have', 'has', 'had', 'can', 'could', 'would', 'should',
  'i', 'my', 'me', 'we', 'our', 'us', 'you', 'your', 'it', 'its', 'this', 'that', 'these', 'those', 'there', 'here',
  'what', 'which', 'who', 'whom', 'when', 'where', 'how', 'why', 'any', 'some', 'all', 'about', 'again', 'anything',
  'please', 'show', 'tell', 'find', 'give', 'list', 'summarize', 'summarise', 'remind', 'remember', 'was', 'were',
  '的', '了', '和', '是', '在', '我', '有', '就', '不', '都', '把', '被', '让', '给', '从', '对', '为', '以', '之',
  '跟', '还', '也', '过', '吗', '呢', '吧', '啊', '呀', '哦', '哪', '哪些', '什么', '怎么', '为什么', '如何',
  '这些', '那些', '这个', '那个', '一下', '一些', '多少', '是否', '以及', '还有', '或者', '然后', '关于',
  '有没有', '我的', '我们', '你们', '他们', '看看', '找找', '告诉', '说说', '列出', '总结', '帮我', '请',
  '要', '想', '能', '会', '可以', '需要', '记得', '当时', '后来', '一共', '到底', '究竟',
]);

// ICU happily glues two function words into one token (我都在忙 -> 我 / 都在 / 忙), so a token made of
// nothing but the single characters already listed above is a stop word too. Derived, never duplicated.
const ZH_FUNCTION = new Set([...QUERY_STOP].filter((w) => w.length === 1 && CJK.test(w)));
function allFunctionChars(w) {
  for (const ch of w) if (!ZH_FUNCTION.has(ch)) return false;
  return true;
}

// Same shape as store.js's helpers, re-stated here so this file stays free of the Electron-bound module.
function pad(n) { return String(n).padStart(2, '0'); }
function dateKeyOf(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function addDays(dateKey, n) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return dateKeyOf(new Date(y, m - 1, d + n));
}
// 0 = Monday. Weeks start on Monday in both languages the app ships with.
function weekday(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}
function monthStart(dateKey) { return `${dateKey.slice(0, 7)}-01`; }
function monthEnd(dateKey) {
  const [y, m] = dateKey.split('-').map(Number);
  return dateKeyOf(new Date(y, m, 0));
}

const ZH_DIGIT = { 零: 0, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
// Only the small numbers a person actually says about their own log: 三天, 十天, 十五天, 二十天.
function zhNumber(s) {
  if (/^\d+$/.test(s)) return Number(s);
  if (s === '十') return 10;
  let m = /^十([零一两二三四五六七八九])$/.exec(s);
  if (m) return 10 + ZH_DIGIT[m[1]];
  m = /^([一两二三四五六七八九])十([零一两二三四五六七八九])?$/.exec(s);
  if (m) return ZH_DIGIT[m[1]] * 10 + (m[2] ? ZH_DIGIT[m[2]] : 0);
  return ZH_DIGIT[s] ?? null;
}

function one(key) { return { from: key, to: key }; }
function lastNDays(n, today) { return { from: addDays(today, -(n - 1)), to: today }; }

// Ordered: the longer expression has to win, or 前天 is read as 天 and 上个月 as 月.
const RANGE_RULES = [
  [/(?:(\d{4})\s*年)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/, (m, today) => one(`${m[1] || today.slice(0, 4)}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`)],
  [/前天|day before yesterday/i, (m, today) => one(addDays(today, -2))],
  [/昨天|昨日|\byesterday\b/i, (m, today) => one(addDays(today, -1))],
  [/今天|今日|\btoday\b/i, (m, today) => one(today)],
  [/上(?:个)?(?:周|星期|礼拜)|\blast week\b/i, (m, today) => {
    const from = addDays(addDays(today, -weekday(today)), -7);
    return { from, to: addDays(from, 6) };
  }],
  [/(?:本|这|这个)(?:周|星期|礼拜)|\bthis week\b/i, (m, today) => ({ from: addDays(today, -weekday(today)), to: today })],
  [/上(?:个)?月|\blast month\b/i, (m, today) => {
    const prev = addDays(monthStart(today), -1);
    return { from: monthStart(prev), to: monthEnd(prev) };
  }],
  [/(?:本|这|这个)月|\bthis month\b/i, (m, today) => ({ from: monthStart(today), to: today })],
  [/(?:最近|近|过去|这)\s*([0-9]+|[零一两二三四五六七八九十]{1,3})\s*(天|周|星期|礼拜|个?月)/, (m, today) => {
    const n = zhNumber(m[1]);
    if (!n) return null;
    return lastNDays(m[2] === '天' ? n : /月/.test(m[2]) ? n * 30 : n * 7, today);
  }],
  [/\b(?:last|past|recent)\s+(\d{1,3})\s+(day|week|month)s?\b/i, (m, today) => {
    const n = Number(m[1]);
    return lastNDays(m[2].toLowerCase() === 'day' ? n : m[2].toLowerCase() === 'week' ? n * 7 : n * 30, today);
  }],
  [/最近|这几天|前几天|\brecently\b|\blately\b/i, (m, today) => lastNDays(7, today)],
];

/**
 * Reads a date range out of the question.
 * @returns {{from:string,to:string,matches:string[]}|null} inclusive dateKeys plus the words that said so
 *   (the caller strips those, so "上周" does not also go looking for entries containing the text 上周)
 */
function parseRange(question, todayKey) {
  const q = String(question || '');
  const iso = q.match(/\d{4}-\d{2}-\d{2}/g);
  if (iso) {
    const sorted = [...new Set(iso)].sort();
    return { from: sorted[0], to: sorted[sorted.length - 1], matches: [...new Set(iso)] };
  }
  for (const [re, handler] of RANGE_RULES) {
    const m = re.exec(q);
    if (!m) continue;
    const range = handler(m, todayKey);
    if (range) return { ...range, matches: [m[0]] };
  }
  return null;
}

/**
 * Splits the question into the terms worth matching, with the time words already removed.
 * `allowSingle` decides whether a lone CJK character may stand in when nothing else survives.
 * Latin tokens are kept as words (short ones too — "AI", "PR" are exactly what people search for).
 * Chinese is matched as character bigrams: ICU's word segmenter cuts 报错 into 报 + 错 here, and single
 * characters hit everything, so 报错截图 becomes 报错 / 错截 / 截图 — the junk pair simply never matches.
 */
function queryTerms(question, lang, { allowSingle = true } = {}) {
  const terms = [];
  const loners = [];
  const seen = new Set();
  const push = (w) => {
    const key = CJK.test(w) ? w : w.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    terms.push(key);
  };
  let run = [];   // a stretch of consecutive single-character CJK tokens
  const flush = () => {
    if (run.length === 1) loners.push(run[0]);
    else for (let i = 0; i + 1 < run.length; i++) push(run[i] + run[i + 1]);
    run = [];
  };
  for (const s of segment(String(question || ''), lang)) {
    const w = s.w.trim();
    if (!s.wordLike || !w || !/[\p{L}\p{N}]/u.test(w)) { flush(); continue; }
    const isCjk = CJK.test(w);
    if (QUERY_STOP.has(isCjk ? w : w.toLowerCase()) || (isCjk && allFunctionChars(w))) { flush(); continue; }
    if (!isCjk) {
      flush();
      if (w.length >= 2 && (/\p{L}/u.test(w) || w.length >= 3)) push(w);
      continue;
    }
    if (w.length === 1) run.push(w);
    else { flush(); push(w); }
  }
  flush();
  // A one-character question ("找一下猫") has nothing else to go on, so the lone character has to serve.
  // After a time expression it must not: "上周我都在忙什么" leaves a stray 忙 behind, and searching for
  // it would turn a question about a whole week into a near-empty result.
  if (!terms.length && allowSingle) for (const w of loners) push(w);
  return terms;
}

// Where a term can be found, and how much a hit there is worth. A title is deliberate signal, OCR
// text the noisiest, hence the spread. What the classifier saw sits at the top because for a picture
// with no text it is the only handle there is.
const FIELDS = [
  ['tags', 3.5],          // only on records saved before per-entry keyword tagging was dropped
  ['seen', 3.5],          // what the classifier saw: a wordless picture's only handle
  ['title', 3],
  ['summary', 2],
  ['meta', 1.2],
  ['text', 1],
];
const TEXT_SCAN = 20000;   // characters of OCR/transcript text scanned per entry

function haystacks(e) {
  return {
    tags: (e.tags || []).join(' ').toLowerCase(),
    seen: String(e.visionLabels || '').toLowerCase(),
    title: String(e.title || '').toLowerCase(),
    summary: String(e.summary || '').toLowerCase(),
    meta: [e.path, e.url, e.sourceUrl, e.sourceTitle, e.type].filter(Boolean).join(' ').toLowerCase(),
    text: String(e.text || '').slice(0, TEXT_SCAN).toLowerCase(),
  };
}

function countOcc(hay, term) {
  if (!hay) return 0;
  let n = 0;
  let i = hay.indexOf(term);
  while (i !== -1) { n++; i = hay.indexOf(term, i + term.length); }
  return n;
}

function inRange(dateKey, range) {
  return !range || (dateKey >= range.from && dateKey <= range.to);
}

/**
 * @param {Array} entries      every entry in the workspace (newest first is fine, order does not matter)
 * @param {string} question
 * @param {{today?:string, limit?:number, lang?:string}} [opts]
 * @returns {{entries:Array, range:{from:string,to:string}|null, terms:string[], scored:boolean}}
 */
function recall(entries, question, { today = dateKeyOf(new Date()), limit = 40, lang } = {}) {
  const found = parseRange(question, today);
  const range = found ? { from: found.from, to: found.to } : null;
  const pool = entries.filter((e) => inRange(e.dateKey, range));
  // The time words already did their job as a filter; leaving them in would make the search go
  // looking for entries whose text literally says 上周.
  let rest = String(question || '');
  if (found) for (const m of found.matches) rest = rest.split(m).join(' ');
  const terms = queryTerms(rest, lang, { allowSingle: !range });
  const byNewest = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt));

  // "上周我都干了什么": no content words left, so the range itself is the answer.
  if (!terms.length) {
    return { entries: [...pool].sort(byNewest).slice(0, limit), range, terms, scored: false };
  }

  const bags = pool.map(haystacks);
  // Document frequency over the pool: a word in nearly every entry (a recurring app name, the user's
  // own handle) says much less about which entry is meant than a word that appears three times.
  const df = new Map();
  for (const bag of bags) {
    for (const term of terms) {
      if (Object.values(bag).some((h) => h.includes(term))) df.set(term, (df.get(term) || 0) + 1);
    }
  }
  const idf = new Map(terms.map((term) => [term, Math.log((pool.length + 1) / ((df.get(term) || 0) + 1)) + 0.25]));

  const todayMs = new Date(`${today}T00:00:00`).getTime();
  const scored = [];
  for (let i = 0; i < pool.length; i++) {
    const bag = bags[i];
    let score = 0;
    let matched = 0;
    for (const term of terms) {
      let hit = 0;
      for (const [field, weight] of FIELDS) {
        const c = countOcc(bag[field], term);
        if (c) hit += weight * (1 + Math.log(Math.min(c, 20)));
      }
      if (hit > 0) { matched++; score += hit * idf.get(term); }
    }
    if (!matched) continue;
    // An entry that answers four words of the question beats one that answers a single word loudly.
    score *= 0.35 + 0.65 * (matched / terms.length);
    const ageDays = Math.max(0, (todayMs - new Date(pool[i].createdAt).getTime()) / 86400000);
    score *= 1 + 0.08 * Math.exp(-ageDays / 21);
    scored.push({ e: pool[i], score, matched });
  }
  scored.sort((a, b) => b.score - a.score || byNewest(a.e, b.e));
  return { entries: scored.slice(0, limit).map((s) => s.e), range, terms, scored: true };
}

module.exports = { recall, parseRange, queryTerms, addDays, dateKeyOf };
