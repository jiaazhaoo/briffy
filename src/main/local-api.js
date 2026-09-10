'use strict';
// Local HTTP API (127.0.0.1 only) used by the browser extension to hand over media from the current page.
//   GET  /api/ping            → { app, version }
//   POST /api/media/item      body = file bytes (may be empty), header X-Briffy-Meta = base64(JSON)
//   POST /api/media/done      JSON { pageUrl, pageTitle, count, failed }
//   POST /api/tab             JSON { url, title } – which page the browser is showing right now
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_PORT = 47831;
const MAX_BODY = 2 * 1024 * 1024 * 1024;
let server = null;
let deps = null;
let lastReceived = null;
// Set by the extension's heartbeat and remembered across restarts: without that, briffy forgets a
// working extension every time it starts and claims it is not installed until the next heartbeat --
// up to five minutes of a wrong answer on screen.
let extension = null;      // { version, id, lastSeen }
// The extension reports every 5 minutes, so two missed reports mean it is gone. Kept short so a stale
// entry cannot keep claiming the extension is installed.
const EXTENSION_STALE_MS = 11 * 60 * 1000;

// Read-only paths a browser can open directly: the install guide and the status it polls. They expose
// nothing but "is an extension talking to us", so they do not need the extension's custom header.
const PUBLIC_GET = new Set(['/install', '/', '/api/extension']);

function allowed(req, pathname) {
  const host = String(req.headers.host || '').split(':')[0];
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) return false;
  const origin = String(req.headers.origin || '');
  if (origin && !/^(chrome|moz|safari-web|edge)-extension:\/\//.test(origin) && !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(origin)) return false;
  if (req.method === 'OPTIONS') return true;
  if (req.method === 'GET' && PUBLIC_GET.has(pathname)) return true;
  // An extension the user has not reloaded since the rename still sends the old header.
  return req.headers['x-briffy'] === '1' || req.headers['x-dailylogs'] === '1';
}
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Briffy, X-Briffy-Ext, X-Briffy-Ext-Id, X-Briffy-Meta, X-DailyLogs, X-DailyLogs-Meta');
  res.setHeader('Access-Control-Max-Age', '600');
}
function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) reject(new Error('body too large')); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
// Streams the request body to a temp file (videos can be huge); resolves with { file, size } or null when empty.
function readToTemp(req) {
  return new Promise((resolve, reject) => {
    const file = path.join(os.tmpdir(), `briffy-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
    const out = fs.createWriteStream(file);
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { req.destroy(new Error('body too large')); } });
    req.pipe(out);
    out.on('finish', () => resolve(size ? { file, size } : (fs.rmSync(file, { force: true }), null)));
    out.on('error', reject);
    req.on('error', (e) => { out.destroy(); fs.rmSync(file, { force: true }); reject(e); });
  });
}

async function handle(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, 'http://127.0.0.1');
  if (!allowed(req, url.pathname)) { json(res, 403, { ok: false, error: 'forbidden' }); return; }
  try {
    if (req.method === 'GET' && url.pathname === '/api/ping') {
      // Only a real browser extension counts as "connected": the headers this reads are written by the
      // browser itself, so a local script or a curl cannot make the app claim it is installed.
      const ver = req.headers['x-briffy-ext'] || req.headers['x-dailylogs-ext'];
      const from = extensionRequest(req.headers);
      if (ver && from) {
        const id = from.id;
        const known = extension && extension.id === id;
        extension = { version: String(ver), id, lastSeen: Date.now() };
        if (deps.rememberExtension) deps.rememberExtension({ ...extension });
        if (!known && deps.onExtension) deps.onExtension(extension);
      }
      // `wantTab` asks the extension to report which page it is showing, so that something saved
      // while a browser is in front can name the page. The extension sends nothing unless asked.
      json(res, 200, { ok: true, app: 'briffy', version: deps.version, lastReceived, wantTab: !!(deps.wantsTab && deps.wantsTab()) });
      return;
    }
    // The guide page polls this while the user installs the extension.
    if (req.method === 'GET' && url.pathname === '/api/extension') {
      json(res, 200, extensionStatus());
      return;
    }
    if (req.method === 'GET' && (url.pathname === '/install' || url.pathname === '/')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(deps.installPage ? deps.installPage() : '<h1>briffy</h1>');
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/media/item') {
      let meta = {};
      try { meta = JSON.parse(Buffer.from(String(req.headers['x-briffy-meta'] || req.headers['x-dailylogs-meta'] || ''), 'base64').toString('utf8')); } catch (_) { json(res, 400, { ok: false, error: 'bad meta' }); return; }
      const body = await readToTemp(req);
      const entry = await deps.workspace.ingestBrowserMedia(meta, body);
      lastReceived = new Date().toISOString();
      json(res, 200, { ok: true, id: entry ? entry.id : null });
      return;
    }
    // A page the user just bookmarked, with the text already pulled out in the tab (the pages worth
    // saving are behind a login, where fetching the URL from here would return an empty shell).
    if (req.method === 'POST' && url.pathname === '/api/page') {
      const page = await readJson(req);
      const entry = await deps.workspace.ingestBookmark(page || {});
      // Leaves a trace in the log: "I clicked and nothing happened" is otherwise impossible to tell
      // apart from "the click never reached the app at all".
      console.log('[local-api] bookmark', entry ? 'saved' : 'duplicate', (page && page.url) || '?');
      lastReceived = new Date().toISOString();
      json(res, 200, { ok: true, id: entry ? entry.id : null, duplicate: !entry });
      return;
    }
    // The page the browser is on. Held in memory for half a minute and attached only to something the
    // user then chooses to save; nothing here is written to disk on its own. See foreground.js.
    //
    // 除非「不用动手存的那一层」开着（wantText），那时候同一个 POST 还会带上这一页的正文，
    // 而正文是**写盘**的。所以它由一个单独的开关管，而且默认关着——见 src/main/trail.js。
    // 搭这条路是因为它本来就在每次切标签时跑，不用再造一个触发时机。
    if (req.method === 'POST' && url.pathname === '/api/tab') {
      const tab = await readJson(req);
      if (deps.onTab) deps.onTab(tab || {});
      json(res, 200, {
        ok: true,
        wantTab: !!(deps.wantsTab && deps.wantsTab()),
        wantText: !!(deps.wantsText && deps.wantsText()),
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/media/done') {
      const info = await readJson(req);
      lastReceived = new Date().toISOString();
      if (deps.onDone) deps.onDone(info);
      json(res, 200, { ok: true });
      return;
    }
    json(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    console.error('[local-api]', e);
    json(res, 500, { ok: false, error: e.message });
  }
}

function start(d) {
  deps = d;
  if (!extension && d.lastExtension && d.lastExtension.lastSeen) extension = { ...d.lastExtension };
  stop();
  const port = Number(d.port) || DEFAULT_PORT;
  server = http.createServer((req, res) => { handle(req, res).catch((e) => { try { json(res, 500, { ok: false, error: e.message }); } catch (_) { /* ignore */ } }); });
  server.on('error', (e) => { console.error('[local-api] cannot listen on', port, e.message); server = null; if (d.onError) d.onError(e); });
  server.listen(port, '127.0.0.1', () => console.log(`[local-api] listening on http://127.0.0.1:${port}`));
  return server;
}
function stop() {
  if (server) { try { server.close(); } catch (_) { /* ignore */ } server = null; }
}
function status() {
  return {
    running: !!server && server.listening,
    port: server && server.listening ? server.address().port : null,
    lastReceived,
    extension: extensionStatus(),
  };
}

/**
 * `{ id }` when the request really came from a browser extension, otherwise null. The headers it reads
 * are written by the browser itself and are forbidden to page JavaScript, so a heartbeat from a script,
 * a terminal or a curl does not make the app claim the extension is installed.
 *
 * The catch, measured on Chrome 153: a service worker's **GET** carries no `Origin` at all. The browser
 * only writes one when the method is not GET or HEAD -- our POSTs get `Origin: chrome-extension://<id>`,
 * the heartbeat GET gets nothing. Requiring an Origin here is what kept the heartbeat from ever counting
 * while the popup, which only checks that its fetch came back, said "connected".
 *
 * So: when the browser did write an Origin, it settles the question and hands us the real id. When it
 * did not, `Sec-Fetch-Site: none` stands in -- a page's fetch to 127.0.0.1 is always `cross-site`, and a
 * page cannot set the header itself. A page cannot slip through the Origin-less door either way: sending
 * `X-Briffy-Ext` at all forces cors mode, which forces the page's own Origin onto the request.
 */
function extensionRequest(headers) {
  if (!headers['sec-fetch-mode'] || !headers['sec-fetch-site']) return null;   // absent on non-browser clients
  const origin = String(headers.origin || '');
  if (origin) {
    const m = /^(?:chrome|moz|safari-web|edge)-extension:\/\/([a-z0-9-]+)\/?$/i.exec(origin);
    return m ? { id: m[1] } : null;            // a page wrote this one, not an extension
  }
  if (headers['sec-fetch-site'] !== 'none') return null;
  // No Origin to read the id off, so take the extension's word for it. It is a label for the log and for
  // "is this the same extension as last time", never the thing that decides whether to trust the request.
  return { id: String(headers['x-briffy-ext-id'] || '') };
}

/** @returns {{connected:boolean, version:string, id:string, lastSeen:number|null}} */
function extensionStatus() {
  const fresh = !!extension && Date.now() - extension.lastSeen < EXTENSION_STALE_MS;
  return {
    connected: fresh,
    version: extension ? extension.version : '',
    id: extension ? extension.id : '',
    lastSeen: extension ? extension.lastSeen : null,
  };
}

module.exports = { start, stop, status, extensionStatus, DEFAULT_PORT };
