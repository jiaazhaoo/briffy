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
const boilerplate = require('./boilerplate');
const title = require('./title');
const vocab = require('./vocab');
const chats = require('./chats');
const ocrBoxes = require('./ocr-boxes');
const shape = require('./shape');
const trail = require('./trail');
const { CJK } = require('./segment');
const index = require('./index-db');
const { localDateKey } = require('./store');

let store;
function init(deps) {
  store = deps.store;
  // chats 也要有 store：认「以前问过的话」要翻聊天记录（echoFilter）。main.js 已经初始化过
  // 一次，这里再来一次是幂等的——但少了它，从 bench 或者别的入口进来就悄悄少一道闸。
  try { chats.init({ store }); } catch (_) { /* 翻不了就只挡这一场问过的 */ }
  ocrBoxes.init({ store });   // 同理：索引和词表要读字框（ocr-boxes.bodyText），bench 进来也得有
}

const MAX_ITEMS = 40;   // as many as a daily-recap-sized context comfortably holds
// 一句话问出来的东西最多留这么几条。40 是给「把这段时间给我」用的；一个具体的问题给四十条，
// 结果是每条只摊到五百字，而含着答案的那几条正需要一千多。少而长。
// 递给模型多少条。要装得下「每一路的第一名」（最多 MAX_QUERIES 条）加上沿链补的那几条，
// 否则第一轮就白进了——分路的意义在于每一面都有代表，装不下就等于没分。
const KEEP = 24;
// 那 24 格里留给「路过」的几格。**给小不给大**：那三条腿翻的是你自己的库，那才是这个产品的
// 主语；路过是补一句「你还读过这个」。给多了，一天几十页的浏览痕迹会把你自己存的东西挤出去。
const TRAIL_KEEP = 3;
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
// 拿词面命中的前几条当链的种子，每条最多带回来这么几个邻居。卡得紧是有道理的：
// 「同一段操作」里可能有几十条，全放进来就把搜索结果变成了那一小时的流水账。
const CHAIN_SEED = 3;
const CHAIN_HOP = 4;
// 词面空手的时候，拿向量猜的那几条当**线索**：从它们身上挑几个有指向性的词，再走一遍精确匹配。
// 这是 IR 里的伪相关反馈（Rocchio/RM3），不是新东西。
//
// 为什么这样绕一圈：这个模型跨语言的对齐在句子那一层，不在词那一层（量在 dev/search-near-bench.js
// 顶上）——「停车 ↔ parking」0.485，而「停车 ↔ 抓紧」0.901。所以直接拿它的名次当答案不行，
// 噪声和真货混在同一个分数带里。但它**只要在前几名里蒙对一次**就够了：那一条身上写着 parking、
// Buckingham、TW18，这些词交给 FTS5 是精确的活儿。蒙错的那些种子贡献的词在词面上什么也找不到，
// 自己就死了——所以这条腿的错误是安静的。
const RF_SEED = 5;     // 拿前几条当线索
const RF_TEXT = 400;   // 每条只看开头这么多字，够挑词了
const RF_WORDS = 3;    // 最多挑这么几个词
const RF_HITS = 3;     // 每个词最多带回来这么几条
// 一个词要在**几条种子里同时出现**才算数。
//
// **按 df 从小到大挑是错的，我第一版就这么写的**：一条记录里最罕见的词几乎总是 hapax——
// 案件编号 9586726235593、OCR 出来的 mr、rd、town。「停车」那五条种子里 Find parking 和
// Parking space 都在，可挑出来的三个词一个有用的都没有。
// 「在几条种子里都出现」才是要的那个判据（RM3 就是这么做的）：parking 在三条种子里都有。
const RF_MIN_SEEDS = 2;
// 而且这个词不能到处都是。按比例卡，不按条数：实测「停车」那一轮，on 出现在四条种子里
// （df 30 = 12%）、of 三条（7%）、to 三条（16%），全是虚词；parking 三条（df 11 = 4.3%）、
// charge 4 条（1.6%）、reading（1.9%）是真的。5% 这条线正好把两边分开。
const RF_DF = 0.05;
// 短问句不当回声判据：「今天呢」这种三个字，正文里随手就撞上，挡掉的会是真记录。
const ECHO_MIN = 8;
const ASKED_MS = 60 * 1000;   // 问过的话缓存这么久
// 只在短记录上判「整条是家具」。长记录里夹着一行家具是常态，不该因此整条丢掉。
// 一条记录的正文里，实字（字母和汉字）少于这么多个，它说不出任何一件事。
//
// 数字、标点、时间戳不算——识别糊了的截图正文长这样：「12:009条 A it」「00 0 Q 日 0 0 0 ² 米 8」
// 「7 è 4 1 小」。它们不短，但一个字也没说。而它们**短、干净、在向量空间里离哪儿都不远**，
// 于是每个查询都往里挤。
//
// 8 是量出来的：这个工作区里实字最少的**真**记录是「96.5% 的案件卡在源数据上」（9 个），
// 再下面是「停 Staines 车站」（10）、「£10 接驳车直接送你回去取车」（11）——都得留着。
// 8 以下的十五条，一条真东西也没有。
const THIN = 8;
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
//
// **2026-09-08 把这张表加回来过，又拿掉了。** 加的理由是 boilerplate.js 顶上写着
// 「谁手上有记录谁来喂（ask.refresh）」而从来没人喂过。喂上之后才看清它为什么不该喂：
//   · 抽证据词的那条路（vocab.fill）明明白白传的是 null，它从来就没用过这张表；
//     唯一的用户是 chunk.textOf，也就是算向量前剥一道，收益就是那 3%。
//   · 代价是每次启动把整个工作区读一遍——正是上面这段话在躲的那个 O(n)。
//   · 更糟的是它让向量指纹跟着抖：chunk.hashOf 把剥过的正文算进去，而这张表随着记录增加
//     一直在变，表一变，一批向量就整体作废重算。
//   · 而它一生效就闯了祸：junkRecord 里「整条都是网页家具」那条规则第一次真的跑起来，
//     挡掉 8 条，一条对的都没有（见那个函数的注释）。那条规则也一起拿掉了。
let evIdx = null;

function learnFurniture() {
  if (evIdx) return;
  // 追问要的名字从这张视图里取；不是材料的记录（junkRecord）不出名字。判过的记住。
  // 家具那张表不在这儿取：它是后台慢慢学的，这会儿可能还没有；每条记录第一次被问到时再取。
  //
  // 以前问过的话（被复制回工作区的那几条）不当节点：它们是问题，不是材料，却和那件事的
  // 每条记录都共用词。实测一条清单十三个格子里它们占三四个，把两跳才够得到的真货挤了出去。
  // （briffy 拍到自己的那种曾经也在这儿单挡——它上面显示着你的十几条记录，和每一条都共用一个词，
  // 实测图里清单最长的五条全是它。现在它在采集时就不会出现了，见 windows.hideForCapture；
  // 剩下的旧记录盖了 context.self 的章，junkRecord 认。）
  const echoed = echoFilter([]);
  const memo = new Map();
  const ok = (id) => {
    if (!memo.has(id)) memo.set(id, !junkRecord(store.getEntry(id)) && !echoed(id));
    return memo.get(id);
  };
  evIdx = vocab.lazyView(index, { ok });
  evIdx.ok = ok;
}

// 全库扫那两条腿（形状 / 词面）要一份「每条记录的标题和正文」。
//
// **这是给一个几百到几万条的库准备的，不是给二十万条的。** 实测（2026-09-09，316 条）：
// 读进内存 8ms、373 KB，扫一遍 0.3ms。按这个平均长度外推，2 万条是 23 MB、扫一遍 22ms——
// 还行；20 万条是 231 MB，那就不能常驻内存了，所以过了这条线两条腿都不出手，退回索引。
// ask.js 顶上那段注释说的正是同一件事：这个文件的历史包袱就是「别把整个工作区抬进内存」，
// 那条规矩在二十万条时是对的，在三百条时让它漏掉了写着答案的那两条记录。
const SCAN_MAX = 20000;
let corpusCache = null;
function corpus() {
  if (corpusCache) return corpusCache;
  const ids = index.allIds();
  if (ids.length > SCAN_MAX) { corpusCache = []; return corpusCache; }
  const out = [];
  for (const id of ids) {
    const e = store.getEntry(id);
    if (e) out.push({ id: e.id, title: e.title || '', text: e.text || '' });
  }
  corpusCache = out;
  return out;
}

// 页面图（vocab.pageGraph）：一页和从它上面摘下来的那几条。表，不是内存；索引变了就换一份。
let graphCache = null;
function pageGraph() {
  if (!graphCache) graphCache = vocab.pageGraph(index);
  return graphCache;
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
 * 挑材料：不是材料的（junkRecord）不给，重复的只给一条。
 *
 * 同一段文字存过好几遍的只留一条：三条一模一样的记录给模型看，它读到的信息是一样的，
 * 占掉的却是三个格子。
 * @returns {(id:string)=>boolean}
 */
/**
 * 这条记录**本身**是不是材料。纯函数，只看这一条，不看别的记录——跨记录的去重在 junkFilter 里。
 *
 * 两种不是材料的：
 *   · briffy 拍到了自己（context.self）：正文整个是 briffy 的界面文案。对任何问题都不是答案，
 *     可它短、干净、离哪儿都不远，实测十个探针里六个的头几名有它。这一种现在只剩旧记录：
 *     2026-09-09 起采集时 briffy 自己的窗就不在画面里（windows.hideForCapture），之前靠词表
 *     认倒影的 mirror.js 删了，它认出的 24 条旧记录一次性盖了章。
 *   · 说不出任何一件事的：识别糊了，剩下一堆数字和单个字母。
 *
 * **正文识别不出东西的时候，标题顶上。** 一张图的窗口标题「jia — ◑ 主显示器文字模糊」是真话，
 * 而 briffy 自己起的占位（Screenshot 11:22、剪贴板图片 12:39）和文件名（26abf35c….jpg）不是。
 * 少了这一条，「实字 < 8」挡掉的 29 条里有 17 条是冤枉的——每日大赛、Golden Retriever Puppy、
 * 主显示器文字模糊，正文都是空的或者一串乱码，标题却说得清清楚楚。
 *
 * **「整条都是网页家具」那条规则拿掉了。** 它在 2026-09-08 之前从没跑过（家具表一直是 null，
 * 没人喂），我把家具表喂上之后它第一次真的生效，挡掉 8 条：4 条是我自己问过的话（回声那道闸
 * 已经挡过），另 4 条是真记录——AI Engineering Skills Map、「我们这个 app 现在占用 1.8g」、
 * 万字拆解《热血高校1》、1st Half Challenge (~50km)。它本来要挡的「English (Great Britain)」
 * 反而没挡住。一条只做坏事的规则。（boilerplate 剥长网页的家具照旧，那是 chunk.textOf 的事。）
 *
 * 「问」那条路和搜索框用它挑材料；**图也用它挑节点**——这一点是后补的，代价量出来过：
 * 图里清单最长的五条全是 briffy 自己的截图。一张截图上正好显示着你的十几条记录，于是它
 * 和那十几条每一条都共用一个词，成了枢纽；「Dell ultrawide monitor」的八条相关里五条是它。
 */
function junkRecord(e) {
  if (!e) return true;
  const text = String(e.text || '');
  const head = String(e.title || '').trim();
  if (!head && !text.trim()) return true;
  if (e.context && e.context.self) return true;
  return !says(text) && !says(titleWorth(head));
}

/** 这段字里有没有够多的实字。数字、标点、时间戳不算。 */
function says(s) { return (String(s || '').match(/\p{L}/gu) || []).length >= THIN; }

/** 标题里能当内容的那部分：占位和文件名不算。 */
function titleWorth(head) {
  if (!head || title.isPlaceholder(head)) return '';
  const bare = head.replace(/\.[a-z0-9]{1,5}$/i, '');
  return /^[0-9a-f]{12,}$/i.test(bare) ? '' : bare;     // 文件名就是一串哈希
}

function junkFilter() {
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
    if (junkRecord(e)) return say(true);
    body.set(t, id);
    return say(false);
  };
}

function refresh({ budgetMs = SYNC_BUDGET_MS } = {}) {
  index.open(store.userData, store.workspaceDir);
  index.useVecModel(vector.MODEL);
  learnFurniture();
  // onDay：建一天索引的时候顺手把这一天的抬头词和地名收进表里（vocab 的甲那一遍）。
  // 这是唯一一处天然「一天只读一次」的地方，搁在别处就得再把全库读一遍。
  const r = index.sync({ dir: entriesDir(), loadDay: readDay, onDay: (_k, list) => { vocab.collect(index, list); vocab.collectPages(index, list); } }, { budgetMs });
  // 有天被重建过，页面图和词表视图都得跟着丢：词表视图按词缓存倒排，新记录抽出的词进不了
  // 已经缓存过的那些倒排——于是一条新记录的名字进不了追问的种子，直到重启。
  if (r && r.days) { graphCache = null; evIdx = null; corpusCache = null; }
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
  const room = KEEP;                  // 第二轮往后的名额
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
  let ids = [];
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

  // ③ **另外两条腿：按形状扫全库，和按词扫全库。** 见 shape.js 顶上那笔账。
  //
  // 索引这一路只会匹配**词**，而一条写着「Runnymede Pleasure Ground, Egham, Surrey TW20 0AE」
  // 的记录里没有「地址」这两个字——所以问地址的时候它一条也够不着。形状那一路补的正是这个：
  // 问地址就扫邮编，问几点就扫时刻，问多少钱就扫金额。认不出形状的问题（「screenpipe 是
  // 怎么采集的」）交给词面全扫，那一档它比索引强得多。
  //
  // 三条腿**按配额并**，谁也不许独占：形状最多占一半，索引留住前几条，全扫填满剩下的。
  // 二选一是不行的——量出来「推荐用哪个本地模型」里的「模型」会触发型号那一档，
  // 一个认错的形状就能把整份名额吃光。
  //
  // 台子在 dev/recall-arch-bench.js：14 个问题、33 条满分记录，36% → 91%，检索 702ms → 0ms。
  const pool = corpus();
  if (pool.length) {
    const words = index.termsOf(q).flatMap((t) => String(t.key || '').split(' '))
      .map((x) => x.toLowerCase()).filter((x) => x.length > 1);
    const sp = shape.shapeOf(q);
    // **这儿不能拿 seen 过滤。** 一条记录既被词面找到、又是很强的形状命中，是常态；
    // 拿 seen 把它从形状那一路划掉，它就只能去挤索引那 6 个名额，反而掉出去了——
    // 实测这一个字母的差别：停车 4/4 掉成 2/4，显示器 3/3 掉成 2/3。去重是 blend 自己的事。
    const usable = (id) => !echoed(id) && !drop(id);
    ids = shape.blend({
      found: ids,
      // 地址那一档用松的那个形状：真实记录里写的是「Buckingham Court, TW18」，只有前半段
      shapeHits: sp ? shape.scan(pool, sp === 'postcode' ? 'postcodeLoose' : sp, words).filter(usable) : [],
      scanHits: shape.scanWords(pool, words).filter(usable),
      keep: KEEP,
    });
  }

  // ④ **第四条腿：你没存但读过的那些网页。**
  //
  // 记录页是「你决定留下的」，路过那一层是「你没留、但确实经过的」。后者每天几十页原文
  // （实测中位数 559 字，是扩展在页面里读的 innerText，不是 OCR），而在 2026-09-09 之前
  // 它对这条路完全不存在——问「上周那篇讲市政条件的东西」，答案就在硬盘上，而这儿看不见。
  //
  // 它**不占前三条腿的名额**，另给一小把：那三条腿翻的是你自己的库，那才是这个产品的主语；
  // 路过是补一句「你还读过这个」。也不走 echoed / junkRecord 那两道闸——那两道认的是
  // 「记录」的形状（问过的话被复制回工作区、整条都是网页家具），网页正文不是那种东西。
  const trailHits = [];
  try {
    const words = index.termsOf(q).flatMap((t) => String(t.key || '').split(' '))
      .map((x) => x.toLowerCase()).filter((x) => x.length > 1);
    for (const p of trail.findPages(words, { limit: TRAIL_KEEP })) {
      trailHits.push({
        id: `trail:${p.day}:${p.at}`,
        type: 'trail',
        dateKey: p.day,
        createdAt: p.at,
        title: p.title || p.site || p.url,
        url: p.url,
        source: p.site,
        text: p.text,
      });
    }
  } catch (e) { console.warn('[ask] 路过那一层没读成', e.message); }

  const entries = ids.slice(0, KEEP - trailHits.length).map((id) => store.getEntry(id)).filter(Boolean)
    .concat(trailHits);

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
  const out = ids.filter((id) => !skip.has(id) && !echoed(id) && !drop(id));
  // 第三条腿：**同一页**。只走一跳，不扩散。
  //
  // 搜到了一页上的一条，那一页上另外几条本来就该跟着来。这条边说得出理由（是从哪一页摘的、
  // 那一页上还摘了哪几条），而且库大起来不会变差，向量会。
  //
  // 种子就是词面已经命中的那几条——调用方把它们当 exclude 传进来了，不用另外搜一遍。
  // 所以词面空手的时候这条腿也空手：它补的是「找到了一条，把同一处的另几条带上」，
  // 不是「什么都没找到，替我猜」。
  //
  // **「同一段操作」那条边不用**，试过。一段操作是连续抓下来的所有东西，实测一跳 49~53 条，
  // 从哔哩哔哩到剪贴板图片到显示器参数全在里面；而 links.js 交出来的 run.ids 是按那一段的
  // 先后排的，不是按离种子多远，所以取前几条等于取那一小时的开头。它在详情页那条清单里
  // 有意义（那儿按分数排过），在搜索结果里不是。
  const seeds = (exclude || []).slice(0, CHAIN_SEED);
  if (seeds.length) {
    const g = pageGraph();
    for (const seed of seeds) {
      let l; try { l = g.linksOf(seed); } catch (_) { continue; }
      const hop = [l.source && l.source.page, ...l.clips].filter(Boolean);
      for (const id of hop.slice(0, CHAIN_HOP)) {
        if (!skip.has(id) && !echoed(id) && !drop(id) && !out.includes(id)) out.push(id);
      }
    }
  }
  // 第四条腿：伪相关反馈。**只在词面完全空手的时候出手**——那正是跨语言那道坎所在的地方
  // （「停车」找不到 parking，「退款」找不到 refund）。词面有结果的时候不出手：它比这条腿准。
  if (!seeds.length && out.length < limit) {
    // 问向量的时候把查询垫成一句话。一个光秃秃的词不在这个模型见过的分布里，垫成句子能把
    // **同语种的引力**拆掉（实测中文噪声 0.704 → 0.356），「停车」这才够得到 Find parking。
    const guess = await vector.search(index, `关于${q}的记录`, { limit: RF_SEED, min: VEC_MIN, cacheDir: store.paths().models })
      .catch(() => []);
    const asked = new Set(index.termsOf(q).map((p) => p.key));
    const total = index.stats().entries || 1;
    const words = new Map();          // 词 -> {n: 在几条种子里出现, df}
    for (const id of guess) {
      const e = store.getEntry(id);
      if (!e) continue;
      const head = `${e.title || ''} ${e.text || ''}`.replace(/\s+/g, ' ').slice(0, RF_TEXT);
      const seen = new Set();         // 同一条种子里出现两次不算两条
      for (const p of index.termsOf(head)) {
        if (p.rareDf <= 0 || asked.has(p.key) || seen.has(p.key)) continue;
        if (p.rareDf / total > RF_DF) continue;
        seen.add(p.key);
        const w = words.get(p.key) || { n: 0, df: p.rareDf };
        w.n++;
        words.set(p.key, w);
      }
    }
    const pick = [...words.entries()].filter(([, w]) => w.n >= RF_MIN_SEEDS)
      .sort((a, b) => (b[1].n - a[1].n) || (a[1].df - b[1].df))
      .slice(0, RF_WORDS);
    for (const [w] of pick) {
      let hit = []; try { hit = index.search({ query: w, limit: RF_HITS }).ids; } catch (_) { hit = []; }
      for (const id of hit) {
        if (!skip.has(id) && !echoed(id) && !drop(id) && !out.includes(id)) out.push(id);
      }
    }
  }
  return out.slice(0, limit);
}

module.exports = { init, run, near, warm, refresh, junkRecord, MAX_ITEMS };
