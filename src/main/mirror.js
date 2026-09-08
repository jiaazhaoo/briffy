'use strict';
// briffy 拍到了自己。
//
// 库里有一批记录，正文是这样的：「选择一条记录查看详情」「问问你的记录 →」
// 「搜索标题/文字/画面内容 全部截图剪贴板收藏 全部日期网格列表选择 今天 昨天 9月4日」。
// 它们是 briffy 自己的窗口被截了进来——按快捷键的时候 briffy 在最前面，或者把一张
// briffy 的截图粘了进来。工具拍到了自己的倒影。
//
// 它们对任何问题都不是答案，可它们短、干净、在向量空间里离哪儿都不远，于是每个查询都往里挤：
// 实测十个探针里六个的头几名有它们。
//
// **不写黑名单。** briffy 的界面文案就摆在 renderer 自己的 i18n 表里，它认得出自己说过的话。
// 这里把那张表读出来当判据——界面改了文案，判据跟着改，没有第二个地方要维护。
//
// **判出来也不删、不藏。** 和 boilerplate 剥网页家具是同一个分寸：记录一个字不动，词面搜索照旧
// 搜得到（你把那几个字打全了，它就该出来）；只是它不再被「意思相近」这条腿主动端上来。
const fs = require('fs');
const path = require('path');

// 短词不当判据：「问」「设置」「保存」「今天」到处都是，拿它们判会把半个库判成倒影。
// 中文四个字、拉丁八个字符起——这个长度的短语撞上不是巧合。
const MIN_CJK = 4;
const MIN_LATIN = 8;
// 判据是**覆盖率**：界面文案占掉这条记录多大比例。
//
// 数「撞上几条」是不行的，实测误伤得厉害：撞上两条就算的话，Ultra Challenge 那张报名页、
// 「赛程分前后半程」（地址那个案子的关键证据）、Bishops Park、Runnymede、grok-icon-study、
// Ollama 地址——全被判成倒影。一张长网页里碰巧含着两句 briffy 也说过的话，太容易了。
// 覆盖率分得开「这条记录**就是**界面」和「这条记录**提到**了界面也说过的话」。
//
// 分母只算**实字**（字母和汉字），不算数字、标点、时间戳。截图 OCR 出来满屏是
// 「11:00-12:59 3条 今天 33 昨天 94」这种，拿它们当分母，真的倒影也稀释到判不出来。
// 实测这条线两边：真倒影 49% / 50% / 56% / 86% / 100%；最高的误伤是「Ollama 地址」34%——
// 它确实是 briffy 设置页抄下来的，但里面写着你要的那个地址，不能挡。
const MIN_COVER = 0.45;
// 一条也不撞就不用算了。不设下限：一条记录整个就是一句界面文案，那一条就够。
const MIN_HITS = 1;
// 除非整条就是一句界面文案，一个字不多——那种不用凑数。
const CJK = /[㐀-鿿豈-﫿]/;
// 实字：字母和汉字。数字、标点、时间戳不参与算比例——截图 OCR 出来一半是它们。
const WORDY = /\p{L}/u;

let cache = null;

/** 从一个 renderer 文件里把 `const T = { … }` 整块切出来。字符串里的括号不算数。 */
function tableOf(src) {
  const at = src.indexOf('const T = {');
  if (at < 0) return '';
  let i = src.indexOf('{', at);
  let depth = 0; let q = '';
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (q) {
      if (c === '\\') { j++; continue; }
      if (c === q) q = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return src.slice(i, j + 1); }
  }
  return '';
}

/**
 * 一句界面文案里，能拿来当判据的那几段。`{n} 条记录` 要拆开——占位符不是字。
 *
 * 拉丁文案要**两个词以上**。单个词不行，哪怕它够长：briffy 的界面里有 `Screenshot`、
 * `Clipboard`，而它们同时是英文里的普通词——实测「ScreenshotOne」（一个用户存下来的产品名）
 * 就是这么被判成倒影的。中文四个字已经是词组了，不用这一条。
 */
function usable(text) {
  const out = [];
  for (const piece of String(text).split(/\{[^}]*\}/)) {
    const trimmed = piece.trim();
    const s = trimmed.replace(/\s+/g, '');
    if (!s) continue;
    const ok = CJK.test(s)
      ? s.length >= MIN_CJK
      : s.length >= MIN_LATIN && /\S\s+\S/.test(trimmed);
    if (ok) out.push(s.toLowerCase());
  }
  return out;
}

/** briffy 说过的话。读一次，之后走缓存。读不到就空手——空手意味着这道闸不生效，不会误伤。 */
function phrases() {
  if (cache) return cache;
  const out = new Set();
  const dir = path.join(__dirname, '..', 'renderer');
  let files = [];
  try {
    for (const sub of fs.readdirSync(dir)) {
      const f = path.join(dir, sub, `${sub}.js`);
      try { if (fs.statSync(f).isFile()) files.push(f); } catch (_) { /* 没有同名 js */ }
    }
  } catch (_) { files = []; }
  for (const f of files) {
    let src = '';
    try { src = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
    const tbl = tableOf(src);
    if (!tbl) continue;
    for (const m of tbl.matchAll(/(['"])((?:\\.|(?!\1)[^\\])*)\1/g)) {
      for (const p of usable(m[2])) out.add(p);
    }
  }
  cache = out;
  return out;
}

/**
 * 这条记录是不是 briffy 自己的界面。
 *
 * **只看正文，不看标题。** 标题常常是 briffy 自己起的（`Screenshot 11:22`、`剪贴板图片 05:03`），
 * 那些词本来就在界面文案表里——拿标题一起判，等于把每一条没识别出文字的截图都判成倒影。
 * @param {string} text 记录的正文
 */
function isMirror(text) {
  const raw = String(text || '').replace(/\s+/g, '').toLowerCase();
  if (!raw) return false;
  const said = phrases();
  if (!said.size) return false;
  if (said.has(raw)) return true;              // 整条就是一句界面文案
  // 盖住哪些位置记下来，别重复算：短语之间会互相包含（「搜索标题/文字/画面内容」里含着「画面内容」）。
  const covered = new Uint8Array(raw.length);
  let hits = 0;
  for (const p of said) {
    let at = raw.indexOf(p);
    if (at < 0) continue;
    hits++;
    while (at >= 0) { covered.fill(1, at, at + p.length); at = raw.indexOf(p, at + 1); }
  }
  if (hits < MIN_HITS) return false;
  let total = 0; let n = 0;
  for (let i = 0; i < raw.length; i++) {
    if (!WORDY.test(raw[i])) continue;
    total++;
    if (covered[i]) n++;
  }
  return total > 0 && n / total >= MIN_COVER;
}

/**
 * 画面里有 briffy 的界面——不是「整条都是界面」，是「界面在画面里」。
 *
 * 一张 briffy 的列表截图上正好显示着你的十几条记录：它的正文大半是那十几条的字，界面文案只占
 * 一两成，isMirror 判不出来（实测覆盖率 7%~19%）。可它撞上的**不同**界面短语有三到十三条，
 * 而任何不是 briffy 的画面一条也撞不上（Ultra Challenge 那页、grok-icon、赛程那页全是 0；
 * 最多的是一条语音记录的详情页被复制成记事，2 条）。
 *
 * 数的是**不互相包含**的短语：「搜索标题/文字/画面内容」里含着「画面内容」，那是一条不是两条。
 * 不去嵌套的话计数虚高一截，门槛就得定在一个碰巧的数上。
 *
 * 这个判据**只该用在图片上**（调用方管）：一条记事里抄着 briffy 的设置页（「Ollama 地址」，
 * 撞 9 条）是你写的，不是拍的，里面有你要的东西。
 *
 * 用在哪：图的节点。一张显示着十几条记录的截图，和那十几条每一条都共用一个词，于是它成了
 * 枢纽——实测清单最长的五条全是它。它作为答案材料倒无妨（isMirror 管那个），作为节点不行。
 */
const SELF_HITS = 3;

function showsSelf(text) {
  const raw = String(text || '').replace(/\s+/g, '').toLowerCase();
  if (!raw) return false;
  const got = [];
  for (const p of phrases()) if (raw.includes(p)) got.push(p);
  if (got.length < SELF_HITS) return false;
  const outer = got.filter((p) => !got.some((q) => q !== p && q.includes(p)));
  return outer.length >= SELF_HITS;
}

/** 测试用：把缓存丢掉。 */
function forget() { cache = null; }

module.exports = { isMirror, showsSelf, phrases, forget, MIN_HITS, MIN_COVER, MIN_CJK, MIN_LATIN, SELF_HITS };
