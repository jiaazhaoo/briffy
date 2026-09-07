'use strict';
// 自动主题：把记录聚成堆，再给每堆起个名字。真实工作区，看聚出来的堆人认不认得。
//
//   npx electron dev/topic-bench.js
//
// 「三个词」那套做过一次，被砍了：segment.js 开头写着，220 条里 209 条抽出来的词本来就原样在
// 正文里，搜索早就覆盖了，白干。那个结论没有过期——**再从正文里抽词，还是白干**。
//
// 所以这次换一个问题：不是「这条记录有哪三个词」，而是「哪些记录讲的是同一件事」。
// 前者是词，后者是**堆**，而堆能给记录页一个它现在完全没有的东西：一条竖着的线索。
//
// 做法是 BERTopic 那一套里最简单的形态，没有新依赖：
//   聚堆   向量两两比余弦，超过阈值就并到一起（并查集），不定 k——主题有几个是数出来的
//   起名   c-TF-IDF：一个词在这堆里出现得多、在整个工作区里出现得少，它就是这堆的名字
// 起名这一步**不经过模型**，和索引用的是同一套分词，所以名字永远是工作区里真实存在的词。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const HOME = os.homedir();
const WS = path.join(HOME, 'Library/Application Support/briffy/workspace');
const DIR = path.join(WS, 'entries');
const CACHE = path.join(HOME, 'Library/Application Support/briffy/models');

const JOIN = 0.62;        // 两条记录多像才算同一堆
const MIN_SIZE = 3;       // 少于这么多条的不算一个主题，是零头
const NAME_WORDS = 3;     // 每堆起几个词的名字——就是「三个词」，但这次是堆的三个词，不是记录的

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

async function main() {
  const index = require('../src/main/index-db');
  const vector = require('../src/main/vector');
  const topic = require('../src/main/topic');
  const llm = require('../src/main/llm');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-topic-'));
  index.open(tmp, WS);
  index.useVecModel(vector.MODEL);
  const loadDay = (k) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, `${k}.json`), 'utf8')); } catch (_) { return []; } };
  let r; do { r = index.sync({ dir: DIR, loadDay }, { budgetMs: 20000 }); } while (!r.done);
  let f; do { f = await vector.fill(index, loadDay, { budgetMs: 8000, batch: 20, cacheDir: CACHE }); if (f.error) break; } while (!f.done);
  if (f.error) { console.log('向量补不了：', f.error); app.quit(); return; }

  const all = new Map();
  for (const file of fs.readdirSync(DIR)) {
    if (!file.endsWith('.json')) continue;
    let e; try { e = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8')); } catch (_) { continue; }
    for (const x of (Array.isArray(e) ? e : e.entries || [])) all.set(x.id, x);
  }
  const getEntry = (id) => all.get(id) || null;
  const total = index.vecStats().entries;

  console.log(`${total} 条记录，${index.vecStats().chunks} 块\n`);
  console.log('  阈值   主题数  有归属  最大堆');
  for (const th of [0.55, 0.60, 0.62, 0.65, 0.70]) {
    const gs = topic.build(index, getEntry, { join: th });
    const covered = gs.reduce((n, g) => n + g.members.length, 0);
    console.log(`  ${th.toFixed(2)}   ${String(gs.length).padStart(5)}  ${String(Math.round(covered * 100 / total) + '%').padStart(6)}  ${String(gs[0] ? gs[0].members.length : 0).padStart(5)} 条`);
  }

  const groups = topic.build(index, getEntry);
  console.log(`\n阈值 ${topic.JOIN} → ${groups.length} 个主题\n`);

  const cfg = { provider: 'ollama', languageName: 'Chinese', ollama: { host: 'http://127.0.0.1:11434', model: 'qwen3.5:9b' } };
  console.log('════ 抽词起名 vs 模型起名（一堆一次调用）════\n');
  const t0 = Date.now();
  for (const g of groups) {
    const items = g.members.map((id) => { const e = getEntry(id) || {}; return { title: e.title, text: e.text }; });
    let byModel = '';
    try { byModel = await llm.topicName(cfg, { items }); } catch (e) { byModel = `（失败：${e.message}）`; }
    console.log(`  ${String(g.members.length).padStart(3)} 条`);
    console.log(`      抽词：${g.words || '（起不出来）'}`);
    console.log(`      模型：${byModel || '（空）'}`);
    console.log(`      里面是：${g.members.slice(0, 3).map((id) => String((getEntry(id) || {}).title || '').replace(/\s+/g, ' ').slice(0, 34)).join(' / ')}`);
    console.log('');
  }
  console.log(`模型起名 ${groups.length} 个堆共用了 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  require('../src/main/embed').dispose();
  fs.rmSync(tmp, { recursive: true, force: true });
  app.quit();
}

app.whenReady().then(() => main().catch((e) => { console.error('炸了:', e && e.stack || e); app.quit(); }));
