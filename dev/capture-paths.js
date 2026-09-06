'use strict';
// Four ways to get pixels off this screen, timed against each other.
//
//   npx electron dev/capture-paths.js
//
// The overlay currently costs 220-350 ms to appear, and repeated grabs manage 5 frames a second --
// both far from what a screenshot tool needs (an overlay past ~120 ms reads as a stutter, and
// stitching a scrolling capture wants 20+ frames a second). Before designing anything, find out
// whether that is the API's floor or just how it is being called.
const { app, desktopCapturer, screen } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const now = () => process.hrtime.bigint();
const since = (t) => Number(process.hrtime.bigint() - t) / 1e6;
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const row = (name, times, note = '') =>
  console.log(`  ${name.padEnd(46)} median ${med(times).toFixed(1).padStart(7)} ms   best ${Math.min(...times).toFixed(1).padStart(7)} ms   ${note}`);

app.whenReady().then(async () => {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const native = { width: Math.round(primary.bounds.width * primary.scaleFactor), height: Math.round(primary.bounds.height * primary.scaleFactor) };
  console.log(`primary display ${native.width}x${native.height}, ${displays.length} display(s) attached\n`);

  const runs = 5;
  const time = async (fn) => { const t = []; for (let i = 0; i < runs; i++) { const s = now(); await fn(); t.push(since(s)); } return t; };

  console.log('1. desktopCapturer — what the overlay uses today');
  const bigBox = displays.reduce((a, d) => ({
    width: Math.max(a.width, Math.round(d.bounds.width * (d.scaleFactor || 1))),
    height: Math.max(a.height, Math.round(d.bounds.height * (d.scaleFactor || 1))),
  }), { width: 1, height: 1 });
  row('every display at native size (current)', await time(() => desktopCapturer.getSources({ types: ['screen'], thumbnailSize: bigBox })));
  row('every display, thumbnails 320px', await time(() => desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 320, height: 200 } })), 'is the size the cost, or the call?');
  row('every display, thumbnails 1x1', await time(() => desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })), 'the floor of the call itself');
  row('window list instead of screens', await time(() => desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1, height: 1 } })), 'for window detection / snapping');

  console.log('\n2. screencapture — the system binary, already on every Mac');
  const tmp = path.join(os.tmpdir(), 'briffy-cap.png');
  const shot = (args) => new Promise((res, rej) => execFile('/usr/sbin/screencapture', args, (e) => (e ? rej(e) : res())));
  try {
    row('whole primary screen to a file', await time(() => shot(['-x', '-D1', tmp])));
    row('a 1200x900 region to a file', await time(() => shot(['-x', '-R0,0,1200,900', tmp])));
    const size = fs.statSync(tmp).size;
    console.log(`     (the region file is ${(size / 1024).toFixed(0)} KB; reading it back costs the same again)`);
  } catch (e) {
    console.log(`     unavailable: ${e.message}`);
  }

  console.log('\n3. a live capture stream — what native tools actually use');
  console.log('   getUserMedia(chromeMediaSource:desktop) is ScreenCaptureKit underneath. It cannot run in');
  console.log('   the main process, so it is measured from a hidden page instead:');
  const { BrowserWindow } = require('electron');
  const src = (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }))
    .find((s) => String(s.display_id) === String(primary.id)) || null;
  if (!src) { console.log('     could not identify the primary display as a source'); }
  else {
    // navigator.mediaDevices does not exist on a data: URL -- that is an opaque origin, and screen
    // capture is only offered to a secure one. A real file does have one.
    const page = path.join(os.tmpdir(), 'briffy-capture-probe.html');
    fs.writeFileSync(page, '<!doctype html><meta charset="utf-8"><title>probe</title><body></body>');
    const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } });
    // Electron asks before handing over the screen; this probe answers yes for itself.
    win.webContents.session.setDisplayMediaRequestHandler(null);
    await win.loadFile(page);
    const out = await win.webContents.executeJavaScript(`(async () => {
      const t = (f) => { const s = performance.now(); f(); return performance.now() - s; };
      let stream;
      const t0 = performance.now();
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: ${JSON.stringify(src.id)},
                   maxWidth: ${native.width}, maxHeight: ${native.height}, maxFrameRate: 60 } },
        });
      } catch (e) { return { error: e.message }; }
      const open = performance.now() - t0;
      const video = document.createElement('video');
      video.srcObject = stream; video.muted = true;
      await video.play();
      await new Promise((r) => setTimeout(r, 300));   // let a few frames arrive
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      const ctx = c.getContext('2d', { willReadFrequently: false });
      const frames = [];
      for (let i = 0; i < 10; i++) {
        frames.push(t(() => ctx.drawImage(video, 0, 0)));
        await new Promise((r) => requestAnimationFrame(r));
      }
      const crops = [];
      for (let i = 0; i < 5; i++) {
        const c2 = document.createElement('canvas'); c2.width = 1200; c2.height = 900;
        crops.push(t(() => c2.getContext('2d').drawImage(video, 0, 0, 1200, 900, 0, 0, 1200, 900)));
      }
      stream.getTracks().forEach((tr) => tr.stop());
      return { open, size: [video.videoWidth, video.videoHeight], frames, crops };
    })()`);
    if (out.error) console.log(`     unavailable: ${out.error}`);
    else {
      console.log(`     opening the stream once:                    ${out.open.toFixed(1)} ms  (paid once, then kept warm)`);
      row('grabbing a full frame from the open stream', out.frames, `stream is ${out.size[0]}x${out.size[1]}`);
      row('grabbing one region from the open stream', out.crops, `→ ${(1000 / med(out.crops)).toFixed(0)} frames a second`);
    }
    win.destroy();
  }

  console.log('\n4. how much of a scrolling capture is stitching?');
  console.log('   (measured separately once there is something to stitch)');
  process.exit(0);
}).catch((e) => { console.error(e && e.stack || e); process.exit(1); });
