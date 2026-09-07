'use strict';
// 「泰晤士河道超级马拉松」那个主题，为什么没把停车那一串记录拉进来。
//
//   npx electron dev/thames-link-probe.js
//
// 不猜，把每一道门槛上的数都打出来：
//   1. chunk.textOf 的长度 —— 短于 MIN_TEXT(24) 的记录**根本不参与归堆**
//   2. 有没有向量
//   3. 和那一堆的中心、和堆里每一条的相似度 —— 对着 JOIN(0.62) 和 NEAR(0.60) 看
// 归堆是「和堆的代表比」，双链是「和这一条比」，两条路各卡在哪里得分开说。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const HOME = os.homedir();
const WS = path.join(HOME, 'Library/Application Support/briffy/workspace');
const DIR = path.join(WS, 'entries');
const CACHE = path.join(HOME, 'Library/Application Support/briffy/models');

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();

async function main() {
  const index = require('../src/main/index-db');
  const vector = require('../src/main/vector');
  const topic = require('../src/main/topic');
  const chunk = require('../src/main/chunk');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-thames-'));
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
  const getEntry = (id) => all.get(id) || null;
  const vecs = new Map(topic.recordVectors(index).map((x) => [x.id, x.v]));

  const groups = topic.build(index, getEntry);
  console.log(`工作区 ${all.size} 条记录，${vecs.size} 条有向量，归出 ${groups.length} 个堆\n`);

  // 哪个堆是「泰晤士河道超级马拉松」
  const HINT = /泰晤士|thames|ultra\s*challenge|超级马拉松|walking|挑战/i;
  let g = groups.find((x) => x.members.some((id) => HINT.test(one(getEntry(id) && getEntry(id).title))));
  if (!g) g = groups.sort((a, b) => b.members.length - a.members.length)[0];
  console.log('════ 这个堆里现在有谁 ════');
  for (const id of g.members) console.log(`   ${one((getEntry(id) || {}).title).slice(0, 52)}`);

  // 堆的中心 = 成员平均
  const dim = vecs.get(g.members[0]).length;
  const c = new Float32Array(dim);
  for (const id of g.members) { const v = vecs.get(id); if (v) for (let i = 0; i < dim; i++) c[i] += v[i]; }
  let n = 0; for (let i = 0; i < dim; i++) n += c[i] * c[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < dim; i++) c[i] /= n;

  // 停车那一串
  const PARK = /parking|egham|staines|runnymede|buckingham court|windsor road|bishops park|接驳车|取车|车站|停车/i;
  const parks = [...all.values()].filter((e) => PARK.test(`${e.title || ''} ${e.text || ''}`) && !g.members.includes(e.id));
  console.log(`\n════ 没进堆、但看着该进的 ${parks.length} 条 ════`);
  console.log('  正文长度  有向量  和堆中心  和堆里最像的一条        记录');
  const rows = [];
  for (const e of parks) {
    const len = chunk.textOf(e).length;
    const v = vecs.get(e.id);
    let toC = null; let best = null; let bestId = '';
    if (v) {
      toC = dot(c, v);
      for (const id of g.members) { const mv = vecs.get(id); if (!mv) continue; const s = dot(v, mv); if (best === null || s > best) { best = s; bestId = id; } }
    }
    rows.push({ e, len, v: !!v, toC, best, bestId });
  }
  rows.sort((a, b) => (b.best || -1) - (a.best || -1));
  for (const x of rows) {
    const mark = x.len < 24 ? '← 太短，根本不参与归堆' : '';
    console.log(`  ${String(x.len).padStart(6)}  ${x.v ? ' 有  ' : ' 没有'}  ${x.toC === null ? '  —  ' : x.toC.toFixed(3)}   ${x.best === null ? '  —  ' : x.best.toFixed(3)}  ${one((getEntry(x.bestId) || {}).title).slice(0, 18).padEnd(20)}  ${one(x.e.title).slice(0, 34)} ${mark}`);
  }
  console.log(`\n  归堆的门槛 JOIN=${topic.JOIN ?? 0.62}（和堆的**代表**比） · 双链的门槛 NEAR=${vector.NEAR}（和某一条比） · MIN_TEXT=${topic.MIN_TEXT ?? 24}`);

  console.log('\n════ 这些记录彼此像不像（它们自己能不能成一堆）════');
  const withV = rows.filter((x) => x.v);
  let pairs = 0; let over = 0;
  for (let i = 0; i < withV.length; i++) {
    for (let j = i + 1; j < withV.length; j++) {
      const s = dot(vecs.get(withV[i].e.id), vecs.get(withV[j].e.id));
      pairs++; if (s >= 0.62) over++;
    }
  }
  console.log(`  ${withV.length} 条两两 ${pairs} 对，其中 ${over} 对 ≥ 0.62`);

  // 归堆比的是「和代表比」，代表是这堆里**时间最早**的那一条。所以要单独看代表是谁。
  console.log('\n════ 代表是谁，比的又是谁 ════');
  console.log(`  这堆的代表：「${one((getEntry(g.leader) || {}).title).slice(0, 46)}」`);
  const lv = vecs.get(g.leader);
  const anchors = g.members.map((id) => ({ id, t: one((getEntry(id) || {}).title).slice(0, 30) }));
  console.log('\n  和「代表」比 vs 和堆里每一条比（归堆只看第一列，双链看后面几列）：');
  const head = ['和代表', ...anchors.map((a) => a.t.slice(0, 12))];
  console.log('    ' + head.map((h) => h.padEnd(14)).join('') + '  记录');
  for (const x of rows.slice(0, 12)) {
    const v = vecs.get(x.e.id);
    if (!v) continue;
    const cells = [dot(v, lv), ...anchors.map((a) => dot(v, vecs.get(a.id) || new Float32Array(dim)))];
    console.log('    ' + cells.map((n2) => n2.toFixed(3).padEnd(14)).join('') + '  ' + one(x.e.title).slice(0, 30));
  }

  // 把门槛一路放低，看要低到什么程度这些记录才连得上——以及那时候会顺手连进来多少不相干的
  console.log('\n════ 门槛放到多低才连得上，代价是什么 ════');
  const parkIds = new Set(rows.filter((x) => x.v && x.len < 200).map((x) => x.e.id));   // 那几条真的地址/短句
  console.log('  门槛   那几条地址连上几条   全工作区平均每条记录连出几条');
  for (const floor of [0.60, 0.50, 0.40, 0.30, 0.20]) {
    let hit = 0;
    for (const id of parkIds) {
      const v = vecs.get(id);
      if (g.members.some((m) => vecs.get(m) && dot(v, vecs.get(m)) >= floor)) hit++;
    }
    let total = 0; let cnt = 0;
    for (const [id, v] of vecs) {
      let k = 0;
      for (const [id2, v2] of vecs) { if (id2 !== id && dot(v, v2) >= floor) k++; }
      total += k; cnt++;
    }
    console.log(`  ${floor.toFixed(2)}   ${String(hit).padStart(6)} / ${parkIds.size}          ${(total / cnt).toFixed(1)}`);
  }

  // ── 对照一：代表换成「跟着走的重心」。现在是拿新记录和**堆里最早那一条**比，
  // 而这堆最早那一条是「English (Great Britain)」——一个语言选择条在把门。
  console.log('\n════ 对照一：代表固定 vs 重心跟着走 ════');
  const rowsAll = topic.recordVectors(index)
    .filter((x) => { const e = getEntry(x.id); return e && chunk.textOf(e).length >= 24; })
    .sort((a, b) => String((getEntry(a.id) || {}).createdAt || '').localeCompare(String((getEntry(b.id) || {}).createdAt || '')));
  function clusterCentroid(list, join) {
    const gs = [];
    for (const r of list) {
      let best = -1; let bestS = join;
      for (let i = 0; i < gs.length; i++) { const s = dot(r.v, gs[i].c); if (s >= bestS) { bestS = s; best = i; } }
      if (best >= 0) {
        const gg = gs[best];
        gg.members.push(r.id);
        for (let i = 0; i < gg.sum.length; i++) gg.sum[i] += r.v[i];
        let nn = 0; for (let i = 0; i < gg.sum.length; i++) nn += gg.sum[i] * gg.sum[i];
        nn = Math.sqrt(nn) || 1;
        gg.c = gg.sum.map((z) => z / nn);
      } else {
        gs.push({ members: [r.id], sum: [...r.v], c: [...r.v] });
      }
    }
    return gs.filter((x) => x.members.length >= 3);
  }
  const byC = clusterCentroid(rowsAll, 0.62);
  const inTopic = (list) => list.find((x) => x.members.some((id) => /ultra challenge/i.test(one((getEntry(id) || {}).title))));
  const gc = inTopic(byC);
  console.log(`  固定代表   ${groups.length} 个堆，最大 ${Math.max(...groups.map((x) => x.members.length))} 条，那个堆 ${g.members.length} 条`);
  console.log(`  重心跟着走 ${byC.length} 个堆，最大 ${Math.max(...byC.map((x) => x.members.length))} 条，那个堆 ${gc ? gc.members.length : 0} 条`);
  if (gc) for (const id of gc.members) console.log(`     ${one((getEntry(id) || {}).title).slice(0, 52)}`);

  // ── 对照二：这条关系本来就不是「意思像」，是「同一段时间、同一个来处」。
  console.log('\n════ 对照二：时间和来处说了什么 ════');
  const stamp = (id) => String((getEntry(id) || {}).createdAt || '').slice(0, 16).replace('T', ' ');
  console.log('  堆里那几条：');
  for (const id of g.members) console.log(`     ${stamp(id)}  ${(getEntry(id) || {}).origin || '?'}  ${one((getEntry(id) || {}).title).slice(0, 40)}`);
  console.log('  停车那几条（只列短的、纯地址那种）：');
  for (const x of rows.filter((y) => y.len < 200)) console.log(`     ${stamp(x.e.id)}  ${x.e.origin || '?'}  ${one(x.e.title).slice(0, 40)}`);

  console.log('\n════ 逐条看：它到底写了什么 ════');
  for (const x of rows.slice(0, 10)) {
    console.log(`\n  「${one(x.e.title).slice(0, 46)}」  ${x.e.type} · ${x.e.origin || '?'} · 正文 ${x.len} 字`);
    console.log(`     ${one(chunk.textOf(x.e)).slice(0, 150)}`);
  }

  require('../src/main/embed').dispose();
  fs.rmSync(tmp, { recursive: true, force: true });
  app.quit();
}
app.whenReady().then(() => main().catch((e) => { console.error('炸了:', e && e.stack || e); app.quit(); }));
