'use strict';
// Sentence embeddings, for choosing which of a document's own words describe it.
//
// The child is kept warm because tagging happens on every capture, and restarted if it dies. If it
// cannot run at all -- no network on the first use, a model this machine chokes on -- that is recorded
// and the caller silently goes back to counting words, which is what it did before.
const path = require('path');
const { utilityProcess } = require('electron');

// Small, multilingual, and the one KeyBERT recommends for mixed-language text. ~120 MB.
const MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const IDLE_MS = 3 * 60 * 1000;

let child = null;
let idleTimer = null;
let seq = 0;
const waiting = new Map();
let broken = '';          // why it is unavailable, once we know

function kill() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (child) { try { child.kill(); } catch (_) { /* gone */ } child = null; }
  for (const { reject } of waiting.values()) reject(Object.assign(new Error('embedding process stopped'), { code: 'embed-down' }));
  waiting.clear();
}
function touchIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!waiting.size) kill(); }, IDLE_MS);
}

function spawn() {
  if (child) return child;
  child = utilityProcess.fork(path.join(__dirname, 'embed-child.js'), [], { serviceName: 'briffy embeddings' });
  child.on('message', (m) => {
    if (!m || m.id === undefined) return;
    const w = waiting.get(m.id);
    if (!w) return;
    if (m.type === 'progress') { if (w.onProgress) w.onProgress(m.percent); return; }
    waiting.delete(m.id);
    if (m.type === 'done') w.resolve(m.vectors);
    else w.reject(Object.assign(new Error(m.error || 'embedding failed'), { code: 'embed-failed' }));
  });
  child.on('exit', () => {
    // No answer and no error: the model took the process down. Do not try it again this session.
    if (waiting.size) broken = 'the embedding model crashed on this machine';
    child = null;
    for (const { reject } of waiting.values()) reject(Object.assign(new Error(broken || 'embedding process exited'), { code: 'embed-crashed' }));
    waiting.clear();
  });
  return child;
}

function available() { return !broken; }
function reason() { return broken; }

/**
 * @param {string[]} texts
 * @param {{cacheDir:string, mirror?:string, onProgress?:(pct:number)=>void, timeoutMs?:number}} opts
 * @returns {Promise<number[][]>} one unit-length vector per input
 */
function embed(texts, { cacheDir, mirror = '', onProgress, timeoutMs = 4 * 60 * 1000 } = {}) {
  if (broken) return Promise.reject(Object.assign(new Error(broken), { code: 'embed-crashed' }));
  if (!texts.length) return Promise.resolve([]);
  spawn();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(Object.assign(new Error('embedding timed out'), { code: 'embed-timeout' }));
    }, timeoutMs);
    waiting.set(id, {
      onProgress,
      resolve: (v) => { clearTimeout(timer); touchIdle(); resolve(v); },
      reject: (e) => { clearTimeout(timer); touchIdle(); reject(e); },
    });
    child.postMessage({ type: 'embed', id, texts, cfg: { model: MODEL, cacheDir, mirror } });
  });
}

module.exports = { embed, available, reason, dispose: kill, MODEL };
