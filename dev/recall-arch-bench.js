'use strict';
// 「问一句话，找回那几条记录」这一步，什么架构最好。**只量检索，不叫模型**——
// 今天量下来所有的失败都在这一步，而这一步不花钱、确定、可重复。
//
//   npx electron dev/recall-arch-bench.js
//
// 2026-09-09 跑出来的账（316 条记录、5 个问题、15 条满分记录）：
//   A 现状              找回 3/15 (20%)   · 混进自产的 0 条  · 768ms
//   B 全扫词面           找回 3/15 (20%)   · 混进自产的 12 条 · 5ms    ← 光把全库读一遍没用
//   C 现状+形状          找回 8/15 (53%)   · 混进自产的 8 条  · 4ms
//   D 全扫+形状          找回 7/15 (47%)   · 混进自产的 12 条 · 3ms
//   E 形状按 PRF 排序     找回 3/15 (20%)   · 混进自产的 4 条  · 0ms   ← 比按问题排更差
//   F E+去掉自产         找回 3/15 (20%)   · 混进自产的 0 条  · 0ms
//   G 形状填满名额        找回 12/15 (80%)  · 混进自产的 0 条  · 0ms   ← 赢家
// 端到端（deepseek-v4-flash-0731，同一个模型只换检索）：
//   「起点终点的具体地址」 A：「没有给出更具体的街道门牌地址」 → G：「Runnymede Pleasure
//     Ground, Egham, Surrey TW20 0AE」
//   「报名费多少钱」      A：「没有找到关于报名费的信息」    → G：「£139.00」（引了订单确认页）
//
// 标准答案是从工作区里扫出来的：先按答案本身的字符串（TW20 0AE、08:30、P3425WE…）找出
// 哪几条记录**真的写着**答案，那几条就是这一问的满分。**briffy 自己的问答产物不算**——
// 它们也写着答案，但那是循环论证：系统找到自己上次的回答，不等于找到了依据。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const HOME = os.homedir();
const WS = path.join(HOME, 'Library/Application Support/briffy/workspace');
const DIR = path.join(WS, 'entries');
const UD = path.join(HOME, 'Library/Application Support/briffy');
const KEEP = 24;                 // 和 ask.js 的 KEEP 一样，四种架构公平比

// 这几条是 briffy 自己的问答被复制回工作区的产物，或者我调试时的输出。
// 它们不是材料：找到它们不算找到依据，而且它们会把词表喂坏（见今天量的那笔账）。
const SELF_MADE = new Set(['2207997e', 'bed6dd5c', '3e4a4683', 'e9e26c6b', '68fcd2d6']);

const CASES = [
  { q: '这个走路活动的起点和终点的具体地址是什么', gold: ['8842bbbc', 'af906c29', 'c77d8596'], shape: 'postcode' },
  { q: '那个徒步活动几点开始', gold: ['c77d8596'], shape: 'time' },
  { q: '我把车停在哪了', gold: ['f015834f', '1d27fe80', 'd332bbe7', 'f088c5c7'], shape: 'postcode' },
  { q: '我看的那个显示器是什么型号', gold: ['97713b8b', '93bcab7c', '8a7826e7'], shape: 'code' },
  { q: '报名费多少钱', gold: ['c87ecb99', '91fdd86f', '07147ed6', '34d0cc6f'], shape: 'money' },
];

// ---------- 形状 ----------
// 问的是什么类型的东西，就去扫什么形状。判据是确定性的正则，和 redact.js 同一种东西。
const SHAPE_RE = {
  postcode: /\b[A-Z]{1,2}[0-9][A-Z0-9]?\s?[0-9][A-Z]{2}\b/,
  time: /\b(?:[01]?\d|2[0-3])[:：][0-5]\d\b/,
  money: /[£$€¥]\s?\d[\d,]*(?:\.\d\d)?|\d+\s?(?:元|镑|块)/,
  code: /\b[A-Za-z]{1,6}[0-9]{2,6}[A-Za-z]{0,4}\b/,
};
// 一句话在问哪种形状。**这一版用词触发，不叫模型**——先把「有没有形状腿」这件事量清楚，
// 「谁来决定用哪个形状」是下一个问题（模型出主意那一版单独测）。
const TRIGGER = [
  ['postcode', /地址|在哪|哪里|位置|邮编|怎么走|address|where/i],
  ['time', /几点|什么时候|时间|出发|开始|when|time/i],
  ['money', /多少钱|费用|价格|报名费|多少镑|cost|price|fee/i],
  ['code', /型号|什么牌子|哪一款|model|型/i],
];
function shapeOf(q) { for (const [k, re] of TRIGGER) if (re.test(q)) return k; return ''; }

function load() {
  const days = new Map(); const byId = new Map();
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.json')) continue;
    let e; try { e = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (_) { continue; }
    const list = Array.isArray(e) ? e : e.entries || [];
    days.set(f.slice(0, -5), list);
    for (const x of list) byId.set(x.id, x);
  }
  return { days, byId };
}
const bodyOf = (e) => `${e.title || ''}\n${e.text || ''}`;
const isSelf = (id) => [...SELF_MADE].some((p) => id.startsWith(p));

/** 全扫：每条记录都看一遍，按命中的词打分。库小的时候这不要钱（实测 373KB / 0.3ms）。 */
function fullScan(all, terms, { limit = KEEP } = {}) {
  const scored = [];
  for (const e of all) {
    const head = String(e.title || '').toLowerCase();
    const body = bodyOf(e).toLowerCase();
    let s = 0;
    for (const t of terms) {
      if (!t) continue;
      if (body.includes(t)) s += 1;
      if (head.includes(t)) s += 1;          // 标题里命中算两分：那是别人给它起的名字
    }
    if (s > 0) scored.push({ id: e.id, s: s / Math.log2(4 + body.length / 200) });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.id);
}

/** 一段字里值得当线索的词：拉丁词和两字以上的中文串。 */
function wordsIn(s) {
  const t = String(s || '').toLowerCase();
  const out = new Set();
  for (const w of t.match(/[a-z][a-z0-9]{2,}/g) || []) out.add(w);
  for (const run of t.match(/[\u3400-\u9fff]{2,}/g) || []) for (let i = 0; i < run.length - 1; i++) out.add(run.slice(i, i + 2));
  return out;
}

/**
 * 形状腿：全库扫一遍，谁身上有这个形状的东西，谁就是候选。穷尽，不漏。
 *
 * 排序有两种，差别很大：
 *   'q'   按「和问题共用词」排。**这个是错的**——问「报名费多少钱」，记录上写的是
 *         「£159.00」和「registration fee」，一个共用词都没有，于是所有命中同分，
 *         截断之后留下的是随机的十条。实测这一问 0/4。
 *   'prf' 按「和词面已经找到的那几条共用词」排。那几条是这件事的现场（Ultra、Thames、
 *         Challenge、12 Sep），带着这些词的邮编/金额才是这件事的邮编和金额。
 */
function shapeScan(all, shape, terms, { limit = 10, by = 'q', seedText = '' } = {}) {
  const re = SHAPE_RE[shape];
  if (!re) return [];
  const seed = by === 'prf' ? wordsIn(seedText) : null;
  const hits = [];
  for (const e of all) {
    const body = bodyOf(e);
    if (!re.test(body)) continue;
    let s = 0;
    if (seed) { for (const w of wordsIn(body)) if (seed.has(w)) s += 1; }
    else { const low = body.toLowerCase(); for (const t of terms) if (t && low.includes(t)) s += 1; }
    hits.push({ id: e.id, s });
  }
  hits.sort((a, b) => b.s - a.s);
  return hits.slice(0, limit).map((x) => x.id);
}

app.whenReady().then(async () => {
  const { days, byId } = load();
  const all = [...byId.values()];
  const store = {
    userData: UD, workspaceDir: WS,
    paths: () => ({ entries: DIR, ocr: path.join(WS, 'ocr'), models: path.join(UD, 'models') }),
    listDates: () => [...days.keys()].sort(),
    loadDay: (k) => days.get(k) || [],
    getEntry: (id) => byId.get(id) || null,
    getSettings: () => ({ ...JSON.parse(fs.readFileSync(path.join(UD, 'settings.json'), 'utf8')), provider: 'openrouter' }),
    getSecret: () => '',        // 空 key ⇒ run() 只做检索就返回，不叫模型
  };
  const ask = require('../src/main/ask');
  const index = require('../src/main/index-db');
  const vector = require('../src/main/vector');
  const vocab = require('../src/main/vocab');
  ask.init({ store });
  ask.refresh({ budgetMs: 30000 });
  let v; do { v = await vector.fill(index, store.loadDay, { budgetMs: 9000, batch: 20, cacheDir: store.paths().models }); if (v.error) break; } while (!v.done);
  if (!(v && v.error)) vector.buildBuckets(index);
  let vf; do { vf = vocab.fill(index, (id) => store.getEntry(id), { budgetMs: 3000 }); } while (!vf.done);
  let st; do { st = vocab.settle(index, { budgetMs: 3000 }); } while (!st.done);

  const ARCH = ['A 现状', 'B 全扫词面', 'C 现状+形状', 'D 全扫+形状', 'E 现状+形状(PRF)', 'F E+去掉自产', 'G 形状填满名额'];
  const tally = Object.fromEntries(ARCH.map((a) => [a, { got: 0, gold: 0, self: 0, n: 0, ms: 0 }]));

  for (const c of CASES) {
    // termsOf 给的是 {key,…}，key 是切好的词（词组用空格连着）。**不是 text**——
    // 第一版写成 p.text，取出来全是 undefined，于是「全扫」这一档一条都没命中，
    // 而形状那一档的排序也跟着乱。量之前先确认取到的东西不是空的。
    const terms = index.termsOf(c.q).flatMap((p) => String(p.key || '').split(' ')).map((x) => x.toLowerCase()).filter((x) => x.length > 1);
    if (!terms.length) throw new Error('取不出词，别往下量了：' + c.q);
    const sets = {};
    let t0 = Date.now();
    const a = (await ask.run(c.q, {})).sources.map((e) => e.id);
    tally['A 现状'].ms += Date.now() - t0;
    sets['A 现状'] = a;
    t0 = Date.now(); const b = fullScan(all, terms); tally['B 全扫词面'].ms += Date.now() - t0; sets['B 全扫词面'] = b;
    t0 = Date.now(); const sh = shapeScan(all, shapeOf(c.q), terms); tally['C 现状+形状'].ms += Date.now() - t0;
    sets['C 现状+形状'] = [...new Set([...a.slice(0, KEEP - sh.length), ...sh])];
    sets['D 全扫+形状'] = [...new Set([...b.slice(0, KEEP - sh.length), ...sh])];
    // E：形状命中按「和词面已经找到的那几条共用词」排
    const seedText = a.slice(0, 6).map((id) => bodyOf(byId.get(id) || {})).join('\n');
    const shP = shapeScan(all, shapeOf(c.q), terms, { by: 'prf', seedText, limit: 10 });
    sets['E 现状+形状(PRF)'] = [...new Set([...a.slice(0, KEEP - shP.length), ...shP])];
    // F：再把 briffy 自己的问答产物请出去（它们占了 8~12 个名额）
    sets['F E+去掉自产'] = sets['E 现状+形状(PRF)'].filter((id) => !isSelf(id));
    // G：形状腿**把剩下的名额填满**，不再截在一个常数上。
    // 「报名费多少钱」那一问词面一条都没找到，24 个名额全空着，而形状腿只取了 10 条——
    // 空着名额却把唯一在工作的那条腿截断，说不通。顺便把 briffy 自己的问答产物请出去。
    const clean = a.filter((id) => !isSelf(id));
    const shG = shapeScan(all, shapeOf(c.q), terms, { limit: KEEP }).filter((id) => !isSelf(id));
    const keepWords = Math.min(clean.length, Math.max(4, KEEP - shG.length));
    sets['G 形状填满名额'] = [...new Set([...clean.slice(0, keepWords), ...shG])].slice(0, KEEP);
    tally['D 全扫+形状'].ms += tally['B 全扫词面'].ms / CASES.length;

    console.log(`\n════ ${c.q}`);
    console.log(`   形状 = ${shapeOf(c.q) || '（认不出）'} · 满分 ${c.gold.length} 条`);
    for (const name of ARCH) {
      const ids = sets[name];
      const hit = c.gold.filter((g) => ids.some((x) => x.startsWith(g)));
      const self = ids.filter(isSelf).length;
      const t = tally[name]; t.got += hit.length; t.gold += c.gold.length; t.self += self; t.n += 1;
      const miss = c.gold.filter((g) => !ids.some((x) => x.startsWith(g)));
      console.log(`   ${name.padEnd(12)} ${ids.length} 条 · 找回 ${hit.length}/${c.gold.length}` +
        `${miss.length ? ' · 漏 ' + miss.join(' ') : ''}${self ? ' · 自产的 ' + self + ' 条' : ''}`);
    }
  }
  console.log('\n════════ 总计 ════════');
  for (const name of ARCH) {
    const t = tally[name];
    console.log(`${name.padEnd(12)} 找回 ${t.got}/${t.gold} (${Math.round(t.got / t.gold * 100)}%) · 混进自产的 ${t.self} 条 · 检索耗时 ${Math.round(t.ms)}ms`);
  }
  app.quit();
});
