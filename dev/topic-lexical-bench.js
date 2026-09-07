'use strict';
// 归堆到底要不要向量——同一批记录，词面聚一遍，和向量聚出来的对着看。
//
//   npx electron dev/topic-lexical-bench.js
//
// 值得问，因为答案改变这个功能的门槛：如果词面够用，那它在跑不动模型的机器上照样能用，
// 也不用等 545 个块算完才出得来。
//
// 词面这一侧用的是索引里现成的东西：同一套分词（index.tokens）和同一张词频表（vocab），
// 每条记录一个 TF-IDF 稀疏向量，再走和 topic.js 完全相同的 leader clustering。
// 唯一的差别就是「像不像」这一步怎么算。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const HOME = os.homedir();
const WS = path.join(HOME, 'Library/Application Support/briffy/workspace');
const DIR = path.join(WS, 'entries');
const CACHE = path.join(HOME, 'Library/Application Support/briffy/models');

function sparse(tokens, df, total) {
  const tf = new Map();
  for (const w of tokens) if (w.length > 1) tf.set(w, (tf.get(w) || 0) + 1);
  const v = new Map();
  let n = 0;
  for (const [w, c] of tf) {
    const d = df(w);
    if (!d || d / total > 0.25) continue;                 // 太常见的词不参与，和检索那边同一条线
    const x = (1 + Math.log(c)) * Math.log(total / d);
    v.set(w, x); n += x * x;
  }
  n = Math.sqrt(n) || 1;
  for (const [w, x] of v) v.set(w, x / n);
  return v;
}
function cos(a, b) {
  const [s, l] = a.size < b.size ? [a, b] : [b, a];
  let d = 0;
  for (const [w, x] of s) { const y = l.get(w); if (y) d += x * y; }
  return d;
}
/** 和 topic.js 里同一个算法：每条只和堆的代表比 */
function cluster(ids, vec, sim, join) {
  const leaders = [];
  for (const id of ids) {
    let best = -1; let bestS = join;
    for (let g = 0; g < leaders.length; g++) {
      const s = sim(vec.get(id), vec.get(leaders[g].leader));
      if (s >= bestS) { bestS = s; best = g; }
    }
    if (best >= 0) leaders[best].members.push(id);
    else leaders.push({ leader: id, members: [id] });
  }
  return leaders.filter((l) => l.members.length >= 3);
}

async function main() {
  const index = require('../src/main/index-db');
  const vector = require('../src/main/vector');
  const topic = require('../src/main/topic');
  const chunk = require('../src/main/chunk');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-lex-'));
  index.open(tmp, WS);
  index.useVecModel(vector.MODEL);
  const loadDay = (k) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, `${k}.json`), 'utf8')); } catch (_) { return []; } };
  let r; do { r = index.sync({ dir: DIR, loadDay }, { budgetMs: 20000 }); } while (!r.done);
  const t0 = Date.now();
  let f; do { f = await vector.fill(index, loadDay, { budgetMs: 8000, batch: 20, cacheDir: CACHE }); if (f.error) break; } while (!f.done);
  const vecMs = Date.now() - t0;
  if (f.error) { console.log('向量补不了：', f.error); app.quit(); return; }

  const all = new Map();
  for (const file of fs.readdirSync(DIR)) {
    if (!file.endsWith('.json')) continue;
    let e; try { e = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8')); } catch (_) { continue; }
    for (const x of (Array.isArray(e) ? e : e.entries || [])) all.set(x.id, x);
  }
  const getEntry = (id) => all.get(id) || null;

  // 向量那一侧：topic.js 现在就是这么做的
  const byVec = topic.build(index, getEntry);

  // 词面那一侧：同样的记录、同样的算法，只换「像不像」
  const t1 = Date.now();
  const total = index.stats().entries;
  const dfCache = new Map();
  const df = (w) => {
    if (!dfCache.has(w)) { const one = index.termsOf(w)[0]; dfCache.set(w, one ? one.rareDf : 0); }
    return dfCache.get(w);
  };
  const ids = [...all.keys()]
    .filter((id) => chunk.textOf(getEntry(id)).length >= 24)
    .sort((a, b) => String(getEntry(a).createdAt || '').localeCompare(String(getEntry(b).createdAt || '')));
  const vec = new Map();
  for (const id of ids) {
    const e = getEntry(id);
    vec.set(id, sparse(index.tokens(`${e.title || ''} ${String(e.text || '').slice(0, 1200)}`), df, total));
  }
  const lexMs = Date.now() - t1;

  console.log(`可归堆的记录 ${ids.length} 条`);
  console.log(`向量：算 545 块用了 ${(vecMs / 1000).toFixed(1)}s（一次性，之后增量）`);
  console.log(`词面：算 ${ids.length} 个 TF-IDF 用了 ${lexMs}ms，零模型\n`);

  console.log('  阈值   词面堆数  进堆的记录');
  for (const th of [0.15, 0.20, 0.25, 0.30, 0.40]) {
    const g = cluster(ids, vec, cos, th);
    console.log(`  ${th.toFixed(2)}   ${String(g.length).padStart(6)}  ${g.reduce((n, x) => n + x.members.length, 0)}`);
  }

  // 挑一个堆数接近的阈值，看两边到底聚出了什么
  let pick = null;
  for (const th of [0.15, 0.20, 0.25, 0.30, 0.40]) {
    const g = cluster(ids, vec, cos, th);
    if (!pick || Math.abs(g.length - byVec.length) < Math.abs(pick.g.length - byVec.length)) pick = { th, g };
  }
  const title = (id) => String((getEntry(id) || {}).title || '').replace(/\s+/g, ' ').slice(0, 30);
  console.log(`\n════ 向量：${byVec.length} 堆 ════`);
  for (const g of byVec.slice(0, 10)) console.log(`  ${String(g.members.length).padStart(2)} 条  ${g.members.slice(0, 3).map(title).join(' / ')}`);
  console.log(`\n════ 词面（阈值 ${pick.th}）：${pick.g.length} 堆 ════`);
  for (const g of pick.g.slice(0, 10)) console.log(`  ${String(g.members.length).padStart(2)} 条  ${g.members.slice(0, 3).map(title).join(' / ')}`);

  // 向量的每个堆，词面有没有把它认出来（成员重合过半就算认出来了）
  let found = 0;
  for (const a of byVec) {
    const A = new Set(a.members);
    const hit = pick.g.some((b) => b.members.filter((m) => A.has(m)).length >= Math.ceil(a.members.length / 2));
    if (hit) found++;
  }
  console.log(`\n向量聚出的 ${byVec.length} 个堆里，词面认出了 ${found} 个（成员重合过半算认出）`);

  require('../src/main/embed').dispose();
  fs.rmSync(tmp, { recursive: true, force: true });
  app.quit();
}

app.whenReady().then(() => main().catch((e) => { console.error('炸了:', e && e.stack || e); app.quit(); }));
