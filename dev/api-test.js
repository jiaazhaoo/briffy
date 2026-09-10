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

// Both fixtures below are the headers Chrome 153 actually put on the wire, read off a throwaway profile
// with a probe extension, not what they were once assumed to be. The difference is the whole bug: the
// heartbeat is a GET and a GET from a service worker carries **no Origin**, because the browser writes
// one only for methods other than GET and HEAD. `Sec-Fetch-Site` is `none` either way -- a page's fetch
// to 127.0.0.1 says `cross-site`, and a page cannot write the header at all.
const HEARTBEAT = { 'X-Briffy': '1', 'X-Briffy-Ext': '0.1.1', 'X-Briffy-Ext-Id': 'qponmlkjihgfedcbqponmlkjihgfedcb', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'none', 'Sec-Fetch-Dest': 'empty' };
const BROWSER_POST = { 'X-Briffy': '1', 'X-Briffy-Ext': '0.1.0', Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'none', 'Sec-Fetch-Dest': 'empty' };
const status = async () => (await fetch(`${BASE}/api/extension`)).json();
const state = async () => (await status()).connected;

let pass = 0;
let total = 0;
function check(ok, line) { total++; if (ok) pass++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${line}`); }

(async () => {
  await new Promise((r) => setTimeout(r, 300));
  const cases = [
    ['fresh start', null, false],
    ['plain curl-style ping (header only)', { 'X-Briffy': '1', 'X-Briffy-Ext': '9.9.9' }, false],
    ['fake origin, no browser fetch headers', { 'X-Briffy': '1', 'X-Briffy-Ext': '9.9.9', Origin: 'chrome-extension://fake' }, false],
    ['page origin (not an extension)', { 'X-Briffy': '1', 'X-Briffy-Ext': '9.9.9', Origin: 'http://127.0.0.1:47899', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-origin' }, false],
    // The door the Origin-less heartbeat opens, and the lock on it: drop the Origin but leave any other
    // Sec-Fetch-Site behind, and it stays shut. Only a context with no page behind it says `none`.
    ['no origin, but not a page-less context', { ...HEARTBEAT, 'Sec-Fetch-Site': 'cross-site' }, false],
    ['real extension, POST (browser writes the Origin)', BROWSER_POST, true],
  ];
  for (const [label, headers, expect] of cases) {
    if (headers) await fetch(`${BASE}/api/ping`, { headers });
    const got = await state();
    check(got === expect, `${label}: connected=${got} (expected ${expect})`);
  }
  // The one this test exists for now. `connected` is already true by here and stays true once set, so
  // asking it again would prove nothing -- the heartbeat carries a different id and version, and the
  // check is that the app took them. That only happens if the Origin-less GET was counted.
  await fetch(`${BASE}/api/ping`, { headers: HEARTBEAT });
  const beat = await status();
  check(beat.connected && beat.id === 'qponmlkjihgfedcbqponmlkjihgfedcb' && beat.version === '0.1.1',
    `real extension heartbeat, GET with no Origin: id=${beat.id} version=${beat.version} (expected the heartbeat's own)`);

  const guide = await fetch(`${BASE}/install`);
  check(guide.status === 200, `guide page reachable without headers: ${guide.status}`);
  const media = await fetch(`${BASE}/api/media/item`, { method: 'POST' });
  check(media.status === 403, `media endpoint still protected: ${media.status}`);
  localApi.stop();
  console.log(`${pass}/${total} passed`);
  process.exit(pass === total ? 0 : 1);
})();
