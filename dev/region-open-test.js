'use strict';
// Does asking for the window list slow the overlay down?
//
//   npx electron dev/region-open-test.js
//
// Snapping needs every window's geometry (~86 ms). The frozen picture behind the overlay costs about
// 200 ms. One after the other, the overlay is a third slower for a feature nobody asked to wait for;
// together, snapping is free. region.js runs them together -- this is the check that it stays that way.
//
// The claim is tested head-on, by timing both orders against each other, rather than inferred from how
// long the overlay takes in total: that total also carries window warm-up and encoding, which move
// around enough to hide the very thing being measured. (Learned the hard way -- an earlier version of
// this test failed while the code was right.)
const { app, desktopCapturer, screen } = require('electron');
const region = require('../src/main/region');
const windowList = require('../src/main/window-list');

const now = () => process.hrtime.bigint();
const since = (t) => Number(process.hrtime.bigint() - t) / 1e6;
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const RUNS = 4;

let pass = 0; let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}${detail ? `  ${detail}` : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

app.whenReady().then(async () => {
  const box = screen.getAllDisplays().reduce((a, d) => ({
    width: Math.max(a.width, Math.round(d.bounds.width * (d.scaleFactor || 1))),
    height: Math.max(a.height, Math.round(d.bounds.height * (d.scaleFactor || 1))),
  }), { width: 1, height: 1 });
  const grab = () => desktopCapturer.getSources({ types: ['screen'], thumbnailSize: box });

  const timeAll = async (fn) => { const t = []; for (let i = 0; i < RUNS; i++) { const s = now(); await fn(); t.push(since(s)); } return med(t); };

  const capture = await timeAll(grab);
  const list = await timeAll(() => windowList.list());
  const together = await timeAll(() => Promise.all([grab(), windowList.list()]));
  const inTurn = await timeAll(async () => { await grab(); await windowList.list(); });

  console.log(`  the picture alone       ${capture.toFixed(0)} ms`);
  console.log(`  the window list alone   ${list.toFixed(0)} ms`);
  console.log(`  both, the way region.js does it  ${together.toFixed(0)} ms`);
  console.log(`  both, one after the other        ${inTurn.toFixed(0)} ms`);

  const saved = inTurn - together;
  check('snapping rides along instead of queueing behind the picture',
    saved > list * 0.7,
    `saves ${saved.toFixed(0)} ms of the ${list.toFixed(0)} ms the list costs`);
  check('together costs about what the slower half costs',
    together < Math.max(capture, list) * 1.25,
    `${together.toFixed(0)} ms against ${Math.max(capture, list).toFixed(0)} ms`);

  // And the overlay really does open, with the windows aboard.
  region.init();
  const t = now();
  const p = region.selectRegion({ hideWindows: async () => 0, restoreWindows: () => {}, strings: { hint: '', ok: '', cancel: '' } });
  await new Promise((resolve) => { const tick = setInterval(() => { if (region.active()) { clearInterval(tick); resolve(); } }, 5); });
  const opened = since(t);
  region.cancel();
  await p;
  console.log(`  the whole overlay, first open    ${opened.toFixed(0)} ms`);
  check('and the overlay still opens quickly enough to feel like a screenshot tool', opened < 600, `${opened.toFixed(0)} ms`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('TEST_ERROR', e && e.stack || e); process.exit(1); });
