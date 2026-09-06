// Exercises the local API on its own port, so tests never touch the instance the user is running.
const path = require('path');
const localApi = require(path.join(__dirname, '..', 'src', 'main', 'local-api.js'));
const PORT = 47899;
const BASE = `http://127.0.0.1:${PORT}`;

localApi.start({
  port: PORT,
  version: 'test',
  workspace: { ingestBrowserMedia: async () => ({ id: 'x' }) },
  installPage: () => '<h1>guide</h1>',
  onExtension: (e) => console.log('  [event] extension connected:', e.id, e.version),
});

const BROWSER = { 'X-Briffy': '1', 'X-Briffy-Ext': '0.1.0', Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'cross-site' };
const state = async () => (await (await fetch(`${BASE}/api/extension`)).json()).connected;

(async () => {
  await new Promise((r) => setTimeout(r, 300));
  const cases = [
    ['fresh start', null, false],
    ['plain curl-style ping (header only)', { 'X-Briffy': '1', 'X-Briffy-Ext': '9.9.9' }, false],
    ['fake origin, no browser fetch headers', { 'X-Briffy': '1', 'X-Briffy-Ext': '9.9.9', Origin: 'chrome-extension://fake' }, false],
    ['page origin (not an extension)', { 'X-Briffy': '1', 'X-Briffy-Ext': '9.9.9', Origin: 'http://127.0.0.1:47899', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-origin' }, false],
    ['real browser extension', BROWSER, true],
  ];
  let pass = 0;
  for (const [label, headers, expect] of cases) {
    if (headers) await fetch(`${BASE}/api/ping`, { headers });
    const got = await state();
    const ok = got === expect;
    if (ok) pass++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: connected=${got} (expected ${expect})`);
  }
  const guide = await fetch(`${BASE}/install`);
  console.log(`${guide.status === 200 ? 'PASS' : 'FAIL'}  guide page reachable without headers: ${guide.status}`);
  const media = await fetch(`${BASE}/api/media/item`, { method: 'POST' });
  console.log(`${media.status === 403 ? 'PASS' : 'FAIL'}  media endpoint still protected: ${media.status}`);
  localApi.stop();
  process.exit(pass === cases.length ? 0 : 1);
})();
