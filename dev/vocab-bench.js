'use strict';
// 词表搬进表里之后：答案一样吗，多少钱。
//
//   npx electron dev/vocab-bench.js
//
// 验收两条，缺一不可：
//   一、同样的问题，表里那一版和内存那一版给出的证据边要一致——搬家不是重写。
//   二、增量真的增量：加一条记录只该动它自己那几十行，不该把全库重算一遍。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const HOME = os.homedir();
const WS = path.join(HOME, 'Library/Application Support/briffy/workspace');
const DIR = path.join(WS, 'entries');
const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();

async function main() {
  const index = require('../src/main/index-db');
  const vector = require('../src/main/vector');
  const links = require('../src/main/links');
  const vocab = require('../src/main/vocab');
  const bp = require('../src/main/boilerplate');

  const days = new Map(); const byId = new Map();
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.json')) continue;
    let e; try { e = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (_) { continue; }
    const l = Array.isArray(e) ? e : e.entries || [];
    days.set(f.slice(0, -5), l);
    for (const x of l) byId.set(x.id, x);
  }
  const all = [...byId.values()];
  const name = (id) => one((byId.get(id) || {}).title).slice(0, 40) || '（无标题）';

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'voc-'));
  index.open(tmp, WS); index.useVecModel(vector.MODEL);
  let r; do { r = index.sync({ dir: DIR, loadDay: (k) => days.get(k) || [] }, { budgetMs: 20000 }); } while (!r.done);

  // ── 甲：收集（跟着 sync 走）
  let t = Date.now();
  for (const [, list] of days) vocab.collect(index, list);
  const msCollect = Date.now() - t;

  // ── 乙：抽词（限时可中断）
  t = Date.now();
  let f; let rounds = 0;
  do { f = vocab.fill(index, (id) => byId.get(id), { budgetMs: 400 }); rounds++; } while (!f.done);
  const msFill = Date.now() - t;
  t = Date.now();
  let s2; let sr = 0;
  do { s2 = vocab.settle(index, { budgetMs: 400 }); sr++; } while (!s2.done);
  const msSettle = Date.now() - t;
  const st = index.vocabStats();
  console.log(`${all.length} 条记录`);
  console.log(`  甲 收集抬头词/地名   ${msCollect}ms   → 标题词 ${st.titled} 个，地名 ${st.places} 个`);
  console.log(`  乙 抽词             ${msFill}ms（${rounds} 轮，每轮限时 400ms）→ ${st.words} 个词，${st.rows} 行`);
  console.log(`  丙 定次序           ${msSettle}ms（${sr} 轮）— 只改 rank，不重抽\n`);

  // ── 一、答案一样吗
  const fur = bp.learn(all.map((e) => String(e.text || '')));
  t = Date.now();
  const mem = links.evidenceIndex(all, (e) => bp.strip(String(e.text || ''), fur));
  const msMem = Date.now() - t;
  // 同一份内存实现，但**也不剥跨记录家具**——用来把「搬家带来的差异」和「少了家具表带来的
  // 差异」分开。分不开的话，76% 一致这个数说明不了任何事。
  const memNoFur = links.evidenceIndex(all, (e) => bp.strip(String(e.text || ''), null));
  const ids = all.map((e) => e.id);

  const agree = (X, Y) => {
    let hit = 0; let tot = 0;
    for (const id of ids) {
      const a = links.evidenceFor(id, X, { limit: 6 }).map((x) => x.id);
      const B = new Set(links.evidenceFor(id, Y, { limit: 6 }).map((x) => x.id));
      tot += a.length; hit += a.filter((x) => B.has(x)).length;
    }
    return tot ? `${(hit / tot * 100).toFixed(0)}%（${hit}/${tot}）` : '—';
  };
  const lazy = vocab.lazyView(index);                // 一个懒的，全程复用——它只碰问到的那几条
  const view = () => lazy;
  const tab = { __view: true };
  let hit = 0; let tot = 0; let hitNF = 0; let totNF = 0;
  for (const id of ids) {
    const v = view();
    const b = new Set(links.evidenceFor(id, v, { limit: 6 }).map((x) => x.id));
    const a = links.evidenceFor(id, mem, { limit: 6 }).map((x) => x.id);
    const c = links.evidenceFor(id, memNoFur, { limit: 6 }).map((x) => x.id);
    tot += a.length; hit += a.filter((x) => b.has(x)).length;
    totNF += c.length; hitNF += c.filter((x) => b.has(x)).length;
  }
  console.log(`  内存那版建一次 ${msMem}ms\n`);
  console.log('  证据边一致率（每条记录前 6 条）：');
  console.log(`    表版  vs  内存版（剥家具）      ${(hit / tot * 100).toFixed(0)}%（${hit}/${tot}）`);
  console.log(`    表版  vs  内存版（也不剥家具）  ${(hitNF / totNF * 100).toFixed(0)}%（${hitNF}/${totNF}）  ← 这个才是「搬家」本身的差异`);
  console.log(`    内存剥 vs 内存不剥              ${agree(mem, memNoFur)}  ← 家具表值多少`);

  // 那条关键的边还在不在
  const pick = (re) => (all.filter((e) => re.test(one(e.title))).pop() || {}).id;
  const A = pick(/^赛程分前后半程/); const B = pick(/^Runnymede Pleasure Ground/);
  const inTab = links.evidenceFor(A, view(), { limit: 16 }).findIndex((x) => x.id === B);
  const inMem = links.evidenceFor(A, mem, { limit: 16 }).findIndex((x) => x.id === B);
  console.log(`\n  「赛程分前后半程」→「Runnymede Pleasure Ground」：内存版第 ${inMem + 1} 名，表版第 ${inTab + 1} 名（0 = 够不到）`);

  // ── 二、加一条记录要多久
  const e0 = all[0];
  const fake = { ...e0, id: 'bench-new-1', title: `${e0.title} (bench)` };
  t = Date.now();
  vocab.collect(index, [fake]);
  index.putVocab('bench-new-1', require('../src/main/entity').of(fake, bp.strip(String(fake.text || ''), null), index.titledSet(), index.placeSet()).slice(0, 60));
  console.log(`\n  加一条记录：表版 ${Date.now() - t}ms；内存版要整个重算 ${msMem}ms`);
  index.dropVocab('bench-new-1');

  fs.rmSync(tmp, { recursive: true, force: true });
  app.quit();
}
app.whenReady().then(() => main().catch((e) => { console.error('炸了:', e && e.stack || e); app.quit(); }));
