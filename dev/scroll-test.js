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
const { execFile } = require('child_process');
const { app, BrowserWindow, screen } = require('electron');

/** Where a native window is and how big, straight from macOS. */
function whereIs(appName) {
  return new Promise((resolve) => {
    execFile('osascript', ['-l', 'JavaScript', '-e', `
      const ws = Application('System Events').processes['${appName}'].windows();
      ws.length ? JSON.stringify({ pos: ws[0].position(), size: ws[0].size() }) : ''`],
    { timeout: 8000 }, (err, out) => {
      const t = String(out || '').trim();
      if (err || !t) return resolve(null);
      try { resolve(JSON.parse(t)); } catch (_) { resolve(null); }
    });
  });
}

/**
 * How far the content inside a rectangle of the screen moved, in device rows.
 *
 * By looking, because for an application briffy did not write there is nothing else to ask. The
 * accessibility API was tried first and is no good here: a scroll bar's AXValue read 0.18519 before and
 * after every step, and it took a second measurement to establish that the window really had scrolled
 * and the number simply was not the position.
 *
 * One number per row -- how dark that row is -- and then the shift that lines two profiles up. The
 * search is deliberately wide and unconstrained, unlike the one in the long shot: this is the
 * instrument, and it must not share the assumption it is being used to check.
 *
 * The document it reads must not be repetitive, and that took two attempts as well: 600 identical
 * sentences gave a profile that repeated every line, so the "best" shift was whichever repeat won --
 * 372 rows, then 400, then 348, for steps that were really 400, 400 and 800.
 */
function profile(shot, rect) {
  const px = shot.px; const w = shot.w;
  const out = new Float64Array(rect.y1 - rect.y0);
  for (let y = rect.y0; y < rect.y1; y++) {
    let sum = 0;
    for (let x = rect.x0; x < rect.x1; x += 2) { const i = ((y * w) + x) * 4; sum += px[i] + px[i + 1] + px[i + 2]; }
    out[y - rect.y0] = sum;
  }
  return out;
}
function shiftOf(before, after, max) {
  let best = Infinity; let at = -1;
  for (let d = 0; d <= max; d++) {
    let sum = 0; let n = 0;
    for (let y = d; y < before.length; y++) { const t = before[y] - after[y - d]; sum += t < 0 ? -t : t; n++; }
    if (n < 200) break;
    const avg = sum / n;
    if (avg < best) { best = avg; at = d; }
  }
  return at;
}

function osa(src) {
  return new Promise((resolve) => execFile('osascript', ['-l', 'JavaScript', '-e', src], { timeout: 15000 }, () => resolve()));
}

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

  // The Electron window above stays alive until the very end on purpose -- destroying the last window
  // quits the app -- but it has to get out of the way first. It is alwaysOnTop, and the first run of
  // this section scrolled it instead of TextEdit, which looked exactly like TextEdit ignoring us.
  win.hide();
  await sleep(400);

  // ---------- a native application, not a browser ----------
  //
  // Everything above is Chromium, which reads the line field of a scroll event (8 px a line). AppKit
  // reads the pixel field instead. Both are set, and the long shot measures what it actually got rather
  // than trusting either -- but "measures what it got" is only worth something if a native window
  // answers the same request the same way every time, and until this was written that had never been
  // checked on anything but a browser.
  //
  // TextEdit, because it is on every Mac and it is a plain AppKit scroll view.
  const { Monitor } = require('node-screenshots');
  const doc = path.join(os.tmpdir(), 'briffy-scroll-native.txt');
  const words = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango'.split(' ');
  let seed = 4;
  const rnd = (n) => { seed = ((seed * 1103515245) + 12345) & 0x7fffffff; return seed % n; };
  fs.writeFileSync(doc, Array.from({ length: 600 }, (_, i) => {
    const n = 2 + rnd(13);
    return `${String(i).padStart(4, '0')} ${Array.from({ length: n }, () => words[rnd(words.length)]).join(' ')}`;
  }).join('\n'));

  // `open -a`, not AppleScript's own open: the scripting one returned without error and left TextEdit
  // running with no windows at all, which read from the outside as macOS refusing to answer.
  await new Promise((r) => execFile('open', ['-a', 'TextEdit', doc], { timeout: 10000 }, () => r()));
  await sleep(2200);
  const NX = display.bounds.x + 200; const NY = display.bounds.y + 150;
  await osa(`const ws = Application('System Events').processes['TextEdit'].windows();
    if (ws.length) { ws[0].position = [${NX}, ${NY}]; ws[0].size = [700, 650]; }
    delay(0.4); Application('TextEdit').activate(); 'ok'`);
  await sleep(900);

  let box = await whereIs('TextEdit');
  for (let i = 0; i < 5 && !box; i++) { await sleep(700); box = await whereIs('TextEdit'); }
  if (!box) {
    check('TextEdit opened a window we can point at', false, 'it did not, so the native half was skipped');
  } else {
    const mon = Monitor.all()[0];
    const probe = mon.captureImageSync();
    const sx = probe.width / mon.width(); const sy = probe.height / mon.height();
    const take = () => { const img = mon.captureImageSync(); return { px: img.toRawSync(), w: img.width }; };
    // Well inside the text, clear of the title bar and the window's own edges.
    const area = {
      x0: Math.round((box.pos[0] + 60) * sx), x1: Math.round((box.pos[0] + 620) * sx),
      y0: Math.round((box.pos[1] + 70) * sy), y1: Math.round((box.pos[1] + 610) * sy),
    };
    const mid = { x: box.pos[0] + (box.size[0] / 2), y: box.pos[1] + (box.size[1] / 2) };
    const rows = (box.size[1] - 140) * sy;

    const got = [];
    for (const ask of [100, 200, 300, 200]) {
      const before = profile(take(), area);
      await scroll.step({ ...mid, dy: ask });
      await sleep(800);
      got.push({ ask, moved: shiftOf(before, profile(take(), area), Math.min(1100, Math.floor(rows))) });
    }
    console.log(`\n${got.map((g) => `  asked ${String(g.ask).padStart(3)} points → the content moved ${String(g.moved).padStart(4)} device rows`).join('\n')}`);

    check('a native window scrolls when we ask it to', got.every((g) => g.moved > 8),
      got.map((g) => g.moved).join(', '));
    const per = got.map((g) => g.moved / g.ask);
    check('and by a distance proportional to the request',
      Math.max(...per) - Math.min(...per) < 0.3, `${per.map((r) => r.toFixed(2)).join(', ')} rows a point`);
    const same = got.filter((g) => g.ask === 200).map((g) => g.moved);
    check('and the same request twice gives the same distance', same.length === 2 && same[0] === same[1],
      same.join(' and '));
  }
  await osa(`const ws = Application('System Events').processes['TextEdit'].windows();
    if (ws.length) ws[0].close(); 'ok'`);
  try { fs.unlinkSync(doc); } catch (_) { /* already gone */ }

  scroll.close();
  win.destroy();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('TEST_ERROR', e && e.stack || e); process.exit(1); });
