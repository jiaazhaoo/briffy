'use strict';
// 「问我的记录」。索引挑出这个问题说的是哪些记录，模型只把它们写成一句回答，并按编号引用。
//
// 挑记录这一步**完全不经过模型**。这不是省事，是这个功能能成立的前提：
//
//   换掉 OpenRouter 换成本地 Ollama，索引不受影响；断网也照样定位得到。
//   没配任何 AI 服务时，返回的仍然是一份排好序的、正确的记录清单——那本来就是答案的大半。
//   延迟是确定的，不取决于对方的网络，也不取决于模型聪不聪明。
//
// 以前这里是 store.listEntries({ limit: Infinity })：把工作区每一天都读进内存再打分。20 万条实测
// 215MB 堆、707ms；按这个工作区的真实平均长度外推到 185 万条约 7GB——每问一次崩一次。现在只从索引
// 里拿命中的那几十个 id，再按 id 取回那几条。
const fs = require('fs');
const path = require('path');
const llm = require('./llm');
const retrieve = require('./retrieve');
const vector = require('./vector');
const links = require('./links');
const boilerplate = require('./boilerplate');
const story = require('./story');
const vocab = require('./vocab');
const chats = require('./chats');
const { CJK } = require('./segment');
const index = require('./index-db');
const { localDateKey } = require('./store');

let store;
function init(deps) {
  store = deps.store;
  // chats 也要有 store：认「以前问过的话」要翻聊天记录（echoFilter）。main.js 已经初始化过
  // 一次，这里再来一次是幂等的——但少了它，从 bench 或者别的入口进来就悄悄少一道闸。
  try { chats.init({ store }); } catch (_) { /* 翻不了就只挡这一场问过的 */ }
}

const MAX_ITEMS = 40;   // as many as a daily-recap-sized context comfortably holds
// 一句话问出来的东西最多留这么几条。40 是给「把这段时间给我」用的；一个具体的问题给四十条，
// 结果是每条只摊到五百字，而含着答案的那几条正需要一千多。少而长。
// 递给模型多少条。要装得下「每一路的第一名」（最多 MAX_QUERIES 条）加上沿链补的那几条，
// 否则第一轮就白进了——分路的意义在于每一面都有代表，装不下就等于没分。
const KEEP = 24;
// 一条查询最多贡献这么几条。**卡得紧是有道理的**：一个问题有好几个面（起点、终点、停车），
// 让第一条查询把名额吃光，剩下的面就一条也进不来——今天量到的正是这个，把词揉成一句只捞回
// 1/7，拆成五条各取前 3 捞回 3/7。
const PER_QUERY = 3;
// 搜索框那条语义腿的最低分。**这不是「问」那条路的门槛**——那儿有词面命中兜着，捞宽一点无妨；
// 搜索框是直接给人看的，一条不相干的记录摆在那儿就是一条错。
//
// 0.50 是量出来的，不是拍的（dev/embed-bakeoff.js 和当时那次探针）：库里确实有的问法，最好的
// 那条落在 0.41~0.64；库里根本没有的问法（房贷利率、量子色动力学、我奶奶的猫、sourdough），
// 最好的那条落在 0.28~0.49。两段是叠着的，**没有一条线能把它们完全分开**，所以这条线是取舍：
// 画在 0.50，四个「库里没有」的问法全部空手而归，代价是「泰晤士河」的 Path Thames（0.410）
// 也进不来——而它现在归词面管了（前缀那一级，0 条 → 6 条）。宁可空手，不要拿噪声填满第一屏。
const VEC_MIN = 0.50;
// 检索够到的那几条之外，再沿链补这么多。链是「说得出理由」的那一路（同一个罕见词、同一页、
// 同一段操作），它在库大起来之后**不会变差**，而向量会——所以补位交给它，不交给向量。
const CHAIN_ADD = 6;
// 拿前几条当种子。这个数卡在 8 的时候实测漏过：「赛程分前后半程」——那一晚唯一一条同时写着
// 起点和终点的记录——排在第 9，正好在种子之外，于是链没有从它长过，终点地址那条就没被带上来。
// 同一个问题跑两遍，一遍成一遍不成，差别只是模型改写时吐没吐出「Runnymede」这个词。
// **能算出来的路不该赌模型说不说得出那个词**，所以种子放宽到把检索够到的都算上。
// 代价是每个种子一次 story.grow（带向量邻居约 20ms），十二个约 240ms。
const CHAIN_SEEDS = 12;
const CHAIN_SPAN = 16;   // 每个种子长这么大的一片就够——要的是近邻，不是整件事
// 短问句不当回声判据：「今天呢」这种三个字，正文里随手就撞上，挡掉的会是真记录。
const ECHO_MIN = 8;
const ASKED_MS = 60 * 1000;   // 问过的话缓存这么久
// 只在短记录上判「整条是家具」。长记录里夹着一行家具是常态，不该因此整条丢掉。
const JUNK_MAX = 120;
// 上一轮带过来几条。带多了这一问就成了上一问的回声，带少了追问就没有主语。
const CARRY_TURNS = 2;   // 往回带几轮
const CARRY_EACH = 3;    // 每轮带那一轮排最前的几条
const CARRY_ROOM = 4;    // 一共最多占这么多格
// 手上那几条记录里最罕见的几个名字，直接当查询。**不经过模型**——名字和罕见度都是算出来的。
const SEED_QUERIES = 10;
const NAMES_PER_RECORD = 3;   // 轮着取的时候，每条记录先出这么几个自己的名字
// 头几路是「人话」（原句、原句的实词），后面全是名字。只有人话那几路掺向量。
const LANG_LANES = 2;
// 一句话里有这么多「字」（汉字 + 三个字母以上的英文词）才算说得清自己。
// 「地址是多少」5，「我最近在看二手显示器，都看了些什么？」16。卡在中间。
const SELF_MIN = 10;
// 一问最多分这么多路。分得多不贵（一路 2~5ms），贵的是名额——所以路数和 KEEP 要一起看：
// 横着取的时候，只有前 room 条路的第一名进得来。
const MAX_QUERIES = 16;
// 第一次提问不该卡在建索引上。一个用了几年的工作区从零建要好几分钟，所以每次只做这么久，
// 剩下的下一次接着做；天是从新到旧建的，先补上的正好是最可能被问到的。
const SYNC_BUDGET_MS = 400;

function entriesDir() { return store.paths().entries; }

/**
 * 打开索引并追平工作区。可以随便调，没变过的天不会被重读。
 *
 * 读天文件走 fs，**不走 store.loadDay**：那个函数会把读过的每一天留在 store.days 里，而建索引要
 * 把每一天都读一遍——等于一边建索引一边把整个工作区钉进内存，正是这个索引要消灭的那件事。
 * 索引这边读完就扔，一天用完不留。
 */
function readDay(k) {
  try { return JSON.parse(fs.readFileSync(path.join(entriesDir(), `${k}.json`), 'utf8')); } catch (_) { return []; }
}

// 证据词的倒排。
//
// 这以前是每五分钟把每一天读进内存重算一遍的三个 Map：250 条 56ms / 11MB，按 O(n) 外推到
// 20 万条是 55 秒 / 8.8GB，而且**每存一条新记录就整个重来一次**。现在落在库里了（vocab.js），
// 这里只留一个懒视图——问到哪一条才去库里取哪一条。建它不要钱，所以「多久重学一次」
// 这个问题连同 FURNITURE_MS 一起没有了。
//
// 跨记录重复的家具表也一并去掉了：boilerplate 那两条规则里，它在真实工作区上只剥掉 3%
// （boilerplate.js 顶上量过），却要为它把每条记录的每一行都存下来；而主力那条「成串的短行」
// 是纯逐条的，不需要别的记录作证。实测证据边一致率 91%（剥 vs 不剥），这 9% 不值那张表。
let evIdx = null;

function learnFurniture() {
  if (!evIdx) evIdx = vocab.lazyView(index);
}

/**
 * 扩散要用的那一套：页面图、证据词倒排、向量邻居。
 *
 * **算一次，留着用。** 这以前是每次调用都重来一遍：把每一天读进内存、`links.build` 整个工作区，
 * 而它被 linksOf（每开一次详情页）和 chainAround（每问一次）各调一次。250 条上是 6ms，看不出来；
 * 按 O(n) 外推到 20 万条是每开一次详情页 5 秒、把整个工作区抬进堆一次。
 * 而 ask.js 顶上那段注释说的正是同一件事——`listEntries({limit: Infinity})` 是怎么死的。
 *
 * 失效的条件就一个：索引变了。sync 报有天被重建过（r.days > 0），下次再算。
 * 这不是「缓存要不要过期」的问题——图是索引的函数，索引没动，图就没动。
 */
let ctxCache = null;
function storyCtx() {
  try { learnFurniture(); } catch (_) { /* 用上一份 */ }
  if (ctxCache) return ctxCache;
  // 四样东西现在都是懒的，一样也不用把工作区读进内存：
  //   g   页面图 —— 表（vocab.pageGraph）
  //   ev  词表  —— 表（vocab.lazyView）
  //   near 向量邻居 —— LSH 粗筛桶，不再全表扫
  // 于是这个函数本身不要钱了，缓存留着只是省几次建对象。
  ctxCache = {
    g: vocab.pageGraph(index),
    ev: evIdx,
    near: (x) => { try { return vector.related(index, x, { limit: 4 }); } catch (_) { return []; } },
  };
  return ctxCache;
}

/**
 * 这几条记录讲的是什么，按「最像这件事的名字」排。
 *
 * 排序是**先看它在手上这几条里出现过几次，再看它在整个工作区里有多罕见**。
 * 只按罕见排是错的，实测栽过：手上七条记录里最罕见的四个是 10km、25km、邮件、Visit——
 * 全是只此一份的边角料，拿它们去检索什么也带不回来；而真正串起这件事的 Runnymede
 * （在手上好几条里都出现）排在后面，进不了那几个名额。
 * **罕见 = 独特，反复出现 = 是这件事的主语。要的是后者，再用前者去打破平局。**
 *
 * 抽名字本身没有新造一套：还是 entity.js 那一份（滤掉网页家具和虚词，邮编日期数量走正则）。
 * @returns {string[]}
 */
function namesIn(ids) {
  learnFurniture();
  if (!evIdx) return [];
  const order = [...new Set(ids)].filter((id) => evIdx.words.has(id));
  const seen = new Map();     // 名字 -> {n: 手上几条提到它, df: 全库有多少条提到}
  for (const id of order) {
    for (const k of evIdx.words.get(id) || []) {
      const t = evIdx.text.get(k);
      if (!t) continue;
      const x = seen.get(t) || { n: 0, df: evIdx.df.get(k) || 99 };
      x.n++;
      seen.set(t, x);
    }
  }
  // **按记录横着取，不排一张全局榜。**
  //
  // 全局榜怎么排都不对，两头都试过：只按罕见排，头几个是 10km / 邮件 / Visit 这种只此一份的
  // 边角料；按 tf-idf 排，头几个是 Challenge / Ultra / Thames 这种整件事的泛称。而真正要的那个
  // 词——「Runnymede」，那一晚唯一通向终点地址的桥——两种排法都在十六名之外。
  // 于是它进不进得了查询，全看模型改写时随口吐没吐出这个词：同一个案子跑三遍，成一遍败两遍，
  // 两遍的差别只有一个词（一遍说了 Runnymede，一遍说了 Park）。
  //
  // 病根和「按名次横着取」那个是同一个：**全局排序会把具体的东西挤掉**。一条记录里最说明它
  // 自己是什么的那几个词，不该去和别的记录抢一张榜。所以每条记录各出几个自己的名字，轮着来。
  // 记录内部的次序用 entity.nameRank：邮编/日期/数量/地名在前（正则认死的和从邮编邻居学来的），
  // 然后是被谁当过标题的词，最后才比罕见。
  // 一条记录里，先出什么名字。三档：
  //   0  邮编 / 日期 / 数量 / 地名——正则认死的，和从「挨着邮编出现」学来的
  //   1  拉丁词，或者三个字以上的中文词
  //   2  两个字的中文词
  //
  // 第三档要垫底，是实测逼出来的：改写出来的十四路查询里，「向量」「概念」「回去」各占一路，
  // 而每一路的第一名都必须进门（那条规矩本身是对的，早上正是它把 Runnymede 放进来的），
  // 于是一路虚词就必然拖进一条无关记录。用户一眼就看出来了：二十四条里十三条不该在。
  //
  // 为什么按「两个字的中文词」这条线切，而不是列一张虚词表：这个工作区里的标题常常是一整句
  // 话（剪贴板笔记的标题就是正文第一行），所以「有没有人拿它当过标题」那个信号被稀释了，
  // 「好的」「希望」和「车站」「接驳」拿到同样的身份。而**两个字的中文词里，是名字的和不是
  // 名字的分不开**——分不开就别硬分，让它排在后面：有更好的候选时它进不来，没有时它还在。
  // 这是排序，不是过滤——「模型」「内存」这种真有用的两字词，位子够的时候照样上。
  const CJK2 = /^[㐀-䶿一-鿿]{2}$/u;
  const rank = (k) => {
    const kind = (evIdx.kind && evIdx.kind.get(k)) || 'name';
    if (kind !== 'name') return 0;
    return CJK2.test(String(evIdx.text.get(k) || '')) ? 2 : 1;
  };
  const lanes = [];
  for (const id of order) {
    const mine = [...(evIdx.words.get(id) || [])]
      .sort((a, b) => (rank(a) - rank(b)) || ((evIdx.df.get(a) || 99) - (evIdx.df.get(b) || 99)))
      .map((k) => evIdx.text.get(k)).filter(Boolean);
    if (mine.length) lanes.push(mine);
  }
  const out = [];
  for (let i = 0; i < NAMES_PER_RECORD; i++) {
    for (const lane of lanes) {
      const t = lane[i];
      if (t && !out.includes(t)) out.push(t);
    }
  }
  // 轮完还不够就把剩下的按 tf-idf 补上
  const w = (x) => x.n / Math.log2(2 + x.df);
  for (const [t] of [...seen.entries()].sort((a, b) => w(b[1]) - w(a[1]))) if (!out.includes(t)) out.push(t);
  return out;
}

/**
 * 这句话自己说不说得清。
 *
 * 说得清 = 可以拿它自己去问向量；说不清 = 主语在上文里，只能靠上一轮带过来的名字。
 * 判据是**实词的量**，不是字数：「地址是多少」五个字里实词只有一个，
 * 「我最近在看二手显示器，都看了些什么？」实词有好几个。
 * @param {string} q
 */
function selfContained(q) {
  const t = String(q || '');
  const words = (t.match(/[㐀-䶿一-鿿]/gu) || []).length + t.split(/[^A-Za-z0-9]+/).filter((x) => x.length > 2).length;
  return words >= SELF_MIN;
}

/** 上一轮真正用上的那几条。模型自己报的 used 是 1 起的下标，对应当时给它的 sources。 */
function usedIds(turn) {
  const t = turn || {};
  const ids = Array.isArray(t.ids) ? t.ids : [];
  const used = Array.isArray(t.used) ? t.used : [];
  const picked = used.map((n) => ids[Number(n) - 1]).filter(Boolean);
  return picked.length ? picked : ids;      // 没报 used 就退回全部，总比没有主语强
}

/**
 * 认出回声：正文里原样写着你问过的话的记录。
 *
 * 它们几乎都是上一次问答被复制回工作区留下的，里面带着上一次的答案——而那份答案是**摘要**，
 * 门牌号早在摘要里就没了。同时它们又是词面上最完美的命中（问题的每一个字它都有），
 * 所以不挡住的话，模型读的永远是自己上次说过的话，越读越薄。
 * @param {string[]} questions 这一场对话里问过的话
 * @returns {(id:string)=>boolean}
 */
// briffy 自己那一页答案被复制回工作区时留下的抬头：「… · N 条记录 · 模型名」。
// 这是个硬标记，认它比认内容可靠。
const ANSWER_MARK = /·\s*\d+\s*条记录\s*·/;
// 问过的话的缓存。翻一遍聊天记录不贵，但也不必每问一次都翻。
let askedCache = null;
let askedAt = 0;

/** 这个工作区里，你**曾经**问过的所有话。 */
function askedBefore() {
  if (askedCache && Date.now() - askedAt < ASKED_MS) return askedCache;
  askedAt = Date.now();
  const out = new Set();
  try {
    for (const c of chats.list(60)) {
      const full = chats.read(c.id);
      for (const t of (full && full.turns) || []) {
        const q = String((t && t.question) || '').replace(/\s+/g, '').toLowerCase();
        if (q.length >= ECHO_MIN) out.add(q);
      }
    }
  } catch (_) { /* 读不到就只挡这一场对话里的 */ }
  askedCache = out;
  return out;
}

function echoFilter(questions) {
  // **这一场问过的，和以前每一场问过的，一起挡。**
  //
  // 原来只挡这一场，实测漏得厉害：问「起点和终点的具体地址」，递上去的二十四条里有五条是
  // 我自己以前问过的话被复制回工作区留下的（「我记下来了详细地址，你找一下」「具体的开始和
  // 结束的地址是什么」…）。它们跟这一问字面不同，所以那道闸放行了；可它们同样不是答案，
  // 而且同样是词面上最完美的命中——问题的每个字它都有。
  // 你问过什么，briffy 自己存着（chats.js），不用猜。
  const qs = new Set(askedBefore());
  for (const x of questions || []) {
    const q = String(x || '').replace(/\s+/g, '').toLowerCase();
    if (q.length >= ECHO_MIN) qs.add(q);
  }
  const list = [...qs];
  return (id) => {
    const e = store.getEntry(id);
    if (!e) return false;
    const raw = `${e.title || ''} ${e.text || ''}`;
    if (ANSWER_MARK.test(raw)) return true;         // 整条就是上一次的问答
    const t = raw.replace(/\s+/g, '').toLowerCase();
    return list.some((x) => t.includes(x));
  };
}

/**
 * 整条都是网页家具的记录，别占格子。
 *
 * 「English (Great Britain)」这种——一个语言选择条，被复制过好几回。它对任何问题都不是答案，
 * 但它短、干净、在向量空间里离哪儿都不远，所以每次都挤进来。实测第 2 问十六格里它占了三格。
 * 判据不新造：boilerplate 已经学过「哪些行是家具」（出现在三条以上记录里的行），
 * 一条记录**整条**就是这么一行，那它就是家具本身。
 *
 * 同一段文字重复存过好几遍的也只留一条：三条一模一样的记录给模型看，它读到的信息是一样的，
 * 占掉的却是三个格子。
 * @returns {(id:string)=>boolean}
 */
function junkFilter() {
  const fur = boilerplate.furniture();
  const body = new Map();     // 正文 -> 第一个占住它的 id
  const verdict = new Map();  // id -> 判过没有。**同一条问两遍必须是同一个答案**
  return (id) => {
    if (verdict.has(id)) return verdict.get(id);
    const say = (v) => { verdict.set(id, v); return v; };
    const e = store.getEntry(id);
    if (!e) return say(true);
    const t = `${e.title || ''} ${e.text || ''}`.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!t) return say(true);
    // 去重是**跨记录**的：两条一模一样的记录只留一条。不是「这一条出现过第二次」——
    // 一条记录本来就会同时命中好几路查询，不记住判过的结果，它就会在自己那一路上
    // 被当成自己的重复丢掉。实测栽在这儿：「Runnymede Pleasure Ground … TW20 0AE」在
    // 「Runnymede」那一路上是第一名，却因为前面某一路先碰过它，在自己那一路上被滤没了。
    const owner = body.get(t);
    if (owner !== undefined && owner !== id) return say(true);
    if (fur && t.length <= JUNK_MAX) {
      const lines = String(e.text || '').split('\n').map((x) => boilerplate.key(x)).filter(Boolean);
      if (lines.length && lines.every((x) => fur.has(x))) return say(true);
    }
    body.set(t, id);
    return say(false);
  };
}

/**
 * 从检索够到的这几条出发，沿链走一跳，补几条它们的近邻。
 *
 * 为什么补位交给链、不交给向量：今天量过，250 条的时候向量前十里排在正确答案前面的已经是
 * 「5381491216421114」「ipaslogo.com」和一行破折号——噪声和答案在同一个距离带（0.38~0.47）。
 * 噪声条数随库线性长，对的答案永远只有几条，所以**向量是唯一一个库越大越差的部件**。
 * 而链走的是硬证据：一个邮编在一百万条里仍然只指着那几条。
 * @returns {string[]}
 */
function chainAround(seeds, room) {
  const n = Math.min(CHAIN_ADD, Math.max(0, room));
  if (!n || !seeds.length) return [];
  try {
    const ctx = storyCtx();
    const have = new Set(seeds);
    const best = new Map();
    for (const seed of seeds.slice(0, CHAIN_SEEDS)) {
      for (const m of story.grow(seed, ctx, { max: CHAIN_SPAN }).members) {
        if (have.has(m.id)) continue;
        if ((best.get(m.id) || 0) < m.score) best.set(m.id, m.score);
      }
    }
    return [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => id);
  } catch (_) { return []; }        // 长不出来就算了，检索够到的那几条本来就是答案的大半
}

/** 和这一条共用证据词的那几条，每条带着共用的词。空手是正常的：这一条上没有够罕见的词。 */
function evidenceOf(id) {
  try { learnFurniture(); } catch (_) { /* 用上一份 */ }
  if (!evIdx) return [];
  try { return links.evidenceFor(String(id || ''), evIdx); } catch (_) { return []; }
}

function refresh({ budgetMs = SYNC_BUDGET_MS } = {}) {
  index.open(store.userData, store.workspaceDir);
  index.useVecModel(vector.MODEL);
  learnFurniture();
  // onDay：建一天索引的时候顺手把这一天的抬头词和地名收进表里（vocab 的甲那一遍）。
  // 这是唯一一处天然「一天只读一次」的地方，搁在别处就得再把全库读一遍。
  const r = index.sync({ dir: entriesDir(), loadDay: readDay, onDay: (_k, list) => { vocab.collect(index, list); vocab.collectPages(index, list); } }, { budgetMs });
  if (r && r.days) ctxCache = null;   // 有天被重建过，图跟着重算；没动就接着用上一份
  return r;
}

/**
 * 应用起来之后在后台把索引建完，这样第一次提问就已经是齐的。
 *
 * 倒排建完之后接着补向量，走的是同一条循环、同一个「限时、可中断、下次接着做」的形状——
 * 不为它新建第二套调度。实测每条记录 21ms，一天两百条累计四秒，和 OCR 一张截图 0.5 秒
 * 比起来是同一个量级，而 OCR 已经在跑了。所以新存的东西是**几秒钟**跟上，不是等到夜里。
 *
 * 顺序是先倒排后向量：倒排是那个会说「找不到」的一半，也是断网、换服务、模型跑不动时唯一
 * 还在工作的一半，它必须先齐。
 */
function warm() {
  const fillVectors = () => {
    vector.fill(index, readDay, { budgetMs: 1500, cacheDir: store.paths().models })
      .then((r) => {
        if (r.error) { console.warn('[ask] 向量补不了：', r.error); return; }   // 词面那一半照常工作
        if (!r.done) { setTimeout(fillVectors, 800); return; }
        // 向量齐了才建粗筛桶：桶的位数跟着库的大小走，边补边建会建到一半就作废。
        try {
          const b = vector.buildBuckets(index);
          if (b.built) console.log(`[ask] 向量粗筛桶 ${b.bits} 位 × ${b.tables} 表，${b.built} 条${b.rebuilt ? '（重建）' : ''}`);
        } catch (e) { console.warn('[ask] 桶建不起来，退回全表扫：', e.message || e); }
        setTimeout(fillVocab, 400);
      })
      .catch((e) => console.warn('[ask] 向量补不了：', e.message || e));
  };
  const step = () => {
    let r;
    try { r = refresh({ budgetMs: 1500 }); } catch (e) { console.warn('[ask] 索引建不起来', e.message); return; }
    if (!r.done) { setTimeout(step, 800); return; }   // 留出空档，别把启动那几秒占满
    setTimeout(fillVectors, 800);
  };
  // 抽词和定次序：限时、可中断、下次接着做，和补向量同一个形状——要解的是同一个问题，
  // 一件 O(n) 的活儿不能卡在启动那几秒里。次序要等大家都抽完才定得准（df 是靠它数出来的）。
  const fillVocab = () => {
    try {
      const f = vocab.fill(index, (id) => store.getEntry(id), { budgetMs: 600 });
      if (!f.done) { setTimeout(fillVocab, 600); return; }
      const st2 = vocab.settle(index, { budgetMs: 600 });
      if (!st2.done) { setTimeout(fillVocab, 600); return; }
      const st = index.vocabStats();
      console.log(`[ask] 词表齐了：${st.words} 个词、${st.rows} 行，地名 ${st.places} 个`);
    } catch (e) { console.warn('[ask] 抽词没做完：', e.message || e); }
  };
  setTimeout(step, 3000);
}

/**
 * @param {string} question
 * @returns {Promise<null|{question:string, answer:string, used:number[], sources:Array,
 *   range:{from:string,to:string}|null, scored:boolean, noProvider:boolean, error:string, model:string}>}
 */
async function run(question, { limit = MAX_ITEMS, history = [] } = {}) {
  const q = String(question || '').trim();
  if (!q) return null;
  const today = localDateKey();
  try { refresh(); } catch (e) { console.warn('[ask] 索引没能追平', e.message); }

  const cfg0 = llm.config(store);
  // ① 这一问该拿什么去检索。模型不在就是空数组，下面退回原句——那时的行为和从前一模一样。
  // 改写的时候，把「上一轮真正用上的那几条记录里的名字」摆给它挑。它只能说出它见过的词，
  // 而上一次回答有没有把地名写出来是碰运气的——名字这一份不碰运气，是 entity.js 算出来的。
  // 名字从**上几轮看过的全部记录**里抽，不只是模型说它用上的那几条。
  //
  // 只从 used 抽过，不稳：同一个案子跑三遍，3/3、1/3、1/3——因为上一轮说自己用了哪几条本身
  // 就在飘。而名字是不占名额的（占名额的是下面的 carried），多看几条只会让排序更稳：
  // 「在手上这几条里出现过几次」这个排序，本来就是靠**多条记录一起作证**才准。
  const seeds = namesIn(history.slice(-CARRY_TURNS).flatMap((t) => (t && t.ids) || []));
  const plan = llm.isConfigured(cfg0) ? await llm.searchPlan(cfg0, { question: q, history, seeds }).catch(() => []) : [];

  // 真正拿去检索的几条，**模型只出其中一部分**：
  //   · 原句和它的实词——这两条是地板。没有模型、模型抽风、改写全被滤掉，剩下的仍然是今天这套，
  //     不多不少。ask.js 顶上那条「不依赖模型也能定位」的保证就落在这儿。
  //   · 手上那几条记录里最罕见的几个名字，**直接当查询用，不经过模型**。让模型从菜单里挑，
  //     实测它挑不准：菜单里明明有 Runnymede，它挑走了 Thames / Path / Ultra / Challenge。
  //     名字是算出来的，罕见度也是算出来的，那就别让它猜——猜的部分留给「还该从哪个角度找」。
  //   · 模型出的那几条，补角度用。
  const plain = retrieve.select(index, q, { today, limit, getEntry: (id) => store.getEntry(id) });
  const queries = [];
  for (const x of [q, (plain.terms || []).join(' '), ...seeds.slice(0, SEED_QUERIES), ...plan]) {
    const s2 = String(x || '').trim();
    if (s2 && !queries.includes(s2)) queries.push(s2);
    if (queries.length >= MAX_QUERIES) break;
  }

  // ② 每条查询各自挑一小把，再并起来。**分开问，不揉成一句**——见 llm.searchPlan 那笔账。
  //
  // 回声在这里滤，不在 retrieve.rerank 里滤：那一层比的是「记录里有没有原样写着**这条查询**」，
  // 而改写之后送进去的是「Bishops Park」这种词，回声当然不含它，于是那道闸整个失效了。
  // 实测：第 2 问十六格里五格是回声（自己上一次的问答被复制回工作区留下的）。
  // 所以按**整场对话的问句**滤——记录里原样写着你问过的话，它就不是这句话的答案。
  const echoed = echoFilter([...history.map((t) => (t || {}).question), q]);
  const drop = junkFilter();
  // 上一轮读过的那几条记录，直接带过来。
  //
  // **一场对话的状态不是那几段文字，是那几条记录。** 实测栽在这儿两次：改写这一步只能说出
  // 上一次回答里出现过的词，而上一次回答说没说「Bishops Park」是碰运气的——同一个问题跑两遍，
  // 一遍说了（于是第 2 问找得到起点），一遍没说（于是第 2 问从零开始，答「未找到」）。
  // 而上一轮手上那条「赛程分前后半程」里从头到尾写着起点和终点，它跟回答说了什么无关。
  //
  // 带的是**上一轮真正用上的那几条**（模型自己报的 used），不是它当时手上的全部。带全部会把
  // 上一轮那些没用上的杂物（一条 GitHub 仓库、一条 Andrew Ng 的推）一路拖下去，越拖越脏。
  const carried = [];
  for (const t of history.slice(-CARRY_TURNS)) {
    for (const id of usedIds(t).slice(0, CARRY_EACH)) {
      if (!carried.includes(id) && store.getEntry(id)) carried.push(id);
    }
  }
  const seen = new Set();
  let pick = null;
  const room = KEEP - CHAIN_ADD;      // 第二轮往后的名额；给链留出位子
  // 每条查询各留一小串，最后**按名次横着取**：先把每条查询的第一名都收进来，再收第二名。
  // 顺着一条条查询收是错的，实测栽过：「起点地址」那条查询的第一名（Bishops Park, Fulham）
  // 排在第十六位，模型根本没读到它，回了一句「记录中未包含起点和终点的详细地址」——
  // 而答案就是它手上的最后一条。一个问题的几个面是**平级**的，收的时候就得平级。
  const lanes = [];
  for (let qi = 0; qi < queries.length; qi++) {
    const sub = queries[qi];
    const p = sub === q ? plain : retrieve.select(index, sub, { today, limit, getEntry: (id) => store.getEntry(id) });
    if (!pick && p.ids.length) pick = p;                    // 时间范围和词按第一条命中的算
    if (!p.ids.length) continue;
    // **名字那几路只走词面；人话那两路词面和向量各走各的，不融合。**
    //
    // 名字不掺向量：「问得越像名字，词面越准」——「Runnymede」词面第一名就是那条地址，
    // 精确无歧义，再 RRF 掺一遍向量只会把噪声顶上来。实测向量掺进每一路，四遍里三遍答错。
    //
    // 人话那两路则**反过来**，而且不能靠融合解决。RRF 只看名次，于是一堆「碰巧对上字」的
    // 词面命中会把真正对的那条向量命中压死：问「我最近在看二手显示器」，词面切出来的词
    // 撞上了 briffy 自己的截屏开发笔记，12 条全中，而向量把 Samsung CJ89 排在第 3——
    //   词面第 12 名  1/(20+13) = 0.030
    //   向量第 3 名   1/(60+4)  = 0.016
    // 十二条垃圾条条压过它，而第一轮每路只取第一名，于是那一路交出来的是垃圾。
    // （早上那条「向量把 Windsor Road 排第 8，被十六条词面命中全部压过」是同一件事。）
    //
    // 融合的前提是两边都在回答同一个问题。而这里它们回答的是**两个不同的问题**：
    // 词面答「哪几条写着这些字」，向量答「哪几条说的是这件事」。让它们各交各的第一名，
    // 比让它们在一个分数上打架诚实得多。
    const keep = (id) => !echoed(id) && !drop(id);
    lanes.push(p.ids.filter(keep).slice(0, PER_QUERY * 3));
    // 向量单独一路，但**只给说得清自己的那种问法**。
    //
    // 这一条是撞出来的。拆成两路之后，「我最近在看二手显示器，都看了些什么？」从全错变成
    // 三台显示器全对；同一次改动却把「地址是多少」从答对（Ollama 的 127.0.0.1:11434）
    // 变成了答错（Bishops Park）——因为向量对这五个字的第一名就是库里最「像地址」的东西，
    // 而原来 RRF 把向量埋掉，反倒歪打正着地保护了它。
    //
    // 分界线不是长短本身，是**这句话自己说不说得清**：十八个字的那句自带主语，
    // 五个字的那句主语在上文里。**短追问只能靠上文那几路名字，不能靠它自己的向量**——
    // 它自己的向量指的是「地址」这个词在整个工作区里最像的东西，那和你在问什么无关。
    if (qi < LANG_LANES && selfContained(q)) {
      const near = await vector.search(index, sub, { limit, cacheDir: store.paths().models, from: p.range ? p.range.from : '' })
        .catch(() => []);
      if (near.length) lanes.push(near.filter(keep).slice(0, PER_QUERY * 3));
    }
  }
  const ids = [];
  for (const id of carried) {                       // 上一轮的先站住位子，它们是这一问的主语
    if (ids.length >= CARRY_ROOM || seen.has(id) || echoed(id) || drop(id)) continue;
    seen.add(id); ids.push(id);
  }
  // 第一轮：**每一路的第一名都要进来，不看名额**。
  //
  // 这里卡过一次，卡得很蠢：名额 14 个，路 16 条，于是第 15、16 路一条也进不来。而那次模型
  // 恰好把「Runnymede」放在第 16 路——它找到了，我没让它进门。
  // 分路的全部意义就是「每一面都要有代表」，第一名进不来的路等于没分。所以第一轮不设限，
  // 名额只管第二轮往后。
  for (const lane of lanes) {
    const id = lane[0];
    if (id && !seen.has(id)) { seen.add(id); ids.push(id); }
  }
  for (let r = 1; r < PER_QUERY && ids.length < room; r++) {
    for (const lane of lanes) {
      if (ids.length >= room) break;
      const id = lane[r];
      if (id && !seen.has(id)) { seen.add(id); ids.push(id); }
    }
  }
  if (!pick) pick = plain;

  // ③ 沿链走一跳补位。找地址那次就靠它：Runnymede Pleasure Ground 和 Windsor Road 共用邮编
  //    TW20 0AE，检索只够到前者，一跳就把后者带上来了。
  for (const id of chainAround(ids, KEEP - ids.length)) {
    if (!seen.has(id) && !echoed(id) && !drop(id)) { seen.add(id); ids.push(id); }
  }

  const entries = ids.slice(0, KEEP).map((id) => store.getEntry(id)).filter(Boolean);

  const base = {
    question: q, answer: '', used: [], model: '',
    sources: entries, range: pick.range,
    scored: pick.scored, noProvider: false, error: '', total: index.stats().entries,
    inRange: pick.inRange, queries, seeds, ids: entries.map((e) => e.id),
  };
  if (!entries.length) return base;

  const cfg = cfg0;
  if (!llm.isConfigured(cfg)) return { ...base, noProvider: true };
  try {
    const r = await llm.answerQuestion(cfg, { question: q, entries, terms: pick.terms, history });
    return { ...base, answer: r.answer, used: r.used, model: r.model };
  } catch (e) {
    return { ...base, error: e.message || String(e) };
  }
}

/**
 * 搜索框的第二条腿：意思相近，但搜的那几个字一个都没写在里面。
 *
 * 和「问」那条路不一样，这里**不能**要求词面先命中——搜索框的价值恰恰是「搜跑步出得来徒步」，
 * 而那时候词面按定义就是空的。实测七个这样的词，词面能搜到 1 个，向量 5 个。
 * 安全性靠界面兜：这些结果在页面上是**标出来的**，不会和精确命中混在一起假装是同一回事。
 * @returns {Promise<string[]>} 记录 id，按相近程度排
 */
async function near(query, { exclude = [], limit = 12 } = {}) {
  const q = String(query || '').trim();
  // 门槛是为了别在打第一个字母时就去算向量。但**一个汉字就是一个完整的词**——「车」「猫」「书」
  // 都是正经查询，按字符数一刀切会把它们全挡在外面（实测「车」返回 0 条，而它本该找到
  // Ford focus 和那张接驳车的截图）。所以只对拉丁那种一个字母不成词的情况要求两个字符。
  if (!q || (q.length < 2 && !CJK.test(q))) return [];
  try { refresh(); } catch (_) { /* 索引没追平也照样能搜已经建好的那部分 */ }
  const skip = new Set(exclude || []);
  // 和「问」那条路用同两道闸。搜索框以前一道都没有，于是量出来这些：
  //   「地址」前四名里两名是**我自己以前问过的话**（「我记下来了详细地址，你找一下」）——
  //         它们被复制回工作区，成了词面和向量上都最完美的命中，可它们不是答案。
  //   「停车」「活动」的前几名是「选择一条记录查看详情」「问问你的记录 →」「剪贴板图片 12:39」——
  //         briffy 自己的界面被截进来了。boilerplate 早就认得这种东西，只是搜索框没问过它。
  const echoed = echoFilter([q]);
  const drop = junkFilter();
  const ids = await vector.search(index, q, { limit: limit * 4, min: VEC_MIN, cacheDir: store.paths().models });
  return ids.filter((id) => !skip.has(id) && !echoed(id) && !drop(id)).slice(0, limit);
}

/**
 * 和这一条有关的记录，**一条按远近排好的清单**，每条都说得出为什么。
 *
 * 之前这里是四组分开列的边（摘自 / 从这一页摘的 / 同一程 / 同一个词），外加一张图谱。
 * 图谱做不成：十四张卡片、四十多条线，线上还写着字，实测就是一团乱麻，读不出任何东西。
 * 而分四组也不对——**你要的是「和这条最近的是哪几条」，不是「按证据种类分类的四张小表」**。
 *
 * 所以合成一条清单，用 story.grow 排：它本来就是按分数排好的，而且每条都带着
 * 它是被哪条边、哪一对词放进来的。左边写理由，右边写标题。
 * @returns {{related:{id:string, score:number, why:object}[]}}
 */
function linksOf(id) {
  const me = String(id || '');
  try {
    const s = story.grow(me, storyCtx(), { max: 14 });
    return {
      related: s.members
        .filter((m) => m.id !== me)
        .map((m) => ({ id: m.id, score: m.score, why: m.via || null })),
    };
  } catch (_) { return { related: [] }; }
}

/** 和这一条讲同一件事的那几条。空手是正常的：向量还没补齐，或者它确实没有近邻。 */
function relatedTo(id) {
  try { refresh(); } catch (_) { /* 索引没追平也照样能用已经建好的那部分 */ }
  try { return vector.related(index, String(id || '')); } catch (_) { return []; }
}

module.exports = { init, run, near, warm, refresh, relatedTo, linksOf, evidenceOf, MAX_ITEMS };
