'use strict';
// Runs one transcription and exits. Lives in a utilityProcess so that when the model takes the process
// down -- and it does: some ONNX checkpoints abort inside onnxruntime with a SIGTRAP that no try/catch
// can see -- what dies is this, not the app, not the recording, not everything else in flight.
const stt = require('./stt');

process.parentPort.on('message', async (e) => {
  const msg = e.data || {};
  if (msg.type !== 'transcribe') return;
  try {
    const pcm = new Float32Array(msg.pcm);
    const result = await stt.transcribe(pcm, msg.cfg, (stage, p, file) => {
      try { process.parentPort.postMessage({ type: 'progress', stage, p, file }); } catch (_) { /* parent gone */ }
    });
    process.parentPort.postMessage({ type: 'done', result });
  } catch (err) {
    process.parentPort.postMessage({ type: 'failed', error: err.message || String(err) });
  }
});
