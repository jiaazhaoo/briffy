'use strict';
// Window snapping: the list itself, and the coordinate change that puts it on one screen.
//
//   npx electron dev/window-snap-test.js
//
// The hover-and-click behaviour lives in the overlay's renderer and is checked in the browser preview
// (`node dev/preview/serve.js`, then /region). What is checked here is everything underneath it: that
// macOS really answers, fast, and that a window's place on a second or third display comes out right --
// which is where an off-by-one screen origin would hide.
const { app, screen } = require('electron');
const assert = require('assert');
const windowList = require('../src/main/window-list');

let pass = 0; let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}${detail ? `  ${detail}` : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

app.whenReady().then(async () => {
  // ---------- the real list ----------
  const t0 = Date.now();
  const windows = await windowList.list();
  const ms = Date.now() - t0;
  check('macOS answers with the windows on screen', windows.length > 0, `${windows.length} windows in ${ms} ms`);
  check('and fast enough to sit beside the capture', ms < 400, `${ms} ms (the capture itself costs ~190 ms)`);
  check('every window has a size worth capturing', windows.every((w) => w.w >= windowList.MIN_SIDE && w.h >= windowList.MIN_SIDE), '');
  check('every window says which app it belongs to', windows.every((w) => typeof w.app === 'string' && w.app), '');
  check('briffy does not offer to capture itself', !windows.some((w) => w.pid === process.pid), '');
  if (windows.length) {
    console.log('       front to back:');
    for (const w of windows.slice(0, 4)) console.log(`         ${w.app.padEnd(16)} ${`${w.w}x${w.h}`.padEnd(11)} at ${w.x},${w.y}  ${(w.title || '').slice(0, 34)}`);
  }

  // ---------- onto one screen ----------
  // CoreGraphics and Electron both count logical points from the top-left of the main display, so the
  // conversion is a subtraction -- but only for windows that reach the screen at all.
  const display = (x, y, width, height) => ({ bounds: { x, y, width, height } });
  const main = display(0, 0, 1000, 800);
  const left = display(-1200, 100, 1200, 900);        // a second screen, to the left and lower down

  const w = (name, x, y, ww, hh) => ({ app: name, title: '', pid: 1, x, y, w: ww, h: hh });

  const onMain = windowList.forDisplay([
    w('A', 10, 20, 300, 200),          // fully on the main screen
    w('B', -1100, 150, 400, 300),      // only on the left-hand screen
    w('C', -50, -30, 200, 200),        // straddles the main screen's top-left corner
    w('D', 990, 10, 300, 300),         // just clips the main screen's right edge
    w('E', 1200, 10, 100, 100),        // past it entirely
  ], main);
  check('only what reaches the screen comes back', onMain.map((x) => x.app).join(',') === 'A,C,D',
    `got ${onMain.map((x) => x.app).join(',') || '(none)'}`);
  check('a window on the main screen keeps its place', JSON.stringify(onMain[0]) === JSON.stringify({ app: 'A', title: '', x: 10, y: 20, w: 300, h: 200 }), '');
  check('one hanging off the top-left keeps negative edges', onMain[1].x === -50 && onMain[1].y === -30,
    'the overlay clips them; moving them here would resize the window');

  const onLeft = windowList.forDisplay([
    w('B', -1100, 150, 400, 300),
    w('A', 10, 20, 300, 200),
  ], left);
  check('a second screen subtracts its own origin', onLeft.length === 1 && onLeft[0].x === 100 && onLeft[0].y === 50,
    `x=${onLeft[0] && onLeft[0].x} y=${onLeft[0] && onLeft[0].y} (expected 100, 50)`);

  check('nothing on a screen gives nothing', windowList.forDisplay([w('A', 10, 20, 30, 30)], display(5000, 5000, 100, 100)).length === 0, '');
  check('an empty list is not an error', windowList.forDisplay([], main).length === 0, '');

  // ---------- against the displays actually attached ----------
  const real = screen.getAllDisplays();
  let placed = 0;
  for (const d of real) placed += windowList.forDisplay(windows, d).length;
  check('every real window lands on at least one real display', placed >= windows.length,
    `${windows.length} windows → ${placed} placements across ${real.length} display(s)`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('TEST_ERROR', e && e.stack || e); process.exit(1); });
