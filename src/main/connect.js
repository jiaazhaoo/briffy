'use strict';
// 把别处的东西接进来：Notion 的页面、Gmail 的邮件。
//
// 一条硬约束先写在这里，因为它决定这个功能能怎么发布：**Gmail 的 gmail.readonly 是「受限权限」**。
// Google 要求过 CASA Tier 2 安全审计才能给外部用户用，每年一次，首次 6–12 周、几千到几万美元；
// 在那之前应用是「未验证」状态，授权页带警告，最多 100 个测试用户。
//
// 所以这里不内置任何 client id：**凭据由用户自己带**。Notion 用他自己建的 integration token，
// Gmail 用他自己在 Google Cloud 建的桌面端 client。这样个人使用今天就能跑，而 briffy 也不会因为
// 内置了一个没过审的 client 而把所有用户卡在那张警告页上。本地优先的工具普遍是这么做的。
//
// 每个服务只需要提供三件事，见 notion.js / gmail.js：
//   check(creds)              凭据对不对，顺便把账号名带回来
//   pull(creds, cursor, take)  拉一批，交给 take(item)，返回新的游标和还有没有
//   label                     给设置页看的名字
//
// 拉回来的东西直接进 store.addEntry，不走 workspace 的那条流水线：它是给 OCR 和转写用的，
// 而这里进来的本来就是文字。
const fs = require('fs');
const path = require('path');

const bulk = require('./import-bulk');

const services = {
  notion: require('./connect-notion'),
  gmail: require('./connect-gmail'),
};

let store = null;
let running = null;          // 同一时间只同步一个服务，别把网络和磁盘一起挤满
const listeners = new Set();

// remoteId -> 记录 id。**不能拿 SQLite 那个索引来做这件事**：那是可以随时扔掉重建的缓存，而
// 「这封邮件是不是已经收过了」是一条不能猜错的事实——猜错一次就是同一封邮件进来两遍。
// 所以它自己有一份文件，跟记录放在一起，随工作区一起搬走。
let seen = null;
let seenDirty = false;
let seenTimer = null;
function seenFile() { return path.join(store.workspaceDir, 'remote.json'); }
function loadSeen() {
  if (seen) return seen;
  try { seen = new Map(Object.entries(JSON.parse(fs.readFileSync(seenFile(), 'utf8')))); }
  catch (_) { seen = new Map(); }
  return seen;
}
function rememberSeen(remoteId, entryId) {
  loadSeen().set(remoteId, entryId);
  seenDirty = true;
  if (seenTimer) return;
  seenTimer = setTimeout(() => { seenTimer = null; flushSeen(); }, 800);
}
function flushSeen() {
  if (!seenDirty || !seen) return;
  try {
    fs.mkdirSync(path.dirname(seenFile()), { recursive: true });
    fs.writeFileSync(seenFile(), JSON.stringify(Object.fromEntries(seen)));
    seenDirty = false;
  } catch (e) { console.warn('[connect] 记不住已同步的清单', e.message); }
}

function init(deps) { store = deps.store; }
function onProgress(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function say(p) { for (const fn of listeners) { try { fn(p); } catch (_) { /* 听众自己的事 */ } } }

function stateOf(name) {
  const all = store.getSettings().connectState || {};
  return { cursor: '', lastAt: '', count: 0, error: '', ...(all[name] || {}) };
}
function setState(name, patch) {
  const all = { ...(store.getSettings().connectState || {}) };
  all[name] = { ...stateOf(name), ...patch };
  store.updateSettings({ connectState: all });
}

/** 每个服务当前的样子，给设置页看。永远不返回凭据本身。 */
function list() {
  return Object.entries(services).map(([name, svc]) => {
    const st = stateOf(name);
    return {
      name,
      label: svc.label,
      connected: svc.hasCreds(store),
      account: st.account || '',
      lastAt: st.lastAt,
      count: st.count,
      error: st.error,
      busy: running === name,
      done: !!st.done,
    };
  });
}

/**
 * 存凭据，并且当场验一次——存下一个用不了的 token，用户要到第一次同步才发现。
 * @returns {Promise<{ok:boolean, account?:string, error?:string}>}
 */
async function connect(name, creds) {
  const svc = services[name];
  if (!svc) return { ok: false, error: `unknown service ${name}` };
  try {
    const who = await svc.check(creds);
    svc.saveCreds(store, creds);
    setState(name, { account: who.account || '', error: '' });
    return { ok: true, account: who.account || '' };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/**
 * 断开。只清凭据和进度，**已经同步进来的记录一条都不动**——那是你的东西了。
 * 已收清单也留着：断开再接回来不该把整个邮箱重收一遍。
 */
function disconnect(name) {
  const svc = services[name];
  if (!svc) return false;
  svc.clearCreds(store);
  setState(name, { cursor: '', lastAt: '', count: 0, error: '', done: false, account: '' });
  return true;
}

/**
 * 同步。断点续传：游标存在设置里，中途关掉应用，下次从同一处继续。
 *
 * 一次只拉一批就存一批，不攒在内存里——邮箱可以有十万封，攒着就是把工作区又复制了一份进内存，
 * 那正是索引那一版刚修掉的毛病。
 */
async function sync(name, { pages = Infinity } = {}) {
  const svc = services[name];
  if (!svc) throw new Error(`unknown service ${name}`);
  if (running) throw new Error('another sync is already running');
  if (!svc.hasCreds(store)) throw new Error('not connected');
  running = name;
  const t0 = Date.now();
  let added = 0; let seen = 0;
  try {
    let { cursor } = stateOf(name);
    for (let page = 0; page < pages; page++) {
      const creds = svc.loadCreds(store);
      const out = await svc.pull(creds, cursor, (item) => {
        seen++;
        if (fileOne(name, item)) added++;
      });
      cursor = out.cursor || '';
      setState(name, { cursor, count: stateOf(name).count + added, lastAt: new Date().toISOString(), error: '', done: !out.more });
      say({ service: name, added, seen, more: out.more, ms: Date.now() - t0 });
      added = 0;
      if (!out.more) break;
    }
    return { seen, ms: Date.now() - t0, done: !!stateOf(name).done };
  } catch (e) {
    setState(name, { error: e.message || String(e) });
    throw e;
  } finally {
    running = null;
    flushSeen();
  }
}

/**
 * 一条外面的东西变成一条记录。
 *
 * remoteId 是幂等的关键：同一封邮件、同一个页面再拉一次不会变成第二条。改过的页面会**更新**那一条，
 * 不是再添一条——Notion 的页面天天在改，不这么做同步一个月就有三十份同一页。
 */
function fileOne(service, item) {
  const remoteId = `${service}:${item.id}`;
  const knownId = loadSeen().get(remoteId);
  const existing = knownId ? store.getEntry(knownId) : null;
  const at = item.at ? new Date(item.at) : new Date();
  const fields = {
    type: item.type || 'note',
    title: item.title || '',
    text: item.text || '',
    url: item.url || '',
    origin: service,
    remoteId,
    status: 'done',
    createdAt: at.toISOString(),
    dateKey: `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`,
  };
  if (existing) {
    if ((existing.text || '') === fields.text && (existing.title || '') === fields.title) return false;
    store.updateEntry(existing.id, { title: fields.title, text: fields.text, updatedAt: new Date().toISOString() });
    return false;
  }
  const entry = store.addEntry(fields);
  rememberSeen(remoteId, entry.id);
  return true;
}

/**
 * 从导出文件导入：Notion 的 zip、Gmail Takeout 的 mbox、或一个文件夹。
 *
 * 这是「不想填凭据」的那条路。Gmail 的受限权限要过 CASA 审计，Notion 的公开集成必须带 client
 * secret——两样都躲不掉，而导出文件一样都不需要。代价是它是一次快照，不是持续同步。
 *
 * 走的是和同步同一个 fileOne，所以去重、更新、按原始时间归日，行为完全一致：
 * 同一个导出文件拖两次不会变成两份。
 */
async function importFiles(paths) {
  if (running) throw new Error('another sync is already running');
  running = 'import';
  const t0 = Date.now();
  let added = 0; let seen = 0; const kinds = [];
  try {
    for (const src of (Array.isArray(paths) ? paths : [paths])) {
      const out = await bulk.read(src, (item) => {
        seen++;
        if (fileOne(item.origin || 'import', item)) added++;
        if (seen % 200 === 0) say({ service: 'import', added, seen, more: true, ms: Date.now() - t0 });
      });
      kinds.push(out.kind);
    }
    say({ service: 'import', added, seen, more: false, ms: Date.now() - t0 });
    return { added, seen, kinds, ms: Date.now() - t0 };
  } finally {
    running = null;
    flushSeen();
  }
}

module.exports = { init, list, connect, disconnect, sync, importFiles, onProgress, stateOf, services, _fileOne: fileOne, _flushSeen: flushSeen };
