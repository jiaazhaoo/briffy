'use strict';
// 自动双链：每条记录连到和它最像的那几条，主题从这张图上算出来。
//
//   npx electron dev/link-bench.js
//
// 想法的来处：向量已经每条都有了，而现在只有约三分之一的记录进得了堆（topic.js 的门槛），
// 剩下的在界面上一条关系都看不见。但**每一条都有最近邻**。
//
// 要先验的不是"能不能连"，是"连出来的像不像"。向量分数没有绝对意义——检索那边量过，
// 一条正确答案 0.445、一个工作区里根本不存在的问题也能凑到 0.432。所以最近邻永远非空，
// 哪怕它其实不相干。门槛划在哪，只能看真实数据。
//
// 顺带比一遍：从这张图上跑社区发现，和现在的 leader clustering 谁聚得好。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const HOME = os.homedir();
const WS = path.join(HOME, 'Library/Application Support/briffy/workspace');
const DIR = path.join(WS, 'entries');
const CACHE = path.join(HOME, 'Library/Application Support/briffy/models');
const K = 5;

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/** 标签传播：邻居里最多的那个标签就是我的标签，反复几轮直到不变。没有 k，没有依赖。 */
function labelProp(n, edges, rounds = 20) {
  const label = new Array(n).fill(0).map((_, i) => i);
  const nbr = new Map();
  for (const [a, b, w] of edges) {
    if (!nbr.has(a)) nbr.set(a, []); nbr.get(a).push([b, w]);
    if (!nbr.has(b)) nbr.set(b, []); nbr.get(b).push([a, w]);
  }
  for (let r = 0; r < rounds; r++) {
    let moved = 0;
    const order = [...Array(n).keys()].sort(() => Math.random() - 0.5);
    for (const i of order) {
      const list = nbr.get(i);
      if (!list || !list.length) continue;
      const tally = new Map();
      for (const [j, w] of list) tally.set(label[j], (tally.get(label[j]) || 0) + w);
      let best = label[i]; let bestW = -1;
      for (const [l, w] of tally) if (w > bestW) { bestW = w; best = l; }
      if (best !== label[i]) { label[i] = best; moved++; }
    }
    if (!moved) break;
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) { if (!groups.has(label[i])) groups.set(label[i], []); groups.get(label[i]).push(i); }
  return [...groups.values()];
}

async function main() {
  const index = require('../src/main/index-db');
  const vector = require('../src/main/vector');
  const topic = require('../src/main/topic');
  const chunk = require('../src/main/chunk');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-link-'));
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
  const rows = topic.recordVectors(index).filter((x) => {
    const e = getEntry(x.id);
    return e && chunk.textOf(e).length >= topic.MIN_TEXT;
  });
  const title = (id) => String((getEntry(id) || {}).title || '').replace(/\s+/g, ' ').slice(0, 34) || '（无标题）';
  console.log(`${rows.length} 条记录，全部两两比 = ${(rows.length * (rows.length - 1) / 2).toLocaleString()} 次点积`);

  // 全部两两
  const t0 = Date.now();
  const nbrs = rows.map(() => []);
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const s = dot(rows[i].v, rows[j].v);
      nbrs[i].push([j, s]); nbrs[j].push([i, s]);
    }
  }
  for (const list of nbrs) list.sort((a, b) => b[1] - a[1]);
  console.log(`算完用了 ${Date.now() - t0}ms\n`);

  // 最近邻的分数分布：门槛该划在哪
  const top1 = nbrs.map((l) => (l[0] ? l[0][1] : 0)).sort((a, b) => a - b);
  const q = (p) => top1[Math.floor(top1.length * p)].toFixed(3);
  console.log(`最近邻的分数：最低 ${q(0)} · 四分之一 ${q(0.25)} · 中位 ${q(0.5)} · 四分之三 ${q(0.75)} · 最高 ${top1[top1.length - 1].toFixed(3)}`);
  console.log('  门槛   有链接的记录   平均每条几条链接');
  for (const floor of [0.40, 0.50, 0.55, 0.60, 0.65, 0.70]) {
    let withLink = 0; let total = 0;
    for (const list of nbrs) {
      const n = list.filter(([, s]) => s >= floor).slice(0, K).length;
      if (n) withLink++;
      total += n;
    }
    console.log(`  ${floor.toFixed(2)}   ${String(withLink).padStart(5)} / ${rows.length}  (${Math.round(withLink * 100 / rows.length)}%)   ${(total / rows.length).toFixed(1)}`);
  }

  console.log('\n════ 随机挑八条，看它的邻居像不像 ════');
  const pick = [...Array(rows.length).keys()].sort(() => Math.random() - 0.5).slice(0, 8);
  for (const i of pick) {
    console.log(`\n  【${title(rows[i].id)}】`);
    for (const [j, s] of nbrs[i].slice(0, 3)) console.log(`     ${s.toFixed(3)}  ${title(rows[j].id)}`);
  }

  console.log('\n════ 主题：图上的社区 vs 现在的 leader clustering ════');
  const byLeader = topic.build(index, getEntry);
  console.log(`  leader clustering  ${byLeader.length} 堆，${byLeader.reduce((n, g) => n + g.members.length, 0)} 条进堆`);
  for (const floor of [0.55, 0.60, 0.65]) {
    const edges = [];
    for (let i = 0; i < rows.length; i++) {
      for (const [j, s] of nbrs[i].filter(([, x]) => x >= floor).slice(0, K)) if (i < j) edges.push([i, j, s]);
    }
    const comms = labelProp(rows.length, edges).filter((c) => c.length >= 3);
    console.log(`  标签传播 门槛 ${floor}    ${comms.length} 堆，${comms.reduce((n, c) => n + c.length, 0)} 条进堆，最大 ${Math.max(0, ...comms.map((c) => c.length))} 条`);
    if (floor === 0.60) {
      for (const c of comms.sort((a, b) => b.length - a.length).slice(0, 6)) {
        console.log(`      ${String(c.length).padStart(2)} 条  ${c.slice(0, 3).map((i) => title(rows[i].id)).join(' / ')}`);
      }
    }
  }

  require('../src/main/embed').dispose();
  fs.rmSync(tmp, { recursive: true, force: true });
  app.quit();
}

app.whenReady().then(() => main().catch((e) => { console.error('炸了:', e && e.stack || e); app.quit(); }));
