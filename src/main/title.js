'use strict';
// 一条记录该叫什么。
//
// 「截图 22:46」不是标题，是时间戳。这个工作区里 255 条记录，83 条（33%）的标题就是
// 「类型 + 时间」——你看着它根本不知道那是什么。
//
// 为什么不抽关键词。试过了：拿 entity.js（专名、邮编、日期、数量、地名，加 df 罕见度）
// 去跑那 83 条截图的 OCR，抽出来是「剩下 · Project · 剪切 · 改成 · 几个」这种东西，
// 还有几条一个词都抽不出来。不是算法差——**一张全屏截图本身就不是「关于一件事」的**，
// 它的 OCR 里有菜单栏、有 briffy 自己的界面、有好几个窗口，没有主题可抽。
// （业内也没有现成的轮子：CleanShot、Shottr、Raycast 都做 OCR，但只用来搜，没有一个做自动标题。）
//
// 真正说得清那张图是什么的，是**那一刻屏幕上那个窗口叫什么**。所以这件事的难点不在算法，
// 在采集——见 foreground.js 里 APP_TITLE 那段账。
//
// 纯函数，node 直接跑得起来（dev/title-test.js）。不 require electron，也不 require store：
// 放在这儿而不是留在 workspace.js 里，就是为了它能被测——retrieve.js 当初也是为这个搬出来的。

// 太短说明不了什么，太长就不是标题是正文了
const MIN = 2;
const MAX = 90;

/**
 * 语境到了之后，这条记录能不能有个更好的名字。
 *
 * **只换占位标题。** 第一行是内容的那些记录不动：你复制的那段话就是你复制的那段话，
 * 窗口标题没资格盖过它——实测过一条反例，「Is it okay if I arrive at your place around nine?」
 * 的窗口标题是「Google Translate」，换过去就把内容换成了工具名。
 * 用户自己改过标题的也不动（改的时候 titleAuto 会被抹掉，见 main.js 的 ws:update-entry）。
 *
 * @param {object} entry 已经存下的那条
 * @param {object} ctx   foreground.read 读回来的语境
 * @returns {string} 空字符串表示「没有更好的」
 */
function fromContext(entry, ctx) {
  const e = entry || {};
  if (!e.titleAuto || !ctx) return '';
  const w = String(ctx.window || '').replace(/\s+/g, ' ').trim();
  if (w.length < MIN || w.length > MAX) return '';
  // 和应用同名的窗口标题等于没说（Claude 桌面版的窗口就叫「Claude」，这个工作区里
  // 它那 70 条只有 1 条带得上窗口标题）。foreground.trimWindowTitle 已经会把它剪成空，
  // 这里再挡一道，因为语境也可能是别处塞进来的。
  if (w.toLowerCase() === String(ctx.app || '').toLowerCase()) return '';
  return w;
}

// ── 一条记录该叫什么：一条降级链
//
// 没有哪一个来源能覆盖全部，所以按可靠性排队，谁先给得出就用谁。量出来的覆盖和质量：
//   窗口标题        有 app 的 46%   高
//   OCR 最显著的行   52 条          中——截的是 briffy 自己时就只剩界面词
//   本地关键词 tags  66 条          中——「Claude Code · limits · Weekly」好，「I'm · it's · idea」差
//   正文第一行       文字类都有      中——常常是一整段话
//   类型 + 时间      100%           无
//
// **每一条都要有个说得出的名字**，所以最后那一档永远兜得住。

const CJK = /[㐀-䶿一-鿿]/u;
// 一个标题最多这么长。超过就不是标题是正文了——中文按字数、拉丁按词数，因为一个汉字顶一个词。
const CUT_CJK = 24;
const CUT_LAT = 60;

// macOS 的菜单栏。全屏截图的第一行几乎总是它，而它说的是「哪个应用」，不是「这张图是什么」。
const MENUBAR = /\b(File|Edit|View|Window|Help|Format|Go|History|Bookmarks|Develop)\b.*\b(File|Edit|View|Window|Help|Format|Go|History|Bookmarks|Develop)\b/;
// OCR 认得有多准。低于这个数的行是乱码——「：文//：: 88 1 chresus D 8」就是这么来的。
const OCR_MIN_CONF = 92;

/** 一行字有没有实质内容：不是纯符号、纯数字、纯时间、不是菜单栏。 */
function meaty(s) {
  const t = String(s || '').trim();
  if (t.length < 3) return false;
  // **不能写 \W**：\W 是 [^A-Za-z0-9_]，汉字全都算 \W，于是「我在测试语音识别」会被判成
  // 「全是符号」整条丢掉——纯中文的行一条都活不下来。要的是「有没有字母」，用 \p{L}。
  if (!/\p{L}/u.test(t)) return false;
  if (/^\d{1,2}:\d{2}(\s|$)/.test(t) && t.length < 12) return false;  // 「23:00 6条」
  if (MENUBAR.test(t)) return false;
  // 一个正经的词都没有的，是 OCR 在乱猜（「A it」「：文//：: 88」）
  if (!words(t).length) return false;
  // 认出来的字里符号和空格占一多半，那多半是 OCR 在乱猜
  const junk = (t.match(/[^\p{L}\p{N}\s]/gu) || []).length;
  if (junk > t.length * 0.34) return false;
  return true;
}

/**
 * 剪掉开头那一串图标。
 *
 * 界面上的小图标被 OCR 认成了字，而且总排在最前面，因为工具栏就在那儿：
 *   「● 日 ← → Briffy 本地开发」  「À 拖入的图片也做 OCR」  「(1) Facebook」
 * 一轮一轮地剥：先剥非字非数的，再剥「一个字后面跟空格」的（那种独字几乎都是图标），
 * 剥到不再变为止。带空格这个条件要紧——「9月12日」开头的 9 后面没有空格，不会被误伤。
 */
function stripLead(t) {
  let s = String(t || '');
  for (let i = 0; i < 6; i++) {
    // 「(1) Facebook」开头那个未读数：它是个计数器，不是这一页叫什么
    const n = s.replace(/^\(\d+\)\s*/, '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/^[\p{L}\p{N}]\s+/u, '');
    if (n === s) break;
    s = n;
  }
  return s || String(t || '');
}

/** 把一句话剪成一个标题：剪掉开头的图标，在标点处断，不硬切字。 */
function clip(s) {
  const t = stripLead(String(s || '').replace(/\s+/g, ' ')).trim();
  const max = CJK.test(t) ? CUT_CJK : CUT_LAT;
  if (t.length <= max) return t;
  // 在最靠后的那个「可以断的地方」断，而不是数够字数一刀切。切在词中间读起来像坏掉了。
  const head = t.slice(0, max + 1);
  const at = Math.max(head.lastIndexOf('，'), head.lastIndexOf('。'), head.lastIndexOf('、'),
    head.lastIndexOf('；'), head.lastIndexOf('：'), head.lastIndexOf(','), head.lastIndexOf('. '),
    head.lastIndexOf(' — '), head.lastIndexOf(' - '), head.lastIndexOf(' '));
  return `${(at > max * 0.4 ? head.slice(0, at) : t.slice(0, max)).trim()}…`;
}

/**
 * 图上最像标题的那一行：**字最大的那一行**。
 *
 * 这是排版层面的经典做法，不用模型：一张图里最大的字通常就是它在讲什么。
 * OCR 早就把每行的位置和高度存下来了（ocr-boxes.js），以前只是没人用。
 *
 * 挡掉三种：认不准的（框里第五个字段就是置信度）、菜单栏（全屏截图的第一行几乎总是它）、
 * 和一个正经词都没有的乱码。
 *
 * 试过第四种——按「这个词在多少张图里出现过」挡界面词（和 boilerplate 同一个判据）。
 * **量下来一条也没多救**（都是 12 条），而它要为此扫一遍全库的 OCR。去掉了。
 *
 * @param {Array<[number,number,number,number,number,string]>} lines ocr-boxes 存下来的行
 * @param {(word:string)=>number} [chrome] 留着接口，现在没人用
 * @param {number} [shots]
 */
function fromPicture(lines, chrome, shots = 0) {
  const ls = (lines || []).filter((l) => Array.isArray(l) && (l[4] === undefined || l[4] >= OCR_MIN_CONF) && meaty(l[5]));
  if (!ls.length) return '';
  const maxH = Math.max(...ls.map((l) => l[3])) || 1;
  const rare = (t) => {
    if (!chrome || !shots) return 1;
    const ws = words(t);
    if (!ws.length) return 0;
    let n = 0;
    for (const w of ws) n += Math.log(shots / (1 + chrome(w)));
    return Math.max(0, n / ws.length);
  };
  let best = ''; let top = 0;
  for (const l of ls) {
    const s = (l[3] / maxH) * (0.4 + rare(l[5]));
    if (s > top) { top = s; best = l[5]; }
  }
  return top > 0 ? clip(best) : '';
}

/** OCR 那一行切成词。二元切分中文，不依赖分词器——这里只用来数「有多常见」。 */
function words(s) {
  const t = String(s || '');
  const out = (t.match(/[A-Za-z][A-Za-z0-9]{2,}/g) || []).map((w) => w.toLowerCase());
  for (const run of t.match(/[㐀-䶿一-鿿]{2,}/gu) || []) {
    for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}

/** 本地抽的关键词拼成一个名字。虚词太多的那种（语音转写常见）不要。 */
function fromTags(tags) {
  const list = (tags || []).map((x) => String(x || '').trim()).filter((x) => x.length >= 2 && meaty(x));
  if (list.length < 2) return '';
  // 「I'm · it's · idea · sure」这种全是虚词的，说明这条记录本来就没有主语
  const thin = list.filter((x) => /^[a-z']{1,5}$/i.test(x)).length;
  if (thin > list.length / 2) return '';
  return clip(list.slice(0, 3).join(' · '));
}

// 「这标题只是个占位」——类型 + 时间，看着不知道是什么东西。
const PLACEHOLDER = /^(截图|Screenshot|剪贴板图片|Clipboard image|语音|Voice|录音|Note|随手记)\s*\d{1,2}:\d{2}$/;
function isPlaceholder(t) { return !String(t || '').trim() || PLACEHOLDER.test(String(t).trim()); }

/**
 * 一条记录的自动标题。**每一条都会有**，最后那一档兜底。
 *
 * **只给占位标题起名。** 这条比「起得好」重要得多：一次实测里，
 * 「Is it okay if I arrive at your place around nine?」被换成了它的窗口标题
 * 「Google Translate」——内容变成了工具名，而且你不会发现，因为标题看上去挺正常。
 * 「把中国区改成一次性年卡」被换成了「payment · mode」，同理。
 * 你自己存下的那句话就是你自己存下的那句话，任何自动来源都没资格盖过它。
 *
 * @param {object} entry
 * @param {{window?:string, lines?:Array, chrome?:Function, shots?:number, fallback?:string, force?:boolean}} src
 * @returns {string} 空字符串 = 这条不需要改
 */
function of(entry, src = {}) {
  const e = entry || {};
  if (!src.force && !e.titleAuto && !isPlaceholder(e.title)) return '';
  const w = String(src.window || (e.context || {}).window || '').replace(/\s+/g, ' ').trim();
  if (w && w.length >= MIN && w.length <= MAX && w.toLowerCase() !== String((e.context || {}).app || '').toLowerCase()) return clip(w);
  const pic = fromPicture(src.lines, src.chrome, src.shots);
  if (pic) return pic;
  const tag = fromTags(e.tags);
  if (tag) return tag;
  const line = String(e.text || '').split('\n').map((x) => x.trim()).find(meaty);
  if (line) return clip(line);
  return String(src.fallback || e.title || '').trim();
}

module.exports = { fromContext, of, fromPicture, fromTags, clip, stripLead, meaty, words, isPlaceholder, MIN, MAX, CUT_CJK, CUT_LAT, OCR_MIN_CONF };
