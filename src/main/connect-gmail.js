'use strict';
// Gmail: bring the mail in.
//
// **凭据是你自己的。** gmail.readonly 在 Google 那里是「受限权限」：要给外部用户用，应用得过 CASA
// Tier 2 安全审计，每年一次、首次 6-12 周、几千到几万美元；在那之前应用是未验证状态，授权页带一张
// 警告，而且最多 100 个测试用户。briffy 内置一个自己的 client id 只会把每个用户都卡在那张警告页上，
// 所以这里让你填自己在 Google Cloud 建的「桌面应用」client——你是那个应用的所有者，就没有这道门。
//
// 授权走回环：浏览器里点同意，Google 把码回调到 127.0.0.1 上一个临时端口。全程没有中间服务器，
// briffy 也从不经手你的 Google 密码——它只拿到一个可以随时撤销的 refresh token。
//
// 只读。scope 只要 gmail.readonly，briffy 不发信、不改标签、不删邮件。
const http = require('http');
// electron 用到时再取：这个文件里除了「打开浏览器」那一步都不依赖它，
// 顶层 require 会让它在纯 node 下加载不了，测试也就跑不起来。

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const PAGE_SIZE = 50;
const CONCURRENCY = 4;           // 列表只给 id，正文要一封封取；四个并发够快又不至于被限速

const label = 'Gmail';

function hasCreds(store) { return !!(store.getSecret('gmailClient') && store.getSecret('gmailRefresh')); }
function loadCreds(store) {
  const [id, secret] = String(store.getSecret('gmailClient') || '').split(' ');
  return { clientId: id || '', clientSecret: secret || '', refresh: store.getSecret('gmailRefresh') || '' };
}
function saveCreds(store, creds) {
  store.setSecret('gmailClient', `${creds.clientId || ''} ${creds.clientSecret || ''}`);
  store.setSecret('gmailRefresh', creds.refresh || '');
}
function clearCreds(store) { store.setSecret('gmailClient', ''); store.setSecret('gmailRefresh', ''); }

/**
 * 走完一次授权，拿到 refresh token。同意是在浏览器里由你点的，briffy 只接住结果。
 * 端口是临时的、只监听 127.0.0.1、用完就关。
 */
async function authorise({ clientId, clientSecret }) {
  if (!clientId || !clientSecret) throw new Error('missing client id or secret');
  const server = http.createServer();
  const port = await new Promise((res, rej) => {
    server.on('error', rej);
    server.listen(0, '127.0.0.1', () => res(server.address().port));
  });
  const redirect = `http://127.0.0.1:${port}`;
  const wait = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { server.close(); reject(new Error('timed out waiting for the authorisation')); }, 5 * 60 * 1000);
    server.on('request', (req, res) => {
      const url = new URL(req.url, redirect);
      const code = url.searchParams.get('code');
      const err = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<meta charset="utf-8"><body style="font:14px/1.7 -apple-system,system-ui,sans-serif;padding:64px;text-align:center;color:#333">`
        + (code ? '连上了，回到 briffy 就行。' : `没能连上：${err || 'cancelled'}`) + '</body>');
      clearTimeout(timer);
      server.close();
      if (code) resolve(code); else reject(new Error(err || 'authorisation cancelled'));
    });
  });
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent',
  });
  const { shell } = require('electron');
  await shell.openExternal(`${AUTH}?${q}`);
  const code = await wait;
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: 'authorization_code' }),
  });
  const data = await res.json();
  if (!res.ok || !data.refresh_token) throw new Error(data.error_description || data.error || 'no refresh token came back');
  return data.refresh_token;
}

const access = new Map();        // clientId -> { token, until }
async function accessToken({ clientId, clientSecret, refresh }) {
  const hit = access.get(clientId);
  if (hit && hit.until > Date.now() + 30000) return hit.token;
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(data.error_description || data.error || 'could not refresh the token');
  access.set(clientId, { token: data.access_token, until: Date.now() + (data.expires_in || 3600) * 1000 });
  return data.access_token;
}

async function call(creds, path) {
  const token = await accessToken(creds);
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429 || res.status === 403) {          // 限速：退一步再来一次
    await new Promise((r) => setTimeout(r, 2000));
    const again = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${await accessToken(creds)}` } });
    if (!again.ok) throw new Error(`Gmail ${again.status}`);
    return again.json();
  }
  if (!res.ok) {
    let msg = `Gmail ${res.status}`;
    try { const d = await res.json(); msg = (d.error && d.error.message) || msg; } catch (_) { /* 用状态码 */ }
    throw new Error(msg);
  }
  return res.json();
}

async function check(creds) {
  const refresh = creds.refresh || await authorise(creds);
  const me = await call({ ...creds, refresh }, '/profile');
  creds.refresh = refresh;                                  // 交回去给 saveCreds
  return { account: me.emailAddress || 'Gmail' };
}

const b64 = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const strip = (html) => String(html || '')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

/** 邮件正文。优先纯文本；只有 HTML 的就把标签剥掉——存下来的是能被搜到的字，不是排版。 */
function bodyOf(payload) {
  const seen = { plain: '', html: '' };
  const walk = (part) => {
    if (!part) return;
    const type = part.mimeType || '';
    const data = part.body && part.body.data;
    if (data && type === 'text/plain' && !seen.plain) seen.plain = b64(data);
    if (data && type === 'text/html' && !seen.html) seen.html = b64(data);
    for (const p of (part.parts || [])) walk(p);
  };
  walk(payload);
  return (seen.plain || strip(seen.html)).slice(0, 20000);
}

const header = (h, name) => ((h || []).find((x) => (x.name || '').toLowerCase() === name) || {}).value || '';

async function pull(creds, cursor, take) {
  const q = new URLSearchParams({ maxResults: String(PAGE_SIZE), ...(cursor ? { pageToken: cursor } : {}) });
  const list = await call(creds, `/messages?${q}`);
  const ids = (list.messages || []).map((m) => m.id);
  // 一次取几封，既不是一封封排队等，也不是一口气全发出去
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const msgs = await Promise.all(batch.map(async (id) => {
      try { return await call(creds, `/messages/${id}?format=full`); }
      catch (e) { console.warn('[gmail] could not fetch', id, e.message); return null; }
    }));
    for (const m of msgs) {
      if (!m) continue;
      const h = (m.payload && m.payload.headers) || [];
      const from = header(h, 'from');
      const to = header(h, 'to');
      take({
        id: m.id,
        title: header(h, 'subject') || '(no subject)',
        text: [from && `From ${from}`, to && `To ${to}`, '', bodyOf(m.payload)].filter(Boolean).join('\n'),
        url: `https://mail.google.com/mail/u/0/#all/${m.id}`,
        at: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : header(h, 'date'),
        type: 'note',
      });
    }
  }
  return { cursor: list.nextPageToken || '', more: !!list.nextPageToken };
}

module.exports = { label, check, pull, authorise, hasCreds, loadCreds, saveCreds, clearCreds, _bodyOf: bodyOf, _strip: strip, _header: header };
