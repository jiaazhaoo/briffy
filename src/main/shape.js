'use strict';
// 问什么形状的东西，就去找什么形状的东西。
//
// 一条写着「Runnymede Pleasure Ground, Egham, Surrey TW20 0AE」的记录里，**没有「地址」这两个字**。
// 所以任何由「地址」生成的查询都到不了它——不管换多聪明的模型，不管排序怎么调。这是 2026-09-09
// 那一整天所有失败的直接原因：用户连着两次问起点终点的具体地址，而地址就明明白白存在库里。
//
// 判据全是确定性的正则，没有模型，和 redact.js 是同一种东西（那边是出门前盖掉，这边是找回来）。
// 全库扫一遍的代价实测过：316 条记录、373 KB，读进内存 8ms，扫一遍 0.3ms。
//
// 量出来的账在 dev/recall-arch-bench.js 顶上：14 个问题、33 条满分记录，
// 现状 36% → 91%，检索耗时 702ms → 0ms。台子直接调这个文件，所以它同时是回归测试。
//
// 纯函数，node 直接跑得起来（见 dev/shape-test.js）。

// ---------- 形状 ----------
const SHAPES = {
  // 英国邮编。完整的那种：TW20 0AE、SW6 6EA。
  postcode: /\b[A-Z]{1,2}[0-9][A-Z0-9]?\s?[0-9][A-Z]{2}\b/,
  // 半截的：真实记录里写的是「Parking space on Buckingham Court, TW18」，只有前半段。
  // **单看它很松**（CJ89、M25 都像），所以只配合下面 rank() 那种「形状在标题里 + 记录短」用，
  // 而且名额有上限——量出来它救回停车那一问 2 条，同时差点淹掉签证住址那一条。
  postcodeLoose: /\b(?:[A-Z]{1,2}[0-9][A-Z0-9]?\s?[0-9][A-Z]{2}|[A-Z]{2}[0-9]{1,2})\b/,
  time: /\b(?:[01]?\d|2[0-3])[:：][0-5]\d\b/,
  money: /[£$€¥]\s?\d[\d,]*(?:\.\d\d)?|\d+\s?(?:元|镑|块)/,
  // 型号串：p3425we、CJ89、XA20014390917。字母开头、中间有数字。
  // 数字放到 12 位：保单号 XA20014390917 有 11 位数字，卡在 6 位的话它一个字都不匹配。
  code: /\b[A-Za-z]{1,6}[0-9]{2,12}[A-Za-z]{0,4}\b/,
};

// 一句话在问哪一种形状。
//
// **这张表是个凑合，它认错过。** 量出来的一次：「这台机器推荐用哪个本地模型」里的「模型」
// 带一个「型」字，触发了型号那一档。所以两件事一起做：一，触发词尽量写全（「模型」在
// 「型」前面先被排除）；二，更要紧的——**认错的形状不许吃掉整份名额**（见 blend 的配额）。
// 真正该决定「这句话在找什么」的是模型（searchPlan），这张表是它不在时的地板。
const TRIGGERS = [
  // 顺序有意义：先排掉那些「带了触发字但不是那个意思」的说法
  ['', /本地模型|哪个模型|什么模型|模型大小/],
  ['postcode', /地址|在哪|哪里|哪儿|位置|邮编|门牌|怎么走|address|postcode|where/i],
  ['time', /几点|什么时候|多久|出发时间|开始时间|when|what time/i],
  ['money', /多少钱|费用|价格|报名费|花了多少|多少镑|多少元|cost|price|fee|how much/i],
  ['code', /型号|什么牌子|哪一款|单号|编号|序列号|model number|serial/i],
];

/**
 * 这句话在找什么形状的东西。
 * @param {string} question
 * @returns {string} 形状名，认不出就是空字符串（那时该退回全扫，见 blend）
 */
function shapeOf(question) {
  const q = String(question || '');
  for (const [name, re] of TRIGGERS) if (re.test(q)) return name;
  return '';
}

/** 这段字里有没有这个形状的东西。 */
function has(text, shape) {
  const re = SHAPES[shape];
  return !!re && re.test(String(text || ''));
}

/**
 * 一条形状命中排多前。
 *
 * **量出来的：每一条真的是答案的记录都长一个样——很短，而且形状就写在标题里。**
 *   Runnymede Pleasure Ground, Egham, Surrey TW20 0AE   98 字，标题就是答案
 *   Windsor Road, Egham TW20 0AE                        56 字
 *   Dell ultrawide monitor p3425we                      60 字
 *   Samsung CJ89 series 49" curved ultrawide monitor    105 字
 * 而噪音是五千字的网页，邮编埋在正文里。那是「我特意留下这一条」和「这一页碰巧提到」的差别。
 * 问题里的词也算一点分，但只算一点：问「报名费」的时候，记录上写的是「£159.00」，一个词都不共用。
 */
function rank(entry, shape, terms) {
  const e = entry || {};
  const body = `${e.title || ''}\n${e.text || ''}`;
  const inHead = has(e.title, shape) ? 3 : 0;
  const short = body.length <= 200 ? 2 : body.length <= 800 ? 1 : 0;
  let q = 0;
  const low = body.toLowerCase();
  for (const t of terms || []) if (t && low.includes(t)) q += 1;
  return inHead + short + Math.min(q, 2);
}

/** 全库里带这个形状的记录，排好序。@returns {string[]} */
function scan(entries, shape, terms) {
  if (!SHAPES[shape]) return [];
  const hits = [];
  for (const e of entries) {
    if (!has(`${e.title || ''}\n${e.text || ''}`, shape)) continue;
    hits.push({ id: e.id, s: rank(e, shape, terms) });
  }
  hits.sort((a, b) => b.s - a.s);
  return hits.map((x) => x.id);
}

/**
 * 全扫词面：每条记录都看一遍，按命中的词打分。标题里命中算两分——那是别人给它起的名字。
 *
 * **这一条单独用没有用**（实测和现在的索引一样，36% vs 36%），它补的是另一个洞：
 * 问题**认不出形状**的时候（「screenpipe 是怎么采集的」「我存的那个视频讲什么」），
 * 索引只给前几条，而全扫给全部。那一档上它 5/5，索引 2/5。
 */
function scanWords(entries, terms) {
  const out = [];
  for (const e of entries) {
    const head = String(e.title || '').toLowerCase();
    const body = `${head}\n${String(e.text || '').toLowerCase()}`;
    let s = 0;
    for (const t of terms || []) {
      if (!t) continue;
      if (body.includes(t)) s += 1;
      if (head.includes(t)) s += 1;
    }
    if (s > 0) out.push({ id: e.id, s: s / Math.log2(4 + body.length / 200) });
  }
  out.sort((a, b) => b.s - a.s);
  return out.map((x) => x.id);
}

/**
 * 三条腿按配额并起来。**谁也不许独占名额。**
 *
 * 这条规矩是量出来的，也是这次唯一真正通用的一条。之前那版是二选一（有形状就走形状、
 * 没形状才全扫），日用题上立刻出事：「这台机器推荐用哪个本地模型」触发了型号那一档，
 * 二十个名额被型号串占满，真正写着「推荐用 qwen3.5:27b」的两条一条也进不来。
 * 一个认错的形状不该吃掉整份名额——82% → 91% 就是这一条换来的。
 *
 * @param {{found:string[], shapeHits:string[], scanHits:string[], keep:number}} o
 *   found 是索引本来找到的那几条（它最准，但只有前几名）
 * @returns {string[]}
 */
function blend({ found = [], shapeHits = [], scanHits = [], keep = 24 }) {
  const out = [];
  const add = (list, n) => {
    let left = n;
    for (const id of list) {
      if (out.length >= keep || left <= 0) break;
      if (out.includes(id)) continue;
      out.push(id); left -= 1;
    }
  };
  add(shapeHits, Math.floor(keep / 2));   // 形状：最多一半
  add(found, KEEP_FOUND);                 // 索引本来找到的：留住前几条
  add(scanHits, keep);                    // 全扫把剩下的填满
  // 还有空位的话，**先还给索引再还给形状**：索引那一路是精确匹配，形状那一路只知道
  // 「这条身上有个像邮编的东西」。上限只在别人填得满的时候才是上限，填不满就别浪费名额。
  add(found, keep);
  add(shapeHits, keep);
  return out.slice(0, keep);
}
const KEEP_FOUND = 6;

module.exports = { shapeOf, has, rank, scan, scanWords, blend, SHAPES, TRIGGERS, KEEP_FOUND };
