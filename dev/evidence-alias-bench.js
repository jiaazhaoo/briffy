'use strict';
// 证据链的下一个问题：**桥词不一定是一模一样的词。**
//
//   npx electron dev/evidence-alias-bench.js
//
// 泰晤士河 和 Thames 是同一条河，超级马拉松 和 Ultra Challenge 是同一件事，
// Staines-upon-Thames 里包着 Thames，Egham 和 TW20 指着同一个地方。
// 前一个探针（dev/evidence-chain-bench.js）只认字面相同的词，这四种它一种都接不住。
//
// 三条可能的路，代价差得很远，所以一起量：
//   A 同现  —— 一条记录里同时出现两个词，它自己就是一份对照表。免费。
//              （「2026年泰晤士河步道超级马拉松挑战赛 --- Thames Path Ultra Challenge 2026」
//                这一个标题里中英文并排——工作区自带的词典。）
//   B 包含  —— staines-upon-thames ⊃ thames。免费。
//   C 词向量 —— 唯一能接住「从没同现过」的那种。要模型。
//
// 要回答的是：A + B 够不够，C 值不值。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');
const { segment } = require('../src/main/segment');

const DIR = path.join(os.homedir(), 'Library/Application Support/briffy/workspace/entries');
const CACHE = path.join(os.homedir(), 'Library/Application Support/briffy/models');
const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const norm = (v) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return v.map((x) => x / n); };

// 该连上的 / 不该连上的，摆在一起才看得出有没有间隔
const PAIRS = [
  ['泰晤士河', 'thames', '同一条河'],
  ['挑战', 'challenge', '同一个词'],
  ['步道', 'path', '同一个词'],
  ['超级', 'ultra', '同一个词'],
  ['staines-upon-thames', 'thames', '包含'],
  ['egham', 'tw20', '同一个地方的名字和邮编'],
  ['runnymede', 'egham', '两个挨着的地方，不是一回事'],
  ['泰晤士河', 'payment', '毫不相干（对照）'],
  ['挑战', 'airports', '毫不相干（对照）'],
  ['egham', 'marketplace', '毫不相干（对照）'],
];

async function main() {
  const all = [];
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.json')) continue;
    let e; try { e = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (_) { continue; }
    for (const x of (Array.isArray(e) ? e : e.entries || [])) all.push(x);
  }

  // 用真正的分词器，不用正则。上一个探针那个 [㐀-鿿]{2,8} 把「2026年泰晤士河步道超级马拉松挑战赛」
  // 切成了「年泰晤士河步道超 | 级马拉松挑战赛」——于是「泰晤士河」根本没进过词表。
  const words = (e) => {
    const c = e.context || {};
    const raw = [e.title, String(e.text || '').slice(0, 1200), c.window, c.url, e.url].filter(Boolean).join(' ');
    const out = new Set();
    for (const t of segment(raw, '')) {
      if (!t.wordLike) continue;
      const w = String(t.w).toLowerCase();
      if (w.length < 2 || /^\d+$/.test(w)) continue;
      out.add(w);
      if (w.includes('-')) for (const p of w.split('-')) if (p.length >= 3) out.add(p);
    }
    return out;
  };
  const W = new Map(all.map((e) => [e.id, words(e)]));
  const has = (w) => [...W].filter(([, s]) => s.has(w)).map(([id]) => id);
  const df = new Map();
  for (const s of W.values()) for (const w of s) df.set(w, (df.get(w) || 0) + 1);
  console.log(`${all.length} 条记录，词表 ${df.size}（用 segment.js 切的）\n`);

  const embed = require('../src/main/embed');
  let V = new Map();
  if (embed.available()) {
    const uniq = [...new Set(PAIRS.flatMap(([a, b]) => [a, b]))];
    try {
      const vs = await embed.embed(uniq, { cacheDir: CACHE });
      V = new Map(uniq.map((w, i) => [w, norm([...vs[i]])]));
    } catch (e) { console.log('词向量算不了：', e.message); }
  }

  console.log('  A 同现        B 包含  C 词向量   两个词');
  console.log('  一起出现/各自出现');
  for (const [a, b, note] of PAIRS) {
    const A = new Set(has(a)); const B = new Set(has(b));
    const both = [...A].filter((x) => B.has(x)).length;
    const sub = a.includes(b) || b.includes(a) ? '  是  ' : '  ——  ';
    const sim = V.has(a) && V.has(b) ? dot(V.get(a), V.get(b)).toFixed(3) : '  —  ';
    console.log(`  ${String(both).padStart(3)} / ${String(A.size).padStart(3)},${String(B.size).padStart(3)}   ${sub}  ${sim}    ${a} ↔ ${b}   ${note}`);
  }

  console.log('\n════ A 那条路：工作区里自带的中英对照 ════');
  // 一个词只在某几条里出现，而那几条里总有另一个词跟着——那两个词多半指同一样东西。
  // 只看标题和窗口标题：正文里的同现太廉价（一篇长文里什么词都碰得到一起）。
  const heads = new Map(all.map((e) => {
    const c = e.context || {};
    const raw = [e.title, c.window].filter(Boolean).join(' ');
    const out = new Set();
    for (const t of segment(raw, '')) if (t.wordLike) { const w = String(t.w).toLowerCase(); if (w.length >= 2 && !/^\d+$/.test(w)) out.add(w); }
    return [e.id, out];
  }));
  const hdf = new Map();
  for (const s of heads.values()) for (const w of s) hdf.set(w, (hdf.get(w) || 0) + 1);
  const cjk = (w) => /[㐀-䶿一-鿿]/u.test(w);
  const found = [];
  for (const [id, s] of heads) {
    const zh = [...s].filter(cjk); const en = [...s].filter((w) => /^[a-z][a-z-]+$/.test(w) && w.length >= 4);
    if (!zh.length || !en.length) continue;
    for (const z of zh) for (const e2 of en) {
      const zi = hdf.get(z); const ei = hdf.get(e2);
      if (zi < 2 || ei < 2) continue;
      const together = [...heads.values()].filter((x) => x.has(z) && x.has(e2)).length;
      // 两个词几乎总是一起出现，才算一份对照
      if (together >= 2 && together >= Math.min(zi, ei) * 0.8) found.push([z, e2, together, zi, ei]);
    }
  }
  const seen = new Set();
  for (const [z, e2, t, zi, ei] of found.sort((a, b) => b[2] - a[2])) {
    const k = `${z}|${e2}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (seen.size > 12) break;
    console.log(`  ${z} ↔ ${e2}   一起出现 ${t} 次（各自 ${zi} / ${ei}）`);
  }
  if (!seen.size) console.log('  这个工作区的标题里没有并排的中英文');

  embed.dispose();
  app.quit();
}
app.whenReady().then(() => main().catch((e) => { console.error('炸了:', e && e.stack || e); app.quit(); }));
