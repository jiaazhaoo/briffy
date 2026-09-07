'use strict';
// 网页家具：导航栏、页脚、语言选择条、同一个界面串重复几十遍的那些字。
//
// **这里从不改动存下来的记录。** 剥掉的只是「拿去理解」时的那一份视图——算向量、归主题、
// 抽证据词的时候用它。原件、搜索、你看到的正文，一个字都不动：你存的东西就是你存的东西。
//
// 为什么非剥不可，三个问题一个原因：
//   · 「赛程分前后半程 - Claude」全文 5555 字，真正的内容是标题那 7 个字，其余是 claude.ai 的
//     宣传语和界面串（Share / Claude finished the response / Load earlier messages…）。
//     它的向量因此指向「Claude 这个产品」，不指向那场徒步。
//   · 「Find parking」全文 2526 字，前十四行是 JustPark 的菜单
//     （How it works / Rent out your space / Airports / Payment Methods / Log out…）。
//     证据链于是拿到了 rent、airports、payment、high 这些词，把毫不相干的两晚焊在一起。
//   · 主题的质心被这些字拉偏，于是「泰晤士河超级马拉松」那一堆的代表是一个语言选择条。
//
// 判据不用模型，用工作区自己：**家具会重复，内容不会。** 一行字出现在很多条记录里，
// 它就是那个界面的一部分，不是你存它的理由。同一条记录里重复很多遍的行同理
// （一个聊天页上二十个「Share」）。
//
// 纯函数，node 直接跑得起来。见 dev/boilerplate-bench.js（真实工作区上的账）。

const ACROSS = 3;     // 一行出现在这么多条记录里，就是家具
const WITHIN = 4;     // 一条记录里同一行重复这么多遍，对这条记录来说也是家具
const KEEP_LONG = 90; // 长过这么多字的行留着：一整段话重复出现，多半是你自己抄了两遍

// 成串的短行 = 菜单。这一条才是主力。
//
// 交叉重复那一条在真实工作区上几乎学不到东西（实测只剥掉 3%）：家具要重复，得同一个站点存过
// 很多次，而这个工作区每个站点只存过一两回。它反而学到了「1」「0」「x」这种一个字符的行。
// 但家具有个逃不掉的形状——**它是一串挨着的短行**：
//   How it works / Rent out your space / Airports / Company / Help / Bookings made / …
// 十四行连着，每行两三个词，没有一个句号。而内容不长这样：一个地址是一行短的，但它前后
// 没有另外十三行短的陪着。所以判的是**串**，不是单行——「Windsor Road, Egham TW20 0AE」
// 自己一行，永远不会被当成菜单。
const RUN = 5;         // 连着这么多短行，才算一串菜单
const RUN_WORDS = 5;   // 一行少于这么多词才算「短」
const MIN_LINES = 20;  // 整条记录不到这么多行就不动它：短记录本来就全是内容
// 剥过头是这件事最危险的失败方式，因为它不吭声：正文还在，只是内容没了，而向量、主题、
// 证据词全都照跑不误，只是全错。实测抓到两条——一条 26 字的记录（「1st Half Challenge (~50km)」，
// 它整条就是内容）被剥成 0；一条报名页 2092 → 167，因为那一页本来就是一串短选项。
// 所以留两道保险：剥完不许是空的，也不许只剩一小半。够不到就退回去，宁可不剥。
const KEEP_MIN = 0.35;  // 至少要剩下这么多，否则这一遍作废

const key = (line) => String(line || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** 这一行像不像菜单项：短、没有句子的标点、不是一整句话。 */
function menuish(line) {
  const t = String(line || '').trim();
  if (!t) return true;                                  // 空行不打断菜单串
  if (t.length > 44) return false;
  if (/[.。!！?？;；]\s*$/.test(t)) return false;          // 有句末标点的是话，不是菜单项
  if (/[，,、]/.test(t) && t.length > 18) return false;    // 带停顿的长短语更像内容（地址就是这种）
  const words = t.split(/\s+/).filter(Boolean).length;
  const cjk = (t.match(/[㐀-䶿一-鿿]/gu) || []).length;
  return cjk ? cjk <= 8 : words < RUN_WORDS;
}

/** 找出成串的菜单，返回要丢掉的行号。 */
function menuRuns(lines, { run = RUN } = {}) {
  const drop = new Set();
  let i = 0;
  while (i < lines.length) {
    if (!menuish(lines[i])) { i++; continue; }
    let j = i;
    while (j < lines.length && menuish(lines[j])) j++;
    // 一串里真正有字的行数够多才算菜单——十个空行不是菜单
    const solid = [];
    for (let k = i; k < j; k++) if (String(lines[k]).trim()) solid.push(k);
    if (solid.length >= run) for (const k of solid) drop.add(k);
    i = j;
  }
  return drop;
}

/**
 * 从整个工作区学出「哪些行是家具」。
 * @param {string[]} texts 每条记录的正文（顺序无所谓）
 * @param {{across?:number}} [opts]
 * @returns {Set<string>} 行的归一化形式
 */
function learn(texts, { across = ACROSS } = {}) {
  const df = new Map();
  for (const t of texts || []) {
    const seen = new Set();
    for (const line of String(t || '').split('\n')) {
      const k = key(line);
      if (!k || k.length > KEEP_LONG) continue;
      seen.add(k);
    }
    for (const k of seen) df.set(k, (df.get(k) || 0) + 1);
  }
  const out = new Set();
  // 一个字符、纯数字、纯标点的行不算家具：它们到处都是，但剥掉它们什么也没解决，
  // 反而会把「6 页」「£139」这种内容里的数字连坐。
  for (const [k, n] of df) if (n >= across && k.length >= 2 && !/^[\d\p{P}\s]+$/u.test(k)) out.add(k);
  return out;
}

/**
 * 把一段正文里的家具去掉。
 *
 * 两条：整个工作区里重复的行（learn 学到的），以及**这一条记录自己**重复太多遍的行——
 * 后者不需要别的记录作证，一个页面上二十个「Share」，第一个还有点意思，第二十个没有。
 * @param {string} text
 * @param {Set<string>} furniture
 * @returns {string} 只是拿去理解的那一份，不写回记录
 */
function strip(text, furniture, opts = {}) {
  const raw = String(text || '');
  const keepMin = opts.keepMin === undefined ? KEEP_MIN : opts.keepMin;
  const once = (fur, useRuns) => strip1(raw, fur, { ...opts, useRuns });
  const full = once(furniture, true);
  if (full.length >= raw.trim().length * keepMin) return full;
  // 剥太狠了。先退掉「成串短行」那一条，只留跨记录重复的那一条再试一次。
  const soft = once(furniture, false);
  if (soft.length >= raw.trim().length * keepMin) return soft;
  return raw.trim();                       // 还是不行就原样奉还——**宁可不剥**
}

function strip1(text, furniture, { within = WITHIN, run = RUN, minLines = MIN_LINES, useRuns = true } = {}) {
  const lines = String(text || '').split('\n');
  const mine = new Map();
  for (const line of lines) {
    const k = key(line);
    if (k && k.length <= KEEP_LONG) mine.set(k, (mine.get(k) || 0) + 1);
  }
  // 短记录整条都是内容，不动它。一条只有一行「Windsor Road, Egham TW20 0AE」的记录，
  // 任何「像不像菜单」的判断施加在它身上都只有坏处。
  const drop = useRuns && lines.length >= minLines ? menuRuns(lines, { run }) : new Set();
  const out = [];
  const used = new Set();
  for (let i = 0; i < lines.length; i++) {
    const k = key(lines[i]);
    if (!k) continue;
    if (drop.has(i)) continue;
    if (furniture && furniture.has(k)) continue;
    if ((mine.get(k) || 0) >= within) continue;
    if (used.has(k)) continue;             // 同一条里一模一样的行留第一遍就够
    used.add(k);
    out.push(lines[i].trim());
  }
  return out.join('\n');
}

/** 一条记录剥完之后剩下的正文。entry 不变。 */
function textOf(entry, furniture) {
  return strip(String((entry || {}).text || ''), furniture === undefined ? learned : furniture);
}

// 学到的那份家具表放在模块里，因为 chunk.textOf 是逐条调用的、手上没有整个工作区。
// 谁手上有记录谁来喂（ask.refresh），没喂过就是 null——那时只剩「成串短行」那一条规则，
// 它不需要别的记录作证，照样管用。
let learned = null;
function load(texts) { learned = learn(texts); return learned; }
function furniture() { return learned; }

module.exports = { learn, load, furniture, strip, textOf, key, menuish, menuRuns, ACROSS, WITHIN, KEEP_LONG, RUN, MIN_LINES, KEEP_MIN };
