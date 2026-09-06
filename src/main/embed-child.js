'use strict';
// Holds one sentence-embedding model and answers batches of text with vectors. It stays alive between
// requests -- loading the model costs a second or two and tagging happens on every single capture -- and
// it lives out here because an ONNX model that this machine cannot run aborts the process it is in.
let mod = null;
let pipe = null;
let key = '';

async function load(cfg, report) {
  const k = `${cfg.model}|${cfg.mirror || ''}|${cfg.cacheDir || ''}`;
  if (pipe && key === k) return pipe;
  if (!mod) mod = await import('@huggingface/transformers');
  const { pipeline, env } = mod;
  if (cfg.cacheDir) { env.cacheDir = cfg.cacheDir; env.useFSCache = true; }
  const mirror = (cfg.mirror || '').trim();
  env.remoteHost = mirror ? (mirror.endsWith('/') ? mirror : `${mirror}/`) : 'https://huggingface.co/';
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  pipe = await pipeline('feature-extraction', cfg.model, {
    device: 'cpu',
    dtype: 'q8',
    progress_callback: (p) => {
      if (p && p.status === 'progress' && typeof p.progress === 'number') report({ type: 'progress', percent: p.progress });
    },
  });
  key = k;
  return pipe;
}

process.parentPort.on('message', async (e) => {
  const msg = e.data || {};
  if (msg.type !== 'embed') return;
  const report = (m) => { try { process.parentPort.postMessage({ ...m, id: msg.id }); } catch (_) { /* parent gone */ } };
  try {
    const p = await load(msg.cfg, report);
    const out = await p(msg.texts, { pooling: 'mean', normalize: true });
    // one flat Float32Array per input, in order
    const [n, dim] = out.dims;
    const flat = Array.from(out.data);
    const vectors = [];
    for (let i = 0; i < n; i++) vectors.push(flat.slice(i * dim, (i + 1) * dim));
    report({ type: 'done', vectors });
  } catch (err) {
    report({ type: 'failed', error: err.message || String(err) });
  }
});
