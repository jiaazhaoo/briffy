'use strict';
// Local HTTP API (127.0.0.1 only) used by the browser extension to hand over media from the current page.
//   GET  /api/ping            → { app, version }
//   POST /api/media/item      body = file bytes (may be empty), header X-DailyLogs-Meta = base64(JSON)
//   POST /api/media/done      JSON { pageUrl, pageTitle, count, failed }
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_PORT = 47831;
const MAX_BODY = 2 * 1024 * 1024 * 1024;
let server = null;
let deps = null;
let lastReceived = null;
let extension = null;      // { version, id, lastSeen } – set by the extension's heartbeat
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
  return req.headers['x-dailylogs'] === '1';
}
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-DailyLogs, X-DailyLogs-Meta');
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
    const file = path.join(os.tmpdir(), `dailylogs-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
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
      // Only a real browser extension counts as "connected": the Origin header is set by the browser
      // itself for extension fetches, so a local script or a curl cannot make the app claim it is installed.
      const ver = req.headers['x-dailylogs-ext'];
      const id = extensionOrigin(req.headers);
      if (ver && id) {
        const known = extension && extension.id === id;
        extension = { version: String(ver), id, lastSeen: Date.now() };
        if (!known && deps.onExtension) deps.onExtension(extension);
      }
      json(res, 200, { ok: true, app: 'dailylogs', version: deps.version, lastReceived });
      return;
    }
    // The guide page polls this while the user installs the extension.
    if (req.method === 'GET' && url.pathname === '/api/extension') {
      json(res, 200, extensionStatus());
      return;
    }
    if (req.method === 'GET' && (url.pathname === '/install' || url.pathname === '/')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(deps.installPage ? deps.installPage() : '<h1>DailyLogs</h1>');
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/media/item') {
      let meta = {};
      try { meta = JSON.parse(Buffer.from(String(req.headers['x-dailylogs-meta'] || ''), 'base64').toString('utf8')); } catch (_) { json(res, 400, { ok: false, error: 'bad meta' }); return; }
      const body = await readToTemp(req);
      const entry = await deps.workspace.ingestBrowserMedia(meta, body);
      lastReceived = new Date().toISOString();
      json(res, 200, { ok: true, id: entry ? entry.id : null });
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
 * The extension id when the request really came from a browser extension, otherwise ''.
 * Both headers are written by the browser itself and cannot be set by page JavaScript, so a heartbeat
 * from a script, a terminal or a curl does not make the app claim the extension is installed.
 */
function extensionOrigin(headers) {
  const m = /^(?:chrome|moz|safari-web|edge)-extension:\/\/([a-z0-9-]+)\/?$/i.exec(String(headers.origin || ''));
  if (!m) return '';
  if (!headers['sec-fetch-mode'] || !headers['sec-fetch-site']) return '';   // absent on non-browser clients
  return m[1];
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
