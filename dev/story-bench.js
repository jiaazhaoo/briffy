'use strict';
// 从一条记录长出去的那一片，长得对不对。
//
//   npx electron dev/story-bench.js
//
// 验收标准是现成的：那一晚的十四条（截图里的九条 + 主题里已有的五条）。
// 一片长得好不好，只有两个数——**收进来几条对的**，和**顺手带进来几条不相干的**。
// 扩散有两个旋钮（门槛、每跳衰减），所以扫一遍，不猜。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const HOME = os.homedir();
const WS = path.join(HOME, 'Library/Application Support/briffy/workspace');
const DIR = path.join(WS, 'entries');
const CACHE = path.join(HOME, 'Library/Application Support/briffy/models');
const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const WANT = [/^Find parking/i, /^Windsor Road, Egham/i, /^Buckingham Court, Kingston/i,
  /^Parking space on Buckingham/i, /^£10 接驳车/, /^停 Staines/, /^Runnymede Pleasure/i,
  /^赛程分前后半程/, /^Bishops Park/i,
  /^English \(Great Britain\)$/, /^Sat・12 Sep 2026/, /^Ultra Challenge$/,
  /^Thank you! Your registration/i, /^1st Half Challenge$/];

async function main() {
  const links = require('../src/main/links');
  const story = require('../src/main/story');
  const bp = require('../src/main/boilerplate');
  const index = require('../src/main/index-db');
  const vector = require('../src/main/vector');

  const all = [];
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.json')) continue;
    let e; try { e = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (_) { continue; }
    for (const x of (Array.isArray(e) ? e : e.entries || [])) all.push(x);
  }
  const byId = new Map(all.map((e) => [e.id, e]));
  const name = (id) => one((byId.get(id) || {}).title).slice(0, 30) || '（无标题）';

  const fur = bp.learn(all.map((e) => String(e.text || '')));
  const t0 = Date.now();
  const g = links.build(all);
  const ev = links.evidenceIndex(all, (e) => bp.strip(String(e.text || ''), fur));
  console.log(`${all.length} 条记录，建图 ${Date.now() - t0}ms\n`);

  // 向量那一路（≥0.70），有就用，没有也照跑
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-story-'));
  index.open(tmp, WS); index.useVecModel(vector.MODEL);
  const loadDay = (k) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, `${k}.json`), 'utf8')); } catch (_) { return []; } };
  let r; do { r = index.sync({ dir: DIR, loadDay }, { budgetMs: 20000 }); } while (!r.done);
  let vok = true;
  let f; do { f = await vector.fill(index, loadDay, { budgetMs: 9000, batch: 20, cacheDir: CACHE }); if (f.error) { vok = false; break; } } while (!f.done);
  const near = vok ? (id) => { try { return vector.related(index, id, { limit: 4 }); } catch (_) { return []; } } : () => [];
  console.log(vok ? '向量：有' : `向量：没有（${f && f.error}）`);

  const ctx = { g, ev, near, ids: all.map((e) => e.id) };
  const targets = WANT.map((re) => (all.filter((e) => re.test(one(e.title))).pop() || {}).id).filter(Boolean);
  const seed = all.find((e) => /^Ultra Challenge$/.test(one(e.title)));
  console.log(`盯住 ${targets.length} 条，从「${one(seed.title)}」长起\n`);

  console.log('  门槛  衰减   收进来   一片多大   不相干的   用时');
  for (const decay of [0.8, 0.85, 0.9]) {
    for (const floor of [0.24, 0.30, 0.34, 0.38]) {
      const t = Date.now();
      const s = story.grow(seed.id, ctx, { floor, decay, max: 60 });
      const ids = new Set(s.members.map((m) => m.id));
      const hit = targets.filter((x) => ids.has(x)).length;
      console.log(`  ${floor.toFixed(2)}  ${decay.toFixed(2)}   ${String(hit).padStart(3)} / ${targets.length}   ${String(ids.size).padStart(5)} 条    ${String(ids.size - hit).padStart(5)}     ${Date.now() - t}ms`);
    }
  }

  const S = story.grow(seed.id, ctx, { max: 60 });
  console.log(`\n════ 默认参数下长出来的那一片（${S.members.length} 条）════`);
  console.log(`  名字：${story.nameOf(S.members, ctx)}`);
  for (const m of S.members) {
    const v = m.via;
    const why = !v ? '（种子）'
      : v.kind === 'word' ? `同一个词 ${(v.words || []).join(' · ')}`
        : v.kind === 'page' ? `同一处 ${one(v.name).slice(0, 22)}`
          : v.kind === 'run' ? `同一程 ${one(v.name).slice(0, 22)}` : '意思相近';
    const mark = targets.includes(m.id) ? '✓' : ' ';
    console.log(`  ${mark} ${m.score.toFixed(2)} 跳${m.hop}  ${name(m.id).padEnd(32)} ← ${why}`);
  }

  console.log('\n════ 枢纽：顶上那一栏该列的东西 ════');
  const t1 = Date.now();
  const hs = story.hubs(ctx, { limit: 10 });
  console.log(`  算 ${Date.now() - t1}ms`);
  for (const h of hs) console.log(`  ${String(h.n).padStart(3)} 条  ${String(h.name).padEnd(30)}  ← ${name(h.id)}`);

  require('../src/main/embed').dispose();
  fs.rmSync(tmp, { recursive: true, force: true });
  app.quit();
}
app.whenReady().then(() => main().catch((e) => { console.error('炸了:', e && e.stack || e); app.quit(); }));
