'use strict';
// 一件事：从一条记录出发，沿着边长出去的那一片。
//
// **这不是聚类。** 聚类解的是「把工作区切成几堆」，那是个全局问题，必须有一个全局门槛，
// 而这份数据上那个门槛不存在——今天全量到过：
//   · 向量归堆 JOIN=0.62 → 那一堆是「语言选择条 ×2 + 一个日期 + Ultra Challenge + 感谢页」，
//     而该进的那条对真成员 0.685、对堆心 0.647、对代表只有 0.523，被代表挡在门外
//   · 代表换成跟着走的重心 → 同样五条，最大的堆反而 14 → 16
//   · 证据词全局连通 → 要连上那 14 条，门槛得放到 df≤8，代价是吃掉 70% 的工作区
//
// 而人要的从来不是切分，是「把那件事的所有东西给我」——那是**从一条记录长出去**。
// 换成扩散之后，那些账全都不用付了：
//   · 没有全局门槛，所以没有巨块
//   · 每一条进来的记录都带着**它是被哪条边、哪个词放进来的**
//   · 不同种子长出的片可以重叠——一条记录本来就可以属于好几件事
//   · 现算不存，和 vector.js / links.js 同一个决定：存下来的图只会过期
//
// 算法就是乘法权重上的 Dijkstra：从种子出发，每跳乘一次边的强度、再乘一次衰减，
// 掉到门槛以下就不再走。**衰减是这件事的关键**——一跳一个专名（tw20、runnymede）是强证据，
// 三跳绕过一个泛词什么也不是。

const links = require('./links');

// 两个旋钮都是扫出来的（dev/story-bench.js，验收标准是那一晚的十四条）。
// 从「Ultra Challenge」长起：
//   0.24/0.85  收 10/14，但一片 24 条，带进 14 条不相干的
//   0.34/0.85  收  9/14，一片 14 条，只带进 5 条    ← 这儿
//   0.38/0.85  收  5/14，断在报名那半边，过不去停车那半边
// 分数在 0.42（那条对话）→ 0.36（对话页上摘的三条）→ 0.33（开始塌）之间有个坎，0.34 正压在坎上。
// 对照今天那套向量归堆：同一件事它给 5/14，而且没有一条说得出为什么。
const FLOOR = 0.34;
const DECAY = 0.85;    // 每远一跳乘这么多
const MAX = 40;        // 一片最多这么多条

// 边有多硬。这是「一条边只在能说出证据时才存在」在数值上的兑现：
// 同一页是精确匹配，所以满分；同一程只是「那一段里你还路过了什么」，所以最虚。
const W = {
  page: 1.0,
  near: 0.50,
  run: 0.34,
};
/** 共用词那条边的强度，按**最罕见的那个词**给：tw20 值钱，maps 不值钱。 */
const wordWeight = (df) => 0.40 + 0.55 / Math.log2(2 + Math.max(1, df));

// 同一处那条边要按**那一页有多大**稀释。
//
// 一张你只摘过三次的页面，说「这三条是一回事」很有力；一张摘过十七次的（那个开了一整周的
// 终端窗口）说不了同样的话——它不是一件事，是一个工作台。不稀释的话实测会漏：从「停 Staines
// 车站」经「车站」连到一张全屏截图，那张截图属于那个终端窗口，十七条满分的同一处边把整片
// 终端都拉了进来，一片长到 35 条。
const PAGE_FULL = 4;   // 摘录不超过这么多的页面，同一处边算满分
const pageWeight = (clips) => W.page * Math.min(1, PAGE_FULL / Math.max(1, clips));

// 一个节点最多伸出这么多条共用词的边。
//
// 原来是 8，扫出来太窄（真实工作区，从三个种子长，看那一晚的十四条）：
//   limit   收到    一片   够到终点地址
//      8   8/14    30 条    0/3
//     12   8/14    37 条    0/3
//     16  13/14    44 条    2/3   ← 这儿
//     20  13/14    45 条    2/3
// 8 的时候「Runnymede Pleasure Ground, Egham, Surrey TW20 0AE」在证据表里排第十一，
// 被切在门外——而它和「赛程分前后半程」共用的正是 Runnymede 这个地名。
// 放宽之后召回从 8 涨到 13，而精度反而好了一点（27% → 30%）：多出来的边不是噪声，
// 是本来就该有的那几条。20 再没有新东西，说明 16 就是这份数据上的坎。
const EV_LIMIT = 16;

/**
 * 一条记录身上所有的边，合在一起。
 * @returns {{to:string, kind:string, w:number, words?:string[], name?:string}[]}
 */
function edgesOf(id, ctx) {
  const out = [];
  const seen = new Set();
  const push = (to, kind, w, extra) => {
    if (!to || to === id) return;
    const k = `${to}|${kind}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ to, kind, w, ...extra });
  };
  // ctx.g 自带 linksOf 就用它（vocab.pageGraph，背后是表，只碰这一条周围那几行）；
  // 没有就走内存版那张整图。两边形状一样，story 不需要知道自己站在哪一版上。
  const l = ctx.g.linksOf ? ctx.g.linksOf(id) : links.linksOf(id, ctx.g);
  if (l.source) {
    const page = ctx.g.pages.get(l.source.key) || { clips: [] };
    const w = pageWeight(page.clips.length);
    if (l.source.page) push(l.source.page, 'page', w, { name: l.source.name });
    for (const sib of page.clips) push(sib, 'page', w, { name: l.source.name });
  }
  const mineClips = l.clips.length;
  for (const c of l.clips) push(c, 'page', pageWeight(mineClips));
  for (const p of l.run.pages) if (p.first) push(p.first, 'run', W.run, { name: p.name });
  // 共用词：**边连的还是两张卡片**，线上写的是那一对词。
  // 词表来自 entity.js（邮编、日期、距离、专名，滤掉网页家具和虚词），但实体不是节点——
  // 它是这条边的依据。一对可以是完全一致（tw20 ↔ tw20），也可以是模糊一致
  // （泰晤士河 ↔ Thames，staines-upon-thames ⊃ thames）。
  if (ctx.ev) {
    for (const e of links.evidenceFor(id, ctx.ev, { limit: EV_LIMIT })) {
      push(e.id, 'word', wordWeight(e.df), { pairs: e.pairs });
    }
  }
  for (const n of (ctx.near ? ctx.near(id) : [])) push(n, 'near', W.near);
  return out;
}

/**
 * 从一条记录长出那一片。
 *
 * @param {string} seed
 * @param {{g:object, ev:object, near?:(id:string)=>string[]}} ctx
 * @returns {{members:{id:string,hop:number,score:number,via:object|null}[], edges:[string,string,string][]}}
 *   members 按强弱排，第一条就是种子；via 说明它是被哪条边放进来的
 */
function grow(seed, ctx, { floor = FLOOR, decay = DECAY, max = MAX } = {}) {
  const me = String(seed || '');
  if (!me) return { members: [], edges: [] };
  const score = new Map([[me, 1]]);
  const hop = new Map([[me, 0]]);
  const via = new Map([[me, null]]);
  const edges = [];
  const done = new Set();

  while (done.size < max) {
    // 还没展开过的里面分最高的那一个——乘法权重上的 Dijkstra，先展开最有把握的
    let cur = ''; let best = 0;
    for (const [id, s] of score) if (!done.has(id) && s > best) { best = s; cur = id; }
    if (!cur) break;
    done.add(cur);
    // ctx.edges 是给测试留的接缝：扩散这件事本身不该为了测它就得先搭一整张真图
    for (const e of (ctx.edges || edgesOf)(cur, ctx)) {
      const s = score.get(cur) * e.w * decay;
      if (s < floor) continue;
      // 标签挂在**这条边**上，不是挂在节点的来处上：一个节点可能同时被好几种边够到，
      // 拿它的来处去标每一条线，标出来的就是别人的理由（实测出现过空标签）。
      edges.push([cur, e.to, e.kind, e.pairs || e.name || null]);
      if (s <= (score.get(e.to) || 0)) continue;
      score.set(e.to, s);
      hop.set(e.to, (hop.get(cur) || 0) + 1);
      via.set(e.to, { from: cur, kind: e.kind, pairs: e.pairs || null, name: e.name || '' });
    }
  }
  const members = [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([id, s]) => ({ id, score: s, hop: hop.get(id) || 0, via: via.get(id) || null }));
  const keep = new Set(members.map((m) => m.id));
  const seenEdge = new Set();
  const out = [];
  for (const [a, b, kind, why] of edges) {
    if (!keep.has(a) || !keep.has(b)) continue;
    const k = `${a < b ? a : b}|${a < b ? b : a}|${kind}`;
    if (seenEdge.has(k)) continue;
    seenEdge.add(k);
    out.push([a, b, kind, why]);
  }
  return { members, edges: out };
}

/**
 * 这一片叫什么：成员共用得最多、而在整个工作区里又最罕见的那几个词。
 *
 * 现在那套名字是「离堆心最近那条的标题」，所以叫出了「English (Great Britain)」——
 * 一个语言选择条。而这一片真正共有的是 thames / ultra / 50km / runnymede。
 */
const CJK_RE = /[㐀-䶿一-鿿]/u;

function nameOf(members, ctx, { words = 3 } = {}) {
  if (!ctx.ev) return '';
  const tally = new Map();
  for (const m of members) {
    for (const w of ctx.ev.words.get(m.id) || []) {
      const n = ctx.ev.df.get(w) || 0;
      if (n < 2 || n > links.EV_MAXDF) continue;
      tally.set(ctx.ev.text.get(w) || w, (tally.get(ctx.ev.text.get(w) || w) || 0) + 1);
    }
  }
  const scored = [...tally.entries()]
    .filter(([, n]) => n >= 2)
    .map(([w, n]) => [w, n / members.length])
    .sort((a, b) => b[1] - a[1]);
  return scored.slice(0, words).map(([w]) => w).join(' · ');
}

/**
 * 值得从它出发的那些节点。
 *
 * 顶上那一栏列的就是它。**不叫「主题」**：主题这个词在宣称工作区能被切干净，而它不能。
 * 枢纽只是说「这个节点连得多」，那是个事实，不是一个分类。
 * @returns {{id:string, weight:number}[]}
 */
const ANCHOR_DF = 8;   // 一个词罕见到这个份上，才算「这条记录锚在某个具体的东西上」

function hubs(ctx, { limit = 12, min = 4 } = {}) {
  if (!ctx.ev) return [];
  // 候选：身上至少有一个**够具体**的共用词。
  //
  // 按边的总强度排是错的，实测过：终端那个窗口是一个有十七条摘录的「页面」，于是那十七条
  // 每条都拿到十七条满分的同一处边，排出来的前十全是「模糊 · 显示 · 不需要」——
  // 一个连得多的节点不等于一件值得看的事。锚不锚在具体的东西上，才是那个区别。
  const cand = [];
  for (const id of ctx.ids || []) {
    let anchored = false;
    for (const e of links.evidenceFor(id, ctx.ev, { limit: 4 })) {
      if (Math.min(...e.words.map((w) => ctx.ev.df.get(w) || 99)) <= ANCHOR_DF) { anchored = true; break; }
    }
    if (anchored) cand.push(id);
  }
  // 一片长得越大越值得当入口。重叠的只留最强的那个种子——同一件事不该在清单里出现三遍。
  const grown = cand.map((id) => ({ id, s: grow(id, ctx, { max: 24 }) }))
    .filter((x) => x.s.members.length >= min)
    .sort((a, b) => b.s.members.length - a.s.members.length);
  const out = [];
  const taken = new Set();
  for (const x of grown) {
    const ids = x.s.members.map((m) => m.id);
    const overlap = ids.filter((i) => taken.has(i)).length / ids.length;
    if (overlap > 0.5) continue;
    for (const i of ids) taken.add(i);
    out.push({ id: x.id, n: x.s.members.length, name: nameOf(x.s.members, ctx) });
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = { grow, hubs, nameOf, edgesOf, wordWeight, pageWeight, FLOOR, DECAY, MAX, W, ANCHOR_DF, PAGE_FULL, EV_LIMIT };
