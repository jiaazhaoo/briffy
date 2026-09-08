'use strict';
// 搜索框的两条腿，交出来的到底是什么。跑的是**真的 ask.near 和 index.search**。
//
//   npx electron dev/search-near-bench.js
//
// 一半问法库里确实有，一半库里根本没有。没有的那一半，正确答案是**空手**——
// 拿十二条不相干的记录填满第一屏，比什么都不给更糟：它让人以为自己搜过了。
//
// **试过、退回去的：把查询垫成一句话再去问向量**（`关于${q}的记录`）。
// 起因是量到这个模型的对齐在句子那一层，不在词那一层：
//   一句话  附近哪里可以停车 ↔ where can I park nearby  0.853 ／ 不相干的中文句子 0.171
//   一个词  停车 ↔ parking                           0.485 ／ 不相干的中文词 抓紧 0.901
// 垫一句话确实把同语种的引力拆掉了（中文噪声 0.704 → 0.356），「停车」也真的桥到了
// Find parking。但两条腿并起来跑，「停车」从 4 条噪声变成 10 条，「二手」9 条——
// 它捞回来的那两条真货，被它同时捞回来的噪声埋掉了。只用垫过的那一条也不行：
// 「活动」第一名变成「选择一条记录查看详情」，「退款」整条掉到门槛以下。
//
// 那些噪声有个共同点，指向下一件该做的事：兄弟相残、剪贴板图片 12:39、选择一条记录查看详情、
// 问问你的记录 → ——**是 briffy 自己的界面被截了进来**。它对任何问题都不是答案。
const fs = require('fs'); const path = require('path'); const os = require('os');
const { app } = require('electron');
const HOME = os.homedir();
const WS = path.join(HOME, 'Library/Application Support/briffy/workspace');
const DIR = path.join(WS, 'entries');
const UD = path.join(HOME, 'Library/Application Support/briffy');
const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const HAVE = ['车', '停车', '跑步', '显示器', '地址', '泰晤士河', '退款', '活动', '二手', 'parking'];
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
  // 页面图也得先建齐，应用里是 warm() 在后台补的。少了它，链那条腿在台子上永远空手，
  // 而线上是有东西的——我在这上面白跑过一轮。
  const vocab = require('../src/main/vocab');
  for (const k of store.listDates()) vocab.collectPages(index, store.loadDay(k));
  const pg = index.pgStats ? index.pgStats() : null;
  console.log(`${store.byId.size} 条记录 · ${v && v.error ? `向量没有（${v.error}）` : '向量齐了'}`
    + (pg ? ` · 页面图 ${pg.pages} 页 / ${pg.clips} 条摘录` : '') + '\n');
  const nm = (id) => one((store.getEntry(id) || {}).title).slice(0, 26) || '（无标题）';

  let noise = 0;
  for (const [label, list, want] of [['库里有', HAVE, true], ['库里没有', NONE, false]]) {
    console.log(`\n════ ${label} ════`);
    for (const q of list) {
      const lex = index.search({ query: q, limit: 12 }).ids;
      const nr = await ask.near(q, { exclude: lex, limit: 12 });
      if (!want) noise += nr.length;
      console.log(`「${q}」  词面 ${String(lex.length).padStart(2)} 条   意思相近 ${String(nr.length).padStart(2)} 条`);
      if (nr.length) console.log(`      ${nr.map(nm).join('  |  ')}`);
    }
  }
  console.log(`\n库里没有的四个问法，一共冒出来 ${noise} 条「意思相近」。这个数该是 0。`);
  require('../src/main/embed').dispose();
  app.quit();
}
app.whenReady().then(() => main().catch((e) => { console.error(e && e.stack || e); app.quit(); }));
