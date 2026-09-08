'use strict';
// 拿真实工作区里已经有的东西，编几个日常场景，看它答成什么样。
//
//   npx electron dev/ask-scenarios.js [场景字母]
//
// 每个场景都是**两问**，而且第二问故意省掉主语——那才是日常说话的样子，
// 也是这套东西真正难的地方（第一问自带线索，谁都答得出）。
// 这里不打分，只把「它拿到了哪几条」和「它说了什么」原样印出来，好坏你自己看。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const HOME = os.homedir();
const WS = path.join(HOME, 'Library/Application Support/briffy/workspace');
const DIR = path.join(WS, 'entries');
const UD = path.join(HOME, 'Library/Application Support/briffy');
const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// 每个场景后面那一行是「库里其实写着什么」——我先看过记录才编的题，
// 不然就成了自己出题自己答。
const SCENES = [
  ['A', '超级马拉松', [
    '你看看我最近要去一个走路的活动你帮我做个行程单',
    '我记下来了详细的起点和终点地址，你找一下',
  ], '库里有：1st Half Challenge (~50km) Walking Only、9月12日周六、Bishops Park→Runnymede Pleasure Ground TW20 0AE、£159、停车 Windsor Road / 3 Buckingham Court TW18 4JG、£10 接驳车'],

  ['F', '用户真实问的（回声考验）', [
    '我最近报名了一个活动，你帮我看看起点和终点的具体地址，还有开始时间',
    '我要的是具体地址',
  ], '正确答案：Bishops Park (Fulham) → Runnymede Pleasure Ground, Egham, Surrey TW20 0AE，07:00–09:30。考验点：工作区里躺着五条「以前问过的话」的剪贴板拷贝，它们词面上完美命中却不含答案'],

  ['B', '二手显示器', [
    '我最近在看二手显示器，都看了些什么？',
    '卖家在哪，说好几点见？',
  ], '库里有：Facebook Marketplace、Dell ultrawide（USB-C 口坏了，带盒）、Samsung CJ89 49" £150、卖家「今晚在 Heathrow 附近」、"arrive at your place around nine"、"home in half an hour"、OX26 2GL'],

  ['C', 'Padel 退款', [
    '我要申诉一笔球场的收费，帮我把凭证凑齐',
    '收据号和金额是多少',
  ], '库里有：Playtomic UK Ltd、PADELHUB RG1 Reading、2026/08/23 19:30–21:00、Indoor Court 1–3、£13.00、收据号 PUK-CM-RECEIPT-GB-2026-08-01045297'],

  ['D', 'briffy 内存', [
    '我之前说过这个 app 内存占用要优化，当时定了什么',
    '那几个模型分别占多少',
  ], '库里有：现在 1.8g 要压到 500-1000、按需加载的模型 OCR 约 450MB / Whisper / embedding 696MB、只留最近 40 天、没落盘的那一天绝不淘汰'],

  ['E', '本地模型（陷阱题）', [
    '我这台电脑适合跑哪个本地模型',
    '地址是多少',
  ], '陷阱：上一场景里「地址」是门牌号，这里必须理解成 Ollama 的服务地址。库里有：推荐 qwen3.5:27b 约 17GB、qwen3.5:0.8b、「Ollama 地址」那两条'],
];

function fakeStore() {
  const days = new Map(); const byId = new Map();
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.json')) continue;
    let e; try { e = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (_) { continue; }
    const l = Array.isArray(e) ? e : e.entries || [];
    days.set(f.slice(0, -5), l);
    for (const x of l) byId.set(x.id, x);
  }
  const settings = JSON.parse(fs.readFileSync(path.join(UD, 'settings.json'), 'utf8'));
  // **钉死用本地模型。** 应用里的 provider 是你随时会在界面上切的，而场景台要能反复跑出
  // 可比的结果——中途被切一次，后三个场景全部报鉴权错，白跑。要测别的 provider 就传参数。
  const want = (process.argv.find((a) => /^--provider=/.test(a)) || '--provider=ollama').split('=')[1];
  settings.provider = want;
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
  const llm = require('../src/main/llm');
  const index = require('../src/main/index-db');
  const vector = require('../src/main/vector');
  const vocab = require('../src/main/vocab');
  ask.init({ store });

  ask.refresh({ budgetMs: 40000 });
  let v; do { v = await vector.fill(index, (k) => store.loadDay(k), { budgetMs: 9000, batch: 20, cacheDir: store.paths().models }); if (v.error) break; } while (!v.done);
  if (!(v && v.error)) vector.buildBuckets(index);
  let f; do { f = vocab.fill(index, (id) => store.getEntry(id), { budgetMs: 3000 }); } while (!f.done);
  let s; do { s = vocab.settle(index, { budgetMs: 3000 }); } while (!s.done);
  for (const k of store.listDates()) vocab.collectPages(index, store.loadDay(k));

  const cfg = llm.config(store);
  console.log(`${store.byId.size} 条记录 · ${cfg.provider} / ${(cfg[cfg.provider] || {}).model || ''} · 向量${v && v.error ? '没有' : '齐了'}`);

  const only = (process.argv.find((a) => /^[A-F]$/.test(a)) || '').toUpperCase();
  for (const [tag, title, turns, truth] of SCENES) {
    if (only && tag !== only) continue;
    console.log(`\n\n████████ 场景 ${tag} · ${title} ████████`);
    console.log(`（库里其实写着：${truth}）`);
    const history = [];
    for (let i = 0; i < turns.length; i++) {
      const q = turns[i];
      const t = Date.now();
      const r = await ask.run(q, { history });
      console.log(`\n─── 第 ${i + 1} 问 ─── ${Date.now() - t}ms`);
      console.log(`问：${q}`);
      console.log(`它去找了：${JSON.stringify((r.queries || []).slice(2))}`);
      console.log(`拿到 ${r.sources.length} 条：${r.sources.slice(0, 8).map((e) => one(e.title).slice(0, 22)).join(' · ')}${r.sources.length > 8 ? ' …' : ''}`);
      console.log(`\n答：${r.error ? `【出错】${r.error}` : (r.answer || '（空）')}`);
      history.push({ question: q, answer: r.answer || '', ids: r.ids || [], used: r.used || [] });
    }
  }
  require('../src/main/embed').dispose();
  app.quit();
}
app.whenReady().then(() => main().catch((e) => { console.error('炸了:', e && e.stack || e); app.quit(); }));
