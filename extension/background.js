'use strict';
// Service worker: (1) sniffs media responses per tab so streamed videos (mp4 / m3u8) show up even when the DOM
// only has a blob: URL; (2) transfers the items the user picked to the briffy app on 127.0.0.1.

const DEFAULT_PORT = 47831;
const MAX_PER_TAB = 400;
const sniffed = new Map(); // tabId -> Map(url -> item)
// Segments are counted per directory rather than listed. If we never caught the playlist, the count is
// still proof there is a video here, and the shared directory is the one useful thing to show for it.
const fragments = new Map(); // tabId -> Map(dir -> { n, sample, at })
// Requests a service worker made on the page's behalf arrive with tabId -1, which used to drop them
// entirely. They are kept by origin and handed to whichever tab is sitting on that origin.
const orphans = new Map(); // origin -> Map(url -> item)
const mseTabs = new Set();  // tabs seen attaching a MediaSource to a <video>
const MAX_ORPHAN_ORIGINS = 20;

function originOf(url) { try { return new URL(url).origin; } catch (_) { return ''; } }
function dirOf(url) { try { const u = new URL(url); return u.origin + u.pathname.replace(/[^/]*$/, ''); } catch (_) { return ''; } }

function noteFragment(tabId, url, size) {
  const dir = dirOf(url);
  if (!dir) return;
  if (!fragments.has(tabId)) fragments.set(tabId, new Map());
  const map = fragments.get(tabId);
  const cur = map.get(dir) || { n: 0, sample: url, bytes: 0, at: Date.now() };
  cur.n++;
  cur.bytes += size || 0;
  cur.at = Date.now();
  map.set(dir, cur);
  if (map.size > 40) map.delete(map.keys().next().value);
}

// A directory that produced several segments but never a playlist we recognised. Surfaced so the panel
// can say "there is a stream here" instead of showing nothing at all.
function fragmentHints(tabId, have) {
  const map = fragments.get(tabId);
  if (!map) return [];
  const out = [];
  for (const [dir, f] of map) {
    if (f.n < 3) continue;
    if ([...have].some((u) => u.startsWith(dir))) continue;   // the playlist for it did turn up
    out.push({
      url: dir, kind: 'stream', format: 'fragments', fragments: f.n, size: f.bytes,
      sample: f.sample, mime: 'application/vnd.apple.mpegurl', hint: true, at: f.at,
    });
  }
  return out;
}
let flushTimer = null;

importScripts('./classify.js');   // classify() / classifyUrl(): see extension/classify.js

// ---------- per-tab storage (survives service-worker restarts via storage.session) ----------
async function loadTab(tabId) {
  if (sniffed.has(tabId)) return sniffed.get(tabId);
  const key = `tab:${tabId}`;
  const stored = (await chrome.storage.session.get(key))[key] || [];
  const map = new Map(stored.map((it) => [it.url, it]));
  sniffed.set(tabId, map);
  return map;
}
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    const patch = {};
    for (const [tabId, map] of sniffed) patch[`tab:${tabId}`] = [...map.values()].slice(-MAX_PER_TAB);
    try { await chrome.storage.session.set(patch); } catch (_) { /* quota */ }
  }, 500);
}
async function addSniffed(tabId, item) {
  const map = await loadTab(tabId);
  if (map.has(item.url)) return;
  if (map.size >= MAX_PER_TAB) map.delete(map.keys().next().value);
  map.set(item.url, { ...item, sniffed: true, at: Date.now() });
  scheduleFlush();
}
function clearTab(tabId) {
  sniffed.set(tabId, new Map());
  fragments.delete(tabId);
  mseTabs.delete(tabId);
  chrome.storage.session.remove(`tab:${tabId}`).catch(() => {});
}

chrome.webRequest.onHeadersReceived.addListener((d) => {
  if (d.statusCode >= 400) return;
  const c = classify(d.url, d.responseHeaders);
  if (!c) return;
  if (d.tabId < 0) {
    // a service worker fetched it; remember it against its origin for whichever tab is on that site
    if (c.kind === 'segment') return;
    const origin = originOf(d.initiator || d.url);
    if (!origin) return;
    if (!orphans.has(origin)) {
      if (orphans.size >= MAX_ORPHAN_ORIGINS) orphans.delete(orphans.keys().next().value);
      orphans.set(origin, new Map());
    }
    const map = orphans.get(origin);
    if (map.size < MAX_PER_TAB) map.set(d.url, { url: d.url, ...c, viaWorker: true, at: Date.now() });
    return;
  }
  if (c.kind === 'segment') { noteFragment(d.tabId, d.url, c.size); return; }
  addSniffed(d.tabId, { url: d.url, ...c });
}, { urls: ['<all_urls>'], types: ['image', 'media', 'xmlhttprequest', 'other', 'object'] }, ['responseHeaders']);

chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.status === 'loading' && info.url) clearTab(tabId); });
chrome.tabs.onRemoved.addListener((tabId) => { sniffed.delete(tabId); fragments.delete(tabId); mseTabs.delete(tabId); chrome.storage.session.remove(`tab:${tabId}`).catch(() => {}); });

// ---------- talking to the app ----------
async function apiBase() {
  const { port } = await chrome.storage.local.get({ port: DEFAULT_PORT });
  return `http://127.0.0.1:${port || DEFAULT_PORT}`;
}
async function ping() {
  try {
    const res = await fetch(`${await apiBase()}/api/ping`, {
      headers: { 'X-Briffy': '1', 'X-Briffy-Ext': chrome.runtime.getManifest().version },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body = await res.json();
    wantTab = !!body.wantTab;
    return { ok: true, ...body };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---------- which page is on screen ----------
//
// So that a screenshot or a copy taken while the browser is in front can name the page it came from.
// The app asks for this (`wantTab` in the ping reply) and stops asking the moment the user turns
// "record where it came from" off; nothing is sent otherwise. Only the tab the user is looking at is
// reported, one at a time, and the app keeps it in memory for half a minute -- this is not history.
let wantTab = false;
let lastSent = '';
let lastSentAt = 0;
// 同一个页面待久了也要再报一次，否则应用那边会认为这条标签页已经旧到不能用了。
// 只在「应用要」的时候才有这个心跳，关掉「记录来源」它就停。
const RESEND_MS = 60 * 1000;

async function reportTab(tab) {
  if (!wantTab) return;
  if (!tab || !tab.active || !/^https?:/i.test(tab.url || '')) return;
  if (tab.incognito) return;                       // a private window is not something to hand over
  const key = `${tab.url}|${tab.title || ''}`;
  if (key === lastSent && Date.now() - lastSentAt < RESEND_MS) return;
  lastSent = key; lastSentAt = Date.now();
  try {
    const res = await fetch(`${await apiBase()}/api/tab`, {
      method: 'POST',
      headers: { 'X-Briffy': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: tab.url, title: tab.title || '' }),
    });
    if (res.ok) wantTab = !!(await res.json()).wantTab;
  } catch (_) { /* the app is not running */ }
}

async function reportActiveTab() {
  if (!wantTab) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab) reportTab(tab);
  } catch (_) { /* no window */ }
}

chrome.tabs.onActivated.addListener(() => reportActiveTab());
chrome.tabs.onUpdated.addListener((_id, info, tab) => { if (info.status === 'complete' || info.title) reportTab(tab); });
chrome.windows.onFocusChanged.addListener((id) => { if (id !== chrome.windows.WINDOW_ID_NONE) reportActiveTab(); });
// 心跳：停在同一个页面上不动，也让应用那边知道这个页面还在
chrome.alarms.create('briffy-tab', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'briffy-tab') reportActiveTab(); });

// Heartbeat: lets the app show "extension connected" without the user opening the popup first.
// Reloading the extension does not reach tabs that are already open: content scripts are injected when
// a page loads, so every tab from before the reload keeps running nothing until it happens to navigate.
// That is indistinguishable from a broken feature -- you click save, and there is simply no listener.
// So catch them up once. The scripts each guard against being injected twice.
async function injectIntoOpenTabs() {
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }); } catch (_) { return; }
  for (const tab of tabs) {
    if (!tab.id) continue;
    const put = (opts) => chrome.scripting.executeScript(opts).catch(() => { /* chrome:// and the web store refuse */ });
    put({ target: { tabId: tab.id }, files: ['extract.js', 'savedetect.js', 'bookmark.js'] });
    put({ target: { tabId: tab.id, allFrames: true }, world: 'MAIN', files: ['hook.js'] });
    put({ target: { tabId: tab.id, allFrames: true }, files: ['bridge.js'] });
  }
}

const HEARTBEAT = 'briffy-heartbeat';
chrome.runtime.onInstalled.addListener(() => { ping(); injectIntoOpenTabs(); chrome.alarms.create(HEARTBEAT, { periodInMinutes: 5 }); });
chrome.runtime.onStartup.addListener(() => { ping(); injectIntoOpenTabs(); chrome.alarms.create(HEARTBEAT, { periodInMinutes: 5 }); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === HEARTBEAT) ping().then(reportActiveTab); });
ping().then(reportActiveTab);   // also on every service-worker wake-up

// Sets the Referer for our own fetch of one URL (hotlink-protected CDNs) via a temporary session rule.
async function withReferer(url, referer, fn) {
  const id = 1000 + Math.floor(Math.random() * 1e6);
  const escaped = url.slice(0, 1800).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let added = false;
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [{
        id, priority: 1,
        action: { type: 'modifyHeaders', requestHeaders: [{ header: 'referer', operation: 'set', value: referer }] },
        condition: { regexFilter: `^${escaped}`, resourceTypes: ['xmlhttprequest'] },
      }],
    });
    added = true;
  } catch (_) { /* rule rejected (too long, etc.) – fetch without it */ }
  try { return await fn(); } finally {
    if (added) chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] }).catch(() => {});
  }
}

async function postItem(base, meta, body) {
  const res = await fetch(`${base}/api/media/item`, {
    method: 'POST',
    headers: { 'X-Briffy': '1', 'Content-Type': 'application/octet-stream', 'X-Briffy-Meta': btoa(unescape(encodeURIComponent(JSON.stringify(meta)))) },
    body: body || new Uint8Array(0),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const MAX_DIRECT_BYTES = 1.5 * 1024 * 1024 * 1024;
let job = null; // { total, done, failed, current, errors[] }
function report(extra) {
  const state = { ...job, ...extra };
  chrome.storage.session.set({ job: state }).catch(() => {});
  chrome.action.setBadgeText({ text: job && job.done < job.total ? `${job.done}/${job.total}` : '' }).catch(() => {});
}

// One bookmarked page. Small enough to just post as JSON, and it must not disturb a media transfer
// that happens to be running.
async function sendBookmark(page) {
  try {
    const base = await apiBase();
    const res = await fetch(`${base}/api/page`, {
      method: 'POST',
      headers: { 'X-Briffy': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify(page),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const out = await res.json();
    if (out && out.id) {
      chrome.action.setBadgeBackgroundColor({ color: '#22c55e' }).catch(() => {});
      chrome.action.setBadgeText({ text: '\u2713' }).catch(() => {});
      setTimeout(() => chrome.action.setBadgeText({ text: '' }).catch(() => {}), 2500);
    }
    return out;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function sendItems({ pageUrl, pageTitle, items, downloadVideos }) {
  if (job && job.done < job.total) return { ok: false, error: 'busy' };
  const base = await apiBase();
  const health = await ping();
  if (!health.ok) return { ok: false, error: health.error || 'app offline' };
  job = { total: items.length, done: 0, failed: 0, current: '', errors: [], startedAt: Date.now() };
  chrome.action.setBadgeBackgroundColor({ color: '#f97316' }).catch(() => {});
  report();
  for (const it of items) {
    job.current = it.url;
    report();
    const meta = { url: it.url, kind: it.kind, mime: it.mime || '', width: it.width || 0, height: it.height || 0, filename: it.filename || '', title: it.name || '', pageUrl, pageTitle, downloadVideos: !!downloadVideos, alt: it.alt || '' };
    try {
      let body = null;
      // A stream is a playlist, not a file: fetching it here would save a few kilobytes of text. The
      // app has ffmpeg and assembles it from the manifest instead, so we only hand over the address.
      const wantBytes = it.kind === 'image' || ((it.kind === 'video' || it.kind === 'audio') && downloadVideos);
      if (wantBytes && !/^(data|blob):/.test(it.url)) {
        body = await withReferer(it.url, pageUrl, async () => {
          const res = await fetch(it.url, { credentials: 'include' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const len = Number(res.headers.get('content-length')) || 0;
          if (len > MAX_DIRECT_BYTES) throw new Error('file too large');
          const blob = await res.blob();
          if (!meta.mime && blob.type) meta.mime = blob.type;
          return blob;
        });
      } else if (/^data:/.test(it.url)) {
        body = await (await fetch(it.url)).blob();
        meta.mime = meta.mime || body.type;
      }
      await postItem(base, meta, body);
    } catch (e) {
      job.failed++;
      job.errors.push(`${it.url.slice(0, 80)}: ${e.message}`);
      // still tell the app about the URL so the item is recorded
      try { await postItem(base, { ...meta, fetchError: e.message }, null); } catch (_) { /* ignore */ }
    }
    job.done++;
    report();
  }
  try {
    await fetch(`${base}/api/media/done`, { method: 'POST', headers: { 'X-Briffy': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ pageUrl, pageTitle, count: job.total, failed: job.failed }) });
  } catch (_) { /* ignore */ }
  job.current = '';
  report({ finishedAt: Date.now() });
  return { ok: true, done: job.done, failed: job.failed, errors: job.errors };
}

// hook.js sees the page's own fetch/XHR; bridge.js forwards them here with a real tab attached.
async function addHooked(tabId, items) {
  for (const it of items || []) {
    if (it.mse) { mseTabs.add(tabId); continue; }
    const c = classifyUrl(it.url);
    if (!c) continue;
    if (c.kind === 'segment') { noteFragment(tabId, it.url, 0); continue; }
    await addSniffed(tabId, { url: it.url, ...c, hooked: it.how || 'page' });
  }
}

// Everything known about a tab: what the sniffer saw, what the page's own code asked for, what a
// service worker fetched for this origin, and any stream we only know about through its segments.
async function collect(tabId, pageUrl) {
  const map = await loadTab(tabId);
  const items = [...map.values()];
  const have = new Set(items.map((i) => i.url));
  const origin = originOf(pageUrl || '');
  for (const [o, m] of orphans) {
    if (origin && o !== origin) continue;
    for (const it of m.values()) if (!have.has(it.url)) { items.push(it); have.add(it.url); }
  }
  for (const h of fragmentHints(tabId, have)) items.push(h);
  return { items, mse: mseTabs.has(tabId) };
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  (async () => {
    if (msg.type === 'hooked') {
      const tabId = sender.tab && sender.tab.id;
      if (typeof tabId === 'number' && tabId >= 0) await addHooked(tabId, msg.items);
      return { ok: true };
    }
    if (msg.type === 'bookmarked') return sendBookmark(msg.page);
    if (msg.type === 'collect') return collect(msg.tabId, msg.pageUrl);
    if (msg.type === 'getSniffed') return (await collect(msg.tabId, msg.pageUrl)).items;
    if (msg.type === 'ping') return ping();
    if (msg.type === 'send') return sendItems(msg);
    if (msg.type === 'job') return job;
    return null;
  })().then(respond, (e) => respond({ ok: false, error: e.message }));
  return true;
});
