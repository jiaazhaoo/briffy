'use strict';
/* global listen */
// Automatic recording: hold the microphone, and file a recording whenever somebody talks.
//
// This page has nothing on it. It exists only because `getUserMedia` and AudioWorklet are page APIs,
// and because the microphone must keep working when the character is hidden -- hanging it off the pet window
// would tie listening to whether a decoration is on screen.
//
// The shape of a segment, and why:
//
//   ····speech····························silence····
//   ^pre-roll   ^start                    ^end (after a pause)
//
// The detector cannot know somebody has started until they already have, so by the time it says
// "speech" the first syllable is gone. The last second and a bit of audio is therefore kept at all
// times and prepended -- cheap insurance, 16 kHz mono is 64 KB a second. At the other end a pause is
// not the end of a sentence, so it waits several seconds of quiet before deciding a thing is over.
(() => {
  const api = window.listen;

  const RATE = 16000;
  const BLOCK = 4096;                     // ~0.26 s per block from the worklet

  let stream = null;
  let ctx = null;
  let node = null;
  let running = false;
  let micLabel = '';
  // The state machine lives in segmenter.js so it can be tested without a microphone -- where a
  // recording starts and stops is logic, not audio. See dev/segmenter-test.js.
  let seg = null;

  function say(state, extra = {}) { api.state({ state, ...extra }); }

  function drain() {
    for (const rec of seg.take()) {
      const samples = rec.blocks.reduce((n, b) => n + b.length, 0);
      const pcm = new Float32Array(samples);
      let at = 0;
      for (const b of rec.blocks) { pcm.set(b, at); at += b.length; }
      // Int16 is what the transcriber wants, and half the bytes over the wire.
      const pcm16 = new Int16Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) { const v = Math.max(-1, Math.min(1, pcm[i])); pcm16[i] = v < 0 ? v * 0x8000 : v * 0x7fff; }
      api.segment({
        pcm: pcm16, sampleRate: RATE, durationSec: Math.round(rec.ms / 1000),
        speechSec: Math.round((rec.speechMs || 0) / 1000), peak: rec.peak, mic: micLabel, reason: rec.reason,
      });
    }
  }

  function onBlock({ pcm, speech, peak }) {
    const was = seg.recording;
    seg.push({ block: pcm, speech, peak });
    if (seg.recording !== was) say(seg.recording ? 'speech' : 'idle');
    if (seg.pending) drain();
  }

  async function start(deviceId) {
    if (running) return;
    running = true;
    seg = window.segmenter.createSegmenter({ rate: RATE, blockSize: BLOCK });
    try {
      // Every one of these off on purpose. Echo cancellation, noise suppression and gain control are
      // continuous signal processing: measured at 4.5 % of a core, against 1.4 % for the detector
      // itself. Speech detection does not need them and Whisper is trained on ordinary noisy speech.
      const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 };
      if (deviceId) {
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: { ...audio, deviceId: { exact: deviceId } } }); }
        catch (_) { stream = await navigator.mediaDevices.getUserMedia({ audio }); }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio });
      }
    } catch (e) {
      running = false;
      say('denied', { error: e.message });
      return;
    }
    const track = stream.getAudioTracks()[0];
    micLabel = (track && track.label) || '';

    try {
      ctx = new AudioContext({ sampleRate: RATE });
      await ctx.audioWorklet.addModule('vad-worklet.js');
      node = new AudioWorkletNode(ctx, 'vad', { processorOptions: { blockSize: BLOCK } });
      node.port.onmessage = (e) => onBlock(e.data);
      ctx.createMediaStreamSource(stream).connect(node);
      // Connected to nothing: the worklet returns no audio, it only listens. Without a destination
      // some browsers never pull, so a silent sink keeps the graph running.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      node.connect(sink).connect(ctx.destination);
      await ctx.resume();
    } catch (e) {
      running = false;
      say('failed', { error: e.message });
      stop();
      return;
    }
    say('idle', { mic: micLabel });
  }

  function stop() {
    // Anything still being said when listening is turned off is kept, not thrown away.
    if (seg) { seg.flush(); drain(); seg = null; }
    running = false;
    if (node) { try { node.port.onmessage = null; node.disconnect(); } catch (_) { /* gone */ } node = null; }
    if (ctx) { ctx.close().catch(() => {}); ctx = null; }
    if (stream) { for (const t of stream.getTracks()) t.stop(); stream = null; }
    say('off');
  }

  api.onCommand((c) => {
    if (!c) return;
    if (c.cmd === 'start') start(c.micDeviceId || '');
    else if (c.cmd === 'stop') stop();
  });
  window.addEventListener('beforeunload', stop);
  api.ready();
})();
