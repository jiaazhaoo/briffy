'use strict';
// Automatic recording: briffy holds the microphone and files a recording whenever somebody talks.
//
// This is the one thing briffy does without being asked, and it is deliberate. Everything else here
// waits for a keypress or a copy; this listens. That is worth being plain about, because it changes
// what the app is: with it on, meetings and calls end up in the workspace whether or not anyone meant
// them to, other people's voices included. Whether that is wanted is a question for the person using
// it, and it is off unless they turn it on.
//
// What it costs, measured on this machine before it was built:
//
//   microphone open, its own echo/noise/gain processing running   4.5 % of a core
//   the speech detector on top of that                            1.4 %
//   both, with that processing off and the rate down to 16 kHz    2.6 %   ← what ships
//
// Hence the constraints in the renderer: no echo cancellation, no noise suppression, no gain control,
// 16 kHz mono. Whisper wants 16 kHz anyway and is trained on ordinary noisy speech, so nothing is lost
// but more than half the cost. The cost that is not a number: macOS shows the orange microphone dot for
// as long as this runs.
//
// The listening lives in its own hidden window rather than in the pet's, so that hiding the character does
// not silently stop it.
const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const micwatch = require('./micwatch');

let win = null;
let deps = null;
let wanted = false;         // what the settings say
let ready = false;
let state = 'off';
let lastAt = 0;

function preloadPath() { return path.join(__dirname, '..', 'preload', 'listen.js'); }
function pagePath() { return path.join(__dirname, '..', 'renderer', 'listen', 'index.html'); }

function init(d) { deps = d; }

function create() {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    width: 220, height: 90, show: false,
    frame: false, skipTaskbar: true, hiddenInMissionControl: true, paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: false,
      // The detector must keep running while nothing is on screen -- which is always, for this window.
      backgroundThrottling: false,
    },
  });
  win.on('closed', () => { win = null; ready = false; state = 'off'; });
  win.loadFile(pagePath());
  return win;
}

function send(cmd, extra = {}) {
  if (!win || win.isDestroyed() || !ready) return;
  win.webContents.send('listen:command', { cmd, ...extra });
}

/** 打开麦克风，仅当**别的东西**已经打开了它。见 micwatch.js。 */
function applyMic() {
  if (!wanted) { send('stop'); return; }
  if (micwatch.status().inUse) send('start', { micDeviceId: deps.store.getSettings().micDeviceId || '' });
  else send('stop');
}

/** Turns listening on or off to match the settings. Safe to call as often as you like. */
function sync() {
  if (!deps) return;
  const s = deps.store.getSettings();
  wanted = s.autoRecord === true;
  if (!wanted) {
    micwatch.stop();
    if (win && !win.isDestroyed()) { send('stop'); }
    return;
  }
  create();
  // 麦克风的开关不归 briffy 管，归你正在用的那个软件管：别人开了，我们才跟着开
  micwatch.start({ store: deps.store, onChange: () => { applyMic(); if (deps.onState) deps.onState(state); } });
  applyMic();
}

function stop() {
  wanted = false;
  micwatch.stop();
  send('stop');
  if (win && !win.isDestroyed()) { try { win.destroy(); } catch (_) { /* already gone */ } }
  win = null; ready = false; state = 'off';
}

/** @returns {{on:boolean, state:string, lastAt:number, inUse:boolean, holders:Array}} for the settings page. */
function status() {
  const w = micwatch.status();
  return { on: wanted, state, lastAt, inUse: w.inUse, holders: w.holders };
}

function register() {
  ipcMain.on('listen:ready', (e) => {
    if (!win || win.isDestroyed() || e.sender !== win.webContents) return;
    ready = true;
    applyMic();
  });

  ipcMain.on('listen:state', (_e, s) => {
    state = (s && s.state) || 'off';
    if (state === 'denied' || state === 'failed') {
      console.warn('[listen] microphone unavailable:', (s && s.error) || '');
      if (deps && deps.onProblem) deps.onProblem(state, (s && s.error) || '');
      wanted = false;
    }
    if (deps && deps.onState) deps.onState(state);
  });

  ipcMain.on('listen:segment', async (_e, seg) => {
    if (!seg || !seg.pcm || !deps) return;
    lastAt = Date.now();
    try {
      // Straight into the same pipeline a held-down recording uses, marked so that nothing announces
      // it: this happens by itself, possibly many times an hour, and a balloon each time would be the
      // clipboard mistake all over again.
      await deps.workspace.ingestAudio({
        pcm: seg.pcm,
        sampleRate: seg.sampleRate || 16000,
        durationSec: seg.durationSec || 0,
        peak: seg.peak,
        mic: seg.mic || '',
        auto: true,
      });
    } catch (e) {
      console.error('[listen] could not file a segment', e);
    }
  });
}

module.exports = { init, register, sync, stop, status };
