'use strict';
// 换个向量模型能不能把搜索救回来。**答案是不能**，这个文件是证据。
//
//   node dev/embed-bakeoff.js
//
// 量两件事，都在真实工作区上（257 条记录、627 块），不是在两个词之间量余弦——
// 那个量法把我骗过一次：e5 的「停车 ↔ parking 0.849」看着比现在这个模型的 0.504 好得多，
// 换上去之后真实名次反而更差。因为 e5 把所有东西都压进 0.76~0.89 一条窄带，
// 「停车 ↔ 抓紧」也是 0.840。**余弦高不等于分得开，检索要的是分得开。**
//
//   一、八个问题，目标记录排第几，前五名里有几条对的
//   二、问一个库里绝对没有的问题（房贷利率、我奶奶的猫），最高分掉不掉得下来——
//       掉得下来才画得出「搜不到就说搜不到」那条线
//
// 跑出来（2026-09-08）：
//                                    体积   名次和   前五命中   门槛
//   paraphrase-MiniLM-L12（在用）      129M    68     13/40    0.427 ✓
//   multilingual-e5-small            120M    76     16/40    画不出（0.863 / 0.863 重合）
//   multilingual-e5-base             289M   135     15/40    —
//   LaBSE                            477M    47     13/40    画不出（胡话 0.885 反而最高）
//   paraphrase-mpnet-base            288M    64      9/40    0.463 ✓，但名次全面变差
const fs = require('fs'); const path = require('path'); const os = require('os');
const chunk = require('../src/main/chunk');
const CACHE = path.join(os.homedir(), 'Library/Application Support/briffy/models');
const DIR = path.join(os.homedir(), 'Library/Application Support/briffy/workspace/entries');

const CASES = [
  ['停车', /parking|停车|justpark/i],
  ['停车怎么退款', /refund|退款/i],
  ['显示器', /monitor|显示器|ultrawide/i],
  ['详细地址', /Windsor Road|Runnymede Pleasure|TW20 ?0AE/i],
  ['终点在哪', /Runnymede Pleasure/i],
  ['泰晤士河', /thames|泰晤士/i],
  ['走路的活动', /runnymede|ultra march|challenge/i],
  ['parking', /parking|停车|justpark/i],
];
const NONE = ['量子色动力学的重整化群方程', '我奶奶的猫叫什么名字', 'photosynthesis in deep sea vents', '房贷利率'];
const MODELS = [
  ['Xenova/paraphrase-multilingual-MiniLM-L12-v2', false],
  ['Xenova/multilingual-e5-small', true],
  ['Xenova/multilingual-e5-base', true],
  ['Xenova/LaBSE', false],
  ['Xenova/paraphrase-multilingual-mpnet-base-v2', false],
];

const all = [];
for (const f of fs.readdirSync(DIR)) {
  if (!f.endsWith('.json')) continue;
  let e; try { e = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (_) { continue; }
  for (const x of (Array.isArray(e) ? e : e.entries || [])) all.push(x);
}
const docs = [];   // {i, text}
all.forEach((e, i) => { for (const c of chunk.chunksOf(e)) docs.push({ i, text: c }); });
const hay = all.map((e) => `${e.title || ''} ${e.text || ''}`);
const cos = (a, b) => { let s = 0; for (let k = 0; k < a.length; k++) s += a[k] * b[k]; return s; };

(async () => {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = CACHE; env.useFSCache = true; env.allowLocalModels = false; env.allowRemoteModels = true;
  console.log(`${all.length} 条记录，${docs.length} 块\n`);
  for (const [model, e5] of MODELS) {
    let p; try { p = await pipeline('feature-extraction', model, { device: 'cpu', dtype: 'q8' }); }
    catch (err) { console.log(`${model}  取不到：${err.message}\n`); continue; }
    const emb = async (ts) => {
      const out = [];
      for (let i = 0; i < ts.length; i += 32) {
        const o = await p(ts.slice(i, i + 32), { pooling: 'mean', normalize: true });
        const [n, d] = o.dims; const f = o.data;
        for (let j = 0; j < n; j++) out.push(f.slice(j * d, (j + 1) * d));
      }
      return out;
    };
    const t0 = Date.now();
    const dv = await emb(docs.map((d) => (e5 ? `passage: ${d.text}` : d.text)));
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(`════ ${model.split('/')[1]}  (${dv[0].length} 维, 建库 ${secs}s)`);
    let sumRank = 0, p5 = 0;
    for (const [q, want] of CASES) {
      const [qv] = await emb([e5 ? `query: ${q}` : q]);
      const best = new Map();
      dv.forEach((v, k) => { const s = cos(qv, v); const i = docs[k].i; if (!(best.get(i) >= s)) best.set(i, s); });
      const rank = [...best.entries()].sort((a, b) => b[1] - a[1]).map(([i]) => i);
      const at = rank.findIndex((i) => want.test(hay[i]));
      const top5 = rank.slice(0, 5).filter((i) => want.test(hay[i])).length;
      sumRank += at < 0 ? 999 : at + 1; p5 += top5;
      console.log(`   ${q.padEnd(14)} 第 ${at < 0 ? '—' : at + 1} 名   前五命中 ${top5}/5`);
    }
    console.log(`   —— 名次和 ${sumRank}   前五总命中 ${p5}/${CASES.length * 5}`);

    // 「搜不到」画不画得出线：库里有的最高分，和库里没有的最高分，隔开了没有
    const top = async (q) => { const [qv] = await emb([e5 ? `query: ${q}` : q]); let m = -1; for (const v of dv) { const s = cos(qv, v); if (s > m) m = s; } return m; };
    const hi = []; for (const [q] of CASES) hi.push(await top(q));
    const lo = []; for (const q of NONE) lo.push(await top(q));
    const floor = Math.min(...hi); const ceil = Math.max(...lo);
    console.log(`   —— 库里有的最低 ${floor.toFixed(3)}，库里没有的最高 ${ceil.toFixed(3)}：`
      + (floor > ceil ? `分开了，门槛画在 ${((floor + ceil) / 2).toFixed(3)}` : '重合，画不出门槛')
      + '\n');
    if (p.dispose) await p.dispose();
  }
})();
