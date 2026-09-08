'use strict';
// 追问答不答得上来。跑的是**真的 ask.run**，不是它的复制品。
//
//   npx electron dev/ask-followup-bench.js
//
// 案子是用户那两问：
//   1「你看看我最近要去一个走路的活动你帮我做个行程单」  ← 自带全部线索
//   2「我记下来了详细的起点和终点地址，你找一下」        ← 主语在上一问里，而且要找的东西
//                                                     （Windsor Road / TW20 0AE）和这句话
//                                                     一个字都不共用
// 验收就一条：第 2 问的回答里，起点和终点的门牌号在不在。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const HOME = os.homedir();
const WS = path.join(HOME, 'Library/Application Support/briffy/workspace');
const DIR = path.join(WS, 'entries');
const UD = path.join(HOME, 'Library/Application Support/briffy');
const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const TURNS = ['你看看我最近要去一个走路的活动你帮我做个行程单',
  '我记下来了详细的起点和终点地址，你找一下'];
// 第 2 问的答案里该出现的东西
const WANT = [['起点', /Bishops Park/i], ['终点', /Runnymede Pleasure Ground/i], ['终点邮编', /TW20\s?0AE/i]];

/** 一个只读真实工作区的 store，够 ask.js 用。 */
function fakeStore() {
  const days = new Map();
  const byId = new Map();
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
    getSettings: () => settings,
    getSecret: () => '',
    byId,
  };
}

async function main() {
  const store = fakeStore();
  const ask = require('../src/main/ask');
  const llm = require('../src/main/llm');
  ask.init({ store });
  const cfg = llm.config(store);
  console.log(`${store.byId.size} 条记录 · ${cfg.provider} / ${(cfg[cfg.provider] || {}).model || ''}\n`);

  // 向量得先补齐，否则测的是个残缺的系统：「意思相近」那条边实测值 9/14 对 4/14，
  // 而 bench 不像应用那样跑 warm()，SCHEMA 一升级向量表就是空的——我在这上面白跑过好几轮。
  const index = require('../src/main/index-db');
  const vector = require('../src/main/vector');
  ask.refresh({ budgetMs: 30000 });
  const loadDay = (k) => store.loadDay(k);
  let v; do { v = await vector.fill(index, loadDay, { budgetMs: 9000, batch: 20, cacheDir: store.paths().models }); if (v.error) break; } while (!v.done);
  const b = v && v.error ? null : vector.buildBuckets(index);
  console.log(v && v.error ? `向量：没有（${v.error}）` : `向量：齐了 · 粗筛桶 ${b.bits} 位 × ${b.tables} 表\n`);

  const history = [];
  for (let i = 0; i < TURNS.length; i++) {
    const q = TURNS[i];
    const t = Date.now();
    const r = await ask.run(q, { history });
    const ms = Date.now() - t;
    console.log(`\n════════ 第 ${i + 1} 问 · ${ms}ms ════════`);
    console.log(`「${q}」\n`);
    console.log(`名字菜单前 12：${JSON.stringify((r.seeds || []).slice(0, 16))}`);
    console.log(`改写成 ${(r.queries || []).length} 条查询：${JSON.stringify(r.queries || [])}`);
    console.log(`递给模型的 ${r.sources.length} 条：`);
    for (const e of r.sources) console.log(`   · ${one(e.title).slice(0, 44)}`);
    console.log(`\n回答：\n${r.error ? `【出错】${r.error}` : r.answer || '（空）'}`);
    const used = (r.used || []).map((n) => r.sources[n - 1]).filter(Boolean);
    console.log(`\n它说自己用了 ${used.length} 条（下一轮的种子）：`);
    for (const e of used) console.log(`   → ${one(e.title).slice(0, 40)} :: ${one(e.text).slice(0, 90)}`);
    history.push({ question: q, answer: r.answer || '', ids: r.ids || [], used: r.used || [] });
    if (i === TURNS.length - 1) {
      console.log('\n验收：');
      let ok = 0;
      for (const [name, re] of WANT) {
        const hit = re.test(r.answer || '');
        if (hit) ok++;
        console.log(`   ${hit ? '✓' : '✗'} ${name}  ${re}`);
      }
      console.log(`\n   ${ok}/${WANT.length}`);
      process.exitCode = ok === WANT.length ? 0 : 1;
    }
  }
  // 断网 / 没配 AI 的那条路：改写拿不到，检索必须还是今天这套，不能因此空手。
  // ask.js 顶上那条保证就落在这儿，所以它得有人盯着。
  console.log('\n════════ 没配 AI 的时候 ════════');
  const bare = fakeStore();
  bare.getSettings = () => ({ ...store.getSettings(), provider: 'anthropic', anthropicKey: '' });
  ask.init({ store: bare });
  const r0 = await ask.run(TURNS[1], { history: [] });
  console.log(`  挑出 ${r0.sources.length} 条，noProvider=${r0.noProvider}，查询 ${JSON.stringify(r0.queries)}`);
  for (const e of r0.sources.slice(0, 5)) console.log(`     · ${one(e.title).slice(0, 44)}`);
  if (!r0.sources.length) { console.log('  ✗ 没有模型就空手了——这条保证破了'); process.exitCode = 1; }
  else console.log('  ✓ 没有模型照样给得出一份排好序的清单');

  require('../src/main/embed').dispose();
  app.quit();
}
app.whenReady().then(() => main().catch((e) => { console.error('炸了:', e && e.stack || e); app.quit(); }));
