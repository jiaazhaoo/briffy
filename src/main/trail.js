'use strict';
// 你今天都在看什么——不用你动手存的那一层。
//
// 这是 briffy 里第一样**不是你有意存下**的东西，所以它有自己的地方（workspace/trail/），
// 不进 entries/。记录页是"你决定留下的"，把路过的东西混进去，那一页就不再是那个意思了。
//
// 两条进料，成本天差地别，实测（见下）：
//   焦点   每两秒问一次前台是谁，变了才记一条。0.31% 的一个核，每天约 0.2MB。
//   网页   扩展在页面里读 DOM 直接交上来。**0.2ms 读出 12,031 个字**，不截屏、不 OCR。
//
// 为什么不走 OCR：Vision 的 fast 档要 800ms 才读出一千一百个字，而且是"认"出来的；
// 页面内读 innerText 是 0.2ms、一万两千字、原文。快四千倍，字多十倍，还准。
// 辅助功能树那条更糟——用 AppleScript 走一遍 Chrome 是 8.8 秒，Claude 是 32 秒。
// 所以只有微信、Telegram 这类既不交出 DOM 也不交出辅助功能树的应用是 OCR 才能读的
// （screenpipe 在这台机器上实测它们的免 OCR 率是 24% 和 1%），而那恰好是私人聊天，
// 这一层**只记它们的窗口标题，不碰内容**。
//
// 机器闲着不记：powerMonitor.getSystemIdleTime() 是免费的，超过一分钟没人动就停手。
const fs = require('fs');
const path = require('path');
const foreground = require('./foreground');

const POLL_MS = 2000;          // 实测 0.31% 的一个核，含每次起进程的开销
const IDLE_S = 60;             // 一分钟没人动就不记了
const MAX_TEXT = 20000;        // 和扩展里 BriffyExtract 的上限一致
const HEARTBEAT_MS = 5 * 60 * 1000;   // 在一个窗口里待久了也落一条，否则最后一段没有终点

let store = null;
let timer = null;
let last = '';                 // 上一条的 app|window|url，用来判断变没变
let lastAt = 0;
let lastPage = '';             // 上一个交上来的网址，同一页不重复记正文
let onEvent = null;

function init(deps) { store = deps.store; }
function onAppend(fn) { onEvent = fn; }

function dir() { return path.join(store.workspaceDir, 'trail'); }
function fileFor(day) { return path.join(dir(), `${day}.jsonl`); }

/** 一行一条，追加写。天文件那套是整体重写的，这一层一天几百上千条，不能那么写。 */
function append(row) {
  try {
    const day = require('./store').localDateKey(new Date(row.at));
    fs.mkdirSync(dir(), { recursive: true });
    fs.appendFileSync(fileFor(day), `${JSON.stringify(row)}\n`);
    if (onEvent) { try { onEvent(row); } catch (_) { /* 听众自己的事 */ } }
  } catch (e) { console.warn('[trail] 写不进去', e.message); }
}

function enabled() {
  const s = store && store.getSettings ? store.getSettings() : {};
  return s.recordTrail === true;
}

/** 现在有人在用这台电脑吗。免费，不用权限。 */
function awake() {
  try { return require('electron').powerMonitor.getSystemIdleTime() < IDLE_S; }
  catch (_) { return true; }
}

async function tick() {
  if (!enabled() || !awake()) return;
  let ctx = null;
  try { ctx = await foreground.read({ title: true }); } catch (_) { return; }
  if (!ctx || !ctx.app) return;
  const key = `${ctx.app}|${ctx.window || ''}|${ctx.url || ''}`;
  const now = Date.now();
  // 变了就记；没变但待够久了也记一条，好让最后一段有终点
  if (key === last && now - lastAt < HEARTBEAT_MS) return;
  last = key; lastAt = now;
  append({ at: new Date(now).toISOString(), kind: 'focus', app: ctx.app, window: ctx.window || '', url: ctx.url || '' });
}

/**
 * 扩展把一页的正文交上来。
 *
 * 同一个网址只记一次——刷新、回退、SPA 里来回切都会重复触发，而正文没变。
 * 正文变了但网址没变（一条流不断加载）拿不到，这一层不追那个。
 */
function notePage({ url = '', title = '', text = '' } = {}) {
  if (!enabled() || !url) return false;
  if (url === lastPage) return false;
  lastPage = url;
  const body = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  if (!body) return false;
  append({ at: new Date().toISOString(), kind: 'page', url: String(url).slice(0, 2000), window: String(title || '').slice(0, 300), text: body });
  return true;
}

function start() {
  if (timer) return;
  timer = setInterval(() => { tick().catch(() => {}); }, POLL_MS);
  if (timer.unref) timer.unref();
}
function stop() { if (timer) { clearInterval(timer); timer = null; } last = ''; lastPage = ''; }

/** 一天的痕迹，按时间。坏行跳过——追加写的文件被中途杀掉可能留下半行。 */
function read(day) {
  const out = [];
  let raw = '';
  try { raw = fs.readFileSync(fileFor(day), 'utf8'); } catch (_) { return out; }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch (_) { /* 半行，跳过 */ }
  }
  return out;
}

/** 有痕迹的那些天，新的在前。 */
function days() {
  try {
    return fs.readdirSync(dir()).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.slice(0, 10)).sort().reverse();
  } catch (_) { return []; }
}

// 窗口标题里会动的那些东西。Terminal 的转圈动画一秒一变，同一件事会被记成几十次「切换」——
// 实测一天原始 9,952 帧里有 1,655 次「切换」，归一化并合并之后只剩 63 段有意义的。
const SPINNER = /[✳◐◑◒◓⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏◜◝◞◟]\s*/g;
const GLANCE_S = 60;           // 不到一分钟的是瞥一眼，不算一件事，折进前一段

function tidyTitle(w) {
  return String(w || '')
    .replace(SPINNER, '')
    .replace(/\s*—\s*\d+×\d+\s*$/, '')       // Terminal 的窗口尺寸
    .replace(/^\(\d+\)\s*/, '')               // 未读数
    .replace(/\s+/g, ' ').trim();
}

/**
 * 一天分成几段。这是「路过」那一页看到的东西。
 *
 * 三步，每一步都是实测逼出来的：
 *   归一化标题   转圈动画、未读数、窗口尺寸都在变，但那不是换了一件事
 *   相邻合并     同一个应用同一个标题连着的，是一段
 *   折掉一瞥     不到一分钟就切走的，折进前一段——切出去回个消息不算换了件事
 *
 * 网页正文按时间落进它所属的那一段，界面上点开才展。
 * @returns {{from:string, to:string, secs:number, app:string, window:string, pages:object[]}[]}
 */
function sessions(day) {
  const rows = read(day);
  const focus = rows.filter((r) => r.kind === 'focus');
  const pages = rows.filter((r) => r.kind === 'page');
  // 一段的终点不是「下一条事件的时间」，是「最后一次看见它 + 一个心跳」。
  // 两者的差别在真实数据上是这样的：凌晨 4:17 到 11:30 之间没有任何事件（人在睡觉），
  // 按前者算就成了「在 Terminal 里连续 432 分钟」。心跳每五分钟落一条，所以真在用的时候
  // 两条之间不会超过五分钟；超过了，那段空白就是空白，不该记在谁头上。
  const blocks = [];
  for (const r of focus) {
    const w = tidyTitle(r.window);
    const at = Date.parse(r.at);
    const top = blocks[blocks.length - 1];
    if (top && top.app === r.app && top.window === w) { top.seen = at; continue; }
    blocks.push({ start: at, seen: at, app: r.app, window: w, url: r.url || '' });
  }
  for (let i = 0; i < blocks.length; i++) {
    const cap = blocks[i].seen + HEARTBEAT_MS;
    const next = i + 1 < blocks.length ? blocks[i + 1].start : Infinity;
    blocks[i].end = Math.min(cap, next, Date.now());
    if (blocks[i].end < blocks[i].seen) blocks[i].end = blocks[i].seen;
  }
  const merged = [];
  for (const b of blocks) {
    const top = merged[merged.length - 1];
    const secs = (b.end - b.start) / 1000;
    if (top && secs < GLANCE_S && top.app !== b.app) { top.end = b.end; continue; }
    if (top && top.app === b.app && top.window === b.window) { top.end = b.end; continue; }
    merged.push(b);
  }
  return merged.map((b) => ({
    from: new Date(b.start).toISOString(),
    to: new Date(b.end).toISOString(),
    secs: Math.round((b.end - b.start) / 1000),
    app: b.app,
    window: b.window,
    url: b.url,
    pages: pages.filter((p) => { const t = Date.parse(p.at); return t >= b.start && t <= b.end; })
      .map((p) => ({ at: p.at, url: p.url, title: p.window, text: p.text })),
  }));
}

/** 一天里在每个 app / 每个站点上待了多久（秒），按"到下一条为止"算。 */
function spans(day) {
  const rows = read(day).filter((r) => r.kind === 'focus');
  const byApp = new Map();
  for (let i = 0; i < rows.length; i++) {
    const t = Date.parse(rows[i].at);
    const next = i + 1 < rows.length ? Date.parse(rows[i + 1].at) : t;
    // 一段最多算到心跳那么长：中间可能锁屏、睡眠，那些不该算成"在用"
    const secs = Math.max(0, Math.min(next - t, HEARTBEAT_MS)) / 1000;
    byApp.set(rows[i].app, (byApp.get(rows[i].app) || 0) + secs);
  }
  return [...byApp.entries()].map(([app, secs]) => ({ app, secs: Math.round(secs) }))
    .sort((a, b) => b.secs - a.secs);
}

module.exports = { init, start, stop, tick, notePage, read, days, spans, sessions, tidyTitle, onAppend, GLANCE_S, POLL_MS, IDLE_S, MAX_TEXT, HEARTBEAT_MS };
