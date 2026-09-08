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
  // 同一程：0.34 的时候这是条**死边**——0.34 × 0.85 = 0.289，一跳都活不过门槛，
  // 真实工作区上量了一遍，2229 条边里它出现 0 次。等于不存在。
  //
  // 0.42 让它**正好活一跳、活不过两跳**：0.42 × 0.85 = 0.357 ≥ 0.34 进得来，
  // 再走一条同样的边 0.357 × 0.42 × 0.85 = 0.127，出局。这正是它该有的分量——
  // 「那一段里你还路过了什么」是能说的，「那一段里你路过的东西又路过了什么」不能说。
  run: 0.42,
};
// 共用词那条边的强度：按**最罕见的那个词**给（tw20 值钱，maps 不值钱），再按**对上了几件事**加。
//
// 后一半是 2026-09-08 加的。以前只看 df，于是「Kingston·Parking·Buckingham」（三件事）和
// 「London」（一件）在 df 一样时一样重——而清单上量下来（dev/backlinks-bench.js），对上几件事
// 的边几乎条条是对的，只对上一个词的边一半是错的（High、London、1.1gb 那一类）。df 分不开
// 它们：这个工作区里 London 只有 3 条，Dell 有 6 条。能分开的是「是不是好几处独立的证据」。
// 加多少是算出来的：一条三件事的 df2 边 0.875×0.85 = 0.74，再走一条同样的边 0.55，过门槛——
// 于是「Runnymede」能经「赛程分前后半程」够到「Bishops Park」；而只对上一个词的 df3 边
// 0.64×0.85 = 0.545，再走一条 0.30，过不了。**一跳一个专名是强证据，两跳两个泛词什么也不是**，
// 顶上那句话现在在数值上是真的了。
const FACET_BONUS = 0.10;
const wordWeight = (df, facets = 1) => Math.min(0.95,
  0.40 + 0.55 / Math.log2(2 + Math.max(1, df)) + FACET_BONUS * Math.min(Math.max(1, facets) - 1, 2));

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
    // 不是材料的记录不当节点，不管是同一页、同一程还是向量够到的。共用词那条边在词表视图里
    // 已经挡过一道（ctx.ev 不给它们出词、不让它们进倒排），这儿是给另外三种边的。
    if (ctx.ok && !ctx.ok(to)) return;
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
      push(e.id, 'word', wordWeight(e.df, e.facets), { pairs: e.pairs, df: e.df });
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
      via.set(e.to, { from: cur, kind: e.kind, pairs: e.pairs || null, name: e.name || '', df: e.df });
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
  const tally = new Map();   // 词 -> [几条成员带着, df]
  for (const m of members) {
    for (const w of ctx.ev.words.get(m.id) || []) {
      const n = ctx.ev.df.get(w) || 0;
      if (n < 2 || n > links.EV_MAXDF) continue;
      const t = ctx.ev.text.get(w) || w;
      const had = tally.get(t) || [0, n];
      had[0]++;
      tally.set(t, had);
    }
  }
  // 名字要的词：这件事里**大家都有**、而**别处少见**。只按共有排的时候，四张哔哩哔哩截图
  // 被叫成「Thames · Staines」——浏览器的标签栏把别的标签页的标题也截了进来，四张都有，
  // 于是它们「共有」得最多。乘上罕见度之后，首页 / 订阅（只有这几张有）压过 Thames（十几条有）。
  const N = Math.max(members.length, ctx.total || 200);
  const scored = [...tally.entries()]
    .filter(([, [n]]) => n >= 2)
    .map(([w, [n, df]]) => [w, (n / members.length) * Math.log(N / Math.max(1, df))])
    .sort((a, b) => b[1] - a[1]);
  return scored.slice(0, words).map(([w]) => w).join(' · ');
}

/**
 * 事件：从链上整理出来的那几件事。每件带着成员，每个成员带着**参与强度**和一个层次：
 * 核心（这件事本身）或沾边（提到了这件事）。
 *
 * **事件的核心 = 「互为近邻」那张图的连通块。** A 在 B 的前 k 条里、B 也在 A 的前 k 条里，
 * 这条边才算。这一条把「串起来」和「不要乱串」同时做到了，而且是同一个机制：
 *   · 那一晚的记录互相都在对方前三里，所以连成块；
 *   · 半个工作区是一片弥漫的背景（开发笔记、刷的视频、我自己的对话被贴回来），它们的
 *     前三里也常有 Runnymede——因为开发笔记引用它当例子——可 Runnymede 的前三里没有它们。
 *     单向的不算边，背景就进不了核心。
 * 试过的、不成立的：从种子扩散再按重叠并（那一晚碎成十七件）、按共有几条记录并（背景把
 * 所有片焊成一件，31/138）、按共有锚词并整片（同样焊死，因为片本身一半是背景）。
 * 全在 dev/events-bench.js 顶上。
 *
 * **核心块再按共有的锚词并**：那一晚在互近邻图上是四块（报名 10、地址 5、车站起点 4、停车申诉 7），
 * 报名和地址共有 Ultra / Staines / 赛程那几条，并起来；申诉和它们只共有一两个词，不并——
 * 停车罚单是几天后另一件事，这么判是对的。
 *
 * **沾边**：不在核心里、但前 k 条里有核心成员的记录。开发笔记引用了那一晚的地址，它「参与」了
 * 那一晚，只是弱。强度就是那条链接的分数，界面上和核心分开摆。
 *
 * 参与强度：核心成员 = 它和块里最近那条的分数（互为近邻的那条边）；沾边 = 那条单向链接的分数。
 * 都是 grow 给的分：一跳一个邮编 0.6 以上，两跳绕过一个泛词就掉到门槛边上。
 *
 * @param {Map<string, {id:string, score:number, why?:object}[]>} lists 每条记录的清单（ask.linksOf）
 * @param {{ev:object, ok?:Function}} ctx 词表视图（给锚词和起名用）
 * @returns {{id:string, name:string, members:{id:string, score:number, tier:'core'|'touch', via?:object}[]}[]}
 */
const MUTUAL_K = 3;      // 互为前几近邻才算一条边。3 的时候核心块干净（那一晚 9/1），5 就焊成一片（18/108）
const EVENT_MIN = 3;     // 少于这么几条不算一件事，那只是一条记录和它的邻居
const ANCHOR_DF = 8;     // 一个词罕见到这个份上，才算锚词
const EVENT_SHARE = 3;   // 两块共有这么多个锚词才并。2 的时候显示器那件并进了 39 条背景，3 的时候 5 条
const TOUCH_K = 5;       // 沾边看前几条

function events(lists, ctx) {
  const ids = [...lists.keys()];
  const top = new Map(ids.map((id) => [id, new Map((lists.get(id) || []).slice(0, MUTUAL_K).map((x) => [x.id, x]))]));
  // 互为近邻的边 → 连通块
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const tight = new Map();   // id -> 它最硬的那条互近邻边
  for (const a of ids) {
    for (const [b, x] of top.get(a)) {
      const back = top.get(b);
      if (!back || !back.has(a)) continue;
      parent.set(find(a), find(b));
      if (x.score > (tight.get(a) || 0)) tight.set(a, x.score);
      if (back.get(a).score > (tight.get(b) || 0)) tight.set(b, back.get(a).score);
    }
  }
  const comp = new Map();
  for (const id of ids) { if (!tight.has(id)) continue; const r = find(id); if (!comp.has(r)) comp.set(r, []); comp.get(r).push(id); }
  const cores = [...comp.values()].filter((c) => c.length >= EVENT_MIN);
  // 每块的锚词：df ≤ ANCHOR_DF、块里至少两条带着
  const anchorsOf = (c) => {
    const t = new Map();
    for (const id of c) for (const w of (ctx.ev && ctx.ev.words.get(id)) || []) {
      const n = ctx.ev.df.get(w) || 0;
      if (n >= 2 && n <= ANCHOR_DF) t.set(w, (t.get(w) || 0) + 1);
    }
    return new Set([...t].filter(([, n]) => n >= 2).map(([w]) => w));
  };
  const anc = cores.map(anchorsOf);
  const par = cores.map((_, i) => i);
  const f = (i) => (par[i] === i ? i : (par[i] = f(par[i])));
  for (let i = 0; i < cores.length; i++) {
    for (let j = i + 1; j < cores.length; j++) {
      let n = 0;
      for (const w of anc[i]) if (anc[j].has(w)) n++;
      if (n >= EVENT_SHARE) par[f(i)] = f(j);
    }
  }
  const groups = new Map();
  cores.forEach((c, i) => { const r = f(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(...c); });
  // 合成，再找沾边的
  const out = [];
  const inCore = new Map();
  for (const c of groups.values()) {
    const k = out.length;
    for (const id of c) inCore.set(id, k);
    const members = c.map((id) => ({ id, score: tight.get(id) || 0, tier: 'core' }));
    out.push({ id: '', members });
  }
  // 一条记录可以是一件事的核心、同时沾着另一件（「停 Staines 车站」在那一晚里是核心，
  // 在停车申诉里只是沾边）——所以核心成员也要过一遍，只跳过它自己那件。
  for (const id of ids) {
    const mine = inCore.get(id);
    const best = new Map();   // 事件 -> 最强的那条链接
    for (const x of (lists.get(id) || []).slice(0, TOUCH_K)) {
      const k = inCore.get(x.id);
      if (k === undefined || k === mine) continue;
      const had = best.get(k);
      if (!had || x.score > had.score) best.set(k, x);
    }
    for (const [k, x] of best) out[k].members.push({ id, score: x.score, tier: 'touch', via: x.why || null });
  }
  for (const e of out) {
    e.members.sort((a, b) => (a.tier === b.tier ? b.score - a.score : a.tier === 'core' ? -1 : 1));
    e.id = e.members[0].id;
    e.name = nameOf(e.members.filter((m) => m.tier === 'core'), ctx);
  }
  return out.sort((a, b) => b.members.filter((m) => m.tier === 'core').length - a.members.filter((m) => m.tier === 'core').length);
}

/** 一条记录在哪几件事里，各占多少分量。 */
function eventsOf(id, list) {
  const me = String(id || '');
  const out = [];
  for (const e of list || []) {
    const m = e.members.find((x) => x.id === me);
    if (m) out.push({ id: e.id, name: e.name, n: e.members.filter((x) => x.tier === 'core').length, score: m.score, tier: m.tier, via: m.via || null });
  }
  return out.sort((a, b) => (a.tier === b.tier ? b.score - a.score : a.tier === 'core' ? -1 : 1));
}

module.exports = { grow, events, eventsOf, nameOf, edgesOf, wordWeight, pageWeight, FLOOR, DECAY, MAX, W, ANCHOR_DF, EVENT_MIN, EVENT_SHARE, MUTUAL_K, TOUCH_K, PAGE_FULL, EV_LIMIT };
