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

/**
 * @param {object} index src/main/index-db（或任何有 search/days 的东西）
 * @param {string} question 用户原样打进来的话
 * @param {{today:string, limit:number}} opts
 * @returns {{ids:string[], scored:boolean, terms:string[], range:{from,to}|null, inRange:number, rest:string}}
 */
function select(index, question, { today, limit = 40 } = {}) {
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

  return {
    ids: hit.ids,
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
