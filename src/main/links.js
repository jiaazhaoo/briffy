'use strict';
// 自动双链：记录之间的边，以及这些边各自的来路。
//
// 为什么不是「一个更好的相似度」。dev/thames-link-probe.js 在真实工作区上量过一次，结论很硬：
// 「Windsor Road, Egham TW20 0AE」和它所属的那场徒步，向量相似度 0.155——而 0.4 上下就已经是
// 瞎猜。门槛降到 0.30 连上 0/8，降到 0.20 连上 3/8，代价是每条记录连到全工作区 236 条里的 126 条。
// 把窗口标题也喂进向量再量一次（dev/window-title-bench.js）：7 条里 5 条变近，最多 +0.09，
// **0 条过线**。Egham 在泰晤士河步道上是地理常识，不是一个 128-token 小模型带得动的东西。
//
// 而那三条停车记录的 context.window 是「赛程分前后半程 - Claude」——**和同一小时里那条书签的
// 标题一字不差**。关系一直写在记录里。这是「相等」，不是「相似」，而 embedding 恰恰是唯一一种
// 专门把字符串碾成近似含义、从而销毁精确匹配的工具。
//
// 所以这里只有一条规则，用三次：
//
//   **一条边只在能说出它的证据时才存在，而证据永远不合成一个数。**
//
//   同一处  页面 ↔ 从它上面摘下来的记录   按 key 分组      精确，无阈值无模型
//   同一程  页面 ↔ 页面                  时间上一遍扫     结构性，会捞进不相干的
//   同一件事 记录 ↔ 记录                  向量（在 ask.js 里合流）  ≥0.70 才算数
//
// 前两种根本不是算法，是 join 和一维分段——它们精确、便宜、可解释，正因为它们不是相似度。
// 这个文件里没有向量，也没有模型：纯函数，node 直接跑得起来（见 dev/links-test.js）。
//
// 都不落库。和 vector.js 的那个决定一样：存下来只会多一个会过期的东西，而这两种边
// 在一百八十万条上仍然是一张哈希表和一遍扫。

// 窗口标题里会动的那些东西（Terminal 的转圈、窗口尺寸、未读数）。这套归一化是「路过」那边
// 为同一个毛病写的，直接借过来——不借的话，同一个终端窗口会因为一个转圈字符裂成四个「页面」
// （实测：✳ ◑ ◐ 三种转圈把一个窗口拆成 10 + 8 + 5 + 4 条）。
const { tidyTitle } = require('./trail');
const { segment } = require('./segment');
const entity = require('./entity');

const RUN_GAP_MS = 15 * 60 * 1000;   // 隔这么久没动，就是另一段操作了
const MIN_KEY = 4;                   // 短于这么多字的标题不算页面身份
const MAX_CLIPS = 60;                // 一个 key 底下这么多条，它就不是一页，是一个应用外壳

// 浏览器往标题上加的前缀。真实数据里出现过 “Find in page 2026年泰晤士河步道超级马拉松挑战赛”，
// 它和 “2026年泰晤士河步道超级马拉松挑战赛” 是同一页。
const TITLE_NOISE = /^(find in page|在页面中查找)\s+/i;

// 这些是应用外壳的名字，不是某一页。等于当前应用名的也一样（Chrome 的窗口标题偶尔就是 “Google Chrome”）。
const SHELLS = new Set([
  'google chrome', 'chrome', 'safari', 'firefox', 'arc', 'microsoft edge',
  'claude', 'chatgpt', 'wechat', '微信', 'terminal', 'iterm2', 'finder',
  'new tab', '新标签页', 'untitled', '无标题',
  // 网页版应用的外壳名：一个标题底下是无数个不同的页面。有 url 的时候这一条不需要，
  // 每张地图、每封邮件的网址都是不同的——这几个是标题这条降级路上的补丁。
  'google maps', '谷歌地图', 'google translate', 'gmail', 'notion', 'youtube', 'x', 'facebook',
]);

const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** 同一页的两个网址应该算同一个 key：去掉锚点和末尾斜杠，其余照留（查询串常常就是这一页的身份）。 */
function normUrl(u) {
  const s = one(u);
  if (!/^https?:\/\//i.test(s)) return '';
  return s.split('#')[0].replace(/\/+$/, '');
}

/** 标题这一路要过三道：不是浏览器加的噪声前缀、不是外壳名、够长。@returns {string} */
function titleKey(raw, app) {
  const title = one(tidyTitle(raw)).replace(TITLE_NOISE, '');
  if (title.length < MIN_KEY) return '';
  const low = title.toLowerCase();
  if (SHELLS.has(low)) return '';
  if (app && low === one(app).toLowerCase()) return '';
  return title;
}

/**
 * 这条记录是从哪一页拿下来的——**两个身份都要**。
 *
 * url 才是身份，标题只是 url 缺席时的降级方案（标题会变，同一页在真实数据里出现过两个版本）。
 * 但两个都收着还有第二个用处：一条同时带着网址和标题的记录，就是一份「这个网址等于这个标题」
 * 的证词。没有它，同一页会裂成两个节点——书签按网址挂一个，剪贴板按标题挂另一个。
 * @returns {string[]} 拿不准就是空数组——**宁可没有边，也不要一条错的边**
 */
function pageKeysOf(entry) {
  const c = (entry || {}).context || {};
  return [normUrl(c.url), titleKey(c.window, c.app)].filter(Boolean);
}

/** 这条记录**本身**就是某一页（你收藏了它）。同样两个身份都给。 @returns {string[]} */
function pageIdentityOf(entry) {
  const e = entry || {};
  return [normUrl(e.url), titleKey(e.title, '')].filter(Boolean);
}

/** url 和标题指着同一页时把它们并到一起。并的是**同一页的别名**，不是「像」——不会串联。 */
function aliases() {
  const up = new Map();
  const find = (k) => { let r = k; while (up.get(r) && up.get(r) !== r) r = up.get(r); return r; };
  return {
    add(keys) {
      for (const k of keys) if (!up.has(k)) up.set(k, k);
      for (let i = 1; i < keys.length; i++) {
        const a = find(keys[0]); const b = find(keys[i]);
        // 网址当代表：它是真身份，标题只是它的一个说法
        if (a !== b) up.set(/^https?:/i.test(b) ? a : b, /^https?:/i.test(b) ? b : a);
      }
    },
    of: (k) => (up.has(k) ? find(k) : k),
  };
}

/**
 * 把整个工作区算成一张图。纯函数，每次现算。
 *
 * @param {object[]} entries 全部记录，顺序无所谓（里面自己按时间排）
 * @param {{gapMs?:number, maxClips?:number}} [opts]
 * @returns {{pages:Map<string,{key:string,name:string,page:string,clips:string[]}>,
 *            keyOf:Map<string,string>, pageOf:Map<string,string>, runs:string[][]}}
 */
function build(entries, { gapMs = RUN_GAP_MS, maxClips = MAX_CLIPS } = {}) {
  const list = (entries || []).filter(Boolean)
    .slice()
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

  // ── 一遍：谁和谁是同一页的两个说法。一条记录同时带着网址和标题，就是一份证词。
  const alias = aliases();
  for (const e of list) { alias.add(pageKeysOf(e)); alias.add(pageIdentityOf(e)); }

  // ── 二遍：同一处。按 key 分组，网址优先，标题是它缺席时的说法。
  const pages = new Map();
  const keyOf = new Map();
  const at = (key) => {
    if (!pages.has(key)) pages.set(key, { key, name: key, page: '', clips: [] });
    return pages.get(key);
  };
  for (const e of list) {
    const ks = pageKeysOf(e);
    if (!ks.length) continue;
    const k = alias.of(ks[0]);
    keyOf.set(e.id, k);
    at(k).clips.push(e.id);
    // 名字要人读得懂：有标题就用标题，别拿网址当名字
    const readable = ks.find((x) => !/^https?:/i.test(x));
    if (readable && /^https?:/i.test(pages.get(k).name)) pages.get(k).name = readable;
  }
  // 一个 key 底下攒了太多条，说明它是个外壳（“Google Maps”“Claude”），不是一页。
  // 整组丢掉，不是截断——半张图比没有图更容易骗人。
  for (const [k, p] of [...pages]) {
    if (p.clips.length > maxClips) {
      pages.delete(k);
      for (const id of p.clips) keyOf.delete(id);
    }
  }

  // ── 三遍：哪条记录**就是**那一页。收藏了那一页，书签就是这个节点本身，不是它的兄弟。
  const pageOf = new Map();
  for (const e of list) {
    for (const raw of pageIdentityOf(e)) {
      const k = alias.of(raw);
      const p = pages.get(k);
      if (!p || p.page) continue;
      // 「它就是这一页」和「它是从这一页摘的」不冲突——你收藏的正是你当时待着的那一页，
      // 两个身份指同一个 key 恰恰是最强的证据。摘录不会误判成页面：它自己的标题不是这一页的 key。
      p.page = e.id;
      p.name = one(e.title) || p.name;
      pageOf.set(e.id, k);
      break;
    }
  }
  // 页面自己那条记录不算它的摘录
  for (const p of pages.values()) p.clips = p.clips.filter((id) => id !== p.page);

  // ── 四遍：同一程。时间上一遍扫，隔太久就断开。
  const runs = [];
  let cur = null;
  let prev = 0;
  for (const e of list) {
    const t = Date.parse(e.createdAt || '') || 0;
    if (!cur || (prev && t - prev > gapMs)) { cur = []; runs.push(cur); }
    cur.push(e.id);
    prev = t;
  }
  return { pages, keyOf, pageOf, runs };
}

/**
 * 一条记录身上挂着的那几种边。
 *
 * @returns {{source:{key:string,name:string,page:string}|null, clips:string[],
 *            run:{ids:string[], pages:{key:string,name:string,page:string}[]}}}
 *   source 反向：这条是从哪一页摘的 · clips 正向：这一页上摘了哪几条 · run：同一段操作里还有什么
 */
function linksOf(id, g, { runLimit = 6 } = {}) {
  const me = String(id || '');
  const out = { source: null, clips: [], run: { ids: [], pages: [] } };

  const fromKey = g.keyOf.get(me);
  if (fromKey && g.pages.has(fromKey)) {
    const p = g.pages.get(fromKey);
    if (p.page !== me) out.source = { key: p.key, name: p.name, page: p.page };
  }
  const iAm = g.pageOf.get(me);
  if (iAm && g.pages.has(iAm)) out.clips = g.pages.get(iAm).clips.slice();

  const run = g.runs.find((r) => r.includes(me));
  if (run) {
    out.run.ids = run.filter((x) => x !== me);
    const mine = run.indexOf(me);
    const seen = new Map();
    for (let i = 0; i < run.length; i++) {
      const k = g.pageOf.get(run[i]) || g.keyOf.get(run[i]);
      if (!k || seen.has(k) || !g.pages.has(k)) continue;
      const p = g.pages.get(k);
      if (p.page === me || k === (g.keyOf.get(me) || '')) continue;
      // first：那一页你多半**没有存下来**（实测 24 页里只有 1 页存了），所以还得给一条它上面的
      // 摘录当代表——不然「同一程」永远是空的，一个永远空着的分组等于没有这条边。
      seen.set(k, { key: p.key, name: p.name, page: p.page, first: p.page || p.clips[0] || '', d: Math.abs(i - mine) });
    }
    // 按「离这一条多远」排，不按那一段的先后：一段操作有五十条、十几页，从头列起给你的是
    // 那一小时的开头，而你想知道的是**紧挨着这条的前后**你在干什么。
    out.run.pages = [...seen.values()].sort((a, b) => a.d - b.d).slice(0, runLimit)
      .map(({ d, ...p }) => p);
  }
  return out;
}

// ───────────────────────── 同一个词 ─────────────────────────
//
// A 和 B 共用一个词。**边不是「像」，是「共用了哪个词」**——所以每条边都拿得出一对词，
// 而那一对词就写在线上。dev/evidence-chain-bench.js 在真实工作区上量过，从「Windsor Road,
// Egham TW20 0AE」到「报名成功」四跳走得通，每一跳的词都是真的；而向量在这条链上全程 0.155。
//
// 词表用 entity.js 抽（邮编、日期、距离、专名、汉字词，滤掉网页家具和虚词）。
// **实体不是节点**——节点只能是卡片；它只是这条边的依据。
//
// 两种配对：
//   完全一致  tw20 ↔ tw20
//   模糊一致  泰晤士河 ↔ thames（同一条记录里并排出现过，工作区自己就是那本对照表）
//             staines-upon-thames ↔ thames（一个包着另一个）
// 后者是量出来的：泰晤士河出现 3 次，3 次都和 thames 并排；tw20 出现 4 次，4 次都和 egham 并排；
// 而三个对照组是 0 次（dev/evidence-alias-bench.js）。词向量在这一档反而不行——
// 泰晤士河↔thames 只有 0.503，而「两个不同的地方」runnymede↔egham 是 0.459，分不开。
const EV_MAXDF = 40;      // 出现在这么多条以上的词是这个工作区的通用词汇，不算证据
const EV_NEEDDF = 14;     // 至少要有一个这么罕见的共用词，否则这条边不成立
// **试过「只对上一个词的边，那个词得 df ≤ 5」，撤了。** 起因是清单上一半的错都是单个泛词
// （High、London、Gmail、全部）。可一刀切下去，Dell（df 6）那件事整个没了（走得通 67% → 8%），
// 停车申诉那几条也断了（那一晚 97% → 87%）。泛词的问题是泛词本身——站点名进 CHROME、
// 「全部」进 STOP、briffy 自己的截图不再教词表什么是抬头词——不是「一个词」的问题。
const EV_KEEP = 20;       // 一条记录最多拿这么多个词当指纹，只留最罕见的
// 两个词的倒排重合到这个份上，就当它们说的是同一件事（一个地名被切成了好几段）
const FACET_SAME = 0.8;
// 试过给地名/邮编/日期在算罕见度时打折（让「共用一个 Runnymede」重过「共用一个『不能』」），
// **不成，反而更差**：这个工作区里 81 个词沾着邮编，一打折，一大批只是碰巧提到 Staines /
// Kingston 的记录全挤了上来，本来排 38 的那条直接挤没了。
// 记在这儿免得再试一遍：边的权重不是这条路的解，靠查询把那个词直接问出来才是（见 ask.namesIn）。
const ALIAS_MIN = 2;      // 两个词一起出现过这么多次，才算一份对照
const ALIAS_RATIO = 0.8;  // 而且要几乎总是一起出现

/**
 * 整个工作区的词表 + 配对。一次算好，之后每条记录只访问和它共用词的那几条。
 * @param {object[]} entries
 * @param {(e:object)=>string} [stripOf] 剥过家具的正文
 * @returns {{post:Map, df:Map, words:Map, text:Map, kind:Map, alias:Map}}
 */
function evidenceIndex(entries, stripOf, { keep = EV_KEEP } = {}) {
  const ix = entity.index(entries, stripOf);
  const df = new Map();
  const text = new Map();
  const kind = new Map();
  for (const [k, x] of ix.ents) { df.set(k, x.records.length); text.set(k, x.text); kind.set(k, x.kind); }

  // 一条记录只拿它最独特的那几个词当指纹：不这么做，两篇长文总能共用一堆泛词
  const words = new Map();
  const post = new Map();
  for (const [id, keys] of ix.byRecord) {
    const top = keys.slice().sort((a, b) => (df.get(a) || 0) - (df.get(b) || 0)).slice(0, keep);
    words.set(id, new Set(top));
    for (const k of top) {
      if (!post.has(k)) post.set(k, []);
      post.get(k).push(id);
    }
  }

  // ── 模糊配对：谁和谁是同一样东西的两个说法
  const alias = new Map();      // key -> Set(key)
  const link = (a, b) => {
    if (a === b) return;
    if (!alias.has(a)) alias.set(a, new Set());
    if (!alias.has(b)) alias.set(b, new Set());
    alias.get(a).add(b); alias.get(b).add(a);
  };
  const keys = [...text.keys()];
  // 一个包着另一个：staines-upon-thames ⊃ thames、thames path ⊃ thames。
  // **长的那个得是复合词**（带连字符、空格或数字）。不加这一条，英文的词形变化全成了别名：
  // visitors ⊃ visit、registration ⊃ registr…，实测「Visit ≈ Visitors」把 Ultra Challenge
  // 连到了一条毫不相干的记事。
  for (const a of keys) {
    const ta = String(text.get(a)).toLowerCase();
    if (ta.length < 8 || !/[a-z]/.test(ta) || !/[^a-z]/.test(ta)) continue;
    for (const b of keys) {
      const tb = String(text.get(b)).toLowerCase();
      if (tb.length < 4 || tb.length >= ta.length || !ta.includes(tb)) continue;
      link(a, b);
    }
  }
  // 并排出现过：泰晤士河 和 Thames 在同一条记录的**抬头**里挨着。
  //
  // **只看抬头，不看正文。** 建在全文同现上的时候抓到过「车站 ≈ Airports」——两个词只是碰巧
  // 出现在同一张截图的 OCR 里。而真正的对照是并排写出来的：那个标题
  // 「2026年泰晤士河步道超级马拉松挑战赛 --- Thames Path Ultra Challenge 2026」
  // 一行里中英文都有，一条记录顶一部词典。
  const together = new Map();
  const headSets = (entries || []).map((e) => {
    const set = new Set();
    for (const x of entity.of({ title: e.title, url: e.url, context: e.context }, '')) {
      if (text.has(x.key)) set.add(x.key);
    }
    return set;
  });
  for (const set of headSets) {
    const list = [...set];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const k = list[i] < list[j] ? `${list[i]}\u0000${list[j]}` : `${list[j]}\u0000${list[i]}`;
        together.set(k, (together.get(k) || 0) + 1);
      }
    }
  }
  for (const [k, n] of together) {
    if (n < ALIAS_MIN) continue;
    const [a, b] = k.split('\u0000');
    // 中文对英文才算「同一样东西的两个说法」；两个英文词一起出现只是它们常同框
    const cjkA = /[㐀-䶿一-鿿]/u.test(text.get(a) || '');
    const cjkB = /[㐀-䶿一-鿿]/u.test(text.get(b) || '');
    if (cjkA === cjkB) continue;
    if (n < Math.min(df.get(a) || 1, df.get(b) || 1) * ALIAS_RATIO) continue;
    link(a, b);
  }
  return { post, df, words, text, kind, alias };
}

/**
 * 和这一条共用词的那几条，每条带着**那一对词**——线上写的就是它。
 * @returns {{id:string, score:number, pairs:{a:string,b:string,fuzzy:boolean}[]}[]}
 */
/**
 * 这几对词其实说的是几件事。
 *
 * 判据不用词表：**总是一起出现的词是一件事**。倒排一样（或几乎一样）的两个词，
 * 无论是「Bishops / Park / Fulham」还是「Ultra / Challenge」，都只算一份证据。
 * 这和 alias 那一段用的是同一个观察，只是这里用来算分，那里用来配对。
 */
function facets(ps, idx) {
  const sigs = [];
  for (const key of new Set(ps.map((p) => p.a))) {
    const post = idx.post.get(key) || [];
    if (!post.length) continue;
    const set = new Set(post);
    // 和已经数过的某一件事几乎同现，就并进去，不另算一件
    const same = sigs.find((s2) => {
      let both = 0;
      for (const x of set) if (s2.has(x)) both++;
      return both >= Math.min(set.size, s2.size) * FACET_SAME;
    });
    if (!same) sigs.push(set);
  }
  return sigs.length || 1;
}

// 返回里带着 df（最罕见那一对的 df）。**别让调用方从 score 反推回去**：score 里掺了 facets
// 那一小截加分，反推出来的是 log2(2+df) 不是 df，再被 story.wordWeight 又取一次对数，
// 权重区间就从 0.675~0.538 挤成 0.675~0.613——一个 df=3 的虚词和一个 df=14 的泛称
// 就此分不出来。实测那一片里第 6 到第 21 名全挤在 0.55~0.58，而真正该排上来的那条在第 38。
function evidenceFor(id, idx, { limit = 6, maxDf = EV_MAXDF, needDf = EV_NEEDDF } = {}) {
  const mine = idx.words.get(String(id || ''));
  if (!mine) return [];
  const hit = new Map();
  const meet = (other, a, b, fuzzy) => {
    if (other === id) return;
    if (!hit.has(other)) hit.set(other, []);
    hit.get(other).push({ a, b, fuzzy });
  };
  for (const k of mine) {
    const n = idx.df.get(k) || 0;
    if (n < 2 || n > maxDf) continue;
    for (const other of idx.post.get(k) || []) meet(other, k, k, false);
    for (const k2 of idx.alias.get(k) || []) {
      const n2 = idx.df.get(k2) || 0;
      if (n2 < 1 || n2 > maxDf) continue;
      for (const other of idx.post.get(k2) || []) meet(other, k, k2, true);
    }
  }
  const out = [];
  for (const [other, ps] of hit) {
    const best = Math.min(...ps.map((p) => idx.df.get(p.a) || 99));
    if (best > needDf) continue;
    // **按最罕见的那一对打分，不按几对的和**：四对泛词不该压过一个 50km。
    // 后面那一小截是「对得上好几处」的加分，而它按**几件事**算，不按几个词算——
    // 「Bishops Park, Fulham」被切成三个词，三个词的倒排几乎一模一样（它们本来就是一个地名），
    // 按词算就成了三份证据，0.05×3 把它抬到 0.506；而共用一个 Runnymede 只有 0.383。
    // 于是那条写着起点和终点的记录，反倒够不到写着终点地址的那一条。同现的词是一件事，不是三件。
    const f = facets(ps, idx);
    const score = 1 / Math.log2(2 + best) + 0.05 * Math.min(f, 6);
    const seen = new Set();
    const pairs = ps
      .sort((x, y) => (idx.df.get(x.a) || 0) - (idx.df.get(y.a) || 0))
      .filter((p) => { const k = `${p.a}|${p.b}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 3)
      .map((p) => ({ a: idx.text.get(p.a) || '', b: idx.text.get(p.b) || '', fuzzy: p.fuzzy,
        k: (idx.kind && idx.kind.get(p.a)) || 'name', df: idx.df.get(p.a) || 0 }));
    out.push({ id: other, score, df: best, facets: f, pairs });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * 一段操作里，你依次经过的那几页。图谱里「同一程」那条链就是它。
 * @returns {{key:string,name:string,page:string,at:string}[]}
 */
function chainOf(runIds, g, getEntry) {
  const out = [];
  const seen = new Set();
  for (const id of runIds) {
    const k = g.pageOf.get(id) || g.keyOf.get(id);
    if (!k || seen.has(k) || !g.pages.has(k)) continue;
    seen.add(k);
    const p = g.pages.get(k);
    out.push({ key: p.key, name: p.name, page: p.page, at: String((getEntry(id) || {}).createdAt || '') });
  }
  return out;
}

module.exports = {
  build, linksOf, chainOf, pageKeysOf, pageIdentityOf, normUrl, titleKey,
  evidenceIndex, evidenceFor, EV_MAXDF, EV_NEEDDF, EV_KEEP,
  RUN_GAP_MS, MIN_KEY, MAX_CLIPS, SHELLS,
};
