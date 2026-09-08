'use strict';
// 自动双链长得对不对。跑的是**真的 ask.linksOf**——详情页底下那条「相关」清单就是它。
//
//   npx electron dev/backlinks-bench.js
//
// 一条清单好不好，只有两个数：**收进来几条对的**，和**顺手带进来几条不相干的**。
// 「对的」得有人标，所以这里手标了两簇（那一晚的走路活动连同停车、显示器），
// 从每簇里挑一两条当种子，看长出来的清单里有几条在簇里、几条不在。
// 我自己以前问过的话被复制回工作区的那几条（「我记下来了详细地址，你找一下」）不算对也不算错——
// 它们确实是那件事的一部分，但不是材料。
//
// 全局再看四个数：每条长出几条（顶到上限的比例）、边靠什么（词 / 同一页 / 同一程 / 向量）、
// 双向性（A 的清单里有 B，B 的清单里有没有 A）、零链接的是些什么。
//
// 2026-09-08 改之前的底数：60% 的记录顶到上限 13 条；清单最长的五条全是 briffy 自己的截图；
// 「Find parking」经「1.1gb」连到「Ollama 地址」、经「London」连到四条不相干的；
// 「Dell ultrawide monitor」八条相关里五条是 briffy 的截图（屏幕上正好显示着那条 Dell 记录）；
// 「同一程」那条边一次也没出现过——0.34 × 0.85 永远过不了 0.34 的门槛，是条死边。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const HOME = os.homedir();
const WS = path.join(HOME, 'Library/Application Support/briffy/workspace');
const DIR = path.join(WS, 'entries');
const UD = path.join(HOME, 'Library/Application Support/briffy');
const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// 两簇。那一晚是**一件事**：报名了一场沿泰晤士河走的活动，查了起点终点，找了终点附近的停车，
// 后来还为停车罚单申诉——把它拆成「走路」和「停车」两簇量过一轮，结果把真链接（Runnymede →
// Buckingham Court）判成了错的。dev/story-bench.js 里那十四条本来就是当一件事标的。
// 「English (Great Britain)」那三条是 Ultra Challenge 网站的页面，标题被语言选择条抢了——
// 是标题的错，不是链接的错，所以算在簇里。
const EVENING = [/^Ultra Challenge$/i, /^1st Half Challenge/i, /^Thank you! Your registration/i, /^Runnymede Pleasure/i,
  /^Bishops Park/i, /赛程分前后半程/, /^Windsor Road, Egham/i, /^停 Staines/, /^£10 接驳车/, /^Ultra March reddit/i,
  /^Path Thames/i, /^Sat・12 Sep 2026/, /^English \(Great Britain\)/, /^语音 22:34/,
  /^Find parking/i, /^Buckingham Court, Kingston/i, /^Parking space on Buckingham/i, /^Request to cancel UKPC/i,
  /^I was a registered, paying/i, /^Legalities \| Data Release/i, /^Windsor Road, Buckingham/i];
const MONITOR = [/^Dell ultrawide monitor/i, /296 PPI/, /^就用现在的 1280×800/, /^Samsung CJ89/i, /^www\.facebook\.com p3425we/i,
  /^Barely used\. Needs a new usb/i, /主显示器文字模糊/, /^BitsPerColor/i, /EDID/, /^color depth/i, /10bit/];
// 我自己问过的话，被复制回了工作区。不算对也不算错。
const ECHO = [/^我最近有个 walking 挑战/, /^你看看我最近要去一个走路的活动/, /^我最近报名了一个活动/, /^我记下来了详细地址/,
  /^具体的开始和结束的地址/];
const CASES = [['那一晚', /^Ultra Challenge$/i, EVENING], ['那一晚', /^Runnymede Pleasure/i, EVENING],
  ['那一晚', /^Find parking/i, EVENING], ['显示器', /^Dell ultrawide monitor/i, MONITOR]];

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
  const vocab = require('../src/main/vocab');
  ask.init({ store });
  ask.refresh({ budgetMs: 30000 });
  let ff; do { ff = ask.feedFurniture({ budgetMs: 5000 }); } while (!ff.done);
  // 应用里 warm() 在后台补的那几样，台子上得先补齐，否则量的是个残缺的系统
  const loadDay = (k) => store.loadDay(k);
  let v; do { v = await vector.fill(index, loadDay, { budgetMs: 9000, batch: 20, cacheDir: store.paths().models }); if (v.error) break; } while (!v.done);
  if (!(v && v.error)) vector.buildBuckets(index);
  let vf; do { vf = vocab.fill(index, (id) => store.getEntry(id), { budgetMs: 3000 }); } while (!vf.done);
  let vs; do { vs = vocab.settle(index, { budgetMs: 3000 }); } while (!vs.done);
  for (const k of store.listDates()) vocab.collectPages(index, store.loadDay(k));

  const ids = [...store.byId.keys()];
  const title = (id) => one((store.getEntry(id) || {}).title);
  const nm = (id) => title(id).slice(0, 30) || '（无标题）';
  const inSet = (id, set) => set.some((re) => re.test(title(id)));

  // ── 全局
  const rel = new Map();
  const kinds = { word: 0, page: 0, run: 0, near: 0 };
  const t0 = Date.now();
  for (const id of ids) {
    const r = ask.linksOf(id).related;
    rel.set(id, r);
    for (const x of r) { const k = x.why && x.why.kind; if (k in kinds) kinds[k]++; }
  }
  const ms = Date.now() - t0;
  const hist = { 0: 0, '1-3': 0, '4-8': 0, '9+': 0 };
  for (const id of ids) { const c = rel.get(id).length; hist[c === 0 ? 0 : c <= 3 ? '1-3' : c <= 8 ? '4-8' : '9+']++; }
  let pairs = 0; let back = 0;
  for (const id of ids) for (const x of rel.get(id)) { pairs++; if ((rel.get(x.id) || []).some((y) => y.id === id)) back++; }
  console.log(`${ids.length} 条记录 · 全部 linksOf ${ms}ms（${(ms / ids.length).toFixed(1)}ms/条）`);
  console.log(`每条长出几条：0 → ${hist[0]} · 1–3 → ${hist['1-3']} · 4–8 → ${hist['4-8']} · 9+ → ${hist['9+']}（${(100 * hist['9+'] / ids.length).toFixed(0)}% 顶到上限）`);
  console.log(`边靠什么：共用词 ${kinds.word} · 同一页 ${kinds.page} · 同一程 ${kinds.run} · 向量 ${kinds.near}`);
  console.log(`双向性：${pairs} 条链接里 ${back} 条反向也在（${(100 * back / Math.max(1, pairs)).toFixed(0)}%）`);
  const longest = ids.map((id) => [id, rel.get(id).length]).sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`清单最长的：${longest.map(([id, n]) => `${nm(id)}(${n})`).join(' | ')}`);
  const zero = ids.filter((id) => !rel.get(id).length);
  const byType = {};
  for (const id of zero) { const t = (store.getEntry(id) || {}).type; byType[t] = (byType[t] || 0) + 1; }
  console.log(`零链接 ${zero.length} 条：${JSON.stringify(byType)}`);

  // ── 三簇
  let sumP = 0; let sumR = 0; let n = 0;
  for (const [label, seedRe, set] of CASES) {
    const seed = ids.find((id) => seedRe.test(title(id)));
    if (!seed) { console.log(`\n（没找到种子 ${seedRe}）`); continue; }
    const cluster = ids.filter((id) => id !== seed && inSet(id, set));
    const r = rel.get(seed);
    let good = 0; let bad = 0; const got = new Set();
    console.log(`\n════ ${label} · 从「${nm(seed)}」长起 · 簇里另有 ${cluster.length} 条 ════`);
    for (const x of r) {
      const w = x.why || {};
      const why = w.kind === 'word' && w.pairs ? `${w.pairs.map((p) => (p.fuzzy ? `${p.a}≈${p.b}` : p.a)).join('·')} df${w.df}`
        : w.kind === 'page' ? `同一页 ${w.name || ''}` : w.kind === 'run' ? '同一程' : w.kind === 'near' ? '向量' : '';
      let mark;
      if (inSet(x.id, set)) { mark = '✓'; good++; got.add(x.id); } else if (inSet(x.id, ECHO)) { mark = '～'; } else { mark = '✗'; bad++; }
      console.log(`   ${mark} ${x.score.toFixed(2)}  ${why.padEnd(24).slice(0, 24)}  ${nm(x.id)}`);
    }
    const p = good + bad ? good / (good + bad) : 0;
    const rc = cluster.length ? got.size / cluster.length : 0;
    sumP += p; sumR += rc; n++;
    console.log(`   —— 准确 ${good}/${good + bad}（${(100 * p).toFixed(0)}%） 召回 ${got.size}/${cluster.length}（${(100 * rc).toFixed(0)}%）`);
    const miss = cluster.filter((id) => !got.has(id));
    if (miss.length) console.log(`   漏掉的：${miss.map(nm).join(' | ')}`);
  }
  console.log(`\n四个种子平均：准确 ${(100 * sumP / Math.max(1, n)).toFixed(0)}% · 召回 ${(100 * sumR / Math.max(1, n)).toFixed(0)}%`);
  require('../src/main/embed').dispose();
  app.quit();
}
app.whenReady().then(() => main().catch((e) => { console.error(e && e.stack || e); app.quit(); }));
