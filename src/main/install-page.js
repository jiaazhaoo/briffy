'use strict';
// The page DailyLogs opens in the user's browser to walk them through loading the extension.
// It lives on the app's own local endpoint, so it can poll the app and announce success by itself —
// browsers refuse to open chrome://extensions from a command line, so the address is offered for pasting.

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const TEXT = {
  zh: {
    title: 'DailyLogs 浏览器扩展',
    lead: '装上它以后，在任何网页按 <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd>（或点扩展图标），就能把这一页的图片、视频、音频挑出来存进 DailyLogs。',
    waiting: '等待扩展连接…',
    connected: '扩展已连接，可以关掉这个页面了',
    step1: '打开扩展管理页',
    step1desc: '浏览器不允许别的程序直接跳转到这个地址，请复制后粘贴到地址栏：',
    step2: '打开右上角的「开发者模式」',
    step2desc: '开关在扩展管理页的右上角。',
    step3: '点「加载已解压的扩展程序」，选择这个文件夹',
    step4: '完成',
    step4desc: '装好后这个页面会自己变成绿色。之后在任意网页按 <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> 即可。',
    copy: '复制',
    copied: '已复制',
    browserHint: '如果你用的是 Edge，地址换成 edge://extensions；Brave 是 brave://extensions。',
  },
  en: {
    title: 'DailyLogs browser extension',
    lead: 'Once installed, press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> on any page (or click the extension icon) to pick images, videos and audio from it into DailyLogs.',
    waiting: 'Waiting for the extension…',
    connected: 'Extension connected – you can close this page',
    step1: 'Open the extensions page',
    step1desc: 'Browsers do not let another program navigate there, so copy this and paste it into the address bar:',
    step2: 'Turn on "Developer mode"',
    step2desc: 'The switch is in the top-right corner of the extensions page.',
    step3: 'Click "Load unpacked" and choose this folder',
    step4: 'Done',
    step4desc: 'This page turns green by itself once it works. Then press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> on any page.',
    copy: 'Copy',
    copied: 'Copied',
    browserHint: 'On Edge use edge://extensions, on Brave brave://extensions.',
  },
};

/**
 * @param {{lang?:'zh'|'en', extensionDir:string, browser?:string}} opts
 * @returns {string} a self-contained HTML page
 */
function installPage(opts = {}) {
  const t = TEXT[opts.lang === 'en' ? 'en' : 'zh'];
  const dir = escapeHtml(opts.extensionDir || '');
  const scheme = opts.browser === 'edge' ? 'edge' : 'chrome';
  const address = `${scheme}://extensions/`;
  return `<!doctype html>
<html lang="${opts.lang === 'en' ? 'en' : 'zh'}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(t.title)}</title>
<style>
  :root { --bg:#f4f5f7; --card:#fff; --line:#e5e7eb; --text:#16181d; --muted:#6b7280; --accent:#f97316; --green:#16a34a;
    color-scheme: light dark;
    font-family:-apple-system,"Segoe UI Variable Text","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
  @media (prefers-color-scheme: dark) { :root { --bg:#17181c; --card:#222429; --line:#33363d; --text:#f3f4f6; --muted:#9aa0aa; --accent:#fb923c; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); display:flex; justify-content:center; padding:40px 20px 60px; }
  .wrap { width:100%; max-width:640px; }
  h1 { font-size:22px; margin:0 0 8px; letter-spacing:-.01em; }
  .lead { color:var(--muted); font-size:14px; line-height:1.6; margin:0 0 20px; }
  kbd { background:var(--card); border:1px solid var(--line); border-bottom-width:2px; border-radius:6px; padding:1px 6px; font:inherit; font-size:12.5px; }
  .status { display:flex; align-items:center; gap:10px; padding:14px 16px; border-radius:14px; background:var(--card);
    border:1px solid var(--line); margin-bottom:22px; font-weight:600; font-size:14px; }
  .status .dot { width:10px; height:10px; border-radius:50%; background:var(--muted); flex:none; }
  .status.waiting .dot { background:var(--accent); animation:pulse 1.4s ease-in-out infinite; }
  .status.ok { border-color:var(--green); color:var(--green); }
  .status.ok .dot { background:var(--green); animation:none; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
  ol { list-style:none; counter-reset:s; padding:0; margin:0; }
  li { counter-increment:s; position:relative; padding:0 0 22px 42px; }
  li::before { content:counter(s); position:absolute; left:0; top:0; width:26px; height:26px; border-radius:50%;
    background:var(--accent); color:#fff; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:700; }
  li::after { content:""; position:absolute; left:13px; top:30px; bottom:2px; width:2px; background:var(--line); }
  li:last-child::after { display:none; }
  h2 { font-size:15px; margin:3px 0 6px; }
  p { margin:0 0 10px; color:var(--muted); font-size:13.5px; line-height:1.6; }
  .copyrow { display:flex; gap:8px; align-items:stretch; margin:8px 0 4px; }
  code { flex:1; background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 12px;
    font:12.5px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; word-break:break-all; display:flex; align-items:center; }
  button { border:1px solid var(--line); background:var(--card); color:var(--text); border-radius:10px; padding:0 14px;
    font:inherit; font-size:13px; font-weight:600; cursor:pointer; white-space:nowrap; }
  button:hover { border-color:var(--accent); }
  button.done { border-color:var(--green); color:var(--green); }
  .hint { font-size:12.5px; color:var(--muted); margin-top:18px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>🐱 ${escapeHtml(t.title)}</h1>
  <p class="lead">${t.lead}</p>

  <div class="status waiting" id="status"><span class="dot"></span><span id="statusText">${escapeHtml(t.waiting)}</span></div>

  <ol>
    <li>
      <h2>${escapeHtml(t.step1)}</h2>
      <p>${escapeHtml(t.step1desc)}</p>
      <div class="copyrow"><code id="addr">${escapeHtml(address)}</code><button data-copy="addr">${escapeHtml(t.copy)}</button></div>
    </li>
    <li>
      <h2>${escapeHtml(t.step2)}</h2>
      <p>${escapeHtml(t.step2desc)}</p>
    </li>
    <li>
      <h2>${escapeHtml(t.step3)}</h2>
      <div class="copyrow"><code id="dir">${dir}</code><button data-copy="dir">${escapeHtml(t.copy)}</button></div>
    </li>
    <li>
      <h2>${escapeHtml(t.step4)}</h2>
      <p>${t.step4desc}</p>
    </li>
  </ol>

  <p class="hint">${escapeHtml(t.browserHint)}</p>
</div>
<script>
  const COPIED = ${JSON.stringify(t.copied)};
  const CONNECTED = ${JSON.stringify(t.connected)};
  for (const b of document.querySelectorAll('button[data-copy]')) {
    b.addEventListener('click', async () => {
      const text = document.getElementById(b.dataset.copy).textContent;
      try { await navigator.clipboard.writeText(text); } catch (_) {
        const r = document.createRange(); r.selectNode(document.getElementById(b.dataset.copy));
        getSelection().removeAllRanges(); getSelection().addRange(r); document.execCommand('copy'); getSelection().removeAllRanges();
      }
      const old = b.textContent; b.textContent = COPIED; b.classList.add('done');
      setTimeout(() => { b.textContent = old; b.classList.remove('done'); }, 1600);
    });
  }
  async function poll() {
    try {
      const r = await fetch('/api/extension', { headers: { 'X-DailyLogs': '1' } });
      const j = await r.json();
      if (j.connected) {
        const s = document.getElementById('status');
        s.className = 'status ok';
        document.getElementById('statusText').textContent = CONNECTED + (j.version ? ' (v' + j.version + ')' : '');
        return;
      }
    } catch (_) { /* app closed */ }
    setTimeout(poll, 2000);
  }
  poll();
</script>
</body>
</html>`;
}

module.exports = { installPage };
