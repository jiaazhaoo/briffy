'use strict';
// "Sign in with OpenRouter": OAuth PKCE flow that gives the app an API key without the user copying anything.
// https://openrouter.ai/docs/use-cases/oauth-pkce  – localhost callbacks are allowed on any port.
const crypto = require('crypto');
const http = require('http');
const { shell } = require('electron');

const AUTH_URL = 'https://openrouter.ai/auth';
const EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys';

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
  <style>body{font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#f6f3ee;color:#2f2a24;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
  .card{background:#fff;border:1px solid #e6dfd4;border-radius:16px;padding:32px 40px;max-width:520px;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.08)}h1{font-size:20px;margin:0 0 10px}p{color:#7c7368;margin:0}</style></head>
  <body><div class="card"><div style="font-size:42px">🐱</div><h1>${title}</h1><p>${body}</p></div></body></html>`;
}

let active = null;

/**
 * Opens the browser for the OpenRouter consent screen and resolves with the new API key.
 * @param {{timeoutMs?:number, strings?:{successTitle:string, successBody:string, failTitle:string}}} [opts]
 * @returns {Promise<string>}
 */
async function login(opts = {}) {
  const timeoutMs = opts.timeoutMs || 10 * 60 * 1000;
  const s = { successTitle: 'Signed in', successBody: 'You can close this tab and return to DailyLogs.', failTitle: 'Sign-in failed', ...(opts.strings || {}) };
  if (active) active.cancel();
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());

  return new Promise((resolve, reject) => {
    let done = false;
    let timer = null;
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
      const code = url.searchParams.get('code');
      if (!code) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        res.end(page(s.failTitle, 'No authorization code was returned.'));
        finish(new Error('OpenRouter did not return an authorization code'));
        return;
      }
      try {
        const key = await exchange(code, verifier);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(page(s.successTitle, s.successBody));
        finish(null, key);
      } catch (e) {
        res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
        res.end(page(s.failTitle, String(e.message)));
        finish(e);
      }
    });
    const finish = (err, key) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      active = null;
      setTimeout(() => server.close(), 500);
      if (err) reject(err); else resolve(key);
    };
    timer = setTimeout(() => finish(new Error('Sign-in timed out')), timeoutMs);
    active = { cancel: () => finish(new Error('Sign-in cancelled')) };
    server.on('error', (e) => finish(e));
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const callback = `http://localhost:${port}/callback`;
      const authUrl = `${AUTH_URL}?callback_url=${encodeURIComponent(callback)}&code_challenge=${challenge}&code_challenge_method=S256`;
      if (opts.onUrl) opts.onUrl(authUrl);
      shell.openExternal(authUrl).catch((e) => finish(e));
    });
  });
}

async function exchange(code, verifier) {
  const res = await fetch(EXCHANGE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.key) throw new Error((json.error && (json.error.message || JSON.stringify(json.error))) || `HTTP ${res.status}`);
  return json.key;
}

function cancel() { if (active) active.cancel(); }

module.exports = { login, cancel };
