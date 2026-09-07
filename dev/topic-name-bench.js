'use strict';
// 给一堆记录起名，四种做法对着比。
//
//   npx electron dev/topic-name-bench.js
//
// 归堆本来就不走 LLM（向量 + leader clustering，纯本地）。走 LLM 的只有起名这一步，
// 而它是唯一一处「不开 AI 服务就退化」的地方，所以值得认真找一遍本地的替代。
//
// 已经试过并且失败的两种，都在这里当对照留着：
//   A 抽词（正文）  → spm_id_from、vd_source、v0.18.0、blessonism —— URL 参数、版本号、用户名
//   A' 抽词（标题） → britain english great —— 网页自己的语言选择条
//
// 没试过的两种，都只用已经在跑的那个向量模型，不碰 LLM：
//   B 最中心那条的标题 —— 离堆中心最近的那条记录，它的标题本来就是这堆的描述
//   C KeyBERT 那一套 —— 从成员里生成候选词组，把候选也算成向量，挑离中心最近的
//     （embed.js 的注释写着这个模型正是 KeyBERT 为混合语言推荐的那个）
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const HOME = os.homedir();
const WS = path.join(HOME, 'Library/Application Support/briffy/workspace');
const DIR = path.join(WS, 'entries');
const CACHE = path.join(HOME, 'Library/Application Support/briffy/models');

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const norm = (v) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return v.map((x) => x / n); };

/** 候选词组：从标题和正文开头切出 1–4 个词的片段，中文按标点和长度切。 */
function candidates(items) {
  const out = new Set();
  for (const it of items) {
    const src = `${it.title || ''}。${String(it.text || '').slice(0, 200)}`;
    for (const seg of src.split(/[\s,，、;；。!！?？:：/|｜\\()（）\[\]"'`_—–\-]+/)) {
      const s = seg.trim();
      if (s.length < 2 || s.length > 12) continue;
      if (/^[\d.v]+$/i.test(s)) continue;                 // 版本号、体积
      if (/^[a-z_]+$/i.test(s) && s.length > 9) continue;  // spm_id_from 这类 URL 参数
      out.add(s);
    }
  }
  return [...out].slice(0, 120);
}

async function main() {
  const index = require('../src/main/index-db');
  const vector = require('../src/main/vector');
  const topic = require('../src/main/topic');
  const embed = require('../src/main/embed');
  const llm = require('../src/main/llm');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-name-'));
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

  // 每条记录的平均向量，和 topic.js 里归堆用的是同一份
  const vecs = new Map();
  const sum = new Map();
  index.vecScan((id, v) => {
    if (!sum.has(id)) sum.set(id, new Float32Array(v.length));
    const s = sum.get(id);
    for (let i = 0; i < v.length; i++) s[i] += v[i];
  });
  for (const [id, s] of sum) vecs.set(id, norm([...s]));

  const groups = topic.build(index, getEntry);
  console.log(`${groups.length} 个堆\n`);
  const cfg = { provider: 'ollama', languageName: 'Chinese', ollama: { host: 'http://127.0.0.1:11434', model: 'qwen3.5:9b' } };
  const t = { B: 0, C: 0, D: 0 };

  for (const g of groups) {
    const items = g.members.map((id) => { const e = getEntry(id) || {}; return { id, title: e.title, text: e.text }; });
    // 堆的中心
    const dim = (vecs.get(g.members[0]) || []).length;
    const centre = new Array(dim).fill(0);
    let used = 0;
    for (const id of g.members) { const v = vecs.get(id); if (!v) continue; used++; for (let i = 0; i < dim; i++) centre[i] += v[i]; }
    const c = norm(centre);

    // B 最中心那条的标题
    let t0 = Date.now();
    let best = null; let bestS = -2;
    for (const id of g.members) { const v = vecs.get(id); if (!v) continue; const s = dot(c, v); if (s > bestS) { bestS = s; best = id; } }
    const B = String((getEntry(best) || {}).title || '').slice(0, 30);
    t.B += Date.now() - t0;

    // C 候选词组算向量，挑离中心最近的两个
    t0 = Date.now();
    let C = '';
    try {
      const cand = candidates(items);
      if (cand.length) {
        const cv = await embed.embed(cand, { cacheDir: CACHE });
        const scored = cand.map((w, i) => [w, dot(c, norm(cv[i]))]).sort((a, b) => b[1] - a[1]);
        C = scored.slice(0, 2).map(([w]) => w).join(' · ');
      }
    } catch (e) { C = `（失败：${e.message.slice(0, 24)}）`; }
    t.C += Date.now() - t0;

    // D 模型（现在用的）
    t0 = Date.now();
    let D = '';
    try { D = await llm.topicName(cfg, { items }); } catch (e) { D = `（失败：${e.message.slice(0, 24)}）`; }
    t.D += Date.now() - t0;

    console.log(`  ${String(g.members.length).padStart(2)} 条`);
    console.log(`     A 抽词   ${g.words || '（起不出来）'}`);
    console.log(`     B 最中心 ${B}`);
    console.log(`     C 向量选 ${C}`);
    console.log(`     D 模型   ${D}`);
    console.log(`     里面是   ${g.members.slice(0, 2).map((id) => String((getEntry(id) || {}).title || '').replace(/\s+/g, ' ').slice(0, 30)).join(' / ')}`);
    console.log('');
  }
  console.log(`用时合计：B ${t.B}ms · C ${t.C}ms · D ${t.D}ms（${groups.length} 个堆）`);
  embed.dispose();
  fs.rmSync(tmp, { recursive: true, force: true });
  app.quit();
}

app.whenReady().then(() => main().catch((e) => { console.error('炸了:', e && e.stack || e); app.quit(); }));
