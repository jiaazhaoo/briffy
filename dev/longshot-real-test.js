'use strict';
// A long screenshot of a page built to break it.
//
//   npx electron dev/longshot-real-test.js
//
// The other test (dev/longshot-test.js) drives a window it owns with `scrollTo`, in even steps, on a
// page of flat colour bands. That proves the stitcher joins what it is given, and nothing more. This
// one runs the feature the way it actually runs: briffy posts the scrolls itself through CoreGraphics,
// the page does its own smooth scrolling, and the shot ends when the page stops moving.
//
// The page is the adversarial part. Thirty near-identical sections and a sticky header is the shape
// that broke the old version: everything looks like everything else, so a join one card too far down
// scores about as well as the right one. Watching the user scroll and inferring the distance, that
// produced 7445 px of picture from 90 px of scrolling, the same two sections over and over, with
// nothing in the output to say it had gone wrong. Hence the two checks at the end -- the height has to
// match how far the page really went, and no strip of it may appear twice.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow, screen, nativeImage } = require('electron');

const VIEW_W = 900; const VIEW_H = 620;
const PAGE = process.env.PAGE || '';

let pass = 0; let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}${detail ? `  ${detail}` : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A page made here, so the test does not depend on the internet or on what is open. */
function documentHtml() {
  const rows = [];
  for (let i = 0; i < 30; i++) {
    // Everything about a section looks like every other section -- that is the point -- except one
    // swatch, whose red channel is the section's number. It is what lets the check at the end tell a
    // correctly joined picture from one that repeated itself: to the matcher these are 8 levels of red
    // apart in a 6 px square, to the test they are names.
    rows.push(`<article><i class="sig" style="background:rgb(${10 + (i * 8)},60,180)"></i>
      <h2>Section ${i}</h2><p>${'the quick brown fox jumps over the lazy dog. '.repeat(6)}</p>
      <div class="tag">row ${i}</div></article>`);
  }
  return `<!doctype html><meta charset="utf-8"><title>doc</title><style>
    html,body{margin:0;background:#fff;font:15px/1.6 system-ui;color:#222}
    header{position:sticky;top:0;height:52px;background:#1b1a18;color:#fff;display:flex;align-items:center;padding:0 20px;font-weight:700}
    article{padding:14px 22px;border-bottom:1px solid #e6e3dd;position:relative}
    .sig{position:absolute;left:0;top:14px;width:8px;height:10px}
    h2{margin:0 0 6px;font-size:17px}
    .tag{display:inline-block;margin-top:8px;padding:2px 8px;background:#2a6cf0;color:#fff;font:12px/1.5 system-ui}
    ::-webkit-scrollbar{display:none}
  </style><body><header>a sticky header, which is the thing that breaks naive stitching</header>
  ${rows.join('')}</body>`;
}

app.whenReady().then(async () => {
  const longshot = require('../src/main/longshot');
  longshot.init();
  const display = screen.getPrimaryDisplay();

  const at = { x: display.bounds.x + 60, y: display.bounds.y + 90 };
  const page = new BrowserWindow({
    x: at.x, y: at.y, width: VIEW_W, height: VIEW_H, useContentSize: true,
    frame: false, show: false, alwaysOnTop: true, backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, backgroundThrottling: false },
  });
  page.setAlwaysOnTop(true, 'floating', 1);
  if (PAGE) await page.loadURL(PAGE);
  else {
    const file = path.join(os.tmpdir(), 'briffy-longshot-real.html');
    fs.writeFileSync(file, documentHtml());
    await page.loadFile(file);
  }
  page.show(); page.focus();
  await sleep(900);

  const rect = { x: at.x - display.bounds.x, y: at.y - display.bounds.y, width: VIEW_W, height: VIEW_H };
  const started = longshot.start({
    display, rect,
    strings: { starting: 's', scroll: 'scroll', done: 'Done', cancel: 'Cancel', full: 'full', failed: 'failed', tooFast: 'slower' },
  });
  await sleep(2000);
  const bar = BrowserWindow.getAllWindows().find((w) => w !== page && !w.isDestroyed());
  check('the control strip is up', !!bar, '');

  // Nothing is driven from here: briffy scrolls the page itself and stops when the page stops moving.
  // The only thing this test does is watch how far the page actually travelled while that happened.
  let furthest = 0;
  const watch = setInterval(async () => {
    try { furthest = Math.max(furthest, await page.webContents.executeJavaScript('window.scrollY')); } catch (_) { /* going away */ }
  }, 120);
  const guard = setTimeout(() => { if (bar && !bar.isDestroyed()) bar.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); }, 75000);
  const shot = await started;
  clearInterval(watch); clearTimeout(guard);
  const scrolled = furthest;
  check('it stopped by itself at the bottom of the page', scrolled > 1500, `the page went ${scrolled} px`);

  check('a picture came back', !!(shot && shot.png), shot ? `${(shot.png.length / 1024).toFixed(0)} KB` : 'nothing');
  if (!shot) { console.log(`\n${pass} passed, ${fail + 1} failed`); page.destroy(); process.exit(1); }

  const img = nativeImage.createFromBuffer(shot.png);
  const size = img.getSize();
  const scale = size.width / VIEW_W;
  const expected = (VIEW_H + scrolled) * scale;
  const off = ((size.height - expected) / expected) * 100;
  console.log(`\n  the page really moved ${scrolled} px; the picture is ${size.height} against ${Math.round(expected)} expected (${off >= 0 ? '+' : ''}${off.toFixed(1)}%)`);
  check('the picture is as tall as the ground it covered', Math.abs(off) < 10, `${off.toFixed(1)}% out`);
  check('it is much taller than one screenful', size.height > VIEW_H * scale * 2, `${size.width}x${size.height}`);

  // Which sections came out, and in what order. Reading pixels rather than words: a run of swatch
  // colour down the left edge is one section, and its red channel says which. A picture that repeated
  // itself shows a number twice; one that lost a join skips a number. Comparing bands of pixels
  // instead, as an earlier version of this test did, says nothing at all here -- thirty sections that
  // look alike and a flat black header make "this strip appears twice" true of a correct picture.
  // Read each swatch as a whole rather than row by row. The capture stream shifts colours by a few
  // levels, and sections are only eight levels apart, so a per-row reading of one true section wobbles
  // between two numbers and a perfectly good picture looks as though it repeated itself.
  const bmp = img.toBitmap();      // BGRA
  const cols = [];
  for (let x = Math.round(2 * scale); x < Math.round(7 * scale); x++) cols.push(x);
  const swatchRow = (y) => {
    let r = 0; let g = 0; let b = 0;
    for (const x of cols) { const i = ((y * size.width) + x) * 4; b += bmp[i]; g += bmp[i + 1]; r += bmp[i + 2]; }
    return { r: r / cols.length, g: g / cols.length, b: b / cols.length };
  };
  const seen = [];
  let run = [];
  const closeRun = () => {
    if (run.length >= Math.round(6 * scale)) {
      const mid = run.slice(1, -1);
      const r = mid.reduce((n, v) => n + v, 0) / mid.length;
      seen.push(Math.round((r - 10) / 8));
    }
    run = [];
  };
  for (let y = 0; y < size.height; y++) {
    const px = swatchRow(y);
    // the swatch, and nothing else on the page, is this blue-and-green
    if (Math.abs(px.g - 60) < 16 && Math.abs(px.b - 180) < 16) run.push(px.r);
    else closeRun();
  }
  closeRun();

  check('every section it passed is in the picture, once', new Set(seen).size === seen.length,
    seen.length === new Set(seen).size ? `${seen.length} sections, none twice`
      : `${seen.length} sections but only ${new Set(seen).size} different — ${seen.join(',')}`);
  check('and they are in order, with none skipped',
    seen.length > 4 && seen.every((n, k) => k === 0 || n === seen[k - 1] + 1),
    seen.length ? `${seen[0]}…${seen[seen.length - 1]}` : 'no sections found');

  const out = path.join(os.tmpdir(), 'briffy-longshot-real.png');
  fs.writeFileSync(out, shot.png);
  console.log(`\n  the picture: ${out}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  page.destroy();
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('TEST_ERROR', e && e.stack || e); process.exit(1); });
