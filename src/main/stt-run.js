'use strict';
// Transcription, kept at arm's length.
//
// A Whisper checkpoint that this machine cannot run does not throw: onnxruntime aborts the whole
// process with a SIGTRAP, and the app disappears mid-recording. So the work happens in a utilityProcess
// and a crash comes back as an ordinary error. A model that dies this way is remembered, and the next
// attempt steps down to a smaller one rather than crashing again in the same place.
const path = require('path');
const { utilityProcess } = require('electron');
const stt = require('./stt');

const CRASHED = 'model-crashed';

// Smaller, older, more widely exercised: what to fall back to when a checkpoint proves unrunnable here.
const FALLBACK = {
  'Xenova/whisper-medium': 'Xenova/whisper-small',
  'Xenova/whisper-small': 'Xenova/whisper-base',
  'Xenova/whisper-base': 'Xenova/whisper-tiny',
};

function once(pcm, cfg, onProgress, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(path.join(__dirname, 'stt-child.js'), [], { serviceName: 'briffy speech' });
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch (_) { /* already gone */ }
      fn(arg);
    };
    const timer = setTimeout(() => {
      const e = new Error('speech model timed out');
      e.code = 'timeout';
      finish(reject, e);
    }, timeoutMs);

    child.on('message', (m) => {
      if (!m) return;
      if (m.type === 'progress') { if (onProgress) onProgress(m.stage, m.p, m.file); return; }
      if (m.type === 'done') finish(resolve, m.result);
      else if (m.type === 'failed') finish(reject, Object.assign(new Error(m.error), { code: 'stt-failed' }));
    });
    // No message and no exit code: the model took the process with it.
    child.on('exit', () => {
      const e = new Error('the speech model crashed on this machine');
      e.code = CRASHED;
      finish(reject, e);
    });
    child.postMessage({ type: 'transcribe', cfg, pcm: pcm.buffer instanceof ArrayBuffer ? pcm.buffer : new Float32Array(pcm).buffer });
  });
}

/**
 * @param {Float32Array} pcm
 * @param {object} cfg  as for stt.transcribe, plus `onCrash(badModel, nextModel)` to record the swap
 * @returns {Promise<{text:string, language:string|null, model:string}>}
 */
async function transcribe(pcm, cfg, onProgress, { onCrash } = {}) {
  let model = cfg.model;
  const tried = [];
  for (let step = 0; step < 3; step++) {
    tried.push(model);
    try {
      const r = await once(pcm, { ...cfg, model }, onProgress, 15 * 60 * 1000);
      return { ...r, model };
    } catch (e) {
      if (e.code !== CRASHED || !FALLBACK[model]) throw e;
      const next = FALLBACK[model];
      if (onCrash) onCrash(model, next);
      model = next;
    }
  }
  throw Object.assign(new Error(`no speech model ran on this machine (tried ${tried.join(', ')})`), { code: CRASHED });
}

module.exports = { transcribe, CRASHED, FALLBACK, STT_MODELS: stt.STT_MODELS };
