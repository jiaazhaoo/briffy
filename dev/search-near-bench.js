'use strict';
// 搜索框的两条腿，交出来的到底是什么。跑的是**真的 ask.near 和 index.search**。
//
//   npx electron dev/search-near-bench.js
//
// 一半问法库里确实有，一半库里根本没有。没有的那一半，正确答案是**空手**——
// 拿十二条不相干的记录填满第一屏，比什么都不给更糟：它让人以为自己搜过了。
const fs = require('fs'); const path = require('path'); const os = require('os');
const { app } = require('electron');
const HOME = os.homedir();
const WS = path.join(HOME, 'Library/Application Support/briffy/workspace');
const DIR = path.join(WS, 'entries');
const UD = path.join(HOME, 'Library/Application Support/briffy');
const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const HAVE = ['车', '停车', '跑步', '显示器', '地址', '泰晤士河', '退款', '活动'];
const NONE = ['房贷利率', '量子色动力学', '我奶奶的猫', 'recipe for sourdough'];

function fakeStore() {
  const days = new Map(); const byId = new Map();
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.json')) continue;
    let e; try { e = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (_) { continue; }
    const list = Array.isArray(e) ? e : e.entries || [];
    days.set(f.slice(0, -5), list);
    for (const x of list) byId.set(x.id, x);
  }
  const settings = JSON.parse(fs.readFileSync(path.join(UD, 'settings.json'), 'utf8'));
  return {
    userData: UD, workspaceDir: WS,
    paths: () => ({ entries: DIR, models: path.join(UD, 'models') }),
    listDates: () => [...days.keys()].sort(),
    loadDay: (k) => days.get(k) || [],
    getEntry: (id) => byId.get(id) || null,
    getSettings: () => settings, getSecret: () => '', byId,
  };
}

async function main() {
  const store = fakeStore();
  const ask = require('../src/main/ask');
  const index = require('../src/main/index-db');
  const vector = require('../src/main/vector');
  ask.init({ store });
  ask.refresh({ budgetMs: 30000 });
  const loadDay = (k) => store.loadDay(k);
  let v; do { v = await vector.fill(index, loadDay, { budgetMs: 9000, batch: 20, cacheDir: store.paths().models }); if (v.error) break; } while (!v.done);
  console.log(`${store.byId.size} 条记录 · ${v && v.error ? `向量没有（${v.error}）` : '向量齐了'}\n`);
  const nm = (id) => one((store.getEntry(id) || {}).title).slice(0, 26) || '（无标题）';

  let noise = 0;
  for (const [label, list, want] of [['库里有', HAVE, true], ['库里没有', NONE, false]]) {
    console.log(`\n════ ${label} ════`);
    for (const q of list) {
      const lex = index.search({ query: q, limit: 12 }).ids;
      const nr = await ask.near(q, { exclude: lex, limit: 12 });
      if (!want) noise += nr.length;
      console.log(`「${q}」  词面 ${String(lex.length).padStart(2)} 条   意思相近 ${String(nr.length).padStart(2)} 条`);
      if (nr.length) console.log(`      ${nr.slice(0, 4).map(nm).join('  |  ')}`);
    }
  }
  console.log(`\n库里没有的四个问法，一共冒出来 ${noise} 条「意思相近」。这个数该是 0。`);
  require('../src/main/embed').dispose();
  app.quit();
}
app.whenReady().then(() => main().catch((e) => { console.error(e && e.stack || e); app.quit(); }));
