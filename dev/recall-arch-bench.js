'use strict';
// 「问一句话，找回那几条记录」这一步，什么架构最好。**只量检索，不叫模型**——
// 今天量下来所有的失败都在这一步，而这一步不花钱、确定、可重复。
//
//   npx electron dev/recall-arch-bench.js
//
// 2026-09-09 的账。**14 个问题、33 条满分记录**，分两组：
// 前 7 个是围着「形状」出的（含 2 道故意没有形状的对照），后 7 个是日用场景——
// 保单号、P60 收入、签证住址、本机 Ollama 地址、电脑崩溃、推荐模型、存过的视频。
// 后一组是**专门用来找通用毛病的**，里面故意放了两道会让形状腿踩空的题。
//
//   A 现状               12/33 (36%)  · 702ms
//   B 全扫词面            16/33 (48%)  · 15ms
//   C 现状+形状           17/33 (52%)
//   D 全扫+形状           20/33 (61%)
//   E 形状按 PRF 排        12/33 (36%)   ← 比按问题的词排还差
//   G 形状填满名额         21/33 (64%)
//   H G+按标题短记录排      21/33 (64%)
//   I H+半截邮编          22/33 (67%)   ← 停车 +2，但签证住址 −1，很脆
//   J I+无形状时全扫       27/33 (82%)
//   K 三条腿按配额         30/33 (91%)  · 0ms   ← 赢家
//
// **K 赢在一条通用的道理：三条腿一起上，谁也不许独占名额。**
// J 是二选一（有形状走形状，没形状才全扫），日用题上立刻出事：
// 「这台机器推荐用哪个本地模型」里的「模型」带个「型」字，触发了型号那一档，
// 20 个名额被型号串占满，真正写着「推荐用 qwen3.5:27b」的两条挤不进来。
// 一个认错的形状不该吃掉整份名额。改成配额（形状最多一半、索引留 6、全扫填满）之后，
// 那一问和签证住址那一问都回来了，别的一个没坏。
//
// 顺带：那个触发词表本身就是个凑合（「模型」撞「型号」），真做的时候该让模型出主意
// （searchPlan 的 schema 加 shapes），认不出再退回词表。
//
// 端到端（同一个模型只换检索）：
//   deepseek-v4-flash-0731  「起点终点的具体地址」 A：「没有给出更具体的街道门牌地址」
//                            → G：「Runnymede Pleasure Ground, Egham, Surrey TW20 0AE」
//                           「报名费多少钱」 A：「没有找到」 → G：「£139.00」（引订单确认页）
//   本机 qwen3.5:9b         同一问 A：「终点是 Runnymede」 → J：「…Egham, Surrey TW20 0AE」
//   本机 qwen3.5:0.8b       检索变好也兑现不了：24 条读不过来，停车那一问反而抓了个人名。
//                           qwen3-vl:2b 全部返回空（不理 JSON schema）。
//
// **14 个问题仍然是小样本，再往下调分数就是拟合噪声。**
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
  // ── 两道对照：**问题里没有任何形状**。加一条腿最容易犯的错是把本来好的那些问题弄坏，
  //    所以这两道的作用不是拿高分，是「形状那条腿必须完全不出手，成绩和现状一模一样」。
  { q: 'briffy 现在占多少内存', gold: ['275f71a3', '2d3c6155'], shape: '' },
  { q: 'screenpipe 是怎么采集的', gold: ['5ad0638f', 'bb20c934', 'fcd007db'], shape: '' },

  // ── 第二组：日用场景。**不是围着形状出的题**，是「一个人真的会问自己的日志什么」。
  //    故意放了两道会让形状腿踩空的：问「地址」而答案是个网址；问「多少」而触发不了金额。
  { q: '我的保险保单号是多少', gold: ['07364d19'] },
  { q: 'P60 上写的全年收入是多少', gold: ['b84ace1c'] },
  { q: '签证材料里填的居住地址是哪几个', gold: ['cd97796f'] },
  { q: '本机 Ollama 的地址是什么', gold: ['a0d01fae', '7f2c94c7'] },          // 「地址」触发邮编，但答案是网址
  { q: '我电脑那几次崩溃查到原因了吗', gold: ['95a8e24e', '610237b1', 'ec4c0778'] },
  { q: '这台机器推荐用哪个本地模型', gold: ['a0d01fae', '7f2c94c7'] },
  { q: '我存的那个哔哩哔哩视频讲的什么', gold: ['52fe2b5b', '77888f54', '21cd459c'] },
];

// ---------- 形状 ----------
// 问的是什么类型的东西，就去扫什么形状。判据是确定性的正则，和 redact.js 同一种东西。
const SHAPE_RE = {
  postcode: /\b[A-Z]{1,2}[0-9][A-Z0-9]?\s?[0-9][A-Z]{2}\b/,
  time: /\b(?:[01]?\d|2[0-3])[:：][0-5]\d\b/,
  money: /[£$€¥]\s?\d[\d,]*(?:\.\d\d)?|\d+\s?(?:元|镑|块)/,
  code: /\b[A-Za-z]{1,6}[0-9]{2,6}[A-Za-z]{0,4}\b/,
  // 半截邮编：真实记录里「Parking space on Buckingham Court, TW18」只写了前半段。
  // 单看它很松（CJ89、M25 都像），所以只配合「形状在标题里 + 记录短」那种排法用。
  postcodeLoose: /\b(?:[A-Z]{1,2}[0-9][A-Z0-9]?\s?[0-9][A-Z]{2}|[A-Z]{2}[0-9]{1,2})\b/,
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
  const re = shape === 'postcode+' ? SHAPE_RE.postcodeLoose : SHAPE_RE[shape];
  if (!re) return [];
  const seed = by === 'prf' ? wordsIn(seedText) : null;
  const hits = [];
  for (const e of all) {
    const body = bodyOf(e);
    if (!re.test(body)) continue;
    let s = 0;
    if (seed) { for (const w of wordsIn(body)) if (seed.has(w)) s += 1; }
    else { const low = body.toLowerCase(); for (const t of terms) if (t && low.includes(t)) s += 1; }
    // 'title'：**形状写在标题里、而且记录短**——这是「我特意留下这一条」长的样子。
    // 量出来的：找回来的那几条全是这个形状（Runnymede… 98 字、Windsor Road 56 字、
    // Dell…p3425we 60 字，标题就是答案本身）；而混进来的噪音是五千字的网页，
    // 邮编埋在正文里。漏掉的两条（Parking space on Buckingham Court, TW18 / Samsung CJ89）
    // 也正是这个形状，只是按「和问题共用词」排的时候它们一个词都不共用，排不上来。
    if (by === 'title') {
      const inHead = re.test(String(e.title || '')) ? 3 : 0;
      const short = body.length <= 200 ? 2 : body.length <= 800 ? 1 : 0;
      s = inHead + short + Math.min(s, 2);
    }
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

  const ARCH = ['A 现状', 'B 全扫词面', 'C 现状+形状', 'D 全扫+形状', 'E 现状+形状(PRF)', 'F E+去掉自产', 'G 形状填满名额', 'H G+按标题短记录排', 'I H+半截邮编', 'J I+无形状时全扫', 'K 三条腿按配额'];
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
    const fill = (hits) => {
      const kw = Math.min(clean.length, Math.max(4, KEEP - hits.length));
      return [...new Set([...clean.slice(0, kw), ...hits])].slice(0, KEEP);
    };
    // H：形状命中按「形状在标题里 + 记录短」排
    sets['H G+按标题短记录排'] = fill(shapeScan(all, shapeOf(c.q), terms, { by: 'title', limit: KEEP }).filter((id) => !isSelf(id)));
    // I：再让「地址」这一类也认半截邮编
    const shapeI = shapeOf(c.q) === 'postcode' ? 'postcode+' : shapeOf(c.q);
    sets['I H+半截邮编'] = fill(shapeScan(all, shapeI, terms, { by: 'title', limit: KEEP }).filter((id) => !isSelf(id)));
    // J：问题**认不出形状**的时候，退回全扫词面。
    // 这一条是那两道对照题逼出来的：没有形状可扫的问题上，全扫（B）5/5，而现状（A）只有 2/5。
    // 两种机制补的是两个不相干的洞——有形状的问题靠形状，没形状的问题靠「别只看索引的前几条」。
    if (shapeOf(c.q)) {
      sets['J I+无形状时全扫'] = sets['I H+半截邮编'];
    } else {
      const scan = fullScan(all, terms, { limit: KEEP }).filter((id) => !isSelf(id));
      sets['J I+无形状时全扫'] = [...new Set([...clean.slice(0, 6), ...scan])].slice(0, KEEP);
    }
    // K：三条腿**一起上**，谁也不许独占名额。
    //
    // J 是「有形状就走形状，没形状才全扫」——二选一。日用题上量出这样会坏事：
    // 「这台机器推荐用哪个本地模型」里的「模型」带个「型」字，触发了型号那一档，
    // 于是 20 个名额被一堆型号串占满，真正写着「推荐用 qwen3.5:27b」的两条挤不进来（0/2）。
    // 一个认错的形状不该把整份名额吃掉。所以改成配额：形状最多一半，索引和全扫分剩下的。
    {
      const shapeK = shapeOf(c.q) === 'postcode' ? 'postcode+' : shapeOf(c.q);
      const hits = shapeK ? shapeScan(all, shapeK, terms, { by: 'title', limit: KEEP }).filter((id) => !isSelf(id)) : [];
      const scan = fullScan(all, terms, { limit: KEEP }).filter((id) => !isSelf(id));
      const out = [];
      const add = (list, n) => { for (const id of list) { if (out.length >= KEEP) break; if (n-- <= 0) break; if (!out.includes(id)) out.push(id); } };
      add(hits, Math.floor(KEEP / 2));      // 形状：最多一半
      add(clean, 6);                        // 索引原本找到的：留 6 个
      add(scan, KEEP);                      // 全扫把剩下的填满
      add(hits, KEEP);                      // 还有空位就再给形状
      sets['K 三条腿按配额'] = out.slice(0, KEEP);
    }
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
