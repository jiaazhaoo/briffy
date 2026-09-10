'use strict';
// 一条记录**是什么**：怎么进来的、是什么格式、从哪儿来、落在哪一格纸上。
//
// 从 store.js 里搬出来的（2026-09-10），一个字没改。搬的理由是**它要有第二个用户**：
// mcp/briffy-mcp.js 让别的 agent（Claude Code、Codex）读这个工作区，而它是**独立进程、
// 不依赖应用**——直接读盘上的文件，briffy 开着关着都能答。它没法 require store.js：
// store.js 的 paths() 会问 electron 要 userData，而 MCP 服务器跑在纯 node 里。
//
// 于是只有两条路：让 MCP 抄一份判据，或者把判据拿出来。抄一份就会漂——今天刚为这件事
// 修过一次（「筛」和「数」两段代码各走各的，筛选行写 203、屏上摆 19）。所以拿出来。
//
// **这里面一个 fs、一个 electron 都不许有。** 它得在纯 node 里 require 得动，这是它存在的前提。

// Which capture route an entry came in through. `type` alone cannot say it: a clipboard copy can be
// text, an image or files, and a page grab arrives as images too -- what differs is where it came from.
const SOURCES = ['screenshot', 'clipboard', 'bookmark', 'browser', 'voice', 'other'];
function entrySource(e) {
  if (!e) return 'other';
  if (e.origin === 'clipboard') return 'clipboard';
  if (e.origin === 'bookmark') return 'bookmark';
  if (e.origin === 'browser') return 'browser';
  if (e.origin === 'notion') return 'notion';
  if (e.origin === 'gmail') return 'gmail';
  if (e.type === 'screenshot') return 'screenshot';
  if (e.type === 'audio') return 'voice';
  return 'other';
}

// 站点名。域名本身当标签太长也太技术（space.bilibili.com），而这几个是中文用户天天用的，
// 名字对不上就等于没有这个筛选。表很小，认不出来的就用域名，够用。
const SITES = {
  'xiaohongshu.com': '小红书', 'bilibili.com': '哔哩哔哩', 'weibo.com': '微博', 'zhihu.com': '知乎',
  'douyin.com': '抖音', 'instagram.com': 'Instagram', 'x.com': 'X', 'twitter.com': 'X',
  'youtube.com': 'YouTube', 'github.com': 'GitHub', 'reddit.com': 'Reddit',
  'facebook.com': 'Facebook', 'zoom.us': 'Zoom', 'notion.so': 'Notion', 'claude.ai': 'Claude',
  'mail.google.com': 'Gmail', 'docs.google.com': 'Google Docs',
  // 媒体 CDN。复制一张图或者一段视频，拿到的网址常常落在这些域上——它们不是另一个站，
  // 是同一个站放东西的地方。不认的话来源栏里就会多出一堆没人认得的机器名。
  'bilivideo.com': '哔哩哔哩', 'hdslb.com': '哔哩哔哩',
  'xhscdn.com': '小红书', 'twimg.com': 'X', 'fbcdn.net': 'Facebook',
  'sinaimg.cn': '微博', 'zhimg.com': '知乎', 'ytimg.com': 'YouTube',
  'githubusercontent.com': 'GitHub', 'googleusercontent.com': 'Google',
};
// 「最后两段就是域名」在多级后缀上是错的：ukpcappeals.co.uk 会被算成 co.uk。
// 不引公共后缀表（那是一份几千行、还会过期的清单），只认这一小撮二级后缀——它是个有限的集合，
// 而且认错的代价只是名字长一点，不是把两个站并成一个。
const SLD = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'in']);
function baseHost(h) {
  const p = String(h || '').split('.');
  if (p.length <= 2) return p.join('.');
  return (SLD.has(p[p.length - 2]) ? p.slice(-3) : p.slice(-2)).join('.');
}

function siteOf(url) {
  try {
    const h = new URL(String(url)).hostname.replace(/^www\./, '');
    if (SITES[h]) return SITES[h];
    const base = baseHost(h);
    // **退到域名，不退到整个主机名。** 原来认不出就把主机名整个端出来，于是
    // 「upos-sz-mirrorcosov.bilivideo.com」在来源那一栏里自成一格，还把整行撑到换行——
    // 而它只是 B 站放视频的一台机器。子域说明的是「站里的哪一块」，不是「哪个站」。
    return SITES[base] || base;
  } catch (_) { return ''; }
}

// 按**格式**分，不是按「怎么进来的」分。截图和从网页存下来的图都是图片；一条随手记和一封邮件
// 都是文字。「怎么进来的」是另一个维度（entryOrigin），两件事混在一格里就都说不清了。
// mime 是现成的，工作区里 213 条只有 4 条没有；没有的用扩展名兜底。
const FORMAT = [
  [/^image\//, 'image'], [/^audio\//, 'audio'], [/^video\//, 'video'],
  [/pdf/, 'pdf'],
  [/(msword|wordprocessingml|opendocument\.text|rtf)/, 'doc'],
  [/(excel|spreadsheetml|opendocument\.spreadsheet|csv)/, 'sheet'],
  [/(powerpoint|presentationml|opendocument\.presentation)/, 'slides'],
  [/(zip|x-tar|gzip|x-7z|x-rar)/, 'archive'],
  [/uri-list/, 'link'],
  [/^text\//, 'text'],
];
const EXT_FORMAT = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image', '.heic': 'image', '.svg': 'image',
  '.mp3': 'audio', '.wav': 'audio', '.m4a': 'audio', '.webm': 'audio', '.aac': 'audio', '.flac': 'audio',
  '.mp4': 'video', '.mov': 'video', '.mkv': 'video', '.avi': 'video',
  '.pdf': 'pdf', '.doc': 'doc', '.docx': 'doc', '.rtf': 'doc', '.pages': 'doc',
  '.xls': 'sheet', '.xlsx': 'sheet', '.csv': 'sheet', '.numbers': 'sheet',
  '.ppt': 'slides', '.pptx': 'slides', '.key': 'slides',
  '.zip': 'archive', '.tar': 'archive', '.gz': 'archive', '.7z': 'archive', '.rar': 'archive',
  '.txt': 'text', '.md': 'text', '.json': 'text', '.html': 'text',
};

// 浏览器把站名写在窗口标题里：「… - 小红书」「…_哔哩哔哩_bilibili」。没拿到网址的时候，
// 这是唯一还剩下的线索，而且它对 Safari、Firefox 也成立——扩展只在 Chrome 里跑。
// 只认**已知的站名**，不去猜标题的结构：「最后一段是站名」这种规则一遇到「- Google Chrome」
// 「– Audio playing」就会给出垃圾。实测这一条能救回 34 条浏览器记录里的 13 条。
const BROWSER_APP = /chrome|safari|firefox|edge|arc|brave|vivaldi|opera|comet/i;
const SITE_NAMES = [
  ['小红书', '小红书'], ['哔哩哔哩', '哔哩哔哩'], ['bilibili', '哔哩哔哩'], ['知乎', '知乎'], ['微博', '微博'],
  ['抖音', '抖音'], ['youtube', 'YouTube'], ['github', 'GitHub'], ['reddit', 'Reddit'],
  ['instagram', 'Instagram'], ['facebook', 'Facebook'], ['zoom', 'Zoom'], ['notion', 'Notion'],
  ['twitter', 'X'], ['wikipedia', 'Wikipedia'], ['gmail', 'Gmail'], ['淘宝', '淘宝'], ['京东', '京东'],
];
function siteInTitle(title) {
  const w = String(title || '').toLowerCase();
  if (!w) return '';
  for (const [needle, name] of SITE_NAMES) if (w.includes(needle)) return name;
  return '';
}

/** @returns {string} image / text / audio / video / pdf / doc / sheet / slides / archive / link / other */
function entryFormat(e) {
  if (!e) return 'other';
  const mime = String(e.mime || '').split(';')[0].toLowerCase();
  for (const [re, k] of FORMAT) if (re.test(mime)) return k;
  const p = String(e.path || e.originalPath || e.title || '').toLowerCase();
  const dot = p.lastIndexOf('.');
  if (dot > 0) { const k = EXT_FORMAT[p.slice(dot)]; if (k) return k; }
  if (e.type === 'note') return 'text';
  if (e.type === 'url') return 'link';
  return 'other';
}

/**
 * 这条记录**是从哪儿来的**：
 *   站点   有网址就用站点名（小红书、哔哩哔哩、GitHub）
 *   站点   没网址但浏览器把站名写在了窗口标题里
 *   应用   不是浏览器，就用应用名（Claude、Terminal、WeChat）
 *   '?'    以上都不知道
 *
 * **不知道就说不知道，不退回「剪贴板」「截图」。** 那两个是 entrySource 答的另一个问题——
 * 「怎么进来的」。拿它去当「从哪儿来的」的答案是循环的：一张截图的来源是「截图」，等于没说，
 * 而且它会变成这一格里最大的一块（103/213），把真正的站名全压下去。
 *
 * 一格「未知」看着难看，但它是真的：按天量，功能完全生效那天（09-07）真有来源的是 94%，
 * 09-06 是 58%（当天中途才开始记），09-05 是 21%（那时还没有这个功能）。尾巴很小，
 * 而且看得见它才会有人去把它修小。
 */
const UNKNOWN = '?';
function entryOrigin(e) {
  if (!e) return UNKNOWN;
  const c = e.context || {};
  const site = siteOf(e.url || c.url || '');
  if (site) return site;
  const app = String(c.app || '').trim();
  // 浏览器只说明「是个网页」，说不出是哪个站。网址没拿到的时候，窗口标题里往往还写着站名。
  if (BROWSER_APP.test(app)) return siteInTitle(c.window) || UNKNOWN;   // 「Chrome」说不出是哪个站
  return app || UNKNOWN;
}

// ---------- 两级筛选 ----------
//
// **一级就是屏幕上那五种纸**（workspace.js 的 cardKind）：撕下来的碎片、拍立得、索引卡、
// 磁带、有装订孔的纸。这是 2026-09-09 用户定的分法，也是前五版一直没找对的那个轴——
// 之前筛的是「格式」（文字 / 图片 / 链接），而格式和眼睛看到的东西对不上：一张从剪贴板来的图
// 和一张截图都算「图片」，可它们在屏幕上长得完全不一样，也根本不是同一件事。
//
// **五格互斥、全覆盖**：每条记录落在且只落在一格里，所以五个数加起来一定等于全库。
// 「文件」是兜底那一格——认不出来的东西有个家，不会有哪条记录谁也筛不到。
const BUCKETS = ['clip', 'shot', 'saved', 'file', 'voice'];
function entryBucket(e) {
  if (!e) return 'file';
  // 你亲手留下的：收藏（pinned）、从浏览器书签抓进来的、扩展在网页上存的。
  // pinned 至今一条都没有（2026-09-09 量的：331 条里 0 条），并进这一格它才第一次有内容。
  if (e.pinned) return 'saved';
  const s = entrySource(e);
  if (s === 'bookmark' || s === 'browser') return 'saved';
  if (s === 'clipboard') return 'clip';
  if (s === 'screenshot') return 'shot';
  if (s === 'voice') return 'voice';
  return 'file';                  // 拖进来的，以及任何认不出的——兜底，不留孤儿
}

/**
 * 拖进来的东西是什么类型：**用真的扩展名**。
 *
 * 不用 entryFormat 那张表，因为拖进来的可以是任何东西——.sketch、.csv、.heic、.key、.dmg——
 * 而那张表只有 11 项，它们会全被归进「其它」，于是「文件」那一格的二级永远只有两三个词，
 * 其中一个还叫「其它」。**这一格的值是开集，得跟着库里真有什么长。**
 * 没有扩展名的（拖进来的一条网址）退回格式，那时它是「链接」。
 * @returns {string} 大写的扩展名（PDF、DOCX、ZIP），或者格式名，或者 '?'
 */
function fileKind(e) {
  const name = String((e && (e.path || e.originalPath || e.title)) || '');
  const m = name.match(/\.([A-Za-z0-9]{1,8})$/);
  if (m) return m[1].toUpperCase();
  const f = entryFormat(e);
  return f === 'other' ? UNKNOWN : f;
}

/**
 * 二级。**每一格问的问题不一样**，这正是这套分法好用的地方——一个维度对所有东西问同一句话，
 * 就总有一半的东西答不上来（旧的「来源」那一档里最大的一项是「未知」，144 条）。
 *
 * **四格是开集，只有剪贴板是闭集**（2026-09-09 用户点出来的）：
 *   收藏 / 截图    从哪儿来——站点名、应用名，库里出现过什么就有什么
 *   文件           是什么——**真的扩展名**，见 fileKind
 *   录音           哪只麦克风——设备名
 *   剪贴板         是什么——**这一格才该用那张固定的表**：剪贴板只装得下那么几样东西
 * @returns {string} 二级的值；这一格答不上来就是 '?'
 */
function entrySub(e) {
  const b = entryBucket(e);
  if (b === 'saved' || b === 'shot') return entryOrigin(e);
  if (b === 'voice') return String((e && e.mic) || '').trim() || UNKNOWN;
  if (b === 'file') return fileKind(e);
  return entryFormat(e);          // 剪贴板：唯一一格闭集
}

module.exports = {
  SOURCES, BUCKETS, UNKNOWN,
  entrySource, entryFormat, entryOrigin, entryBucket, entrySub, fileKind,
  siteOf, baseHost, siteInTitle,
};
