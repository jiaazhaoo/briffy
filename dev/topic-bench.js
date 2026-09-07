'use strict';
// 自动主题：把记录聚成堆，再给每堆起个名字。真实工作区，看聚出来的堆人认不认得。
//
//   npx electron dev/topic-bench.js
//
// 「三个词」那套做过一次，被砍了：segment.js 开头写着，220 条里 209 条抽出来的词本来就原样在
// 正文里，搜索早就覆盖了，白干。那个结论没有过期——**再从正文里抽词，还是白干**。
//
// 所以这次换一个问题：不是「这条记录有哪三个词」，而是「哪些记录讲的是同一件事」。
// 前者是词，后者是**堆**，而堆能给记录页一个它现在完全没有的东西：一条竖着的线索。
//
// 做法是 BERTopic 那一套里最简单的形态，没有新依赖：
//   聚堆   向量两两比余弦，超过阈值就并到一起（并查集），不定 k——主题有几个是数出来的
//   起名   c-TF-IDF：一个词在这堆里出现得多、在整个工作区里出现得少，它就是这堆的名字
// 起名这一步**不经过模型**，和索引用的是同一套分词，所以名字永远是工作区里真实存在的词。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const HOME = os.homedir();
const WS = path.join(HOME, 'Library/Application Support/briffy/workspace');
const DIR = path.join(WS, 'entries');
const CACHE = path.join(HOME, 'Library/Application Support/briffy/models');

const JOIN = 0.62;        // 两条记录多像才算同一堆
const MIN_SIZE = 3;       // 少于这么多条的不算一个主题，是零头
const NAME_WORDS = 3;     // 每堆起几个词的名字——就是「三个词」，但这次是堆的三个词，不是记录的

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

async function main() {
  const index = require('../src/main/index-db');
  const vector = require('../src/main/vector');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-topic-'));
  index.open(tmp, WS);
  index.useVecModel(vector.MODEL);
  const loadDay = (k) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, `${k}.json`), 'utf8')); } catch (_) { return []; } };
  let r; do { r = index.sync({ dir: DIR, loadDay }, { budgetMs: 20000 }); } while (!r.done);
  let f; do { f = await vector.fill(index, loadDay, { budgetMs: 8000, batch: 20, cacheDir: CACHE }); if (f.error) break; } while (!f.done);
  if (f.error) { console.log('向量补不了：', f.error); app.quit(); return; }

  const all = new Map();
  for (const file of fs.readdirSync(DIR)) {
    if (!file.endsWith('.json')) continue;
    let e; try { e = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8')); } catch (_) { continue; }
    for (const x of (Array.isArray(e) ? e : e.entries || [])) all.set(x.id, x);
  }

  // 一条记录用它所有块的平均向量代表。取最好那一块是给检索用的（一段说到了就算说到了），
  // 归堆要的是整条记录大体在讲什么，所以取平均。
  const sum = new Map(); const cnt = new Map();
  index.vecScan((id, v) => {
    if (!sum.has(id)) { sum.set(id, new Float32Array(v.length)); cnt.set(id, 0); }
    const s = sum.get(id);
    for (let i = 0; i < v.length; i++) s[i] += v[i];
    cnt.set(id, cnt.get(id) + 1);
  });
  const ids = [...sum.keys()].filter((id) => all.has(id));
  const vecs = ids.map((id) => {
    const s = sum.get(id); const out = new Float32Array(s.length);
    let n = 0; for (let i = 0; i < s.length; i++) n += s[i] * s[i];
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < s.length; i++) out[i] = s[i] / n;
    return out;
  });
  console.log(`${ids.length} 条记录，${index.vecStats().chunks} 块\n`);

  // 「像就并到一起」这条路走不通：A 像 B、B 像 C，传递下去 A 和 C 也成了一堆，链一路滚，
  // 实测把 211 条里的 102 条吞进同一个叫「图片」的巨堆，另外 45% 一个堆都进不去。
  //
  // 换成 leader clustering：每一条只和**堆的代表**比，不和堆里任意一条比。代表不动，链就断了。
  // 一遍扫完，没有 k，没有依赖。
  function cluster(th) {
    const leaders = [];   // {at:index, members:[index]}
    for (let i = 0; i < ids.length; i++) {
      let best = -1; let bestS = th;
      for (let g = 0; g < leaders.length; g++) {
        const s = dot(vecs[i], vecs[leaders[g].at]);
        if (s >= bestS) { bestS = s; best = g; }
      }
      if (best >= 0) leaders[best].members.push(i);
      else leaders.push({ at: i, members: [i] });
    }
    return leaders.map((l) => l.members);
  }
  const groups = new Map();
  cluster(JOIN).forEach((g, i) => groups.set(i, g));

  // c-TF-IDF 起名：这堆里多少条含这个词 ÷ 整个工作区里多少条含这个词
  const corpusDf = (term) => {
    const row = index.get ? null : null;
    return term;
  };
  const dfCache = new Map();
  const df = (t) => {
    if (!dfCache.has(t)) {
      const one = index.termsOf(t)[0];
      dfCache.set(t, one ? Math.max(one.rareDf, 1) : 1);
    }
    return dfCache.get(t);
  };
  const nameOf = (members) => {
    const inDf = new Map();
    for (const i of members) {
      const e = all.get(ids[i]);
      // 只从**标题**取词。从正文取的话，名字会变成 spm_id_from、vd_source、v0.18.0、
      // blessonism——URL 参数、版本号、用户名。标题是人或网页给这条记录起的名字，干净得多。
      // 纯数字也不要：「qwen3.5 · 6.6 · 3.3」里后两个是版本号和体积。
      const seen = new Set(index.tokens(String(e.title || ''))
        .filter((w) => w.length > 1 && !/^[\d.v]+$/.test(w)));
      for (const w of seen) inDf.set(w, (inDf.get(w) || 0) + 1);
    }
    return [...inDf.entries()]
      .filter(([, n]) => n >= Math.max(2, members.length * 0.3))
      .map(([w, n]) => [w, (n / members.length) / Math.log(1 + df(w))])
      .sort((a, b) => b[1] - a[1])
      .slice(0, NAME_WORDS).map(([w]) => w);
  };

  // 先扫一遍阈值，看形状：主题几个、覆盖多少、最大的那堆有多大（巨堆是这类做法的塌陷方式）
  console.log('  阈值   主题数  有归属  最大堆');
  for (const th of [0.55, 0.60, 0.65, 0.70, 0.75, 0.80]) {
    const gs = cluster(th).filter((g) => g.length >= MIN_SIZE).sort((a, b) => b.length - a.length);
    const covered = gs.reduce((n, g) => n + g.length, 0);
    console.log(`  ${th.toFixed(2)}   ${String(gs.length).padStart(5)}  ${String(Math.round(covered * 100 / ids.length) + '%').padStart(6)}  ${String(gs[0] ? gs[0].length : 0).padStart(5)} 条`);
  }
  console.log('');

  const big = [...groups.values()].filter((g) => g.length >= MIN_SIZE).sort((a, b) => b.length - a.length);
  const loose = ids.length - big.reduce((n, g) => n + g.length, 0);
  console.log(`阈值 ${JOIN} → ${big.length} 个主题（≥${MIN_SIZE} 条），另有 ${loose} 条散着（${Math.round(loose * 100 / ids.length)}%）\n`);

  for (const g of big) {
    const name = nameOf(g);
    console.log(`  【${name.join(' · ') || '（起不出名字）'}】 ${g.length} 条`);
    for (const i of g.slice(0, 5)) console.log(`      ${String(all.get(ids[i]).title || '').replace(/\s+/g, ' ').slice(0, 52)}`);
    if (g.length > 5) console.log(`      …还有 ${g.length - 5} 条`);
    console.log('');
  }

  require('../src/main/embed').dispose();
  fs.rmSync(tmp, { recursive: true, force: true });
  app.quit();
}

app.whenReady().then(() => main().catch((e) => { console.error('炸了:', e && e.stack || e); app.quit(); }));
