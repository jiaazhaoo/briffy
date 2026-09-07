'use strict';
// 一个问题 → 该给模型看哪些记录。
//
// 这段以前长在 ask.js 里。搬出来是因为它在那儿测不到：ask.js 要 store，store 要 electron，
// 于是唯一能测的办法是把这几行在测试里再抄一遍——而「同一条规则抄两份」正是这个文件顶上那段
// 注释里已经承认过一次的老毛病。抄一份就会漂一份，漂了就没人知道。
//
// 所以这里不 require store、不 require electron，索引从参数进来。它能被 node 直接跑，
// dev/retrieval-test.js 跑的就是这一份，不是它的复制品。
const recall = require('./recall');

const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

/**
 * 排掉两种记录，靠的都不是词库。
 *
 * 一是**回声**：正文里原样含着这个问题的记录。它们不是证据，是问题自己的影子——而且往往是上一次
 * 的问答被复制回工作区留下的，里面带着上一次的答案。实测过一次：一个问题的前两名都是回声，第二名
 * 里写着上一次那个错日期，模型引用了它四次，把错答案原样抄了一遍。**记录里原样写着你的问题，
 * 这件事本身就说明它不是这个问题的答案。**
 *
 * 二是**问话的词**：「看看」「生成」在这个工作区里也很稀有，但它们属于"问"，不属于"这件事"。
 * 分辨它们不需要停用词表——清了门槛的那些记录（同时占着两个以上稀有词的）共同占着的词，
 * 就是这个问题真正在说的东西。只占到别的词的记录排在后面。实测：16 条里 8 条是靠「看看」
 * 挤进来的 briffy 开发笔记，这条规则把它们全排到了后面。
 *
 * @param {string[]} ids 索引给出的候选，已经按命中个数排过
 * @param {Record<string,string[]>} matched 每条命中了哪几个词
 * @param {(id:string)=>object|null} getEntry
 */
function rerank(ids, matched, question, getEntry) {
  if (!getEntry || !matched || !Object.keys(matched).length) return ids;
  const q = norm(question);
  const textOf = (id) => { const e = getEntry(id); return e ? norm(`${e.title || ''} ${e.text || ''}`) : ''; };
  const echo = new Set(q.length >= 8 ? ids.filter((id) => textOf(id).includes(q)) : []);

  const topic = new Set();
  for (const id of ids) {
    if (echo.has(id)) continue;                       // 回声占着每一个词，让它定调就全乱了
    const w = matched[id] || [];
    if (w.length >= 2) for (const t of w) topic.add(t);
  }
  const tier = (id) => {
    if (echo.has(id)) return 3;
    const w = matched[id] || [];
    if (w.length >= 2) return 0;                      // 两个以上一起出现，最可信
    if (w.some((t) => topic.has(t))) return 1;        // 只占一个，但占的是这件事的词
    return 2;                                          // 只占到问话的词
  };
  return ids.map((id, i) => ({ id, i, t: tier(id) }))
    .sort((a, b) => (a.t - b.t) || (a.i - b.i))
    .map((x) => x.id);
}

/**
 * @param {object} index src/main/index-db（或任何有 search/days 的东西）
 * @param {string} question 用户原样打进来的话
 * @param {{today:string, limit:number, getEntry?:Function, keep?:number}} opts
 * @returns {{ids:string[], scored:boolean, terms:string[], range:{from,to}|null, inRange:number, rest:string}}
 */
function select(index, question, { today, limit = 40, getEntry = null, keep = 0 } = {}) {
  const q = String(question || '').trim();
  if (!q) return { ids: [], scored: false, terms: [], range: null, inRange: 0, rest: '' };

  // 时间词归 recall.js 管——那一套有测试盯着，也是这里唯一需要「懂中文」的地方。
  // 它挑完之后要把那些词从查询里去掉，否则索引会去找正文里真的写着「上周」的记录。
  const found = recall.parseRange(q, today);
  let rest = q;
  if (found) for (const m of found.matches) rest = rest.split(m).join(' ');

  const from = found ? found.from : '';
  const to = found ? found.to : '';
  let hit = index.search({ query: rest, from, to, limit });
  // 问了一段时间却一条也没匹配上，就把那段时间整个给他——他问的就是那段时间。
  // 「今天做了什么」曾经返回 0 条：日期词拿走之后剩下的「做了」成了一个内容词，正文里一次也没出现。
  // 补停用词治不了「今天弄了些啥」，所以钉的是结果。
  if (!hit.ids.length && found) hit = index.search({ from, to, limit });

  let ids = rerank(hit.ids, hit.matched, q, getEntry);
  // 一句话问出来的东西，宁可少而长，不要多而碎：八千字摊给十六条是每条五百字，摊给六条是
  // 一千三。真正含着答案的那几条需要的是后者。keep 是上层给的「最多留几条」。
  if (keep && hit.scored && hit.matched && ids.length > keep) ids = ids.slice(0, keep);

  return {
    ids,
    scored: hit.scored,
    terms: hit.terms || [],
    range: found ? { from: found.from, to: found.to } : null,
    // 这段时间里一共有多少条。退回时间范围时给的是「最近 40 条」，界面上得说清楚是 40 还是全部
    // ——它以前一律写「这段时间的全部记录」，而那一周实际有 208 条。
    inRange: found ? index.days({ from, to }).reduce((n, d) => n + d.n, 0) : 0,
    rest,
  };
}

module.exports = { select };
