'use strict';
// What does keeping a screen-capture stream open actually cost?
//
//   npx electron dev/stream-cost.js
//
// A live stream makes every grab free (0.1 ms against 190 ms for desktopCapturer), which is the whole
// difference between a screenshot tool that feels instant and one that does not -- and it is the only
// way to stitch a scrolling capture. But briffy's first rule is that saving something must not make
// the machine work (`入库流程不能让电脑呼呼转`), so the stream has to be paid for before it is used.
//
// Measures processor time over the same window with the stream shut, open and idle, and open while
// frames are actually being pulled at 30 a second.
const { app, BrowserWindow, desktopCapturer, screen } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SECONDS = 6;

/** Processor time this app has used, across the main process and its renderers. */
async function cpuSeconds() {
  const metrics = app.getAppMetrics();
  return metrics.reduce((a, m) => a + (m.cpu ? m.cpu.cumulativeCPUUsage || 0 : 0), 0);
}

async function measure(label, page, script) {
  if (script) await page.webContents.executeJavaScript(script);
  await new Promise((r) => setTimeout(r, 500));           // let it settle
  const before = await cpuSeconds();
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  const used = (await cpuSeconds()) - before;
  const wall = (Date.now() - t0) / 1000;
  console.log(`  ${label.padEnd(44)} ${(used / wall * 100).toFixed(1).padStart(5)} % of one core`);
  return used / wall;
}

app.whenReady().then(async () => {
  const primary = screen.getPrimaryDisplay();
  const native = { width: Math.round(primary.bounds.width * primary.scaleFactor), height: Math.round(primary.bounds.height * primary.scaleFactor) };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 160, height: 100 } });
  const src = sources.find((s) => String(s.display_id) === String(primary.id)) || sources[0];
  console.log(`primary display ${native.width}x${native.height}\n`);

  const file = path.join(os.tmpdir(), 'briffy-stream-cost.html');
  fs.writeFileSync(file, '<!doctype html><meta charset="utf-8"><title>cost</title><body></body>');
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, backgroundThrottling: false } });
  await win.loadFile(file);

  const idle = await measure('nothing running (the baseline)', win, null);

  const open = `(async () => {
    window.__s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: {
      chromeMediaSource: 'desktop', chromeMediaSourceId: ${JSON.stringify(src.id)},
      maxWidth: ${native.width}, maxHeight: ${native.height}, maxFrameRate: 30 } } });
    const v = document.createElement('video'); v.srcObject = window.__s; v.muted = true;
    await v.play(); window.__v = v; return true;
  })()`;
  const streamOpen = await measure('stream open, no frames taken', win, open);

  const pull = `(() => {
    const v = window.__v;
    const c = document.createElement('canvas'); c.width = 1200; c.height = 900;
    const ctx = c.getContext('2d');
    window.__n = 0;
    window.__t = setInterval(() => { ctx.drawImage(v, 0, 0, 1200, 900, 0, 0, 1200, 900); window.__n++; }, 33);
    return true;
  })()`;
  const pulling = await measure('stream open, 30 frames a second taken', win, pull);
  const frames = await win.webContents.executeJavaScript('(() => { clearInterval(window.__t); const n = window.__n; window.__s.getTracks().forEach(t => t.stop()); return n; })()');

  console.log(`\n  (${frames} frames were actually pulled over ${SECONDS}s, so the rate was real)`);
  console.log('\nwhat that means');
  console.log(`  holding the stream open costs about ${((streamOpen - idle) * 100).toFixed(1)} % of a core over doing nothing`);
  console.log(`  pulling frames on top of that costs a further ${((pulling - streamOpen) * 100).toFixed(1)} %`);
  console.log('  → so it can be opened for a capture and shut afterwards, but not left running all day');
  console.log('\nthe other cost is not measurable here: macOS shows a screen-recording indicator');
  console.log('in the menu bar for as long as the stream is open. That alone rules out keeping it warm');
  console.log('permanently -- an app that only screenshots occasionally must not look like it is filming.');

  win.destroy();
  process.exit(0);
}).catch((e) => { console.error(e && e.stack || e); process.exit(1); });
