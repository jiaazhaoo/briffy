'use strict';
// 模糊搜索到底行不行——真实工作区，真实向量，真实对照。
//
//   npx electron dev/fuzzy-bench.js
//
// 每个查询词都是故意挑的：它**不出现在**目标记录里，只是那件事的另一种说法，或者另一种语言。
// 「跑步」找 walking，「车」找 Vauxhall，「付款」找 stripe。词面检索在这些词上按定义会交白卷，
// 所以这一列全是 0 才是对的——要看的是向量那一列能捞回多少。
//
// 顺带把七道日常问答题再跑一遍，看融合之后是不是真的比两边单独都好。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const HOME = os.homedir();
const WS = path.join(HOME, 'Library/Application Support/briffy/workspace');
const DIR = path.join(WS, 'entries');
const CACHE = path.join(HOME, 'Library/Application Support/briffy/models');

// 查询词 → 期望捞到的记录（按标题认）。词本身在那条记录里一次都不出现。
const FUZZY = [
  { q: '跑步', want: ['Sat・12 Sep 2026', 'Ultra Challenge', '赛程分前后半程'] },
  { q: '走多远', want: ['赛程分前后半程', 'Sat・12 Sep 2026'] },
  { q: '车', want: ['Roof bars for a 2012 Vauxhall', 'Ford focus'] },
  { q: '大模型', want: ['Ollama 地址', '推荐在这台电脑上用 qwen3.5:27b', '模型'] },
  { q: '收钱', want: ['把中国区改成一次性年卡', 'Karanow'] },
  { q: '屏幕', want: ['Dell ultrawide monitor', '这块屏物理密度'] },
  { q: '小图标', want: ['grok-icon-study', '蓝色回形针', 'ipaslogo'] },
];

const QA = [
  { q: '我之前查的那个车顶架是给哪辆车的，要多少钱', title: 'Roof bars for a 2012 Vauxhall' },
  { q: '我本机的 ollama 地址是多少', title: 'Ollama 地址' },
  { q: '之前说这台电脑推荐跑哪个模型来着，多大', title: '推荐在这台电脑上用 qwen3.5:27b' },
  { q: '中国区的付费我当时打算怎么改', title: '把中国区改成一次性年卡' },
  { q: '我记过一个显示器的型号，是哪个', title: 'Dell ultrawide monitor p3425we' },
  { q: '那个 grok 图标的开源项目叫什么，谁写的', title: 'GitHub - blessonism/grok-icon-study' },
  { q: '我上个月去哪里旅游了', title: null },
];

async function main() {
  const index = require('../src/main/index-db');
  const vector = require('../src/main/vector');
  const retrieve = require('../src/main/retrieve');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-fuzzy-'));
  index.open(tmp, WS);
  index.useVecModel(vector.MODEL);
  const loadDay = (k) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, `${k}.json`), 'utf8')); } catch (_) { return []; } };
  let r; do { r = index.sync({ dir: DIR, loadDay }, { budgetMs: 20000 }); } while (!r.done);

  const all = new Map();
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.json')) continue;
    let e; try { e = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (_) { continue; }
    for (const x of (Array.isArray(e) ? e : e.entries || [])) all.set(x.id, x);
  }
  console.log(`倒排 ${index.stats().entries} 条`);

  const t0 = Date.now();
  let f; let rounds = 0;
  do { f = await vector.fill(index, loadDay, { budgetMs: 8000, batch: 20, cacheDir: CACHE }); rounds++; if (f.error) break; } while (!f.done);
  const vs = index.vecStats();
  if (f.error) { console.log('向量补不了：', f.error); app.quit(); return; }
  console.log(`向量 ${vs.entries}/${vs.total} 条 · ${vs.chunks} 块 · ${(vs.bytes / 1024 / 1024).toFixed(1)}MB · 补完用了 ${((Date.now() - t0) / 1000).toFixed(1)}s（${rounds} 轮）\n`);

  const titleOf = (id) => String((all.get(id) || {}).title || '').slice(0, 42);
  const hits = (ids, want, n) => ids.slice(0, n).filter((id) => want.some((w) => String((all.get(id) || {}).title || '').includes(w))).length;

  console.log('════ 模糊搜索：查询词一次都不出现在目标记录里 ════\n');
  let lexTotal = 0; let vecTotal = 0;
  for (const c of FUZZY) {
    const lex = index.search({ query: c.q, limit: 10 }).ids;
    const vec = await vector.search(index, c.q, { limit: 10, cacheDir: CACHE });
    const lh = hits(lex, c.want, 10); const vh = hits(vec, c.want, 10);
    lexTotal += lh > 0 ? 1 : 0; vecTotal += vh > 0 ? 1 : 0;
    console.log(`  「${c.q}」  词面 ${lex.length} 条命中 ${lh}   向量 ${vec.length} 条命中 ${vh}`);
    console.log(`      向量前 5：${vec.slice(0, 5).map(titleOf).join(' | ') || '（空）'}`);
  }
  console.log(`\n  能搜到的：词面 ${lexTotal}/${FUZZY.length}   向量 ${vecTotal}/${FUZZY.length}\n`);

  console.log('════ 七道问答题：词面 / 向量 / 融合 ════\n');
  const score = { lex: 0, vec: 0, fus: 0 };
  for (const c of QA) {
    const pick = retrieve.select(index, c.q, { today: '2026-09-07', limit: 40, getEntry: (id) => all.get(id) || null });
    const near = pick.ids.length ? await vector.search(index, c.q, { limit: 40, cacheDir: CACHE, from: pick.range ? pick.range.from : '' }) : [];
    const fused = retrieve.fuse(pick.ids, near, 8);
    const inTop = (ids) => c.title ? ids.slice(0, 8).some((id) => String((all.get(id) || {}).title || '').includes(c.title)) : ids.length === 0;
    const L = inTop(pick.ids); const V = inTop(near); const F = inTop(fused);
    score.lex += L; score.vec += V; score.fus += F;
    console.log(`  ${F ? 'ok  ' : 'MISS'} ${c.q}`);
    console.log(`       词面 ${L ? '✓' : '✗'}   向量 ${V ? '✓' : '✗'}   融合 ${F ? '✓' : '✗'}   （融合后 ${fused.length} 条）`);
  }
  console.log(`\n  词面 ${score.lex}/${QA.length}   向量 ${score.vec}/${QA.length}   融合 ${score.fus}/${QA.length}`);

  require('../src/main/embed').dispose();
  fs.rmSync(tmp, { recursive: true, force: true });
  app.quit();
}

app.whenReady().then(() => main().catch((e) => { console.error('炸了:', e && e.stack || e); app.quit(); }));
