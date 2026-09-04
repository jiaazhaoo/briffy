'use strict';
/* global pet */
(() => {
  const api = window.pet;
  const el = document.getElementById('pet');
  const avatarEl = el.querySelector('.avatar');
  const DRAG_THRESHOLD = 5;
  const DBL_MS = 320;
  const LONG_PRESS_MS = 550;
  const MAX_RECORD_SECONDS = 30 * 60;

  let state = 'idle';
  let badge = false;
  let recording = false;
  let config = { micDeviceId: '' };

  function render() {
    el.className = `pet state-${recording ? 'recording' : state}${badge ? ' has-badge' : ''}`;
  }
  api.onState((s) => { state = s.state || 'idle'; badge = !!s.badge; render(); });
  // the picture in the round frame lives in userData once one is picked in the settings,
  // so main hands us its file:// url instead of the bundled default in the markup
  function setAvatar(url) { if (url) avatarEl.src = url; }
  api.getConfig().then((c) => { config = { ...config, ...(c || {}) }; setAvatar(config.avatarUrl); }).catch(() => {});
  api.onCommand((c) => {
    if (!c) return;
    if (c.cmd === 'toggle-recording') toggleRecording();
    else if (c.cmd === 'config') { config = { ...config, ...c, cmd: undefined }; setAvatar(c.avatarUrl); }
    else if (c.cmd === 'list-mics') listMics();
    else if (c.cmd === 'mic-test') micTest(c);
  });
  window.addEventListener('error', (e) => api.log('renderer error:', e.message));
  window.addEventListener('unhandledrejection', (e) => api.log('renderer rejection:', e.reason && e.reason.message || e.reason));

  // ---------- microphone helpers ----------
  const AUDIO_BASE = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  async function openMic(deviceId) {
    if (deviceId) {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: { ...AUDIO_BASE, deviceId: { exact: deviceId } } });
      } catch (err) {
        api.log('preferred microphone unavailable, using default:', err.message);
      }
    }
    return navigator.mediaDevices.getUserMedia({ audio: AUDIO_BASE });
  }
  function makeMeter(stream) {
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analyser);
    ctx.resume().catch(() => {});
    const buf = new Float32Array(analyser.fftSize);
    let peak = 0;
    return {
      sample() {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0; let p = 0;
        for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > p) p = a; sum += buf[i] * buf[i]; }
        if (p > peak) peak = p;
        return { level: Math.sqrt(sum / buf.length), peak, framePeak: p };
      },
      get peak() { return peak; },
      close() { return ctx.close().catch(() => {}); },
    };
  }
  async function listMics() {
    let devices = [];
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true }); // unlocks device labels
      s.getTracks().forEach((tr) => tr.stop());
    } catch (err) { api.log('enumerate: getUserMedia failed:', err.message); }
    try {
      devices = (await navigator.mediaDevices.enumerateDevices())
        .filter((d) => d.kind === 'audioinput')
        .map((d) => ({ deviceId: d.deviceId, label: d.label || d.deviceId }));
    } catch (err) { api.log('enumerateDevices failed:', err.message); }
    api.micDevices(devices);
  }
  async function micTest({ deviceId = '', seconds = 2 } = {}) {
    let stream;
    try { stream = await openMic(deviceId); } catch (err) { api.micTestResult({ deviceId, error: err.message }); return; }
    const meter = makeMeter(stream);
    const track = stream.getAudioTracks()[0];
    const label = (track && track.label) || '';
    let level = 0;
    await new Promise((resolve) => {
      const iv = setInterval(() => { level = Math.max(level, meter.sample().level); }, 100);
      setTimeout(() => { clearInterval(iv); resolve(); }, seconds * 1000);
    });
    stream.getTracks().forEach((tr) => tr.stop());
    await meter.close();
    api.micTestResult({ deviceId, label, peak: meter.peak, level });
  }

  // ---------- click / double-click / drag ----------
  let down = null;
  let dragging = false;
  let clickTimer = null;
  let lastClick = 0;

  // Middle click starts/stops recording. Trackpads have no middle button, so a long press does the same:
  // hold the pet for LONG_PRESS_MS without moving. Both are also on the tray menu and a global shortcut.
  let holdTimer = null;
  let heldFired = false;

  el.addEventListener('mousedown', (e) => {
    if (e.button === 1) { e.preventDefault(); toggleRecording(); return; }
    if (e.button !== 0) return;
    down = { x: e.screenX, y: e.screenY };
    dragging = false;
    heldFired = false;
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      holdTimer = null;
      if (down && !dragging) { heldFired = true; el.classList.add('held'); toggleRecording(); }
    }, LONG_PRESS_MS);
  });
  window.addEventListener('mousemove', (e) => {
    if (!down) return;
    if (!dragging && Math.hypot(e.screenX - down.x, e.screenY - down.y) > DRAG_THRESHOLD) {
      dragging = true;
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      el.classList.add('dragging');
      api.dragStart({ screenX: down.x, screenY: down.y });
    }
    if (dragging) api.dragMove({ screenX: e.screenX, screenY: e.screenY });
  });
  window.addEventListener('mouseup', (e) => {
    if (!down || e.button !== 0) return;
    const wasDragging = dragging;
    down = null; dragging = false;
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (heldFired) { heldFired = false; el.classList.remove('held'); return; }   // the hold already acted
    if (wasDragging) { el.classList.remove('dragging'); api.dragEnd(); return; }
    const now = Date.now();
    if (now - lastClick < DBL_MS) {
      lastClick = 0;
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      onDoubleClick();
    } else {
      lastClick = now;
      clickTimer = setTimeout(() => { clickTimer = null; onSingleClick(); }, DBL_MS);
    }
  });
  window.addEventListener('blur', () => { if (dragging) { dragging = false; down = null; el.classList.remove('dragging'); api.dragEnd(); } });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); api.contextMenu(); });

  // one click: whole screen · two clicks: drag a box · middle click or long press: voice
  function onSingleClick() {
    if (recording) { stopRecording(); return; }
    api.click();
  }
  function onDoubleClick() {
    if (recording) { stopRecording(); return; }
    api.regionCapture();
  }

  // ---------- drag & drop into the workspace ----------
  window.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; el.classList.add('dropping'); });
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) el.classList.remove('dropping'); });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    el.classList.remove('dropping');
    const dt = e.dataTransfer;
    const paths = [...(dt.files || [])].map((f) => api.pathForFile(f)).filter(Boolean);
    const uriList = dt.getData('text/uri-list') || '';
    const urls = uriList.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && /^https?:/i.test(l));
    const text = dt.getData('text/plain') || '';
    try {
      await api.drop({ paths, urls: paths.length ? [] : urls, text: paths.length || urls.length ? '' : text });
    } catch (err) {
      console.error('drop failed', err);
    }
  });

  // ---------- recording ----------
  let recorder = null;
  let stream = null;
  let meter = null;
  let micLabel = '';
  let chunks = [];
  let startedAt = 0;
  let tick = null;

  async function toggleRecording() {
    if (recording) stopRecording(); else await startRecording();
  }

  async function startRecording() {
    if (recording) return;
    try {
      const ok = await api.requestMic();
      if (!ok) { api.micDenied(); return; }
      stream = await openMic(config.micDeviceId);
    } catch (err) {
      api.log('microphone error:', err.message);
      api.micDenied();
      return;
    }
    const track = stream.getAudioTracks()[0];
    micLabel = (track && track.label) || '';
    try { meter = makeMeter(stream); } catch (err) { api.log('meter failed:', err.message); meter = null; }
    chunks = [];
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => { finishRecording().catch((err) => api.log('finishRecording failed:', err.message)); };
    recorder.start(1000);
    startedAt = Date.now();
    recording = true;
    render();
    api.recordingState({ recording: true, seconds: 0, level: 0, peak: 0, mic: micLabel });
    let level = 0;
    tick = setInterval(() => {
      const s = (Date.now() - startedAt) / 1000;
      if (meter) { const m = meter.sample(); level = m.level; }
      api.recordingState({ recording: true, seconds: s, level, peak: meter ? meter.peak : 0, mic: micLabel });
      if (s >= MAX_RECORD_SECONDS) stopRecording();
    }, 250);
  }

  function stopRecording() {
    if (!recorder) return;
    if (tick) { clearInterval(tick); tick = null; }
    try { recorder.stop(); } catch (err) { console.error(err); }
  }

  function toMono(buf) {
    const n = buf.numberOfChannels;
    if (n === 1) return buf.getChannelData(0).slice();
    const out = new Float32Array(buf.length);
    for (let c = 0; c < n; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < buf.length; i++) out[i] += d[i] / n;
    }
    return out;
  }

  async function finishRecording() {
    const durationSec = (Date.now() - startedAt) / 1000;
    const type = (recorder && recorder.mimeType) || 'audio/webm';
    recorder = null;
    recording = false;
    render();
    const peak = meter ? meter.peak : undefined;
    if (meter) { meter.close(); meter = null; }
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    api.recordingState({ recording: false, seconds: durationSec, peak, mic: micLabel });
    const blob = new Blob(chunks, { type });
    chunks = [];
    const arrayBuffer = await blob.arrayBuffer();
    let pcm = new Float32Array(0);
    try {
      const ctx = new AudioContext({ sampleRate: 16000 });
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      pcm = toMono(decoded);
      await ctx.close();
    } catch (err) {
      console.error('decode failed', err);
    }
    // 16-bit PCM halves the IPC payload compared to float samples.
    const pcm16 = new Int16Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) { const s = Math.max(-1, Math.min(1, pcm[i])); pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
    await api.submitAudio({ webm: new Uint8Array(arrayBuffer), pcm: pcm16, sampleRate: 16000, durationSec, peak, mic: micLabel });
  }

  render();
})();
