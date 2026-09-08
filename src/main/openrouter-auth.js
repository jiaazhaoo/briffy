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
  <style>body{font-family:"Source Sans 3","Noto Sans SC",-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#eef0f3;color:#1a2238;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-autospace:normal}
  .mark{width:56px;height:56px;margin:0 auto 14px}.card{background:#fff;border:1px solid #1a2238;padding:32px 40px;max-width:520px;text-align:center;box-shadow:6px 6px 0 rgba(26,34,56,.18)}h1{font:700 22px/1.3 "Source Serif 4","Noto Serif SC","Songti SC","SimSun",Georgia,serif;letter-spacing:.02em;margin:0 0 10px}p{color:#4b556b;margin:0}</style></head>
  <body><div class="card"><svg class="mark" viewBox="0 0 638 638" aria-hidden="true"><g fill="none" stroke="#2A6CF0" stroke-linecap="round"><path d="M156.5 638 V283.75 A161.75 161.75 0 0 1 480 283.75 V638" stroke-width="46"/><path d="M245.5 638 V493.5 A73 73 0 0 1 391.5 493.5 V638" stroke-width="45"/><path d="M291.5 320 A27.6 27.6 0 0 0 345.5 320" stroke-width="20"/></g><g fill="#2A6CF0"><circle cx="238" cy="281" r="27"/><circle cx="399" cy="281" r="27"/></g></svg><h1>${title}</h1><p>${body}</p></div></body></html>`;
}

let active = null;

/**
 * Opens the browser for the OpenRouter consent screen and resolves with the new API key.
 * @param {{timeoutMs?:number, strings?:{successTitle:string, successBody:string, failTitle:string}}} [opts]
 * @returns {Promise<string>}
 */
async function login(opts = {}) {
  const timeoutMs = opts.timeoutMs || 10 * 60 * 1000;
  const s = { successTitle: 'Signed in', successBody: 'You can close this tab and return to briffy.', failTitle: 'Sign-in failed', ...(opts.strings || {}) };
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
      // 打不开浏览器时把地址一起报出去。默认浏览器没设、被策略拦住、openExternal 抛异常——
      // 这些情况用户看到的都是「点了没反应」，而他其实只要能看见这个地址就能自己走完。
      shell.openExternal(authUrl).catch((e) => finish(new Error(`${e.message}｜手动打开：${authUrl}`)));
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
