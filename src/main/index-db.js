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
const fs = require('fs');
const { segment } = require('./segment');

const SCHEMA = 4;                  // 改了表结构就加一，旧库直接重建
const BODY_MAX = 4000;             // 一条记录进倒排的字数上限；OCR 大段的尾巴对找东西没有帮助

let db = null;
let file = '';

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
      type TEXT, app TEXT, pinned INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS i_day ON entries(day);
    CREATE INDEX IF NOT EXISTS i_type ON entries(type);
    CREATE TABLE IF NOT EXISTS days(day TEXT PRIMARY KEY, n INTEGER, stamp TEXT);
    -- content='' 是不存原文、只存倒排，省下一大半体积；contentless_delete=1 是为了还能删——
    -- 少了它，重新索引某一天时 DELETE 会直接报 "cannot DELETE from contentless fts5 table"。
    CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(body, content='', contentless_delete=1);
    -- 每个词出现在多少条记录里。用来在查询前丢掉过于常见的词：耗时是跟命中行数走的，
    -- 一个几乎每条都有的词（自己的用户名、常驻应用名）会把整条查询从 2ms 拖到 1.4 秒。
    CREATE VIRTUAL TABLE IF NOT EXISTS vocab USING fts5vocab(fts, 'row');
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
    const ins = db.prepare('INSERT INTO entries(id,day,at,type,app,pinned) VALUES(?,?,?,?,?,?)');
    const insF = db.prepare('INSERT INTO fts(rowid,body) VALUES(?,?)');
    let n = 0;
    for (const e of list) {
      if (!e || !e.id || e.status === 'error') continue;
      const c = e.context || {};
      const r = ins.run(e.id, dayKey, String(e.createdAt || ''), String(e.type || ''), String(c.app || ''), e.pinned ? 1 : 0);
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
function matchExpr(question, { total = 0 } = {}) {
  // 先按用户自己打的边界切开（空格、标点），再让 ICU 去切每一块
  const words = String(question || '').split(/[\s,，、;；。!！?？:：/\\()（）[\]"'`]+/).filter(Boolean);
  const phrases = [];
  for (const w of words) {
    const sub = tokens(w);
    if (!sub.length) continue;
    if (sub.length === 1 && sub[0].length === 1 && !/[\u4e00-\u9fff]/.test(sub[0])) continue;  // 单个字母数字，跳过
    phrases.push({ key: sub.join(' '), df: null });
  }
  if (!phrases.length) return null;
  // 只有整词能问到 df；被切开的短语问不到，一律当作不常见（它们本来就更选择性）
  for (const p of phrases) {
    if (p.key.includes(' ')) { p.df = 0; continue; }
    const r = db.prepare('SELECT cnt FROM vocab WHERE term=?').get(p.key);
    p.df = r ? r.cnt : 0;
  }
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
  const terms = query.trim() ? matchExpr(query, { total }) : null;
  if (!terms) {
    // 没有词，就是「把这段时间给我」——按时间倒着给
    const sql = `SELECT e.id FROM entries e ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.at DESC LIMIT ?`;
    const ids = db.prepare(sql).all(...args, limit).map((r) => r.id);
    return { ids, scored: false, ms: Date.now() - t0 };
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
  const tries = [terms.join(' AND ')];
  if (loose.length && loose.length !== terms.length) tries.push(loose.join(' AND '));
  for (const expr of tries) {
    const sql = `SELECT e.id FROM fts f JOIN entries e ON e.rowid = f.rowid
      WHERE f.fts MATCH ? ${where.length ? `AND ${where.join(' AND ')}` : ''}
      ORDER BY rank LIMIT ?`;
    let ids = [];
    try { ids = db.prepare(sql).all(expr, ...args, limit).map((r) => r.id); } catch (_) { ids = []; }
    if (ids.length) return { ids, scored: true, ms: Date.now() - t0 };
  }
  return { ids: [], scored: true, ms: Date.now() - t0 };
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
  tokens, bodyOf, matchExpr, SCHEMA, get, set, file: () => file, COMMON,
};
