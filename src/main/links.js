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
// A 和 B 共用一个词，B 和 C 共用另一个词。**边不是「像」，是「共用了哪个词」**，所以每条边
// 都拿得出证据。dev/evidence-chain-bench.js 在真实工作区上量过，从「Windsor Road, Egham
// TW20 0AE」到「报名成功」四跳走得通，每一跳的词都是真的：tw20/egham → runnymede →
// trailblazerz/50km/ultra → thames/path/challenge。而向量在这条链上全程 0.155。
//
// **不做全局连通分量。** 那条路量过：要把那 14 条连成一块，门槛得放到 df≤8，代价是
// 一个吃掉 70% 工作区的巨块。但界面要的从来不是「谁和谁在同一个分量里」，是
// 「**这一条**最强的几个证据邻居」——逐条排序，取前几名，那个巨块的账就不存在了。
// 排序按词的罕见程度：一个邮编比一个 the 值钱得多。
const EV_MAXDF = 40;      // 出现在这么多条以上的词是这个工作区的通用词汇，不算证据
const EV_NEEDDF = 14;     // 至少要有一个这么罕见的共用词，否则这条边不成立
// 中文的常用二字词天生比专名泛（呈现 / 方式 / 要求 / 通过 / 而且 / 一样），而它们在一个
// 两百多条的工作区里照样「只出现十来次」。所以汉字词要过更紧的一道——这和英文那边的道理
// 是同一个：df 量的是这个工作区里的罕见，不是这个词有没有意思。
const EV_NEEDDF_CJK = 7;
// 一条记录最多拿这么多个词当指纹，只留最罕见的那些。40 是扫出来的拐点：
//   24 太紧，一篇 5555 字的对话一条边都剩不下；
//   40 那条对话连到「你看看我最近要去一个走路的活动」（路线·补给·严格）和「我最近有个
//      walking 挑战」（报名），全对，平均每条 4.8 条边；
//   60 开始混进「门槛 → GPT6一出来」，90 之后是「清楚·保持·而且」这种纯噪声。
const EV_KEEP = 40;
const CJK_RE = /[㐀-䶿一-鿿]/u;
const EV_STOP = new Set(('the a an and or of to in on at for with from by is are was were be been am '
  + 'this that these those it its as if not no yes you your i my we our they them he she his her '
  + 'will would can could should may might must do does did done have has had get got go goes '
  + 'there here when where what which who how why all any some more most other than then also '
  + 'about into over under out up down off just now new see one two three hour hours '
  + 'day days time home half back only very much many such same page click here link'
  + ' 一个 这个 那个 可以 没有 就是 什么 我们 你们 他们 自己 已经 因为 所以 但是 如果 还是 这样 那样').split(/\s+/));

/**
 * 一条记录拿得出的证据词：专名、邮编、汉字词。
 *
 * 不要普通词。**在一个以中文为主的工作区里，英文虚词天生就「罕见」**——hour / should / there
 * 在两百多条里只出现两三次，于是它们通过任何 df 筛，把毫不相干的两晚焊在一起（实测抓到过：
 * 「Windsor Road ↕ hour ↕ 我半小时后到家」）。df 量的是这个工作区里的罕见，不是这个词有没有意思。
 */
// briffy 自己给的标题词，不是证据：「语音」「截图」「剪贴板图片」说的是格式，不是内容。
// 站点后缀同理（_bilibili）——它说的是你在哪个站，不是这条讲什么。
const EV_LABEL = new Set(['语音', '截图', '剪贴板', '剪贴板图片', '图片', 'screenshot', 'clipboard', 'audio', 'voice']);

/** 一条记录的抬头（标题 + 窗口标题 + 网址）里的词。@returns {Set<string>} */
function headWords(entry) {
  const e = entry || {};
  const c = e.context || {};
  const out = new Set();
  for (const t of segment([e.title, c.window, c.url, e.url].filter(Boolean).join(' '), '')) {
    if (t.wordLike) out.add(String(t.w).toLowerCase());
  }
  return out;
}

function evWords(entry, stripped) {
  const e = entry || {};
  const c = e.context || {};
  // 标题和窗口标题是这条记录**关于什么**，正文只是它**说了什么**。两者分开取，因为
  // 一个词值不值钱主要看它长在哪：「热血 · 万字 · 拆解」写在窗口标题上（那条视频叫什么），
  // 而「青年 · 所有 · 出来」是语音转写里飘出来的常用二字词——后者靠 df 拦不住，
  // 它们在这个工作区里确实只出现几次，于是一段 B 站转写和一张报名页被焊在了一起。
  const head = [e.title, c.window, c.url, e.url].filter(Boolean).join(' ');
  const body = String(stripped === undefined ? (e.text || '') : stripped).slice(0, 1500);
  const raw = `${head} ${body}`;
  const inHead = new Set();
  for (const t of segment(head, '')) if (t.wordLike) inHead.add(String(t.w).toLowerCase());
  // titled：**整个工作区里，有没有哪一条把这个词写在标题上。**
  //
  // 这是「工作区自己就是那本词典」的第三次用法（前两次是网址↔标题的别名、和家具的跨记录重复）。
  // 只看这一条自己的抬头是不够的：一张截图的内容全在 OCR 正文里，「车站」对它来说只在正文，
  // 于是「停 Staines 车站」和那几张截图之间的边会断掉。而「青年 / 所有 / 出来 / 了一」
  // 在两百多条记录里一次都没被谁写进标题——那才是它们和「车站」的真正区别，不是罕见程度。
  const titled = (this && this.titled) || null;
  const out = new Set();
  for (const t of segment(raw, '')) {
    if (!t.wordLike) continue;
    const w = String(t.w).toLowerCase();
    if (w.length < 2 || /^\d+$/.test(w) || EV_STOP.has(w)) continue;
    // 只在正文里出现的汉字词，得有三个字才算证据。两个字的中文词太廉价——
    // 「了一」甚至不是个词，是「当了一大批」被切出来的。抬头里的不受这条限制。
    if (EV_LABEL.has(w) || w.startsWith('_')) continue;
    if (CJK_RE.test(w) && w.length < 3 && !inHead.has(w) && !(titled && titled.has(w))) continue;
    if (/^[a-z]/.test(w)) {
      // 拉丁词只认专名（原文里首字母大写）和带数字的（TW18、0AE、50km）
      const proper = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, '').test(raw)
        && new RegExp(`\\b${w[0].toUpperCase()}${w.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(raw);
      if (!proper && !/\d/.test(w)) continue;
      if (w.length < 3) continue;
    }
    out.add(w);
    // Staines-upon-Thames 里的 thames 是这整件事唯一的桥，不拆就没有
    if (w.includes('-')) for (const p of w.split('-')) if (p.length >= 3 && !EV_STOP.has(p)) out.add(p);
  }
  return out;
}

/**
 * 整个工作区的证据词倒排。一次算好，之后每条记录只访问和它共用词的那些记录。
 * @returns {{post:Map<string,string[]>, df:Map<string,number>, words:Map<string,Set<string>>}}
 */
function evidenceIndex(entries, stripOf, { keep = EV_KEEP } = {}) {
  // 先过一遍抬头：这个工作区里，哪些词曾经被谁写在标题上
  const titled = new Set();
  for (const e of entries || []) for (const w of headWords(e)) titled.add(w);
  const ctx = { titled };

  const raw = new Map();
  const df = new Map();
  for (const e of entries || []) {
    if (!e || !e.id) continue;
    const s = evWords.call(ctx, e, stripOf ? stripOf(e) : undefined);
    raw.set(e.id, s);
    for (const w of s) df.set(w, (df.get(w) || 0) + 1);
  }
  // **一条记录只拿它最独特的那几个词当指纹。**
  // 不这么做，长散文会互相认亲：一条 5555 字的中文对话和另一条中文对话总能共用一堆
  // 呈现 / 方式 / 要求 / 通过——每个词都「只出现十来次」，凑够四个就压过了一个 50km。
  // 停用词表堵不住这个口子，中文的常用二字词是无穷无尽的；限量能，而且它对所有语言一视同仁。
  const words = new Map();
  const post = new Map();
  for (const [id, s] of raw) {
    const top = [...s].sort((a, b) => (df.get(a) || 0) - (df.get(b) || 0)).slice(0, keep);
    const set = new Set(top);
    words.set(id, set);
    for (const w of set) {
      if (!post.has(w)) post.set(w, []);
      post.get(w).push(id);
    }
  }
  return { post, df, words };
}

/**
 * 和这一条共用证据词最多的那几条，每条都带着它们共用的词。
 * @returns {{id:string, score:number, words:string[]}[]} 按强弱排
 */
function evidenceFor(id, idx, { limit = 6, maxDf = EV_MAXDF, needDf = EV_NEEDDF } = {}) {
  const mine = idx.words.get(String(id || ''));
  if (!mine) return [];
  const hit = new Map();
  for (const w of mine) {
    const n = idx.df.get(w) || 0;
    if (n < 2 || n > maxDf) continue;
    for (const other of idx.post.get(w) || []) {
      if (other === id) continue;
      if (!hit.has(other)) hit.set(other, []);
      hit.get(other).push(w);
    }
  }
  const out = [];
  for (const [other, ws] of hit) {
    // 至少要有一个够罕见的共用词。全是「maps」「details」「方式」这种，不算证据。
    const ok2 = ws.filter((w) => (idx.df.get(w) || 99) <= (CJK_RE.test(w) ? EV_NEEDDF_CJK : needDf));
    if (!ok2.length) continue;
    const bestDf = Math.min(...ok2.map((w) => idx.df.get(w) || 99));
    // **按最罕见的那一个词打分，不按几个词的和。** 用和的话，四个泛词（呈现·方式·要求·通过）
    // 会压过一个「50km」——而后者才是真正说明问题的那一个。词数只当同分时的先后。
    const score = 1 / Math.log2(2 + bestDf) + 0.05 * Math.min(ws.length, 6);
    out.push({ id: other, score, words: ws.sort((a, b) => (idx.df.get(a) || 0) - (idx.df.get(b) || 0)).slice(0, 4) });
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
  evWords, headWords, evidenceIndex, evidenceFor, EV_MAXDF, EV_NEEDDF, EV_KEEP,
  RUN_GAP_MS, MIN_KEY, MAX_CLIPS, SHELLS,
};
