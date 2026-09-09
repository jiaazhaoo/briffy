'use strict';
// 词表，落在库里、一条一条地建。
//
// 在这之前，「这个工作区里有哪些词、谁提过、谁和谁是一回事」是每五分钟把每一天读进内存
// 重算一遍的三个 Map（links.evidenceIndex）。250 条上 69ms、11MB，看不出问题；
// 按 O(n) 外推到 20 万条是 55 秒、8.8GB——而它是**每存一条新记录就整个重来一次**。
// ask.js 顶上那段注释讲的正是同一种死法（listEntries({limit:Infinity})，20 万条 215MB、
// 外推 185 万条 7GB），那次治好了检索，这次轮到词表。
//
// 两遍，都是增量的：
//
//   甲 · 收集（跟着建索引走，一天一次）
//       把这一天每条记录的抬头词记进 voc_titled，把挨着邮编出现的词记进 voc_place。
//       两张表都**单调只增**：一个词被谁当过标题这件事不会撤销。所以永远不用重算，也不会漂。
//       这一遍很便宜——只切抬头，不碰正文。
//
//   乙 · 抽词（限时、可中断、下次接着做）
//       用甲的两张表当依据，把一条记录的词抽出来写进 voc / voc_of。形状和 vector.fill 一样，
//       因为要解的是同一个问题：一件 O(n) 的活儿不能卡在启动那几秒里。
//
// 为什么分两遍：抽词要先知道「这个词有没有人当过标题」「是不是地名」，而那是全库统计。
// 甲跟着 sync 走完，乙才开始，于是乙看到的是完整的词汇表。新记录进来时甲先加、乙再抽，
// 老记录不重抽——那点漂移会在那一天的文件下次被改动时自己抹平。
//
// **家具表没有搬过来。** boilerplate 有两条规则：跨记录重复的行，和成串的短行。
// 前者在真实工作区上只剥掉 3%（boilerplate.js 顶上量过），却要为它存下每条记录的每一行；
// 后者是纯粹逐条的、不需要别的记录作证，而且是主力。所以这里只用后者（strip(text, null)）。
const entity = require('./entity');
const pageKey = require('./page-key');
const boilerplate = require('./boilerplate');
const ocrBoxes = require('./ocr-boxes');
const { segment } = require('./segment');

// 一条记录一次最多抽这么多词写进表。**比 entity.PER_RECORD 宽**：那个是「挂几个」，
// 是排序问题，该在查的时候定；这里是「存几个」。存窄了，以后改一次排序规则就得重扫全库。
const STORE_MAX = 60;
// 抽词规则的版本。**改了 entity.js 的规则就改这个数**，否则已经抽过的记录永远带着旧词：
// 2026-09-08 把文件大小（1.1gb）从证据里去掉之后，「Find parking」照样经 1.1gb 连着「Ollama 地址」，
// 因为那两条的词是改规则之前抽的，voc_done 记着「做过了」。版本对不上就把 voc_done 清掉，
// 后台那个循环会一条条重抽——和向量换模型自动重建是同一个道理，只是向量把模型名算进了指纹。
const RULES = 8;   // 8：CHROME 表去掉菜单栏词和站点名，整屏截图去掉菜单栏那一条（entity.js / ocr-boxes.bodyText，2026-09-09）
// 包含式别名（staines-upon-thames ⊃ thames）里，长的那个得是复合词——带连字符、空格或数字。
// 否则英文的词形变化全成了别名（visitors ⊃ visit），和 links.js 里那条同一个规矩。
const compound = (t) => /[a-z]/.test(t) && /[^a-z]/.test(t);

/**
 * 甲：这一天里能收集到的抬头词和地名。不碰正文，只切抬头 + 邮编附近。
 * @returns {{titled:string[], places:string[]}}
 */
function harvest(entries) {
  const titled = new Set();
  for (const e of entries || []) {
    // briffy 自己的截图不算数：它的抬头是「全部 截图 剪贴板 收藏 更多」，拿它当过标题，
    // 「全部」就成了正经的抬头词，然后六条不相干的记录经「全部」连成一片。
    // （只剩旧记录会这样，它们盖着 context.self 的章；新的采集里 briffy 自己不在画面上。）
    if (e && e.context && e.context.self) continue;
    for (const t of segment(entity.headOf(e), '')) if (t.wordLike) titled.add(String(t.w).toLowerCase());
  }
  return { titled: [...titled], places: [...entity.placesIn(entries)] };
}

/** 建索引的时候顺手把甲那一遍做了。 */
function collect(index, entries) {
  const { titled, places } = harvest(entries);
  index.addTitled(titled);
  index.addPlaces(places);
  return { titled: titled.length, places: places.length };
}

/**
 * 乙：给还没抽过词的记录抽词。限时，没做完下次接着做。
 * @param {object} index
 * @param {(id:string)=>object|null} getEntry
 * @returns {{done:boolean, n:number, ms:number}}
 */
function fill(index, getEntry, { budgetMs = 800, batch = 60 } = {}) {
  const t0 = Date.now();
  let n = 0;
  if (String(index.get('vocabRules') || '') !== String(RULES)) {
    index.forgetVocab();
    index.set('vocabRules', String(RULES));
  }
  const titled = index.titledSet();
  const places = index.placeSet();
  for (;;) {
    const ids = index.vocabPending(batch);
    if (!ids.length) return { done: true, n, ms: Date.now() - t0 };
    for (const id of ids) {
      const e = getEntry(id);
      // 取不到的记录也要标记做过，否则它每一轮都被挑出来，这个循环就再也走不到头
      if (!e) { index.putVocab(id, []); continue; }
      const body = boilerplate.strip(ocrBoxes.bodyText(e), null);
      // 存进去的次序就是 rank。**排序在这儿定，不在查的时候定**——因为 df 的含义依赖它
      // （见 index-db 里 voc_of.rank 那段）。改排序规则的时候重排 rank 就行，词不用重抽。
      // 只按 nameRank 排，不按 df：这一刻还没有 df，df 正是靠这个 rank 数出来的。
      const list = entity.of(e, body, titled, places)
        .sort((a, b) => entity.nameRank(a, titled) - entity.nameRank(b, titled))
        .slice(0, STORE_MAX);
      index.putVocab(id, list);
      n++;
    }
    if (Date.now() - t0 > budgetMs) return { done: false, n, ms: Date.now() - t0 };
  }
}

/**
 * 一个和 links.evidenceIndex 同形状的东西，但背后是表，不是整个工作区的三个 Map。
 *
 * 拿到的是**这几条记录**周围那一小块词表，不是全部：evidenceFor 只会问「我身上这几个词」
 * 和「谁也提过它们」，那就只取这些。一条记录二十来个词，展开成几百条候选，
 * 和库里一共有多少条记录没关系——这正是搬进表里要买的东西。
 *
 * @param {object} index
 * @param {string[]} ids 要为哪几条记录准备（追问的名字要沿着记录取，所以给它一圈邻居）
 * @returns {{post:Map, df:Map, words:Map, text:Map, kind:Map, alias:Map}}
 */
function viewFor(index, ids, { maxDf = 30, minDf = 2, keep = 20 } = {}) {
  const words = new Map();
  const text = new Map();
  const kind = new Map();
  const seed = new Set();
  for (const id of new Set(ids || [])) {
    const rows = index.vocabOf(id);
    for (const r of rows) { text.set(r.key, r.text); kind.set(r.key, r.kind); seed.add(r.key); }
    words.set(id, rows.map((r) => r.key));
  }
  const df = index.vocabDf([...seed], { keep });
  // 全库门槛在这儿兑现，不在存的时候：只被一条提过的不是这个工作区里的一样东西，
  // 三十条以上都提的是通用词汇。存的时候不筛，是因为 df 会变，而重扫全库很贵。
  const live = [...seed].filter((k) => { const n = df.get(k) || 0; return n >= minDf && n <= maxDf; });
  const post = index.vocabPost(live, { keep });
  // 指纹 = 这条记录 rank 最靠前的那几个（vocabOf 已经按 rank 排好），再滤掉过冷过热的词。
  const liveSet = new Set(live);
  for (const [id, keys] of words) words.set(id, new Set(keys.slice(0, keep).filter((k) => liveSet.has(k))));
  return { post, df, words, text, kind, alias: aliasFor(index, live, text) };
}

// 模糊配对：谁和谁是同一样东西的两个说法。
//
// 全局那一版是所有词两两比包含关系，O(词²)。这里只比**这次用得上的那几个词**和整张词表的
// 交集，而且只走包含这一条（staines-upon-thames ⊃ thames）。
// 全局那一版还有一条「标题里并排出现过」（泰晤士河 ≈ Thames），那条需要扫全部记录的抬头，
// 搬不进这个形状——先欠着，欠在这儿而不是悄悄没了。
function aliasFor(index, keys, text) {
  const alias = new Map();
  if (!keys.length) return alias;
  const link = (a, b) => {
    if (a === b) return;
    if (!alias.has(a)) alias.set(a, new Set());
    if (!alias.has(b)) alias.set(b, new Set());
    alias.get(a).add(b); alias.get(b).add(a);
  };
  const all = index.vocabWords();
  for (const k of keys) {
    const tk = String(text.get(k) || '').toLowerCase();
    if (!tk) continue;
    for (const r of all) {
      const tr = String(r.text || '').toLowerCase();
      if (tr === tk) continue;
      if (tk.length >= 8 && compound(tk) && tr.length >= 4 && tk.includes(tr)) link(k, r.key);
      else if (tr.length >= 8 && compound(tr) && tk.length >= 4 && tr.includes(tk)) link(k, r.key);
    }
  }
  return alias;
}

/**
 * 丙：定次序。抽词的时候还没有 df（df 正是靠次序数出来的），所以先按种类粗排一遍存下，
 * 等大家都抽完了再回来按「种类，然后罕见度」排定。**只改 rank，一个词都不用重抽。**
 *
 * 这也是 rank 这一列真正的价值：以后改排序规则——今天就改过两次（先看有没有当过标题、
 * 再改成 tf-idf）——重跑这一遍就行，不用把全库的词重抽一次。
 * @returns {{done:boolean, n:number, ms:number}}
 */
function settle(index, { budgetMs = 800, batch = 100, keep = 20 } = {}) {
  const t0 = Date.now();
  let n = 0;
  for (;;) {
    const ids = index.vocabUnsettled(batch);
    if (!ids.length) return { done: true, n, ms: Date.now() - t0 };
    for (const id of ids) {
      const rows = index.vocabOf(id);
      const df = index.vocabDf(rows.map((r) => r.key), { keep });
      const sorted = rows.slice().sort((a, b) => (entity.nameRank(a, null) - entity.nameRank(b, null))
        || ((df.get(a.key) || 99) - (df.get(b.key) || 99)));
      index.reRank(id, sorted.map((r) => r.key));
      index.markSettled(id);
      n++;
    }
    if (Date.now() - t0 > budgetMs) return { done: false, n, ms: Date.now() - t0 };
  }
}

/**
 * 和 viewFor 同一个形状，但**什么都不预先算**：问到哪一条才去库里取哪一条，取过就留着。
 *
 * 这是整件事的收口。追问取名字是沿着记录一条一条走的，它事先并不知道会走到谁；
 * 而以前那套要它开工之前先把整个工作区的词表建好（250 条 56ms / 11MB，20 万条 55s / 8.8GB）。
 * 换成懒的之后，一次扩散最多碰四十个节点，就只取这四十条的词——**和库里一共有多少条无关**。
 *
 * 只实现 get/has：evidenceFor、story.nameOf、ask.namesIn 只用这两个。
 * @returns {{post:Map, df:Map, words:Map, text:Map, kind:Map, alias:Map}}
 */
function lazyView(index, { maxDf = 30, minDf = 2, keep = 20, ok = null } = {}) {
  const text = new Map();
  const kind = new Map();
  const dfC = new Map();
  const postC = new Map();
  const wordsC = new Map();
  const aliasC = new Map();
  let allWords = null;     // 模糊配对要整张词表，但只在真的用到时取一次

  // ok：哪些记录算材料。给了它，不是材料的记录既不出词、也不进任何倒排，df 也只数材料。
  //
  // df 必须跟着倒排一起过滤，不能只滤倒排。briffy 自己的截图上正好显示着你的十几条记录，
  // 于是你每一条的标题词它都占——df 被系统性地抬高，抬的正是那些本该最罕见的词：
  // 「dell」实际 4 条，算上倒影 9 条；一个真正罕见的词被抬过 EV_NEEDDF 就不再算证据。
  const postOf = (k) => {
    if (!postC.has(k)) {
      const list = index.vocabPost([k], { keep }).get(k) || [];
      postC.set(k, ok ? list.filter(ok) : list);
    }
    return postC.get(k);
  };
  const dfOf = (k) => {
    if (!dfC.has(k)) dfC.set(k, ok ? postOf(k).length : (index.vocabDf([k], { keep }).get(k) || 0));
    return dfC.get(k);
  };
  const wordsOf = (id) => {
    if (wordsC.has(id)) return wordsC.get(id);
    if (ok && !ok(id)) { wordsC.set(id, new Set()); return wordsC.get(id); }
    const rows = index.vocabOf(id);                       // 已按 rank 排好
    for (const r of rows) { text.set(r.key, r.text); kind.set(r.key, r.kind); }
    const keys = rows.slice(0, keep).map((r) => r.key);
    // 全库门槛在这儿兑现，不在存的时候——df 会变，而重扫全库很贵
    const dfs = ok ? new Map(keys.map((k) => [k, postOf(k).length])) : index.vocabDf(keys, { keep });
    for (const [k, n] of dfs) dfC.set(k, n);
    for (const k of keys) if (!dfC.has(k)) dfC.set(k, 0);
    const out = new Set(keys.filter((k) => { const n = dfC.get(k) || 0; return n >= minDf && n <= maxDf; }));
    wordsC.set(id, out);
    return out;
  };
  const aliasOf = (k) => {
    if (aliasC.has(k)) return aliasC.get(k);
    if (!allWords) { allWords = index.vocabWords(); for (const r of allWords) { if (!text.has(r.key)) text.set(r.key, r.text); if (!kind.has(r.key)) kind.set(r.key, r.kind); } }
    const tk = String(text.get(k) || '').toLowerCase();
    const out = new Set();
    if (tk) {
      for (const r of allWords) {
        const tr = String(r.text || '').toLowerCase();
        if (tr === tk) continue;
        if ((tk.length >= 8 && compound(tk) && tr.length >= 4 && tk.includes(tr))
          || (tr.length >= 8 && compound(tr) && tk.length >= 4 && tr.includes(tk))) out.add(r.key);
      }
    }
    aliasC.set(k, out);
    return out;
  };
  const lazy = (get) => ({ get, has: (k) => get(k) !== undefined });
  return {
    words: lazy(wordsOf),
    df: lazy(dfOf),
    post: lazy(postOf),
    alias: lazy(aliasOf),
    text: { get: (k) => text.get(k), has: (k) => text.has(k) },
    kind: { get: (k) => kind.get(k), has: (k) => kind.has(k) },
  };
}

// ---------- 页面图 ----------
//
// 和词表同一个搬法：以前 links.build 每次用都把整个工作区读进来重建（250 条 3ms，
// 外推 20 万条 2.4 秒），而它被每开一次详情页、每问一次各调一次。
//
// 三样东西，各有各的存法：
//   · 「哪几个说法指同一页」——并查集，天生增量，每来一条记录做一次 union
//   · 「谁从哪一页摘的」——一条记录一行
//   · 「同一程」——**根本不存**，它就是时间上挨着，entries(at) 上一个范围查询

/** 建这一天索引时顺手把页面图也建了。 */
function collectPages(index, entries) {
  let n = 0;
  for (const e of entries || []) {
    if (!e || !e.id) continue;
    const ks = pageKey.pageKeysOf(e);
    // 一条记录同时带着网址和标题，就是「这两个说法指同一页」的一份证词
    if (ks.length > 1) index.pgUnion(ks);
    if (ks.length) {
      const root = index.pgRoot(ks[0]);
      const readable = ks.find((x) => !/^https?:/i.test(x));
      index.putClip(e.id, root, readable || '');
      n++;
    }
    // 「它就是这一页」——收藏了那一页，书签是这个节点本身，不是它的兄弟
    for (const raw of pageKey.pageIdentityOf(e)) {
      if (index.putPage(e.id, index.pgRoot(raw), String(e.title || '').replace(/\s+/g, ' ').trim())) break;
    }
  }
  return n;
}

/**
 * 页面图上这一条周围那几行：它来自哪一页、那一页上还摘了哪几条、同一程里的页面。
 *
 * 「一页上摘了太多条就整组丢掉」（外壳页，比如 Google Maps、Claude）那条规矩在这儿兑现，
 * 不在存的时候——条数会变，而重扫全库很贵。和 df 那一处是同一个道理。
 * @returns {{source:object|null, clips:string[], run:{ids:string[], pages:object[]}}}
 */
function linksOfDb(index, id, { runLimit = 6, maxClips = pageKey.MAX_CLIPS, gapMs = pageKey.RUN_GAP_MS } = {}) {
  const me = String(id || '');
  const out = { source: null, clips: [], run: { ids: [], pages: [] } };
  const page = (k) => {
    if (!k) return null;
    const p = index.pageInfo(k);
    if (!p || p.clips.length > maxClips) return null;   // 外壳，整组不算
    return p;
  };
  const mine = page(index.pageOfEntry(me));
  if (mine && mine.page !== me) out.source = { key: mine.key, name: mine.name, page: mine.page };
  const owned = page(index.pageOwnedBy(me));
  if (owned) out.clips = owned.clips.slice();

  const run = index.runAround(me, { gapMs });
  if (run.length > 1) {
    out.run.ids = run.filter((x) => x !== me);
    const at = run.indexOf(me);
    const seen = new Map();
    const myKey = index.pageOfEntry(me);
    for (let i = 0; i < run.length; i++) {
      const k = index.pageOwnedBy(run[i]) || index.pageOfEntry(run[i]);
      if (!k || seen.has(k)) continue;
      const p = page(k);
      if (!p || p.page === me || k === myKey) continue;
      // first：那一页你多半没存下来，所以给一条它上面的摘录当代表——不然「同一程」永远是空的
      seen.set(k, { key: p.key, name: p.name, page: p.page, first: p.page || p.clips[0] || '', d: Math.abs(i - at) });
    }
    out.run.pages = [...seen.values()].sort((a, b) => a.d - b.d).slice(0, runLimit).map(({ d, ...p }) => p);
  }
  return out;
}

/** 搜索框「同一页」那条腿用的 g（ask.near）：它只问 linksOf 和 pages.get(key)。 */
function pageGraph(index, opts = {}) {
  return {
    __db: true,
    linksOf: (id) => linksOfDb(index, id, opts),
    pages: { get: (k) => index.pageInfo(k) || { clips: [] }, has: (k) => !!index.pageInfo(k) },
  };
}

module.exports = { harvest, collect, fill, settle, viewFor, lazyView, aliasFor, collectPages, linksOfDb, pageGraph, STORE_MAX, RULES };
