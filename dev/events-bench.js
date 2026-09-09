'use strict';
// 软件自己整理出来的那几件事，对不对。
//
//   npx electron dev/events-bench.js
//
// 两问：那一晚（30 条）和显示器（12 条）有没有各自被整理成一件事；整理出来的其他事里
// 有多少是乱串的。「乱串」看每件事的成员里有几条不属于任何手标的簇——那不一定是错
// （没标的簇也是簇），所以逐件打印出来看。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');
const HOME = os.homedir();
const WS = path.join(HOME, 'Library/Application Support/briffy/workspace');
const DIR = path.join(WS, 'entries');
const UD = path.join(HOME, 'Library/Application Support/briffy');
const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const EVENING = [/^Ultra Challenge$/i, /^1st Half Challenge/i, /^Thank you! Your registration/i, /^Runnymede Pleasure/i,
  /^Bishops Park/i, /赛程分前后半程/, /^Windsor Road, Egham/i, /^停 Staines/, /^£10 接驳车/, /^Ultra March reddit/i,
  /^Path Thames/i, /^Sat・12 Sep 2026/, /^English \(Great Britain\)/, /^语音 22:34/,
  /^Find parking/i, /^Buckingham Court, Kingston/i, /^Parking space on Buckingham/i, /^Request to cancel UKPC/i,
  /^I was a registered, paying/i, /^Legalities \| Data Release/i, /^Windsor Road, Buckingham/i];
const MONITOR = [/^Dell ultrawide monitor/i, /296 PPI/, /^就用现在的 1280×800/, /^Samsung CJ89/i, /^www\.facebook\.com p3425we/i,
  /^Barely used\. Needs a new usb/i, /主显示器文字模糊/, /^BitsPerColor/i, /EDID/, /^color depth/i, /10bit/];
const ECHO = [/^我最近有个 walking 挑战/, /^你看看我最近要去一个走路的活动/, /^我最近报名了一个活动/, /^我记下来了详细地址/,
  /^具体的开始和结束的地址/];

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
    paths: () => ({ entries: DIR, ocr: path.join(WS, 'ocr'), models: path.join(UD, 'models') }),
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
  const vocab = require('../src/main/vocab');
  ask.init({ store });
  ask.refresh({ budgetMs: 30000 });
  const loadDay = (k) => store.loadDay(k);
  let v; do { v = await vector.fill(index, loadDay, { budgetMs: 9000, batch: 20, cacheDir: store.paths().models }); if (v.error) break; } while (!v.done);
  if (!(v && v.error)) vector.buildBuckets(index);
  let vf; do { vf = vocab.fill(index, (id) => store.getEntry(id), { budgetMs: 3000 }); } while (!vf.done);
  let vs; do { vs = vocab.settle(index, { budgetMs: 3000 }); } while (!vs.done);
  for (const k of store.listDates()) vocab.collectPages(index, store.loadDay(k));

  const title = (id) => one((store.getEntry(id) || {}).title);
  const nm = (id) => title(id).slice(0, 28) || '（无标题）';
  const inSet = (id, set) => set.some((re) => re.test(title(id)));
  const tag = (id) => (inSet(id, EVENING) ? '晚' : inSet(id, MONITOR) ? '屏' : inSet(id, ECHO) ? '问' : '·');

  const all = index.allIds();
  const story = require('../src/main/story');
  const t0 = Date.now();
  const list = ask.events({ force: true });
  const ms = Date.now() - t0;
  const coreOf = (e) => e.members.filter((m) => m.tier === 'core');
  const inCore = new Set(list.flatMap((e) => coreOf(e).map((m) => m.id)));
  const touched = new Set(list.flatMap((e) => e.members.filter((m) => m.tier === 'touch').map((m) => m.id)));
  console.log(`${all.length} 条记录，整理出 ${list.length} 件事，${ms}ms；${inCore.size} 条在某件事的核心里，${touched.size} 条沾边，${all.length - inCore.size - [...touched].filter((x) => !inCore.has(x)).length} 条两样都不是\n`);

  const bar = (s) => '▮'.repeat(Math.round(s * 4)) + '▯'.repeat(4 - Math.round(s * 4));
  for (const e of list) {
    const core = coreOf(e); const touch = e.members.filter((m) => m.tier === 'touch');
    const cnt = (ms) => { const c = { 晚: 0, 屏: 0, 问: 0, '·': 0 }; for (const m of ms) c[tag(m.id)]++; return `晚 ${c['晚']} · 屏 ${c['屏']} · 其他 ${c['·'] + c['问']}`; };
    console.log(`══ ${String(e.name || '（没名字）').padEnd(28)} 核心 ${core.length} 条（${cnt(core)}）  沾边 ${touch.length} 条（${cnt(touch)}）  认得出的锚词 ${e.quality || 0} · 密度 ${((e.quality || 0) / Math.max(1, core.length)).toFixed(2)}`);
    const g = e.lineage || story.lineage(e, new Map(all.map((id) => [id, ask.linksOf(id).related])));
    const whyT = (w) => (!w ? '—' : w.kind === 'word' && w.pairs ? w.pairs.map((p) => p.a).join('·') : w.kind === 'page' ? `同一页${w.name ? ' ' + w.name.slice(0, 10) : ''}` : w.kind);
    console.log(`     主轴：${g.spine.map((i, k) => `[${g.stops[i].members.length > 1 ? `${nm(g.stops[i].id).slice(0, 14)} +${g.stops[i].members.length - 1}` : nm(g.stops[i].id).slice(0, 14)}]${k < g.edges.length ? ` —${whyT(g.edges[k].why).slice(0, 22)}— ` : ''}`).join('')}`);
    for (const h of g.hang.slice(0, 6)) console.log(`       └ 挂在 [${nm(g.stops[h.to].id).slice(0, 12)}] 底下：${nm(g.stops[h.stop].id).slice(0, 16)}${g.stops[h.stop].members.length > 1 ? ` +${g.stops[h.stop].members.length - 1}` : ''}  ← ${whyT(h.why).slice(0, 24)}`);
    if (g.hang.length > 6) console.log(`       … 还挂着 ${g.hang.length - 6} 站`);
    if (touch.length) console.log(`     沾边：${touch.slice(0, 5).map((m) => `${tag(m.id)}${nm(m.id).slice(0, 14)}(${m.score.toFixed(2)})`).join(' | ')}${touch.length > 5 ? ` … 共 ${touch.length}` : ''}`);
  }

  // 两簇各自的核心落在几件事里、最大的那件收了多少、混了多少
  for (const [label, set] of [['那一晚', EVENING], ['显示器', MONITOR]]) {
    const cl = all.filter((id) => inSet(id, set));
    const per = list.map((e) => ({ e, n: coreOf(e).filter((m) => inSet(m.id, set)).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
    const top = per[0];
    console.log(`\n${label}（${cl.length} 条）的核心落在 ${per.length} 件事里：${per.map((x) => `${x.n}/${coreOf(x.e).length - x.n}`).join('、')}（收/混）；` +
      `没进任何核心的 ${cl.filter((id) => !inCore.has(id)).length} 条`);
  }

  // 一张卡片在哪几件事里
  console.log('\n════ 点一张卡片，它在哪几件事里 ════');
  for (const re of [/^停 Staines/, /^Find parking/i, /^Dell ultrawide/i, /^Windsor Road, Egham/i, /^你已经在做的事/, /^Ultra Challenge$/i]) {
    const id = all.find((x) => re.test(title(x)));
    if (!id) continue;
    const ev = ask.eventsOf(id);
    console.log(`  「${nm(id)}」 → ${ev.length ? ev.map((x) => `${x.tier === 'core' ? '核心' : '沾边'}·${x.name}（${x.n} 条，强度 ${x.score.toFixed(2)}）`).join(' ｜ ') : '不在任何事里'}`);
  }
  require('../src/main/embed').dispose();
  app.quit();
}
app.whenReady().then(() => main().catch((e) => { console.error(e && e.stack || e); app.quit(); }));
