'use strict';
// Four ways to find out where the windows on this screen are, timed.
//
//   npx electron dev/window-list-perf.js
//
// Window snapping -- hover a window, it lights up, one click captures it -- is the thing that makes a
// screenshot tool feel like it understands the screen. It needs the geometry of every visible window,
// and it needs it fast enough that the overlay does not wait for it.
//
// Electron's own window list is not that: it renders a thumbnail of every window, which is work we
// throw away. macOS has the answer directly in CGWindowListCopyWindowInfo, and JXA can reach
// CoreGraphics through the ObjC bridge without compiling anything, which is the point of measuring it.
const { app, desktopCapturer } = require('electron');
const { execFile } = require('child_process');

const now = () => process.hrtime.bigint();
const since = (t) => Number(process.hrtime.bigint() - t) / 1e6;
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const runs = 5;
const time = async (fn) => { const t = []; for (let i = 0; i < runs; i++) { const s = now(); await fn(); t.push(since(s)); } return t; };
const row = (name, t, note = '') => console.log(`  ${name.padEnd(44)} median ${med(t).toFixed(1).padStart(7)} ms  best ${Math.min(...t).toFixed(1).padStart(7)} ms  ${note}`);

// CoreGraphics knows where every window is; JXA can ask it without a compiled addon. Bounds and the
// owning app come back without any permission at all -- only the window's own title needs screen
// recording, which briffy already holds for the capture itself.
const JXA = `
ObjC.import('CoreGraphics');
ObjC.import('Foundation');
// The named constants are not exposed through the bridge, so the values are written out:
// kCGWindowListOptionOnScreenOnly 1, kCGWindowListExcludeDesktopElements 16, kCGNullWindowID 0.
const list = $.CGWindowListCopyWindowInfo(1 | 16, 0);
// castRefToObject first -- deepUnwrap on the raw CFArrayRef silently yields nothing.
const all = ObjC.deepUnwrap(ObjC.castRefToObject(list));
const out = [];
for (const w of all) {
  if (!w || w.kCGWindowLayer !== 0) continue;               // layer 0 = an ordinary app window
  const b = w.kCGWindowBounds;
  if (!b || b.Width < 40 || b.Height < 40) continue;         // slivers and helper panels
  out.push({
    app: w.kCGWindowOwnerName || '',
    title: w.kCGWindowName || '',
    x: Math.round(b.X), y: Math.round(b.Y),
    w: Math.round(b.Width), h: Math.round(b.Height),
  });
}
JSON.stringify(out);
`;


function jxa() {
  return new Promise((resolve) => {
    execFile('osascript', ['-l', 'JavaScript', '-e', JXA], { timeout: 8000, maxBuffer: 1 << 22 }, (err, stdout) => {
      if (err) { resolve({ error: err.message.split('\n')[0] }); return; }
      try { resolve({ windows: JSON.parse(stdout) }); } catch (e) { resolve({ error: `unparsable: ${stdout.slice(0, 80)}` }); }
    });
  });
}

app.whenReady().then(async () => {
  console.log('finding every visible window\n');

  console.log('1. Electron — renders a thumbnail of each window, which snapping does not need');
  for (const size of [{ width: 150, height: 150 }, { width: 64, height: 64 }, { width: 32, height: 32 }]) {
    const t = await time(() => desktopCapturer.getSources({ types: ['window'], thumbnailSize: size, fetchWindowIcons: false }));
    row(`getSources, thumbnails ${String(size.width).padStart(3)}px`, t);
  }

  console.log('\n2. CoreGraphics through JXA — geometry only, nothing rendered');
  const first = await jxa();
  if (first.error) {
    console.log(`     unavailable: ${first.error}`);
  } else {
    const t = await time(jxa);
    row('CGWindowListCopyWindowInfo', t, `${first.windows.length} windows`);
    console.log('\n   what it returns (first five):');
    for (const w of first.windows.slice(0, 5)) {
      console.log(`     ${String(w.app).padEnd(18)} ${String(w.w + 'x' + w.h).padEnd(11)} at ${w.x},${w.y}   ${(w.title || '(no title)').slice(0, 40)}`);
    }
    const titled = first.windows.filter((w) => w.title).length;
    console.log(`\n   ${titled} of ${first.windows.length} came with a title (titles need screen recording, which briffy has)`);
  }

  process.exit(0);
}).catch((e) => { console.error(e && e.stack || e); process.exit(1); });
