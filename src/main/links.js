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
function linksOf(id, g) {
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
    const seen = new Set();
    for (const rid of run) {
      const k = g.pageOf.get(rid) || g.keyOf.get(rid);
      if (!k || seen.has(k) || !g.pages.has(k)) continue;
      seen.add(k);
      const p = g.pages.get(k);
      if (p.page !== me && k !== (g.keyOf.get(me) || '')) out.run.pages.push({ key: p.key, name: p.name, page: p.page });
    }
  }
  return out;
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
  RUN_GAP_MS, MIN_KEY, MAX_CLIPS, SHELLS,
};
