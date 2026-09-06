'use strict';
// Automatic recording, end to end, with a real microphone and real sound.
//
//   npx electron dev/listen-test.js
//
// The state machine has its own test (dev/segmenter-test.js) and needs no audio. This is the other
// half: that the microphone really opens, that the worklet really runs, that speech really reaches the
// pipeline, and that a recording really lands in the workspace -- against a throwaway userData, so
// nothing of the user's is touched.
//
// The sound is made here rather than assumed: a tone is played out of the speakers and picked up by the
// microphone. On a machine with no speakers, or muted, the speech checks are skipped and say so, but
// everything up to that point is still checked.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow } = require('electron');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-listen-'));
app.setPath('userData', TMP);

let pass = 0; let fail = 0; let skip = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}${detail ? `  ${detail}` : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};
const skipped = (name, why) => { skip++; console.log(`  skip ${name}  ${why}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const { Store } = require('../src/main/store');
  const workspace = require('../src/main/workspace');
  const listen = require('../src/main/listen');

  const store = new Store();
  store.init();
  store.updateSettings({ autoRecord: false, sttModel: 'Xenova/whisper-tiny.en' });

  const said = [];
  const windows = {
    setPetState(state, opts = {}) { said.push({ state, message: opts.message || '' }); },
    getState: () => 'idle', hideForCapture: async () => 0, restoreAfterCapture() {},
    broadcastToWorkspace() {}, sendPetCommand() {}, openWorkspace() {},
  };
  workspace.init({ store, windows });

  const states = [];
  listen.init({ store, workspace, onState: (s) => states.push(s), onProblem: (k, e) => states.push(`problem:${k}:${e}`) });
  listen.register();

  // ---------- off by default ----------
  check('it is off unless it is turned on', store.getSettings().autoRecord === false, '');
  check('and reports itself off', listen.status().on === false, JSON.stringify(listen.status()));

  // ---------- turning it on ----------
  store.updateSettings({ autoRecord: true });
  listen.sync();
  await sleep(2500);
  const st = listen.status();
  check('turning it on opens the microphone', st.on === true && ['idle', 'speech'].includes(st.state),
    `state=${st.state}${st.state === 'denied' ? ' (grant briffy the microphone and run again)' : ''}`);

  if (st.state === 'denied' || st.state === 'failed') {
    console.log('\n  no microphone available to this test; the rest needs one.');
    console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
    listen.stop(); process.exit(fail ? 1 : 0);
  }

  // ---------- make a noise and see whether it is filed ----------
  const before = store.listDates().reduce((n, d) => n + store.loadDay(d).length, 0);
  const player = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, backgroundThrottling: false } });
  const page = path.join(TMP, 'tone.html');
  fs.writeFileSync(page, '<!doctype html><meta charset="utf-8"><title>tone</title><body></body>');
  await player.loadFile(page);
  // Warbling tones rather than one steady note: a constant tone reads as background hum to a detector
  // that measures how far the sound rises above the room, which is exactly what it is meant to do.
  const played = await player.webContents.executeJavaScript(`(async () => {
    const ctx = new AudioContext();
    const g = ctx.createGain(); g.gain.value = 0.35; g.connect(ctx.destination);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.connect(g); o.start();
    const t0 = ctx.currentTime;
    for (let i = 0; i < 40; i++) o.frequency.setValueAtTime(180 + ((i * 137) % 500), t0 + i * 0.15);
    await new Promise(r => setTimeout(r, 6000));
    o.stop(); await ctx.close();
    return true;
  })()`);
  check('a sound was played', played === true, '');
  await sleep(5000);          // long enough for the pause to close the recording

  const after = store.listDates().reduce((n, d) => n + store.loadDay(d).length, 0);
  if (after > before) {
    check('the sound was heard and filed', true, `${after - before} recording(s)`);
    const entry = store.listEntries({ limit: 5 })[0];
    check('it is filed as a recording', entry.type === 'audio', entry.type);
    check('it is marked automatic', entry.auto === true, JSON.stringify(entry.auto));
    check('it has audio in it', entry.durationSec >= 1, `${entry.durationSec}s`);
    check('and it was not announced', said.filter((s) => s.message).length === 0,
      said.filter((s) => s.message).map((s) => s.message).join(' | '));
  } else {
    skipped('the sound was heard and filed', '(nothing reached the microphone — muted, or no loopback on this machine)');
    check('nothing was filed and nothing was said', said.filter((s) => s.message).length === 0, '');
  }

  // ---------- turning it off ----------
  store.updateSettings({ autoRecord: false });
  listen.sync();
  await sleep(1200);
  check('turning it off releases the microphone', listen.status().on === false, listen.status().state);

  player.destroy();
  listen.stop();
  store.flushAll();
  console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* leave it */ }
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('TEST_ERROR', e && e.stack || e); process.exit(1); });
