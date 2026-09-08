'use strict';
// 记录里反复出现的那些东西：一个地点、一个日期、一场活动、一笔钱。
//
// 为什么要有它。在这之前图上只有一类节点——「一条记录」，边是记录↔记录，四种边分别回答
// 「我凭什么知道它们有关系」（同一页、共用词、同一段时间、向量像），**没有一种回答
// 「这是什么关系」**。读完只知道有关，不知道怎么个有关法。
//
// 而那一晚真正的骨架不是记录，是记录里反复出现的东西：
//   一场活动 Thames Path Ultra Challenge · 一个日期 12 Sep 2026
//   几个地点 Bishops Park · Runnymede · Egham · TW20 0AE · TW18
//   几个数   50km · 100km · £139
// 这些才是节点，记录是挂在它们上面的证据。顺带解决了一个够不着的问题：
// 「Windsor Road, Egham TW20 0AE」和赛程之间，记录到记录要走三跳，
// **而它们其实是一跳——都指着 Egham**。
//
// **实体是算出来的，不落库。** 这是 B 方案：实体是你穿行的路，不是你收藏的东西。
// 抽得不干净是必然的（今天量过好几轮），当中转点无所谓——排在后面没人点；
// 一旦存下来变成侧栏里一个叫「出来」的东西，就得你亲手去删。而 briffy 的前提是你什么都不用维护。
// 这条以后要长成「可以钉住的实体」也不难：钉的时候它本来就在那儿。
//
// 没有实体↔实体的边。「Egham 在泰晤士河步道上」是世界知识，编不出来，也不该假装能编。
const { segment } = require('./segment');

const MIN_DF = 2;      // 只被一条记录提到的，不是这个工作区里的一样东西
const MAX_DF = 30;     // 三十条以上都提到的，是这个工作区的通用词汇，不是一样东西
// 一条记录最多挂这么多实体。**别卡太紧**：排序是「最罕见优先」，而最罕见的往往是只此一份的
// （15km、200m、818mb），能把人连起来的恰恰是中间那一档（50km 被 4 条提到、Egham 被 3 条）。
// 卡在 12 的时候，「赛程分前后半程」的 50km 被 15km 和 200m 挤掉了，于是它和 Ultra Challenge
// 之间那条唯一的桥断了。
const PER_RECORD = 20;

// 正则能认的三类，不用统计也不会错。**顺序要紧**：邮编要在「数」之前认，
// 不然 TW20 0AE 会先被当成一个带数字的词。
const PATTERNS = [
  // 英国邮编：TW20 0AE、TW18 4JG。整个工作区里最硬的地点标识
  ['place', /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}\b/g,
    (m) => m.replace(/\s+/g, '').toUpperCase().replace(/^(.+)(\w{3})$/, '$1 $2')],
  // 日期：12 Sep 2026 / Sep 12 2026 / 2026年9月12日
  ['date', /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}\b/gi, (m) => m.replace(/\s+/g, ' ')],
  ['date', /\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/g, (m) => m.replace(/\s+/g, '')],
  // 距离和钱：50km、100km、£139、£10
  ['qty', /\b\d+(?:\.\d+)?\s?(?:km|mi|miles|kg|gb|mb)\b/gi, (m) => m.replace(/\s+/g, '').toLowerCase()],
  ['qty', /[£$€¥]\s?\d+(?:[.,]\d+)?/g, (m) => m.replace(/\s+/g, '')],
];

const CJK_RE = /[㐀-䶿一-鿿]/u;
// 网页家具词。这一张表是**有限的**——它是网站界面的词汇，不是英语的词汇，所以列得完。
// （试过让工作区自己判：一个词有没有以小写出现过。10 个专名全过，但 18 个家具词只滤掉 8 个——
//  这个工作区太小、太中文，当不了英文词典。所以这一格用表，不用统计。）
const CHROME = new Set(('privacy policy terms statement cookie cookies settings account sign login logout register '
  + 'menu home search help support contact about learn more view details listing bookings booking messages '
  + 'transactions payment methods profile preferences available select submit continue next previous close '
  + 'download upload share copy edit delete cancel confirm accept decline agree back forward loading error '
  + 'company careers press blog news events legal notice disclaimer copyright reserved rights inc ltd '
  + 'experience experiences levels challenges min max fee fees total subtotal').split(/\s+/));
// briffy 自己的标题词说的是格式不是内容；站点后缀说的是你在哪个站
const LABEL = new Set(['语音', '截图', '剪贴板', '剪贴板图片', '图片', 'screenshot', 'clipboard', 'audio', 'voice']);
const STOP = new Set(('the a an and or of to in on at for with from by is are was were be been am this that these those '
  + 'it its as if not no yes you your i my we our they them he she his her will would can could should may might must '
  + 'do does did done have has had get got go goes there here when where what which who how why all any some more most '
  + 'other than then also about into over under out up down off just now new see one two three hour hours day days time '
  + 'home half back only very much many such same page click here link '
  // 中文虚词。**这里只放真正的虚词**——副词、连词、助动词、疑问词，那是个词类，列得完；
  // 不放「当时咬过我一口」的词（「青年」是个好词，挡住它的该是「有没有谁拿它当过标题」那条规则，
  // 而那条规则确实挡住了）。但「出来 / 必须 / 为什么」躲不过那条规则——它们真的出现在标题里
  // （「GPT6一出来…」「为什么源治必须要找芹泽磕一架？」），所以只能按词类挡。
  + '一个 这个 那个 可以 没有 就是 什么 我们 你们 他们 自己 已经 因为 所以 但是 如果 还是 这样 那样 '
  + '出来 进来 起来 下去 必须 应该 需要 可能 也许 大概 为什么 怎么 怎样 多少 哪个 哪些 所有 每个 '
  + '觉得 知道 认为 时候 现在 以后 之前 之后 而且 并且 或者 然后 于是 虽然 尽管 不过 只是 还有 '
  + '一下 一点 一些 有些 那些 这些 这么 那么 非常 特别 真的 确实 其实 当然 反正 到底').split(/\s+/));

/** 一条记录的抬头（标题 + 窗口标题 + 网址）。 */
function headOf(entry) {
  const e = entry || {};
  const c = e.context || {};
  return [e.title, c.window, c.url, e.url].filter(Boolean).join(' ');
}

/**
 * 一条记录里出现的实体候选。
 *
 * @param {object} entry
 * @param {string} [body] 剥过家具的正文
 * @param {Set<string>} [titled] 整个工作区里被谁写在标题上过的词——见 links.evWords 那笔账：
 *   「车站」有记录拿它当标题，「出来」在两百多条里一次都没有，那才是它们的区别，不是罕见程度
 * @param {Set<string>} [places] 这个工作区里挨着邮编出现过的词（placesIn 学的），升格成地名
 * @returns {{key:string, kind:string, text:string}[]}
 */
function of(entry, body, titled, places) {
  const head = headOf(entry);
  const raw = `${head} ${String(body === undefined ? (entry || {}).text || '' : body).slice(0, 1500)}`;
  const out = new Map();
  const add = (kind, text, key) => {
    const k = `${kind}:${key || String(text).toLowerCase()}`;
    if (!out.has(k)) out.set(k, { key: k, kind, text: String(text) });
  };

  for (const [kind, re, norm] of PATTERNS) {
    for (const m of raw.matchAll(re)) add(kind, norm(m[0]), norm(m[0]).toLowerCase());
  }
  // 正则认过的地方不要再当普通词认一遍（TW20 0AE 里的 0ae）
  const taken = raw.replace(new RegExp(PATTERNS.map(([, re]) => re.source).join('|'), 'gi'), ' ');

  const inHead = new Set();
  for (const t of segment(head, '')) if (t.wordLike) inHead.add(String(t.w).toLowerCase());

  for (const t of segment(taken, '')) {
    if (!t.wordLike) continue;
    const w = String(t.w);
    const low = w.toLowerCase();
    if (low.length < 2 || /^\d+$/.test(low) || STOP.has(low) || LABEL.has(low) || low.startsWith('_')) continue;
    if (CJK_RE.test(low)) {
      // 只在正文里出现的两字中文词太廉价（「了一」甚至不是词，是「当了一大批」切出来的），
      // 除非这个工作区里有谁把它写在过标题上
      if (low.length < 3 && !inHead.has(low) && !(titled && titled.has(low))) continue;
      add(places && places.has(low) ? 'place' : 'name', w, low);
      continue;
    }
    // 拉丁词只认专名：原文里首字母大写过的那些，而且不在网页家具那张表里
    if (low.length < 3 || CHROME.has(low)) continue;
    if (!new RegExp(`\\b${low[0].toUpperCase()}${low.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(raw)) continue;
    add(places && places.has(low) ? 'place' : 'name', w, low);
    if (low.includes('-')) for (const p of low.split('-')) if (p.length >= 3 && !STOP.has(p)) add('name', p, p);
  }
  return [...out.values()];
}

// 一个邮编前后这么多字符之内的词，算它同属一个地址
const PLACE_SPAN = 60;

/**
 * 这个工作区里哪些词是地名。
 *
 * 为什么需要它：罕见度分不出「地名」和「填充词」。实测那一片里，「不能」（3 条提到）、
 * 「Use」（3 条，来自 Terms of Use）都比「Runnymede」（6 条）更罕见，于是共用一个 Runnymede
 * 的那条边比共用一个「不能」的还弱——而 Runnymede 恰恰是「赛程分前后半程」和
 * 「Runnymede Pleasure Ground, Egham, Surrey TW20 0AE」之间唯一那座桥。
 *
 * 判据还是**工作区自己**（这个工作区已经当过三回自己的词典：网址↔标题、重复行、有没有谁
 * 拿它当过标题）：**地名会挨着邮编出现**。「Runnymede Pleasure Ground, Egham, Surrey TW20 0AE」
 * 这一行里，Runnymede / Pleasure / Ground / Egham / Surrey 全都挨着 TW20 0AE。
 * 而「不能」「Use」这辈子不会站在一个邮编旁边。
 *
 * 不用地名词库：那是世界知识，装不下也过期。挨着邮编这件事，是你自己存的东西告诉你的。
 */
function placesIn(entries) {
  const out = new Set();
  const re = PATTERNS[0][1];
  for (const e of entries || []) {
    const raw = `${headOf(e)} ${String((e || {}).text || '').slice(0, 4000)}`;
    for (const m of raw.matchAll(new RegExp(re.source, 'g'))) {
      const a = Math.max(0, m.index - PLACE_SPAN);
      const near = raw.slice(a, m.index + m[0].length + PLACE_SPAN).replace(new RegExp(re.source, 'g'), ' ');
      for (const t of segment(near, '')) {
        if (!t.wordLike) continue;
        const w = String(t.w).toLowerCase();
        if (w.length < 2 || /^\d+$/.test(w) || STOP.has(w) || CHROME.has(w) || LABEL.has(w)) continue;
        out.add(w);
      }
    }
  }
  return out;
}

/**
 * 整个工作区的实体表。**现算，不落库。**
 * @returns {{ents:Map<string,{key,kind,text,records:string[]}>, byRecord:Map<string,string[]>}}
 */
function index(entries, stripOf) {
  const titled = new Set();
  for (const e of entries || []) {
    for (const t of segment(headOf(e), '')) if (t.wordLike) titled.add(String(t.w).toLowerCase());
  }
  const places = placesIn(entries);
  const ents = new Map();
  const raw = new Map();
  for (const e of entries || []) {
    if (!e || !e.id) continue;
    const list = of(e, stripOf ? stripOf(e) : undefined, titled, places);
    raw.set(e.id, list);
    for (const x of list) {
      if (!ents.has(x.key)) ents.set(x.key, { ...x, records: [] });
      ents.get(x.key).records.push(e.id);
    }
  }
  // 只被一条提到的不是这个工作区里的一样东西；被三十条以上提到的是通用词汇
  for (const [k, x] of [...ents]) if (x.records.length < MIN_DF || x.records.length > MAX_DF) ents.delete(k);

  const byRecord = new Map();
  for (const [id, list] of raw) {
    // 一条记录只挂几个，**先看有没有人拿它当过标题，再看罕见**。
    //
    // 只按罕见排是错的，实测栽得很难看：「赛程分前后半程」那条正文里写着 Runnymede，
    // 而 Runnymede 被 8 条记录提到，于是它排在 不能(3)、服务(6)、之间(5)、小时(6)、参考(6)
    // 后面，被挤出了这条记录的二十个名额。结果那条讲赛程的记录和「Runnymede Pleasure Ground,
    // Egham, Surrey TW20 0AE」之间连不上——两条都写着同一个地名，而其中一条把它丢了。
    // 罕见度分不出「地名」和「填充词」：填充词也可以很罕见，而且中文的填充词是无穷多的。
    // 分得出的是另一件事——**这个工作区里有没有谁把它写在标题上过**。地名有，「之间」没有。
    const keep = list.filter((x) => ents.has(x.key))
      .sort((a, b) => (nameRank(a, titled) - nameRank(b, titled))
        || (ents.get(a.key).records.length - ents.get(b.key).records.length))
      .slice(0, PER_RECORD)
      .map((x) => x.key);
    byRecord.set(id, keep);
    for (const [k, x] of ents) if (x.records.includes(id) && !keep.includes(k)) x.records = x.records.filter((r) => r !== id);
  }
  for (const [k, x] of [...ents]) if (x.records.length < MIN_DF) ents.delete(k);
  return { ents, byRecord };
}

/**
 * 挂哪几个的第一顺位：邮编、日期、数量是正则认死的，最硬；其次是被谁当过标题的词；
 * 剩下的只在正文里出现过，最后。
 */
function nameRank(x, titled) {
  if (x.kind !== 'name') return 0;                       // place / date / qty
  return titled && titled.has(String(x.text).toLowerCase()) ? 1 : 2;
}

/** 提到这样东西的记录越少，这条「提到」边越硬——一个邮编比一个常见的名字值钱得多。 */
const weight = (n) => 0.55 + 0.40 / Math.log2(2 + Math.max(1, n));

module.exports = { of, index, weight, headOf, nameRank, placesIn, CHROME, MIN_DF, MAX_DF, PER_RECORD, PATTERNS, PLACE_SPAN };
