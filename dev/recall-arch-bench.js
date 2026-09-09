'use strict';
// 「问一句话，找回那几条记录」这一步，什么架构最好。**只量检索，不叫模型**——
// 今天量下来所有的失败都在这一步，而这一步不花钱、确定、可重复。
//
//   npx electron dev/recall-arch-bench.js
//
// 2026-09-09 的账。14 个问题、33 条满分记录，分两组：前 7 个围着「形状」出（含 2 道故意
// 没有形状的对照），后 7 个是日用场景——保单号、P60 收入、签证住址、本机 Ollama 地址、
// 电脑崩溃、推荐模型、存过的视频。后一组是专门用来找通用毛病的。
//
//   接上形状腿之前   12/33 (36%)  · 702ms
//   上线的这一版     27/33 (82%)  · 索引 + 形状 + 全扫，三条腿按配额
//
// 走到这儿的路，每一步都是一个独立的道理（当初那一串变体在文件末尾留着）：
//   形状腿          20% → 53%   词匹配不到形状：写着 TW20 0AE 的记录里没有「地址」两个字
//   形状填满名额      53% → 80%   词面一条没找到时，24 个名额空着却截断唯一在工作的腿
//   标题短记录优先     ——         真是答案的那几条都很短、形状就写在标题里
//   半截邮编         80% → 93%   真实记录写的是「Buckingham Court, TW18」，只有前半段
//   无形状时全扫      82%         「screenpipe 怎么采集」这类问题上全扫 5/5、索引 2/5
//   三条腿按配额      82% → 91%   一个认错的形状（「模型」撞「型号」）不许吃掉整份名额
//
// 上线之后是 82% 不是 91%：台子里那一版的「索引结果」是接线前那个小候选集，接线后
// ask.run 自己就在做配额，两者的组成不一样。剩下 6 条漏也查清楚了，都不是过滤器挡的：
// 四条是长记录、标题里没有形状，排在形状腿的名额之外；两条是纯粹词不沾边（问「崩溃」
// 而记录写「爆显存」，问「哔哩哔哩视频」而记录写「周周怪】杜琪峰中式邪典」）。
//
// 端到端（同一个模型只换检索）：
//   deepseek-v4-flash-0731  「起点终点的具体地址」 之前：「没有给出更具体的街道门牌地址」
//                            → 之后：「Runnymede Pleasure Ground, Egham, Surrey TW20 0AE」
//                           「报名费多少钱」 之前：「没有找到」 → 之后：「£139.00」（引订单确认页）
//   本机 qwen3.5:9b         同一问 之前：「终点是 Runnymede」 → 之后：「…Egham, Surrey TW20 0AE」
//
// **14 个问题是小样本，别再拿它调分数。** 它现在的用处是回归：改了检索就跑一遍，看这个数掉没掉。
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

  // **只量上线的那一版。** A~K 那一串变体在产品接上之后已经没有意义了——它们全都建在
  // ask.run 之上，而 ask.run 现在自己就是 K。历史账保留在文件头，那是怎么走到这儿的记录。
  let got = 0, gold = 0, self = 0, ms = 0;
  for (const c of CASES) {
    const t0 = Date.now();
    const ids = (await ask.run(c.q, {})).sources.map((e) => e.id);
    ms += Date.now() - t0;
    const hit = c.gold.filter((g) => ids.some((x) => x.startsWith(g)));
    const miss = c.gold.filter((g) => !ids.some((x) => x.startsWith(g)));
    const s2 = ids.filter(isSelf).length;
    got += hit.length; gold += c.gold.length; self += s2;
    console.log(`${String(hit.length + '/' + c.gold.length).padStart(5)}  形状=${(require('../src/main/shape').shapeOf(c.q) || '—').padEnd(13)} ${c.q}`);
    if (miss.length) console.log(`        漏 ${miss.join(' ')}`);
    if (s2) console.log(`        混进 briffy 自产的 ${s2} 条`);
  }
  console.log('\n════════ 总计 ════════');
  console.log(`找回 ${got}/${gold} (${Math.round(got / gold * 100)}%) · 混进自产的 ${self} 条 · 检索共 ${ms}ms`);
  console.log('（接上形状腿之前是 12/33，36%）');
  app.quit();
});
/* 以下是当初那一串实验变体，留着看是怎么走到这儿的：
  for (const name of ARCH) {
    const t = tally[name];
    console.log(`${name.padEnd(12)} 找回 ${t.got}/${t.gold} (${Math.round(t.got / t.gold * 100)}%) · 混进自产的 ${t.self} 条 · 检索耗时 ${Math.round(t.ms)}ms`);
  }
  app.quit();
});

*/
