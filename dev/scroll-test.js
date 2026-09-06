'use strict';
// Does a scroll we send actually move the thing under the pointer, and by how much?
//
//   npx electron dev/scroll-test.js
//
// The long screenshot now rests on the answer: it confines the stitch search to where the content can
// plausibly have got to, and that is only worth anything if the distance we ask for bears a steady
// relation to the distance we get. So this measures it, on a real window, through the real event path.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow, screen } = require('electron');

let pass = 0; let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}${detail ? `  ${detail}` : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const scroll = require('../src/main/scroll');

  check('macOS lets us post events at all', scroll.allowed(),
    scroll.allowed() ? '' : 'Accessibility is off for this process — grant it and run again');
  if (!scroll.allowed()) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); }

  const display = screen.getPrimaryDisplay();
  const at = { x: display.bounds.x + 60, y: display.bounds.y + 90 };
  const W = 800; const H = 600;
  const win = new BrowserWindow({
    x: at.x, y: at.y, width: W, height: H, useContentSize: true,
    frame: false, show: false, alwaysOnTop: true, backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'floating', 1);
  const file = path.join(os.tmpdir(), 'briffy-scroll-test.html');
  fs.writeFileSync(file, '<!doctype html><meta charset=utf-8><style>body{margin:0}div{height:40000px;background:linear-gradient(#fff,#000)}::-webkit-scrollbar{display:none}</style><div></div>');
  await win.loadFile(file);
  win.show(); win.focus();
  await sleep(700);

  const y = () => win.webContents.executeJavaScript('window.scrollY');
  const mid = { x: at.x + W / 2, y: at.y + H / 2 };

  const before = await y();
  const ok = await scroll.step({ ...mid, dy: 200 });
  await sleep(450);
  const after = await y();
  check('a step is acknowledged', ok === true, '');
  check('the window under the pointer actually moved', after > before, `${before} → ${after}`);
  // Not 1:1, and it does not need to be -- the long shot measures what it got. What it does need is
  // for twice the request to be twice the distance, because that is what makes one measurement worth
  // anything for the next step.
  const ratio = [];
  for (const ask of [100, 200, 400]) {
    const a = await y();
    await scroll.step({ ...mid, dy: ask });
    await sleep(420);
    ratio.push(((await y()) - a) / ask);
  }
  check('the distance is proportional to the request',
    Math.max(...ratio) - Math.min(...ratio) < 0.15, `ratios ${ratio.map((r) => r.toFixed(2)).join(', ')}`);

  // The thing that matters for stitching: the same request twice gives the same distance.
  const runs = [];
  for (let i = 0; i < 6; i++) {
    const a = await y();
    await scroll.step({ ...mid, dy: 200 });
    await sleep(380);
    runs.push((await y()) - a);
  }
  const moved = runs.filter((r) => r > 0);
  const lo = Math.min(...moved); const hi = Math.max(...moved);
  check('every step that lands is the same size as the others',
    moved.length >= 4 && (hi - lo) / hi < 0.25, `steps: ${runs.join(', ')}`);
  console.log(`\n  200 px asked → ${lo}–${hi} px moved (${runs.length - moved.length} of 6 swallowed); the stitch window has to hold that`);

  // The bottom of the page: steps stop having an effect, which is how a long shot knows to stop.
  await win.webContents.executeJavaScript('window.scrollTo(0, document.body.scrollHeight)');
  await sleep(400);
  const bottom = await y();
  await scroll.step({ ...mid, dy: 200 });
  await sleep(400);
  check('at the bottom of the page a step changes nothing', (await y()) === bottom, `${bottom}`);

  const t = Date.now();
  for (let i = 0; i < 10; i++) await scroll.step({ x: -1, y: -1, dy: 0 });
  check('ten steps cost little, so a long page is not a long wait', (Date.now() - t) < 900, `${Date.now() - t}ms for 10`);

  scroll.close();
  win.destroy();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('TEST_ERROR', e && e.stack || e); process.exit(1); });
