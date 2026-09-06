'use strict';
// A real scrolling capture, end to end.
//
//   npx electron dev/longshot-test.js
//
// A window shows a document made of coloured bands in a known order, briffy scrolls that window and
// watches the rectangle through a real capture stream, and the picture that comes back is decoded and
// read band by band. That is the only way to catch the failure that matters: a long screenshot that
// looks plausible but has a band repeated or missing, which nobody would spot by eye.
//
// Nothing here scrolls the page. briffy does its own scrolling now -- that is what lets it confine the
// search to where the content can plausibly have got to -- so a test that also drove the page would be
// two hands on the same wheel. dev/longshot-real-test.js is the harder version of this, on a page of
// near-identical sections, which is the shape that breaks matching-based stitching.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow, nativeImage, screen } = require('electron');
const longshot = require('../src/main/longshot');

const BAND = 120;            // logical px per band
const BANDS = 26;
const VIEW_W = 760; const VIEW_H = 520;

let pass = 0; let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}${detail ? `  ${detail}` : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Distinct, far-apart colours so a mis-stitch cannot look like a near miss.
// A lattice, not a hue wheel. Turning the hue by a fixed angle cannot give 26 colours that are far
// apart -- the best angle there is leaves the closest pair 45 levels apart, and this test calls two
// colours the same within 40, so bands quietly became each other. Band 23 read as band 0 for exactly
// that reason and made a correct picture look as though it had started over. Four levels in each
// channel puts every pair at least 80 apart, and the check below refuses to run if that ever stops
// being true.
const LEVELS = [30, 110, 190, 250];
function colourOf(i) {
  return [LEVELS[(i >> 4) & 3], LEVELS[(i >> 2) & 3], LEVELS[i & 3]];
}

function documentHtml() {
  const rows = [];
  for (let i = 0; i < BANDS; i++) {
    const [r, g, b] = colourOf(i);
    rows.push(`<div style="height:${BAND}px;background:rgb(${r},${g},${b});color:#fff;font:700 34px/${BAND}px system-ui;padding-left:24px">band ${i}</div>`);
  }
  return `<!doctype html><meta charset="utf-8"><title>doc</title>
    <style>html,body{margin:0;padding:0;background:#fff}::-webkit-scrollbar{display:none}</style>
    <body>${rows.join('')}</body>`;
}

/** How far apart the two most similar bands are; the reader below cannot tell apart anything closer. */
function closestBands() {
  let worst = Infinity;
  for (let i = 0; i < BANDS; i++) {
    for (let j = i + 1; j < BANDS; j++) {
      const a = colourOf(i); const b = colourOf(j);
      worst = Math.min(worst, Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]));
    }
  }
  return worst;
}

app.whenReady().then(async () => {
  check('the bands are far enough apart to tell apart', closestBands() > 40, `closest pair differs by ${closestBands()}`);
  longshot.init();
  const display = screen.getPrimaryDisplay();

  // The document, parked at a known place on the primary display.
  const at = { x: display.bounds.x + 80, y: display.bounds.y + 80 };
  const page = new BrowserWindow({
    x: at.x, y: at.y, width: VIEW_W, height: VIEW_H, useContentSize: true,
    frame: false, show: false, alwaysOnTop: true, backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, backgroundThrottling: false },
  });
  page.setAlwaysOnTop(true, 'floating', 1);
  const file = path.join(os.tmpdir(), 'briffy-longshot-doc.html');
  fs.writeFileSync(file, documentHtml());
  await page.loadFile(file);
  page.showInactive();
  await sleep(500);

  // The rectangle, in the display's own logical points -- exactly what the selection overlay hands over.
  const rect = { x: at.x - display.bounds.x, y: at.y - display.bounds.y, width: VIEW_W, height: VIEW_H };

  const started = longshot.start({
    display,
    rect,
    strings: { starting: 'starting', scroll: 'scroll', done: 'Done', cancel: 'Cancel', full: 'full', failed: 'failed' },
  });

  // Let the stream open and the first frame land.
  await sleep(2200);
  const bar = BrowserWindow.getAllWindows().find((w) => w !== page && !w.isDestroyed());
  check('the control strip is up', !!bar, bar ? '' : 'no window appeared');
  if (bar) {
    bar.webContents.on('console-message', (_e, _l, msg) => console.log('    [strip]', msg));
    const said = await bar.webContents.executeJavaScript(
      "({ state: document.querySelector('#state').textContent, count: document.querySelector('#count').textContent })");
    console.log(`    strip says: ${JSON.stringify(said)}`);
  }
  if (bar) check('and it hides itself from the capture', bar.isContentProtectionEnabled ? bar.isContentProtectionEnabled() !== false : true, '');

  // briffy scrolls; this only watches how far the page actually travelled, so that the height of the
  // picture can be checked against ground the page really covered. Enter is Done, and it is only here
  // as a way out if the shot never decides it has reached the bottom.
  let scrolled = 0;
  const watch = setInterval(async () => {
    try { scrolled = Math.max(scrolled, await page.webContents.executeJavaScript('window.scrollY')); } catch (_) { /* going away */ }
  }, 100);
  const guard = setTimeout(() => {
    if (bar && !bar.isDestroyed()) bar.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  }, 70000);

  const shot = await started;
  clearInterval(watch); clearTimeout(guard);
  check('it scrolled the window itself and stopped at the end', scrolled > BAND * 4, `the page went ${scrolled} px`);
  check('a picture came back', !!(shot && shot.png && shot.png.length), shot ? `${(shot.png.length / 1024).toFixed(0)} KB` : 'nothing');
  if (!shot) { console.log(`\n${pass} passed, ${fail + 1} failed`); page.destroy(); process.exit(1); }

  const img = nativeImage.createFromBuffer(shot.png);
  const size = img.getSize();
  const scale = size.width / VIEW_W;            // stream pixels per logical point
  check('it is taller than one screenful', size.height > VIEW_H * scale * 1.5,
    `${size.width}x${size.height}, one screenful is ${Math.round(VIEW_H * scale)}`);
  check('it grew by exactly what was scrolled', Math.abs(size.height - ((VIEW_H + scrolled) * scale)) < 30 * scale,
    `${size.height} against ${Math.round((VIEW_H + scrolled) * scale)} expected`);
  check('it used more than the first frame', shot.frames > 2, `${shot.frames} frames contributed`);

  // ---------- read the bands back ----------
  const bmp = img.toBitmap();                   // BGRA
  const at2 = (y) => {
    const x = Math.round(size.width * 0.6);     // away from the text, in flat colour
    const i = ((y * size.width) + x) * 4;
    return [bmp[i + 2], bmp[i + 1], bmp[i]];
  };
  const TOL = 40;
  const near = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < TOL;
  // A band has to hold for a while to count. Where one band meets the next the capture blends them
  // over a row or two, and a blend can land within tolerance of some third band -- which read as bands
  // appearing out of nowhere between two real ones, and made a correct picture look mis-stitched. A
  // real band is 120 points tall; anything under a fifth of that is a boundary, not a band.
  const MIN_RUN = Math.round(BAND * scale * 0.2);
  const seen = [];
  let run = -1; let held = 0;
  const keep = () => { if (run >= 0 && held >= MIN_RUN && seen[seen.length - 1] !== run) seen.push(run); };
  for (let y = 2; y < size.height - 2; y += 4) {
    const c = at2(y);
    let which = -1;
    for (let i = 0; i < BANDS; i++) if (near(c, colourOf(i))) { which = i; break; }
    if (which === run) { held += 4; continue; }
    keep();
    run = which; held = 4;
  }
  keep();
  check('the bands come out in order, none out of place',
    seen.every((v, i) => i === 0 || v >= seen[i - 1]), `read ${seen.slice(0, 12).join(',')}…`);
  const jumps = seen.filter((v, i) => i > 0 && v !== seen[i - 1] + 1);
  check('no band was skipped and none repeated', jumps.length === 0,
    jumps.length ? `breaks at ${jumps.slice(0, 5).join(',')} in ${seen.join(',')}` : `${seen.length} bands in a row`);
  check('it reached the far end of the document', seen[seen.length - 1] >= Math.floor((VIEW_H + scrolled) / BAND) - 1,
    `last band ${seen[seen.length - 1]}, document has ${BANDS}`);

  const out = path.join(os.tmpdir(), 'briffy-longshot-result.png');
  fs.writeFileSync(out, shot.png);
  console.log(`\n  the picture: ${out}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  page.destroy();
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('TEST_ERROR', e && e.stack || e); process.exit(1); });
