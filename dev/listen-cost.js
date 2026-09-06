'use strict';
// What does it cost to leave the microphone open and listen for speech all day?
//
//   npx electron dev/listen-cost.js
//
// Automatic recording means briffy holds the microphone the whole time and decides for itself when
// somebody is talking. briffy's first rule is that its own housekeeping must not make the machine work
// (`入库流程不能让电脑呼呼转`), so this has to be paid for before it is built, not after.
//
// Three states over the same window: nothing, the microphone open and ignored, and the microphone open
// with the speech detector actually running on every block of audio.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow } = require('electron');

const SECONDS = 8;

function cpu() {
  return app.getAppMetrics().reduce((a, m) => a + (m.cpu ? m.cpu.cumulativeCPUUsage || 0 : 0), 0);
}

async function measure(label, page, script) {
  if (script) await page.webContents.executeJavaScript(script);
  await new Promise((r) => setTimeout(r, 600));
  const before = cpu();
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  const used = cpu() - before;
  const wall = (Date.now() - t0) / 1000;
  console.log(`  ${label.padEnd(46)} ${((used / wall) * 100).toFixed(2).padStart(6)} % of one core`);
  return (used / wall) * 100;
}

app.whenReady().then(async () => {
  const dir = path.join(os.tmpdir(), 'briffy-listen-cost');
  fs.mkdirSync(dir, { recursive: true });
  // The detector runs on the audio thread, in a worklet, so the interface never waits for it.
  fs.writeFileSync(path.join(dir, 'vad.js'), `
    class Vad extends AudioWorkletProcessor {
      constructor() { super(); this.floor = 0.01; this.n = 0; }
      process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        if (!ch) return true;
        let sum = 0;
        for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
        const rms = Math.sqrt(sum / ch.length);
        // a slow-moving estimate of the quiet in the room, so a noisy office does not read as speech
        this.floor = rms < this.floor ? (this.floor * 0.995) + (rms * 0.005) : (this.floor * 0.9995) + (rms * 0.0005);
        if ((this.n++ % 40) === 0) this.port.postMessage({ rms, floor: this.floor });
        return true;
      }
    }
    registerProcessor('vad', Vad);
  `);
  fs.writeFileSync(path.join(dir, 'page.html'), '<!doctype html><meta charset="utf-8"><title>listen</title><body></body>');

  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, backgroundThrottling: false } });
  await win.loadFile(path.join(dir, 'page.html'));

  const idle = await measure('nothing running (the baseline)', win, null);

  const openWith = (constraints, rate) => `(async () => {
    if (window.__s) { window.__s.getTracks().forEach(t => t.stop()); }
    if (window.__ctx) { await window.__ctx.close(); }
    window.__s = await navigator.mediaDevices.getUserMedia({ audio: ${JSON.stringify(constraints)} });
    window.__ctx = new AudioContext(${rate ? `{ sampleRate: ${rate} }` : ''});
    window.__src = window.__ctx.createMediaStreamSource(window.__s);
    return window.__ctx.sampleRate;
  })()`;

  const DSP = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  const RAW = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

  const rate = await win.webContents.executeJavaScript(openWith(DSP, 0));
  const held = await measure('microphone open, nothing listening', win, null);

  const listen = `(async () => {
    await window.__ctx.audioWorklet.addModule('vad.js');
    const node = new AudioWorkletNode(window.__ctx, 'vad');
    window.__seen = 0;
    node.port.onmessage = () => { window.__seen++; };
    window.__src.connect(node);
    window.__node = node;
    return true;
  })()`;
  const listening = await measure('mic + detector, echo/noise/gain ON, 48 kHz', win, listen);
  const seen = await win.webContents.executeJavaScript('window.__seen');

  // The expensive part is the microphone's own processing, not the detector. Speech detection does not
  // need any of it, and Whisper is trained on ordinary noisy speech.
  const relisten = `(async () => {
    await window.__ctx.audioWorklet.addModule('vad.js');
    const node = new AudioWorkletNode(window.__ctx, 'vad');
    window.__seen = 0;
    node.port.onmessage = () => { window.__seen++; };
    window.__src.connect(node);
    return true;
  })()`;
  await win.webContents.executeJavaScript(openWith(RAW, 0));
  const rawCost = await measure('mic + detector, all of it OFF, 48 kHz', win, relisten);
  const rate16 = await win.webContents.executeJavaScript(openWith(RAW, 16000));
  const raw16 = await measure(`mic + detector, all OFF, ${rate16} Hz`, win, relisten);

  await win.webContents.executeJavaScript("window.__s.getTracks().forEach(t => t.stop()); window.__ctx.close();");

  console.log(`\n  audio arrives at ${rate} Hz; the detector reported ${seen} times over ${SECONDS}s`);
  console.log(`\n  holding the microphone costs   ${(held - idle).toFixed(2)} % of a core over doing nothing`);
  console.log(`  the detector on top of that      ${(listening - held).toFixed(2)} %`);
  console.log(`  everything on, as first written  ${(listening - idle).toFixed(2)} %`);
  console.log(`  with the microphone's own processing off  ${(rawCost - idle).toFixed(2)} %`);
  console.log(`  and at 16 kHz, which is all Whisper wants ${(raw16 - idle).toFixed(2)} %   ← the one to ship`);
  console.log('\n  the cost that is not a number: macOS shows the orange microphone dot for as long as');
  console.log('  this runs, and lists briffy under "recently used your microphone".');

  win.destroy();
  process.exit(0);
}).catch((e) => { console.error(e && e.stack || e); process.exit(1); });
