'use strict';
// 主题：把讲同一件事的记录归成一堆。
//
// **2026-09-07：产品里已经不用它了。** 留在这儿只为那两个探针
// （dev/thames-link-probe.js、dev/link-bench.js）——它们量的正是「为什么不用它」，
// 而那笔账值得留着，免得哪天有人再走一遍：
//   · 同一件事它只圈住 5 条，里面两个语言选择条、一个日期、一个感谢页
//   · 而该进的那条对真成员 0.685、对堆心 0.647，**对代表只有 0.523**——门是代表把的，
//     而代表是那堆里最差的一条
//   · 代表换成跟着走的重心：同样五条，最大的堆反而 14 → 16
// 取代它的是「从一条记录长出去」（src/main/story.js）：不切分工作区，也就不需要一个
// 这份数据上并不存在的全局门槛。
//
// 这不是「给每条记录三个词」。那套做过，被砍了——220 条里 209 条抽出来的词本来就原样写在正文里，
// 搜索早就覆盖（见 segment.js 开头）。这里问的是另一个问题：**哪些记录是同一件事**。
// 前者是词，后者是堆，而堆能给记录页一样它现在完全没有的东西——一条竖着的线索。
// 记录页现在只有一条按天排的流，没有任何办法说「把那场挑战的所有东西给我」。
//
// 归堆完全在本地，不经过模型：向量已经在索引里了，211 条跑一遍是两百次点积，毫秒级。
// 起名是另一回事，见 name()。
const chunk = require('./chunk');

const JOIN = 0.62;        // 两条记录多像才算同一堆。实测 0.55 覆盖 53%、0.80 覆盖 22%
const MIN_SIZE = 3;       // 少于这么多条的不是主题，是零头
const MIN_TEXT = 24;      // 正文短于这么多字的不参与归堆——它没有「关于什么」可言
const NAME_WORDS = 3;

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/** 一条记录用它所有块的平均向量代表：取最好那一块是给检索用的，归堆要的是整条大体在讲什么。 */
function recordVectors(index) {
  const sum = new Map(); const dim = { n: 0 };
  index.vecScan((id, v) => {
    if (!sum.has(id)) sum.set(id, new Float32Array(v.length));
    const s = sum.get(id);
    for (let i = 0; i < v.length; i++) s[i] += v[i];
    dim.n = v.length;
  });
  const out = [];
  for (const [id, s] of sum) {
    let n = 0; for (let i = 0; i < s.length; i++) n += s[i] * s[i];
    n = Math.sqrt(n) || 1;
    const v = new Float32Array(s.length);
    for (let i = 0; i < s.length; i++) v[i] = s[i] / n;
    out.push({ id, v });
  }
  return out;
}

/**
 * 归堆。每一条只和**堆的代表**比，不和堆里任意一条比。
 *
 * 「像就并到一起」那种做法（并查集）走不通：A 像 B、B 像 C，传递下去 A 和 C 也成了一堆，
 * 链一路滚——实测把 211 条里的 102 条吞进同一个巨堆，另外 45% 一个堆都进不去。
 * 代表不动，链就断了，而且一遍扫完。
 *
 * @param {{id:string,v:Float32Array}[]} rows 按时间从早到晚，这样代表是稳定的：
 *   同一个堆下次重算还是同一条记录当代表，堆的 id 就不会跳，名字也不会跟着跳。
 * @returns {{leader:string, members:string[]}[]}
 */
function cluster(rows, { join = JOIN } = {}) {
  const leaders = [];
  for (const r of rows) {
    let best = -1; let bestS = join;
    for (let g = 0; g < leaders.length; g++) {
      const s = dot(r.v, leaders[g].v);
      if (s >= bestS) { bestS = s; best = g; }
    }
    if (best >= 0) leaders[best].members.push(r.id);
    else leaders.push({ leader: r.id, v: r.v, members: [r.id] });
  }
  return leaders.map((l) => ({ leader: l.leader, members: l.members }));
}

// briffy 自己生成的标题：它们只说了这是什么格式、什么时候存的，说不出这堆是关于什么的。
const AUTO_TITLE = /^(截图|剪贴板图片|语音|Screenshot|Clipboard image)\s*[\d:：]*$|^[\p{Extended_Pictographic}\uFE0F\s]+$|^[0-9a-f]{16,}\.\w+$/u;

/**
 * 不靠模型给一堆起名：**取离堆中心最近、而且标题是真标题的那一条**。
 *
 * 抽词那条路试过两轮都不能看：从正文抽得到 spm_id_from、vd_source、v0.18.0、blessonism
 * （URL 参数、版本号、用户名）；只从标题抽，B 站那一组直接起不出名字，报名那一组变成
 * britain · english · great——网页自己的语言选择条。
 *
 * 而"最中心那条的标题"本来就是这堆的描述，实测 23ms、零模型、20 个堆里 14 个有名字，
 * 剩下 6 个是整堆都没有真标题的剪贴板图——那种连模型也只能起出「剪贴板图片」这种格式名。
 * 所以：有模型时用模型（llm.topicName，多给两三个明显更好的），没有时用这个，抽词只当最后一档。
 */
function centreName(members, getEntry, vectors) {
  const vs = members.map((id) => vectors.get(id)).filter(Boolean);
  if (!vs.length) return '';
  const dim = vs[0].length;
  const c = new Float32Array(dim);
  for (const v of vs) for (let i = 0; i < dim; i++) c[i] += v[i];
  let n = 0; for (let i = 0; i < dim; i++) n += c[i] * c[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < dim; i++) c[i] /= n;
  const ranked = members
    .filter((id) => vectors.get(id))
    .map((id) => [id, dot(c, vectors.get(id))])
    .sort((a, b) => b[1] - a[1]);
  for (const [id] of ranked) {
    const t = String((getEntry(id) || {}).title || '').trim();
    if (t && !AUTO_TITLE.test(t)) return t.slice(0, 40);
  }
  return '';
}

/**
 * 最后一档：这个词在这堆里出现得多、在整个工作区里出现得少。质量见上面那段。
 */
function words(members, getEntry, index) {
  const inDf = new Map();
  for (const id of members) {
    const e = getEntry(id);
    if (!e) continue;
    const seen = new Set(index.tokens(String(e.title || ''))
      .filter((w) => w.length > 1 && !/^[\d.v]+$/.test(w)));
    for (const w of seen) inDf.set(w, (inDf.get(w) || 0) + 1);
  }
  const df = (t) => { const one = index.termsOf(t)[0]; return one ? Math.max(one.rareDf, 1) : 1; };
  return [...inDf.entries()]
    .filter(([, n]) => n >= Math.max(2, members.length * 0.3))
    .map(([w, n]) => [w, (n / members.length) / Math.log(1 + df(w))])
    .sort((a, b) => b[1] - a[1])
    .slice(0, NAME_WORDS).map(([w]) => w);
}

/**
 * 算出这个工作区里的主题。纯本地，不写库，方便测。
 * @returns {{leader:string, members:string[], words:string[]}[]} 按大小排
 */
function build(index, getEntry, { join = JOIN, min = MIN_SIZE } = {}) {
  const rows = recordVectors(index)
    .filter((r) => {
      const e = getEntry(r.id);
      // 没有字的记录（没标题的剪贴板图片）会因为「都很空」而聚在一起，那不是主题。
      return e && chunk.textOf(e).length >= MIN_TEXT;
    })
    .sort((a, b) => {
      const A = getEntry(a.id); const B = getEntry(b.id);
      return String(A.createdAt || '').localeCompare(String(B.createdAt || ''));
    });
  const vectors = new Map(rows.map((r) => [r.id, r.v]));
  return cluster(rows, { join })
    .filter((g) => g.members.length >= min)
    .map((g) => ({
      ...g,
      // 没有模型时界面显示的就是这个。中心那条的真标题优先，抽词垫底。
      words: centreName(g.members, getEntry, vectors) || words(g.members, getEntry, index).join(' · '),
    }))
    .sort((a, b) => b.members.length - a.members.length);
}

module.exports = { build, cluster, words, recordVectors, JOIN, MIN_SIZE, MIN_TEXT };
