'use strict';
// !! THIS TEST DOES NOT RUN on this machine. The detector it leans on is covered elsewhere --
// dev/boxes-test.js photographs a real interface, dev/autoselect-test.js paints one with known grey
// steps -- so what is missing while this is out is only the wiring: that the overlay actually draws
// the box the detector picked, and that hovering a window falls back to the window list.
//
// Two real causes were found and fixed while trying to get it going, and both are worth keeping,
// because neither says anything about itself when it happens:
//
//   a preload outside the application's own directory is refused, and the refusal surfaces as a bare
//     ERR_FAILED (-2) on the page load. No preload-error event, no mention of a preload. The stub used
//     to be written to os.tmpdir(); it is now written next to this file.
//   an offscreen renderer goes down with SIGTRAP the moment this page's <script src="boxes.js"> is
//     parsed. Not boxes.js's doing -- the same file runs under node, and the same page loads offscreen
//     with that one script removed. Both windows here are now shown rather than offscreen; a merely
//     hidden window is no good either, because capturePage never resolves on one.
//
// What remains is not in this file: Electron itself stops becoming ready. `app.whenReady()` never
// fires, so nothing runs at all -- no output, no window, not even the first line of the callback. It
// comes and goes, and it started after the SIGTRAP crashes above. A machine that has not been running
// Electron all afternoon may well run this as written.
const path = require('path');
const fs = require('fs');
const os = require('os');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0; let fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; } else { fail++; console.error(`FAIL ${name}${detail ? ': ' + detail : ''}`); }
};

const UI = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}body{font:13px/1.5 -apple-system,system-ui,sans-serif;background:#fff;color:#222}
#bar{height:44px;background:#f6f6f6;border-bottom:1px solid #d6d6d6;padding:12px}
#side{position:absolute;left:0;top:44px;bottom:0;width:200px;background:#fafafa;border-right:1px solid #d6d6d6;padding:12px}
#main{position:absolute;left:200px;top:44px;right:0;bottom:0;padding:20px;display:grid;grid-template-columns:1fr 1fr;gap:20px;align-content:start}
.card{background:#eef2f7;border:1px solid #c8d2de;height:150px;padding:14px}
</style><div id="bar">toolbar</div><div id="side">sidebar</div>
<div id="main"><div class="card">one</div><div class="card">two</div><div class="card">three</div><div class="card">four</div></div>`;

const STUB = `
const { contextBridge, ipcRenderer } = require('electron');
let onInit = null;
contextBridge.exposeInMainWorld('region', {
  onInit: (cb) => { onInit = cb; ipcRenderer.on('test:init', (e, p) => cb(p)); },
  onReset: () => {},
  select: (r) => ipcRenderer.send('test:select', r),
  long: (r) => ipcRenderer.send('test:long', r),
  cancel: () => ipcRenderer.send('test:cancel'),
});
`;

app.whenReady().then(async () => {
  const W = 1000; const H = 700;

  // 1 · a picture of an interface, exactly as region.js gets one
  const shot = new BrowserWindow({ width: W, height: H, show: true });
  await shot.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(UI)}`);
  await sleep(400);
  const truth = JSON.parse(await shot.webContents.executeJavaScript(`(() => {
    const out = {};
    for (const [k, sel] of Object.entries({ bar: '#bar', side: '#side', card: '.card' })) {
      const r = document.querySelector(sel).getBoundingClientRect();
      out[k] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }
    return JSON.stringify(out);
  })()`));
  const img = await shot.webContents.capturePage();
  const size = img.getSize();
  const image = `data:image/jpeg;base64,${img.toJPEG(88).toString('base64')}`;
  shot.destroy();

  // 2 · the overlay itself, with the preload it would normally have
  // Inside the repo, not in os.tmpdir(). A preload outside the application's own directory is refused,
  // and the refusal arrives as a bare ERR_FAILED on the page load -- no preload-error event, nothing
  // naming the preload at all. Deleted again at the end.
  const preload = path.join(__dirname, `.region-stub-${process.pid}.js`);
  fs.writeFileSync(preload, STUB);
  // Hidden, and plainly hidden -- unlike the window above, which only has to be painted and captured.
  // Two ways of keeping this one off screen do not work, and both fail silently enough to be worth
  // writing down:
  //
  //   offscreen: true                 takes the whole process down with SIGTRAP the moment this page's
  //                                   <script src="boxes.js"> is parsed. Not boxes.js's doing -- the
  //                                   same file runs under node and in an ordinary window, and the same
  //                                   page loads offscreen without it.
  //   paintWhenInitiallyHidden: true  loadFile never resolves. No error, no failure event; the test
  //                                   simply runs until something kills it.
  //
  // The overlay is an ordinary window in the app, so neither was ever needed here.
  // The same webPreferences the real overlay gets (src/main/region.js); the preload here does what
  // src/preload/region.js does, feeding the page a made-up screen instead of a real one. Without
  // sandbox: false the preload cannot require('electron') and the page never receives anything, which
  // arrives as a bare ERR_FAILED on the load rather than as anything about a preload.
  const win = new BrowserWindow({
    width: W, height: H, show: true,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'region', 'index.html'));
  const ev = (s) => win.webContents.executeJavaScript(s);

  // one window covering the whole screen: before boxes.js this was the only thing hovering could offer
  win.webContents.send('test:init', {
    image,
    scale: size.width / W,
    windows: [{ app: 'Demo', title: 'A window', x: 0, y: 0, w: W, h: H }],
    strings: { hint: 'drag', ok: 'OK', cancel: 'Cancel', long: 'Long' },
  });
  await sleep(1200);                       // the detector runs after the overlay is on screen

  const hover = async (x, y) => {
    await ev(`document.dispatchEvent(new MouseEvent('mousemove', { clientX: ${x}, clientY: ${y}, bubbles: true })); 1`);
    await sleep(60);
    return JSON.parse(await ev(`(() => {
      const s = document.querySelector('#snap');
      if (s.classList.contains('hidden')) return 'null';
      const r = s.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        label: document.querySelector('#snapLabel').textContent });
    })()`));
  };
  const near = (a, b, slack = 6) => a && b && Math.abs(a.x - b.x) <= slack && Math.abs(a.y - b.y) <= slack
    && Math.abs(a.w - b.w) <= slack * 2 && Math.abs(a.h - b.h) <= slack * 2;

  const c = truth.card;
  const onCard = await hover(c.x + (c.w / 2), c.y + (c.h / 2));
  ok('hovering a card highlights the card, not the window', near(onCard, c),
    `got ${JSON.stringify(onCard)}, wanted ${JSON.stringify(c)}`);
  ok('a rectangle read off the picture is labelled by its size alone',
    onCard && /^\d+ × \d+$/.test(onCard.label || ''), `label was "${onCard && onCard.label}"`);

  const s = truth.side;
  const onSide = await hover(s.x + 40, s.y + 300);
  ok('hovering the sidebar highlights the sidebar', near(onSide, s), `got ${JSON.stringify(onSide)}`);

  const b = truth.bar;
  const onBar = await hover(b.x + 500, b.y + (b.h / 2));
  ok('hovering the toolbar highlights the toolbar', near(onBar, b), `got ${JSON.stringify(onBar)}`);

  // and clicking without dragging takes what was highlighted
  await ev(`(() => { const d = (t, x, y) => document.dispatchEvent(new MouseEvent(t, { clientX: x, clientY: y, button: 0, bubbles: true }));
    d('mousemove', ${c.x + c.w / 2}, ${c.y + c.h / 2}); d('mousedown', ${c.x + c.w / 2}, ${c.y + c.h / 2}); d('mouseup', ${c.x + c.w / 2}, ${c.y + c.h / 2}); return 1; })()`);
  await sleep(80);
  const picked = JSON.parse(await ev(`(() => { const el = document.querySelector('#box');
    if (el.classList.contains('hidden')) return 'null';
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }); })()`));
  ok('clicking without dragging selects what was highlighted', near(picked, c), `got ${JSON.stringify(picked)}`);

  console.log(`region snap: ${pass} checks passed${fail ? `, ${fail} FAILED` : ''}`);
  try { fs.unlinkSync(preload); } catch (_) { /* it is a temp file */ }
  win.destroy();
  app.exit(fail ? 1 : 0);
}).catch((e) => { console.error('FAILED', e); app.exit(1); });
