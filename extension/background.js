'use strict';
// Service worker: (1) sniffs media responses per tab so streamed videos (mp4 / m3u8) show up even when the DOM
// only has a blob: URL; (2) transfers the items the user picked to the DailyLogs app on 127.0.0.1.

const DEFAULT_PORT = 47831;
const MAX_PER_TAB = 400;
const sniffed = new Map(); // tabId -> Map(url -> item)
let flushTimer = null;

// ---------- classification ----------
function header(headers, name) {
  const h = (headers || []).find((x) => x.name.toLowerCase() === name);
  return h ? String(h.value || '') : '';
}
function classify(url, headers) {
  const ct = header(headers, 'content-type').split(';')[0].trim().toLowerCase();
  const len = Number(header(headers, 'content-length')) || 0;
  const path = url.split(/[?#]/)[0].toLowerCase();
  const ext = (path.match(/\.([a-z0-9]{2,5})$/) || [])[1] || '';
  if (ct === 'application/vnd.apple.mpegurl' || ct === 'application/x-mpegurl' || ext === 'm3u8') return { kind: 'stream', mime: 'application/vnd.apple.mpegurl', size: len };
  if (ct === 'application/dash+xml' || ext === 'mpd') return { kind: 'stream', mime: 'application/dash+xml', size: len };
  if (ct.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv', 'm4v'].includes(ext)) {
    if (ext === 'ts' || ext === 'm4s') return null; // segments – the playlist is what we want
    return { kind: 'video', mime: ct.startsWith('video/') ? ct : `video/${ext === 'mov' ? 'quicktime' : ext}`, size: len };
  }
  if (ct.startsWith('audio/') || ['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg'].includes(ext)) return { kind: 'audio', mime: ct.startsWith('audio/') ? ct : 'audio/mpeg', size: len };
  if (ct.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp'].includes(ext)) {
    if (ct === 'image/svg+xml' || ext === 'svg' || ct === 'image/x-icon' || ext === 'ico') return null;
    if (len && len < 4096) return null; // tracking pixels, tiny icons
    return { kind: 'image', mime: ct.startsWith('image/') ? ct : `image/${ext === 'jpg' ? 'jpeg' : ext}`, size: len };
  }
  return null;
}

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
  chrome.storage.session.remove(`tab:${tabId}`).catch(() => {});
}

chrome.webRequest.onHeadersReceived.addListener((d) => {
  if (d.tabId < 0 || d.statusCode >= 400) return;
  const c = classify(d.url, d.responseHeaders);
  if (c) addSniffed(d.tabId, { url: d.url, ...c });
}, { urls: ['<all_urls>'], types: ['image', 'media', 'xmlhttprequest', 'other', 'object'] }, ['responseHeaders']);

chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.status === 'loading' && info.url) clearTab(tabId); });
chrome.tabs.onRemoved.addListener((tabId) => { sniffed.delete(tabId); chrome.storage.session.remove(`tab:${tabId}`).catch(() => {}); });

// ---------- talking to the app ----------
async function apiBase() {
  const { port } = await chrome.storage.local.get({ port: DEFAULT_PORT });
  return `http://127.0.0.1:${port || DEFAULT_PORT}`;
}
async function ping() {
  try {
    const res = await fetch(`${await apiBase()}/api/ping`, {
      headers: { 'X-DailyLogs': '1', 'X-DailyLogs-Ext': chrome.runtime.getManifest().version },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, ...(await res.json()) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Heartbeat: lets the app show "extension connected" without the user opening the popup first.
const HEARTBEAT = 'dailylogs-heartbeat';
chrome.runtime.onInstalled.addListener(() => { ping(); chrome.alarms.create(HEARTBEAT, { periodInMinutes: 5 }); });
chrome.runtime.onStartup.addListener(() => { ping(); chrome.alarms.create(HEARTBEAT, { periodInMinutes: 5 }); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === HEARTBEAT) ping(); });
ping();   // also on every service-worker wake-up

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
    headers: { 'X-DailyLogs': '1', 'Content-Type': 'application/octet-stream', 'X-DailyLogs-Meta': btoa(unescape(encodeURIComponent(JSON.stringify(meta)))) },
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
    const meta = { url: it.url, kind: it.kind, mime: it.mime || '', width: it.width || 0, height: it.height || 0, filename: it.filename || '', pageUrl, pageTitle, downloadVideos: !!downloadVideos, alt: it.alt || '' };
    try {
      let body = null;
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
    await fetch(`${base}/api/media/done`, { method: 'POST', headers: { 'X-DailyLogs': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ pageUrl, pageTitle, count: job.total, failed: job.failed }) });
  } catch (_) { /* ignore */ }
  job.current = '';
  report({ finishedAt: Date.now() });
  return { ok: true, done: job.done, failed: job.failed, errors: job.errors };
}

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  (async () => {
    if (msg.type === 'getSniffed') return [...(await loadTab(msg.tabId)).values()];
    if (msg.type === 'ping') return ping();
    if (msg.type === 'send') return sendItems(msg);
    if (msg.type === 'job') return job;
    return null;
  })().then(respond, (e) => respond({ ok: false, error: e.message }));
  return true;
});
