'use strict';
// 向量那一半：把记录算成向量存进索引，以及拿一个问题去找相近的记录。
//
// 它是**词面检索的补充，永远不是替代**。dev/semantic-bench.js 在真实工作区上量过：
// 六道有答案的日常题，词面对四道、向量也对四道，但错的不是同几道——向量找得到「显示器型号」
// （问题里没有一个字出现在那条英文记录里），却丢了「推荐跑哪个模型」（那条记录的标题里就写着
// 答案）。并集是五道。所以两边都要，谁也别想单干。
//
// 更硬的一条理由是**向量不会说「找不到」**。同一次实测里，一条正确答案得 0.445，而一个工作区
// 里根本没有的问题(«我上个月去哪里旅游了») 照样能凑出 0.432。分数没有绝对意义，没有可用的阈值。
// 所以这里定死一条：**词面交白卷时，向量也不出手**（融合在 retrieve.fuse 里，见那边的注释）。
// 少了这一条，今天刚修掉的「静默降级」会以更难发现的形式回来。
const embed = require('./embed');
const chunk = require('./chunk');

const MODEL = embed.MODEL;

/**
 * 把还欠着的记录补上向量，只做这么久。
 *
 * 挂在 ask.js 已有的那条预算循环上，不新建调度：那条循环本来就是「限时、可中断、下次接着做」，
 * 而这件事的形状和建倒排索引一模一样。实测每条记录 21ms，攒十条约 0.2 秒——够小，小到可以
 * 跟着队列走，不需要等什么闲时窗口。
 *
 * @param {object} index src/main/index-db
 * @param {(dayKey:string)=>object[]} loadDay
 * @param {{budgetMs?:number, batch?:number, cacheDir:string, mirror?:string}} opts
 * @returns {Promise<{done:boolean, entries:number, chunks:number, ms:number, error:string}>}
 */
async function fill(index, loadDay, { budgetMs = 1500, batch = 10, cacheDir, mirror = '' } = {}) {
  index.useVecModel(MODEL);
  const t0 = Date.now();
  let entries = 0; let chunks = 0;
  if (!embed.available()) return { done: true, entries: 0, chunks: 0, ms: 0, error: embed.reason() || '' };
  try {
    index.sweepVec(50);
    while (Date.now() - t0 < budgetMs) {
      const need = index.needVec(batch);
      if (!need.length) return { done: true, entries, chunks, ms: Date.now() - t0, error: '' };
      // 一天的记录一起读，别为同一天的十条记录读十次天文件
      const byDay = new Map();
      for (const n of need) { if (!byDay.has(n.day)) byDay.set(n.day, loadDay(n.day) || []); }
      const jobs = [];
      for (const n of need) {
        const e = (byDay.get(n.day) || []).find((x) => x && x.id === n.id);
        if (!e) continue;
        const cs = chunk.chunksOf(e);
        if (!cs.length) continue;
        jobs.push({ id: e.id, hash: chunk.hashOf(e, MODEL), texts: cs });
      }
      if (!jobs.length) return { done: true, entries, chunks, ms: Date.now() - t0, error: '' };
      const flat = jobs.flatMap((j) => j.texts);
      const vecs = await embed.embed(flat, { cacheDir, mirror });
      let k = 0;
      for (const j of jobs) {
        index.putVec(j.id, j.hash, vecs.slice(k, k + j.texts.length));
        k += j.texts.length;
        entries++; chunks += j.texts.length;
      }
    }
    return { done: false, entries, chunks, ms: Date.now() - t0, error: '' };
  } catch (e) {
    // 这台机器跑不动模型、模型没下下来、超时——都不该让「问」这条路挂掉，词面那一半照常工作。
    return { done: true, entries, chunks, ms: Date.now() - t0, error: e.message || String(e) };
  }
}

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/**
 * 拿一个问题去找意思相近的记录。返回的是按相近程度排好的 id，**不带分数**——分数在这里没有
 * 绝对意义，交出去只会诱人拿它当阈值用。
 *
 * 一条记录取它最好的那一块的分：一篇长文章里只要有一段说到了，这条就算说到了。
 * @returns {Promise<string[]>}
 */
async function search(index, question, { limit = 40, cacheDir, mirror = '', from = '' } = {}) {
  if (!embed.available()) return [];
  const q = String(question || '').trim();
  if (!q) return [];
  let qv;
  try { [qv] = await embed.embed([q], { cacheDir, mirror }); } catch (_) { return []; }
  if (!qv || !qv.length) return [];
  const best = new Map();
  index.vecScan((id, v) => {
    if (v.length !== qv.length) return;
    const s = dot(qv, v);
    const had = best.get(id);
    if (had === undefined || s > had) best.set(id, s);
  }, { day: from });
  return [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
}

module.exports = { fill, search, MODEL };
