'use strict';
// Where every window on screen is, so the selection overlay can snap to one.
//
// CoreGraphics through JXA: one call, 102 ms, every field for every window -- bounds, title, owning
// app, pid, and the window *layer*, which is what keeps Dock and Notification Centre out of a list of
// things you might want to capture. Nothing to compile and nothing to ship.
//
// **node-screenshots was tried here and is 16x slower, despite appearances.** `Window.all()` returns
// in 4 ms, which looks like a rout until you read anything off the handles: every field is a fresh
// query to the window server, measured at 2.2 ms each (`isMinimized` 7.3 ms), so the eight fields this
// needs across 86 windows cost **1650 ms**. Handles also go stale -- a window closing mid-loop throws
// `Window not found` -- and there is no layer field, so Dock and Notification Centre come back as
// ordinary windows and hovering anywhere would offer to capture the Dock. It is an excellent capture
// library and region.js uses it for exactly that; it is the wrong shape for enumerating windows.
const { execFile } = require('child_process');

const TIMEOUT_MS = 1500;      // it takes ~102 ms; anything near this means something is wrong
const MIN_SIDE = 40;          // below this it is a helper panel, not something anyone means to capture

// The named constants are not exposed through the ObjC bridge, so the values are written out:
//   kCGWindowListOptionOnScreenOnly 1, kCGWindowListExcludeDesktopElements 16, kCGNullWindowID 0.
// `castRefToObject` comes first on purpose: deepUnwrap on the raw CFArrayRef silently yields nothing,
// which is a whole afternoon if you do not know it.
const SCRIPT = `
ObjC.import('CoreGraphics');
ObjC.import('Foundation');
const all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1 | 16, 0)));
const out = [];
for (const w of all) {
  if (!w || w.kCGWindowLayer !== 0) continue;
  const b = w.kCGWindowBounds;
  if (!b) continue;
  out.push({
    app: w.kCGWindowOwnerName || '',
    title: w.kCGWindowName || '',
    pid: w.kCGWindowOwnerPID || 0,
    x: Math.round(b.X), y: Math.round(b.Y), w: Math.round(b.Width), h: Math.round(b.Height),
  });
}
JSON.stringify(out);
`;

/**
 * Every ordinary window, front to back -- the order matters: the first one containing a point is the
 * one the user can see there.
 * @returns {Promise<Array<{app:string,title:string,pid:number,x:number,y:number,w:number,h:number}>>}
 *   empty when the platform cannot say; snapping simply does not appear, nothing else breaks.
 */
function list() {
  if (process.platform !== 'darwin') return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile('osascript', ['-l', 'JavaScript', '-e', SCRIPT],
      { timeout: TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 1 << 22 },
      (err, stdout) => {
        if (err) { resolve([]); return; }
        let parsed;
        try { parsed = JSON.parse(stdout); } catch (_) { resolve([]); return; }
        if (!Array.isArray(parsed)) { resolve([]); return; }
        resolve(parsed.filter((w) => w && w.w >= MIN_SIDE && w.h >= MIN_SIDE && w.pid !== process.pid));
      });
  });
}

/**
 * The windows on one display, in that overlay's own coordinates.
 *
 * Both sources measure in logical points from the top-left of the main display, the same space
 * Electron's `display.bounds` uses -- verified against every attached display -- so the only thing to
 * do is subtract where this display starts, and drop whatever does not reach it.
 */
function forDisplay(windows, display) {
  const b = display.bounds;
  const out = [];
  for (const w of windows) {
    const x = w.x - b.x;
    const y = w.y - b.y;
    if (x + w.w <= 0 || y + w.h <= 0 || x >= b.width || y >= b.height) continue;   // not on this screen
    out.push({ app: w.app, title: w.title, x, y, w: w.w, h: w.h });
  }
  return out;
}

module.exports = { list, forDisplay, MIN_SIDE };
