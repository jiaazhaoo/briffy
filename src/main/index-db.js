'use strict';
// 一个磁盘上的索引，让「问我的记录」不必先把所有记录读进内存。
//
// 起因是量出来的：ask.js 每问一次就 store.listEntries({ limit: Infinity })，把每一天的文件都读进来
// 拼成一个数组。20 万条实测占 215MB、打分 707ms；按真实平均长度外推到 185 万条是 7GB 左右的堆——
// 那不是慢，是每问一次就崩一次。模型那头始终只看 40 条，从来不是瓶颈。
//
// 用 SQLite，而且不加任何依赖：Electron 44 带的 Node 里 node:sqlite 就有 FTS5（在 Electron 里验过）。
//
// 走这条路，20 万条、齐夫分布的语料上实测：
//
//   建索引        40s（一次性，之后只重读改过的那一天）      库 115MB      进程堆 28MB（旧路径 215MB）
//   稀有词        1ms，全库仅有的那一条准确命中
//   两个词 AND    46ms      常见词 73ms      英文 14ms
//   按天取一周    1ms       334 天的计数 0ms
//
// 建索引那 40 秒里绝大部分是 ICU 分词，不是 SQLite。
//
// 三件事必须说清楚，都是量出来才知道的：
//
//   **中文要自己分词。** FTS5 自带的 unicode61 把一整串中文当作一个词，trigram 又要求至少三个字符——
//   两者搜「会议」都返回 0。所以入库和查询都先过 segment.js（ICU），存空格分开的词流。
//
//   **耗时跟命中行数走，不跟库大小走。** 命中 0.16% 时 2ms，命中全部时 1427ms，因为 ORDER BY rank
//   要给每一个命中打分。所以查询要先用天和类型把范围收窄，并且丢掉过于常见的词——只丢停用词不够。
//
//   **索引是可以扔的。** 它住在 userData 而不是工作区：工作区会被用户搬走、拷贝、换掉，而这里的东西
//   全都能从工作区重新算出来。meta 里记着它是照着哪个工作区、哪一版 schema 建的，对不上就重建。
const path = require('path');
const chunk = require('./chunk');
const fs = require('fs');
const { segment } = require('./segment');

const SCHEMA = 5;                  // 改了表结构就加一，旧库直接重建
const BODY_MAX = 4000;             // 一条记录进倒排的字数上限；OCR 大段的尾巴对找东西没有帮助

let db = null;
let file = '';
// 算内容指纹时要把模型名带上，换了模型旧向量才会自动作废。vector.js 打开索引时设进来。
let vecModel = '';
function useVecModel(name) { vecModel = String(name || ''); }

/** 分词后的词流，入库和查询共用一套，否则两边切得不一样就永远对不上。 */
function tokens(text) {
  const out = [];
  for (const t of segment(String(text || '').slice(0, BODY_MAX), '')) {
    if (t.wordLike) out.push(t.w.toLowerCase());
  }
  return out;
}

/** 一条记录里所有值得被搜到的字。 */
function bodyOf(e) {
  const c = e.context || {};
  return tokens([
    e.title, e.summary, e.text, e.note, (e.tags || []).join(' '), e.visionLabels,
    c.app, c.window, c.url, e.url, e.path,
  ].filter(Boolean).join(' ')).join(' ');
}

function open(userDataDir, workspaceDir) {
  if (db) return db;
  const { DatabaseSync } = require('node:sqlite');
  file = path.join(userDataDir, 'index.db');
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS entries(
      rowid INTEGER PRIMARY KEY, id TEXT UNIQUE, day TEXT, at TEXT,
      type TEXT, app TEXT, pinned INTEGER DEFAULT 0, hash TEXT
    );
    CREATE INDEX IF NOT EXISTS i_day ON entries(day);
    CREATE INDEX IF NOT EXISTS i_type ON entries(type);
    CREATE TABLE IF NOT EXISTS days(day TEXT PRIMARY KEY, n INTEGER, stamp TEXT);
    -- content='' 是不存原文、只存倒排，省下一大半体积；contentless_delete=1 是为了还能删——
    -- 少了它，重新索引某一天时 DELETE 会直接报 "cannot DELETE from contentless fts5 table"。
    CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(body, content='', contentless_delete=1);
    -- 每个词出现在多少条记录里。用来在查询前丢掉过于常见的词：耗时是跟命中行数走的，
    -- 一个几乎每条都有的词（自己的用户名、常驻应用名）会把整条查询从 2ms 拖到 1.4 秒。
    -- 'row' 模式给出 term / doc / cnt 三列：doc 是含这个词的记录条数，cnt 是总出现次数。
    -- 要的是 doc。用 cnt 会把「在一条记录里重复十遍」误判成「十条记录都有」——实测 walking
    -- 只在 6 条里出现，cnt 却是 12，于是它被当成不够稀有，正好错过该被挑出来的那个词。
    CREATE VIRTUAL TABLE IF NOT EXISTS vocab USING fts5vocab(fts, 'row');
    -- 向量，一块一行。不是「一条记录一行」，因为模型一次只读 128 个 token，长记录必须切开
    -- （见 chunk.js）。也不跟 rowid 走，跟记录 id 走：天文件是整体重写的，今天每存一条新东西
    -- 整个今天都会重新索引，rowid 全变，那样每存一次就得把今天算过的向量全部重算。
    -- hash 是内容 + 模型 + 切法的指纹：内容没变就不重算，换了模型旧向量自动作废。
    CREATE TABLE IF NOT EXISTS vec(id TEXT, seq INTEGER, hash TEXT, v BLOB, PRIMARY KEY(id, seq));
    CREATE INDEX IF NOT EXISTS i_vec_id ON vec(id, hash);
  `);
  const got = { schema: get('schema'), workspace: get('workspace') };
  if (got.schema !== String(SCHEMA) || got.workspace !== workspaceDir) {
    wipe();
    set('schema', String(SCHEMA));
    set('workspace', workspaceDir);
  }
  return db;
}

function get(k) { const r = db.prepare('SELECT v FROM meta WHERE k=?').get(k); return r ? r.v : null; }
function set(k, v) { db.prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v)); }

/** 扔掉重建。索引里没有任何工作区里没有的东西，所以这一步永远是安全的。 */
function wipe() {
  db.exec('DELETE FROM fts; DELETE FROM entries; DELETE FROM days; DELETE FROM meta;');
}

function close() { if (db) { try { db.close(); } catch (_) { /* 已经关了 */ } } db = null; }

// ---------- 写 ----------

/** 一整天，整批换掉。天文件本来就是整个重写的，逐条比对不划算。 */
function putDay(dayKey, list, stamp) {
  const rows = db.prepare('SELECT rowid FROM entries WHERE day=?').all(dayKey);
  db.exec('BEGIN');
  try {
    for (const r of rows) db.prepare('DELETE FROM fts WHERE rowid=?').run(r.rowid);
    db.prepare('DELETE FROM entries WHERE day=?').run(dayKey);
    const ins = db.prepare('INSERT INTO entries(id,day,at,type,app,pinned,hash) VALUES(?,?,?,?,?,?,?)');
    const insF = db.prepare('INSERT INTO fts(rowid,body) VALUES(?,?)');
    let n = 0;
    for (const e of list) {
      if (!e || !e.id || e.status === 'error') continue;
      const c = e.context || {};
      const r = ins.run(e.id, dayKey, String(e.createdAt || ''), String(e.type || ''), String(c.app || ''), e.pinned ? 1 : 0, chunk.hashOf(e, vecModel));
      insF.run(r.lastInsertRowid, bodyOf(e));
      n++;
    }
    db.prepare('INSERT INTO days(day,n,stamp) VALUES(?,?,?) ON CONFLICT(day) DO UPDATE SET n=excluded.n, stamp=excluded.stamp')
      .run(dayKey, n, String(stamp || ''));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/** 这一天需要重新索引吗。天文件是整体重写的，所以改动时间加大小就够当指纹。 */
function dayIsStale(dayKey, stamp) {
  const r = db.prepare('SELECT stamp FROM days WHERE day=?').get(dayKey);
  return !r || r.stamp !== String(stamp || '');
}

/**
 * 把工作区里所有变过的天重新索引一遍。
 *
 * `budgetMs` 是为了第一次：一个已经用了几年的工作区，从零建索引要好几分钟（20 万条实测 40 秒，
 * 大头是 ICU 分词）。第一次提问不能卡在那里，所以给一个时限，做多少算多少，剩下的下一次接着做——
 * 天是从新到旧排的，所以先建起来的正好是最可能被问到的那几天。
 *
 * @param {{dir:string, loadDay:function}} src 工作区的目录，和读一天的函数
 * @param {{budgetMs?:number}} opts
 * @returns {{days:number, entries:number, ms:number, done:boolean}} 这次动了多少，以及是不是追平了
 */
function sync(src, { budgetMs = Infinity } = {}) {
  const t0 = Date.now();
  let days = 0; let entries = 0;
  let files = [];
  try { files = fs.readdirSync(src.dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)); } catch (_) { return { days: 0, entries: 0, ms: 0, done: true }; }
  const seen = new Set();
  let ranOut = false;
  // 新的先建：先补上的就是最可能被问到的那几天
  for (const f of files.sort().reverse()) {
    const dayKey = f.slice(0, 10);
    seen.add(dayKey);
    let st;
    try { st = fs.statSync(path.join(src.dir, f)); } catch (_) { continue; }
    const stamp = `${st.mtimeMs}:${st.size}`;
    if (!dayIsStale(dayKey, stamp)) continue;
    if (Date.now() - t0 > budgetMs) { ranOut = true; break; }
    const list = src.loadDay(dayKey) || [];
    putDay(dayKey, list, stamp);
    days++; entries += list.length;
  }
  // 天文件被删掉了，索引也得跟着掉。没做完时先不清，否则会把还没轮到的那些当成删了。
  if (!ranOut) {
    for (const r of db.prepare('SELECT day FROM days').all()) {
      if (!seen.has(r.day)) { putDay(r.day, [], ''); db.prepare('DELETE FROM days WHERE day=?').run(r.day); }
    }
  }
  return { days, entries, ms: Date.now() - t0, done: !ranOut };
}

// ---------- 读 ----------

const COMMON = 0.25;      // 出现在超过这一比例记录里的词，不参与匹配

/**
 * 把一句话变成 FTS5 认得的查询。
 *
 * **用户打的一个词要作为一个短语查，不能拆成几个独立的词。** ICU 切不动的组合会被切成单字——
 * 「芹泽」变成 芹 / 泽，「麦克风」变成 麦克 / 风。单个汉字是倒排里最糟的词：几乎每篇都有它，
 * 于是既不准（有「风」的文档全被捞进来）又慢（ORDER BY rank 要给几十万条打分，实测 250ms）。
 * 把子词拼成相邻短语 "麦克 风" 之后，两个毛病一起没了。
 *
 * 顺手丢掉太常见的词：耗时跟命中行数走，一个几乎每条都有的词能把 2ms 拖成 1.4 秒。
 */
// 一个块最多切成这么多个词才还算「一个词组」。再长就不是了：一整句没有标点的中文会被 ICU 切成
// 十个词，把它们拼成一个相邻短语，等于要求这句话原样出现在某条记录里——那永远不成立，而且它是
// AND 的一项，所以它会把整个查询打死。实测：「你帮我看看记录帮我生成行程单」切出十个词，拼成的
// 短语命中 0 条，于是同一个 AND 里的 walking（6 条）和 挑战（5 条）一起陪葬。
// 从 3 收到 2。三个词还当词组，「地址是多少」「是哪个」「谁写的」就都成了必须原样出现的短语，
// 而它们一次也不会出现——于是同一个 AND 里的 ollama、grok、型号 全部陪葬。实测七个日常问题
// 有五个是这么死的，包括「我本机的 ollama 地址是多少」，而工作区里就摆着一条叫「Ollama 地址」
// 的记录。两个词还算词组（白名单、长截图），三个词就是在说话了。
const PHRASE_MAX = 2;
// 稀有词的门槛，和 COMMON 是一头一尾：COMMON 挡的是到处都是的词，这个挑的是真有指向性的词。
const RARE = 0.05;
// 稀有词要共同出现才算数。一个不够——「行程」单独命中的那条和问题多半没关系。
const MIN_HITS = 2;
// 拆出这么多个词以上，打进来的就不是几个关键词而是一句话了。两者要用不同的判据：
// 几个关键词漏一个就是问的不是这件事（「都要有」是对的）；一句话里大半是问话本身的词，
// 要求条条都对上永远不成立。
const SENTENCE = 4;

/**
 * 把一句话拆成能拿去匹配的词。
 * @returns {{key:string, df:number, rareDf:number}[]} key 是空格分隔的相邻词组；df 给 COMMON 用，
 *   rareDf 是词组 df 的上界（取各词里最小的那个），给稀有词那一级用。
 */
function termsOf(question) {
  // 先按用户自己打的边界切开（空格、标点），再让 ICU 去切每一块
  const words = String(question || '').split(/[\s,，、;；。!！?？:：/\\()（）[\]"'`]+/).filter(Boolean);
  const out = [];
  const seen = new Set();
  const push = (key) => { if (key && !seen.has(key)) { seen.add(key); out.push({ key, df: null, rareDf: null }); } };
  for (const w of words) {
    const sub = tokens(w);
    if (!sub.length) continue;
    if (sub.length <= PHRASE_MAX) {
      if (sub.length === 1 && sub[0].length === 1 && !/[\u4e00-\u9fff]/.test(sub[0])) continue;  // 单个字母数字，跳过
      push(sub.join(' '));
      continue;
    }
    // 太长，当不成词组：拆成词。单字丢掉——「的」「我」这种到处都是，AND 上它们只会把命中拖回噪音。
    for (const t of sub) if (t.length > 1) push(t);
  }
  const dfOf = (t) => {
    const r = db.prepare('SELECT doc FROM vocab WHERE term=?').get(t);
    return r ? r.doc : 0;
  };
  for (const p of out) {
    const parts = p.key.split(' ');
    // 只有整词能问到 df；被切开的词组问不到，一律当作不常见（它们本来就更选择性）
    p.df = parts.length > 1 ? 0 : dfOf(p.key);
    // 词组的 df 不会超过它任何一个词的 df，所以取最小的那个当上界就够挑稀有词了
    p.rareDf = Math.min(...parts.map(dfOf));
  }
  return out;
}

function matchExpr(question, { total = 0 } = {}) {
  const phrases = termsOf(question);
  if (!phrases.length) return null;
  const kept = total ? phrases.filter((p) => p.df / total <= COMMON) : phrases;
  const use = kept.length ? kept : phrases;              // 全被丢光就退回原样，总比没有强
  return use.map((p) => `"${p.key.replace(/"/g, '""')}"`);
}

/**
 * 找记录。全部在本地，不碰任何模型。
 * @returns {{ids:string[], scored:boolean, ms:number}}
 */
function search({ query = '', from = '', to = '', type = '', app = '', pinned = false, limit = 40 } = {}) {
  const t0 = Date.now();
  const where = []; const args = [];
  if (from) { where.push('e.day >= ?'); args.push(from); }
  if (to) { where.push('e.day <= ?'); args.push(to); }
  if (type) { where.push('e.type = ?'); args.push(type); }
  if (app) { where.push('lower(e.app) LIKE ?'); args.push(`%${String(app).toLowerCase()}%`); }
  if (pinned) where.push('e.pinned = 1');

  const total = db.prepare('SELECT count(*) c FROM entries').get().c;
  const parts = query.trim() ? termsOf(query) : [];
  const terms = query.trim() ? matchExpr(query, { total }) : null;
  if (!terms) {
    // 没有词，就是「把这段时间给我」——按时间倒着给
    const sql = `SELECT e.id FROM entries e ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.at DESC LIMIT ?`;
    const ids = db.prepare(sql).all(...args, limit).map((r) => r.id);
    return { ids, scored: false, ms: Date.now() - t0, terms: [] };
  }
  // 由紧到松试两次，第一个有结果的就是答案：
  //   1  几个短语都要有 —— 最准，也最快（命中少，ORDER BY rank 就便宜）
  //   2  拆开、仍然都要有 —— 「麦克风白名单」这种连写的长词，整串相邻找不到，拆开找得到
  //
  // 没有第三级的 OR。试过，它把两件事一起弄坏了：「今天做了什么」本该退回成「把今天给我」，
  // 却因为「做了」OR 到了几条弱匹配而变成三条不相干的记录；「麦克风白名单」则捞回十七条噪音。
  // 交白卷是有意义的答案——上层看到空手才知道该退回时间范围。
  //
  // 拆开时丢掉单个汉字：「麦克 风 白 名单」里的 风 和 白 到处都是，AND 上它们只会把命中拖回噪音。
  const loose = [...new Set(terms.flatMap((t) => t.replace(/^"|"$/g, '').split(' ')))]
    .filter((w) => w.length > 1)
    .map((w) => `"${w}"`);
  const sentence = parts.length >= SENTENCE;
  // 拿去在正文里找位置的词。索引里词是空格分开的，原文里中文不带空格，所以要拼回去。
  // 单字不要：它们哪儿都有，截出来的那一段会落在毫无意义的地方。
  const needles = [...new Set(parts.flatMap((p) => [p.key, p.key.replace(/ /g, '')]))].filter((w) => w.length > 1);
  let lead = [];
  const tries = [terms.join(' AND ')];
  // 拆开再 AND 这一级是给「麦克风白名单」这种连写的关键词用的。对一句话它没有意义——它只会
  // 碰巧撞上一条同时含着「看看」「生成」「行程」的记录，然后因为「第一个有结果的就是答案」，
  // 把下面真正该管这件事的那一级挡在门外。实测就是这么坏的。
  if (!sentence && loose.length && loose.length !== terms.length) tries.push(loose.join(' AND '));
  for (const expr of tries) {
    const sql = `SELECT e.id FROM fts f JOIN entries e ON e.rowid = f.rowid
      WHERE f.fts MATCH ? ${where.length ? `AND ${where.join(' AND ')}` : ''}
      ORDER BY rank LIMIT ?`;
    let ids = [];
    try { ids = db.prepare(sql).all(expr, ...args, limit).map((r) => r.id); } catch (_) { ids = []; }
    // 几个关键词的时候，命中就是答案。一句话的时候不是：「都要有」在一句话上能中，往往是因为
    // 撞上了一条正好把这句话本身抄进去的记录——实测这次唯一的命中就是**问题自己**（问完把答案
    // 复制了一份，于是问题的每个词它都占）。所以一句话只让它打头，剩下的位置留给下面那一级。
    if (ids.length && !sentence) return { ids, scored: true, ms: Date.now() - t0, terms: needles };
    if (ids.length) { lead = ids; break; }
  }

  //   3  命中了**几个**稀有词 —— 一句话问出来的词不可能条条都对上
  //
  // 前两级都是「都要有」，那对**打进去的几个关键词**是对的：漏一个就是问的不是这件事。但一句
  // 完整的话不一样，它里面大半是问话本身的词。实测「我最近有个 walking 挑战，你帮我看看记录帮我
  // 生成行程单」：walking 6 条、挑战 5 条，两个一 AND 就是那几条报名记录；可同一个 AND 里还有
  // 帮(1)、生成(2)、行程(1)、看看(7)，没有任何一条记录同时占全，于是交白卷，上层退回「这段时间
  // 最近 40 条」——按时间倒序，和问题毫无关系。
  //
  // 所以这一级换个判据：只看稀有词（df ≤ 5%），按**共同命中的个数**排，至少要两个。
  // 这不会把「今天做了什么」顶掉——那句话拆完只剩「什么」一个词，够不到两个，这一级根本不启动；
  // 也不会把「麦克风 完全不存在的词」凑合成答案——凑不齐两个共同命中的词。
  // 这一级不再看问的是几个词还是一句话。挡噪音的是下面那个 rare.length >= MIN_HITS：
  // 一个查询里凑不出两个稀有词，这一级就根本不启动，「麦克风 完全不存在的词」照旧交白卷。
  const rare = parts.filter((p) => p.rareDf > 0 && p.rareDf / total <= RARE);
  if (rare.length >= MIN_HITS) {
    const count = new Map();
    const dfOfTerm = new Map();
    for (const p of rare) {
      const sql = `SELECT e.id FROM fts f JOIN entries e ON e.rowid = f.rowid
        WHERE f.fts MATCH ? ${where.length ? `AND ${where.join(' AND ')}` : ''} LIMIT 500`;
      let rows = [];
      try { rows = db.prepare(sql).all(`"${p.key.replace(/"/g, '""')}"`, ...args); } catch (_) { rows = []; }
      const plain = p.key.replace(/ /g, '');
      dfOfTerm.set(plain, p.rareDf);
      for (const r of rows) { if (!count.has(r.id)) count.set(r.id, new Set()); count.get(r.id).add(plain); }
    }
    // 以前这里还要求「至少有一条记录同时占着两个稀有词」，否则整个交白卷。那一条是多余的保护，
    // 而且很贵：「中国区的付费我当时打算怎么改」里 中国 只有 2 条记录有，命中一条已经很有指向性，
    // 却因为凑不出第二个词被全部丢掉。真正在挡噪音的是上面那个「查询里得有两个稀有词」。
    // 命中两个的排在只命中一个的前面，这在下面的 sort 里。
    const good = [...count.entries()].filter(([id]) => !lead.includes(id));
    if (good.length) {
      // 命中的词多的在前；一样多就近的在前
      const at = new Map(db.prepare(`SELECT id, at FROM entries WHERE id IN (${good.map(() => '?').join(',')})`)
        .all(...good.map(([id]) => id)).map((r) => [r.id, r.at]));
      // 只命中一个词的记录之间，比的是**那个词有多稀有**，不是谁更新。以前按时间排，于是
      // 「grok」(6 条) 和「那个」「什么」(各 8 条) 平起平坐，更近的那些赢了，真正写着
      // blessonism/grok-icon-study 的那条被挤到第 13 位，再被 keep=8 切掉。
      const best = (w) => Math.min(...[...w].map((t) => dfOfTerm.get(t) ?? Infinity));
      good.sort((a, b) => (b[1].size - a[1].size)
        || (best(a[1]) - best(b[1]))
        || String(at.get(b[0]) || '').localeCompare(String(at.get(a[0]) || '')));
      const ids = [...lead, ...good.map(([id]) => id)].slice(0, limit);
      // 每条命中了哪几个词，排序和取舍在 retrieve.js 里做——那儿看得到正文，这儿看不到。
      const matched = {};
      for (const [id, w] of good) matched[id] = [...w];
      return { ids, scored: true, ms: Date.now() - t0, terms: needles, matched };
    }
  }
  if (lead.length) return { ids: lead, scored: true, ms: Date.now() - t0, terms: needles };
  return { ids: [], scored: true, ms: Date.now() - t0, terms: needles };
}

// ---------- 向量 ----------

/**
 * 还没算向量、或者算的那份已经过期的记录。
 *
 * 「过期」指内容指纹对不上——记录改过，或者换了模型 / 改了切法。判断全在 SQL 里，
 * 不用把天文件读出来，所以问一次是常数代价，可以在后台循环里随便问。
 * @returns {{id:string, day:string}[]}
 */
function needVec(limit = 40) {
  return db.prepare(`SELECT e.id, e.day FROM entries e
    LEFT JOIN vec v ON v.id = e.id AND v.hash = e.hash
    WHERE v.id IS NULL GROUP BY e.id ORDER BY e.at DESC LIMIT ?`).all(limit);
}

/** 一条记录的全部块，整批换掉。 */
function putVec(id, hash, vectors) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM vec WHERE id=?').run(id);
    const ins = db.prepare('INSERT INTO vec(id,seq,hash,v) VALUES(?,?,?,?)');
    vectors.forEach((v, i) => ins.run(id, i, hash, Buffer.from(Float32Array.from(v).buffer)));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/**
 * 扫一遍所有向量，边扫边算分。这里不建近似索引：现在是几百行，点积在 JS 里零点几毫秒；
 * 真到了几百万行，该换的是存储（float32 → int8），不是先上一个没人看得懂的近似结构。
 * @param {(id:string, v:Float32Array)=>void} fn
 */
function vecScan(fn, { day = '' } = {}) {
  const sql = day
    ? 'SELECT v.id, v.v FROM vec v JOIN entries e ON e.id = v.id WHERE e.day >= ? ORDER BY v.id'
    : 'SELECT id, v FROM vec ORDER BY id';
  for (const r of (day ? db.prepare(sql).all(day) : db.prepare(sql).all())) {
    fn(r.id, new Float32Array(r.v.buffer, r.v.byteOffset, r.v.byteLength / 4));
  }
}

/** 已经算了多少、还欠多少、占多大。 */
function vecStats() {
  const rows = db.prepare('SELECT count(*) c, coalesce(sum(length(v)),0) b FROM vec').get();
  // DISTINCT：一条记录有好几块，不去重的话「已算多少条」会数成块数
  const done = db.prepare('SELECT count(DISTINCT e.id) c FROM entries e JOIN vec v ON v.id=e.id AND v.hash=e.hash').get().c;
  const all = db.prepare('SELECT count(*) c FROM entries').get().c;
  return { chunks: rows.c, bytes: rows.b, entries: done, total: all, pending: all - done };
}

/** 记录已经不在了，它的向量也该走。天文件重写会让记录消失，但 vec 是按 id 存的，不会自己掉。 */
function sweepVec(limit = 200) {
  const gone = db.prepare('SELECT DISTINCT v.id FROM vec v LEFT JOIN entries e ON e.id=v.id WHERE e.id IS NULL LIMIT ?').all(limit);
  for (const g of gone) db.prepare('DELETE FROM vec WHERE id=?').run(g.id);
  return gone.length;
}

/** 每天有多少条，用来做粗筛和时间轴。 */
function days({ from = '', to = '' } = {}) {
  const where = []; const args = [];
  if (from) { where.push('day >= ?'); args.push(from); }
  if (to) { where.push('day <= ?'); args.push(to); }
  const sql = `SELECT day, n FROM days ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY day DESC`;
  return db.prepare(sql).all(...args);
}

function stats() {
  return {
    entries: db.prepare('SELECT count(*) c FROM entries').get().c,
    days: db.prepare('SELECT count(*) c FROM days').get().c,
    // 要把 -wal 算进去：WAL 模式下刚写完的数据还在那个文件里，只看主库会得到一个荒唐的小数字
    bytes: ['', '-wal', '-shm'].reduce((n, ext) => {
      try { return n + fs.statSync(file + ext).size; } catch (_) { return n; }
    }, 0),
  };
}

module.exports = {
  open, close, wipe, sync, putDay, search, days, stats,
  useVecModel, needVec, putVec, vecScan, vecStats, sweepVec,
  tokens, bodyOf, matchExpr, termsOf, SCHEMA, get, set, file: () => file, COMMON,
};
