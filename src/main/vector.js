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

// 一条记录的邻居要多像才算「相关」。实测：0.7 以上是真的同一件事
// （「模型」→「qwen3.5:0.8b」0.981，「walking 挑战」→「赛程分前后半程」0.737）；
// 0.4 上下就是瞎猜（一条叫「Views」的记录的前三名分别是 grok-icon-study、报名完成、赛程讨论，
// 全不相干，分数 0.38）。所以门槛卡在这儿，**低于它一条都不给**，不硬凑。
// 2026-09-07 从 0.60 提到 0.70。原来不敢提是因为提了就几乎没有边了——而现在「同一处」和
// 「同一程」两种边扛着（src/main/links.js），语义这一条可以只在真的很近的时候才说话。
// 0.7 以上是实测里唯一站得住的一档：0.981「模型」→「qwen3.5:0.8b」、0.737「walking 挑战」→
// 「赛程分前后半程」；而 0.6 那一档放进来的是「Views」→ grok-icon-study 这种毫不相干的东西。
const NEAR = 0.70;

/** 一条记录那几段向量的平均，归一化。 */
function mean(list) {
  const out = new Float32Array(list[0].length);
  for (const v of list) for (let i = 0; i < v.length; i++) out[i] += v[i];
  let n = 0; for (let i = 0; i < out.length; i++) n += out[i] * out[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

// ── 粗筛的桶（随机投影 LSH）
//
// 「和这条意思相近的是谁」以前是把整张向量表扫一遍。204 条上 18ms，所以当初的结论是
// 「不建表、不存图」——那个结论在那个规模上是对的，注释里也写清楚了 n² 到一百多万条就不可能。
// 现在它到期了，不是因为记录多了，是因为**调用变密了**：story.grow 每展开一个节点问一次，
// 一次扩散最多四十次全表扫（实测 27ms / 250 条，按 O(n) 外推到 20 万条是 20 秒）。
//
// 换成 LSH：把向量投到 bits 个随机方向上，取符号拼成一个桶号。方向相近的向量大概率同桶。
// 一个向量同时进 TABLES 张表（各自一套投影），命中任意一张就算候选——单张表会漏，
// 多张表把漏的概率压下去。候选拿到之后**照样精确算点积**，所以门槛 NEAR=0.70 的含义没变，
// 变的只是「拿谁来比」。
const LSH_TARGET = 24;   // 每个桶里大约留这么多条：太满等于没筛，太空就召不回
const LSH_MIN_BITS = 3;
const LSH_MAX_BITS = 20;
const LSH_RECALL = 0.9;  // 想留住九成邻居
const LSH_MAX_TABLES = 64;

/** 桶号要几位，跟着库的大小走。 */
function bitsFor(n) {
  const want = Math.round(Math.log2(Math.max(2, n / LSH_TARGET)));
  return Math.max(LSH_MIN_BITS, Math.min(LSH_MAX_BITS, want));
}

// 一个向量要进几张表。**这个数必须跟着位数走，不能钉死。**
//
// 钉死过 4，扫出来它撑不住（真实工作区上量的，每一列都是实测）：
//   位数   3     4     5     6     7     8
//   召回  96%   88%   76%   68%   57%   52%
// 而位数是被库的大小逼上去的（每桶要留 ~24 条，20 万条就得 13 位）——4 张表在 13 位上
// 理论召回只有 9%，等于把「意思相近」这条边悄悄关掉。而实测它值 9/14 对 4/14，关不得。
//
// 算法是现成的：两个向量夹角 θ，一刀（一个随机超平面）把它们分开的概率是 θ/π。
// NEAR=0.70 对应 θ≤45.6°，所以同一张表 b 刀都没分开的概率 p^b（p≈0.747）；
// L 张表至少有一张没分开的概率 1−(1−p^b)^L。反解出 L，就是下面这一行。
const LSH_P = 1 - Math.acos(NEAR) / Math.PI;
function tablesFor(bits) {
  const p = Math.pow(LSH_P, bits);
  const want = Math.ceil(Math.log(1 - LSH_RECALL) / Math.log(1 - p));
  return Math.max(4, Math.min(LSH_MAX_TABLES, want));
}

// 投影矩阵是**算出来的，不存**：同一个种子永远给同一组方向，存下来只是多一个会和代码不同步的东西。
const projCache = new Map();
function projections(t, bits, dim) {
  const key = `${t}|${bits}|${dim}`;
  if (projCache.has(key)) return projCache.get(key);
  const rows = [];
  for (let i = 0; i < bits; i++) {
    let x = (t * 7919 + i * 104729 + dim * 15485863) >>> 0;
    const row = new Float32Array(dim);
    for (let d = 0; d < dim; d++) {                    // mulberry32
      x = (x + 0x6D2B79F5) >>> 0;
      let z = Math.imul(x ^ (x >>> 15), 1 | x);
      z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
      row[d] = (((z ^ (z >>> 14)) >>> 0) / 4294967296) * 2 - 1;
    }
    rows.push(row);
  }
  projCache.set(key, rows);
  return rows;
}

/** 这个向量在每张表上落进哪个桶。 */
function bucketsOf(v, bits, tables = tablesFor(bits)) {
  const out = [];
  for (let t = 0; t < tables; t++) {
    let b = 0;
    for (const row of projections(t, bits, v.length)) {
      let s = 0;
      for (let i = 0; i < v.length; i++) s += row[i] * v[i];
      b = (b << 1) | (s >= 0 ? 1 : 0);
    }
    out.push([t, b]);
  }
  return out;
}

/**
 * 把桶建起来／补齐。位数跟着库的大小走，所以库长大到换了位数就整张重建——
 * 那是 log n 次的事，不是每次都做。
 * @returns {{bits:number, built:number, rebuilt:boolean}}
 */
function buildBuckets(index, { force = false } = {}) {
  const n = index.stats().entries;
  const bits = bitsFor(n);
  const tables = tablesFor(bits);
  const was = Number(index.get('lshBits') || 0);
  const rebuilt = force || was !== bits;
  if (rebuilt) { index.dropBuckets(); index.set('lshBits', bits); index.set('lshTables', tables); }
  else if (index.bucketStats().ids >= n) return { bits, tables, built: 0, rebuilt: false };
  const pend = new Map();
  index.vecScan((id, v) => {
    if (!pend.has(id)) pend.set(id, []);
    pend.get(id).push(v);
  });
  let built = 0;
  for (const [id, list] of pend) {
    index.putBuckets(id, bucketsOf(mean(list), bits, tables));
    built++;
  }
  return { bits, tables, built, rebuilt };
}

/**
 * 和这条记录讲同一件事的那几条。
 *
 * 两步：桶里粗筛出候选，再对候选**精确算点积**。门槛还是 NEAR，含义没变。
 * 桶没建起来（老库、刚换模型）就退回全表扫——慢，但不会答错。
 * @returns {string[]} 按相近程度排，可能是空的
 */
function related(index, id, { limit = 3, floor = NEAR } = {}) {
  const mine = index.vecOf(id);
  if (!mine.length) return [];
  const me = mean(mine);
  const bits = Number(index.get('lshBits') || 0);
  const peers = bits ? index.bucketPeers(bucketsOf(me, bits, Number(index.get('lshTables') || 0) || undefined)) : null;
  const others = new Map();
  if (peers && peers.length) {
    for (const [rid, list] of index.vecMany(peers.filter((x) => x !== id))) others.set(rid, list);
  } else {
    index.vecScan((rid, v) => {
      if (rid === id) return;
      if (!others.has(rid)) others.set(rid, []);
      others.get(rid).push(v);
    });
  }
  const scored = [];
  for (const [rid, list] of others) {
    const s = dot(me, mean(list));
    if (s >= floor) scored.push([rid, s]);
  }
  return scored.sort((a, b) => b[1] - a[1]).slice(0, limit).map(([rid]) => rid);
}

/**
 * 一条记录周围两跳的那张图。
 *
 * 两跳就够：实测中位 4 张、四分之三位 6 张、最多 10 张，一屏放得下，不用设上限也不用折叠。
 * 一跳只有三张，看不出形状；三跳会把半个工作区拉进来。
 *
 * 边是**所有节点两两之间**真的够近的那些，不只是「从中心长出去」的那几条——
 * 图谱比清单多出来的东西就在这里：你的三个邻居彼此是不是也连着。
 * @returns {{nodes:{id:string,hop:number}[], edges:[string,string][]}}
 */
function graph(index, id, { hops = 2, limit = 3, floor = NEAR } = {}) {
  const centre = String(id || '');
  const hop = new Map([[centre, 0]]);
  let frontier = [centre];
  for (let d = 1; d <= hops; d++) {
    const next = [];
    for (const from of frontier) {
      for (const to of related(index, from, { limit, floor })) {
        if (hop.has(to)) continue;
        hop.set(to, d);
        next.push(to);
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  const ids = [...hop.keys()];
  const set = new Set(ids);
  const edges = [];
  const seen = new Set();
  for (const a of ids) {
    // 邻居多取几个：图里这些节点彼此的连线，比「从中心长出去」那三条更能说明形状
    for (const b of related(index, a, { limit: limit * 3, floor })) {
      if (!set.has(b)) continue;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(a < b ? [a, b] : [b, a]);
    }
  }
  return { nodes: ids.map((x) => ({ id: x, hop: hop.get(x) })), edges };
}

module.exports = { fill, search, related, graph, buildBuckets, bitsFor, tablesFor, bucketsOf, MODEL, NEAR, LSH_TARGET, LSH_RECALL, LSH_MAX_TABLES };
