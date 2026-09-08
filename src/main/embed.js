'use strict';
// Sentence embeddings, for choosing which of a document's own words describe it.
//
// The child is kept warm because tagging happens on every capture, and restarted if it dies. If it
// cannot run at all -- no network on the first use, a model this machine chokes on -- that is recorded
// and the caller silently goes back to counting words, which is what it did before.
const path = require('path');
const { utilityProcess } = require('electron');

// Small, multilingual, and the one KeyBERT recommends for mixed-language text. ~120 MB.
//
// **换过一次，换回来了。别再换。** 证据在 dev/embed-bakeoff.js，用真实工作区（257 条、627 块）量的：
//
//                                    体积   八问名次和   前五命中   「库里没有」画得出门槛吗
//   paraphrase-MiniLM-L12（现在这个）  129M      68       13/40    画得出 0.427
//   multilingual-e5-small            120M      76       16/40    **画不出**
//   multilingual-e5-base             289M     135       15/40    —
//   LaBSE                            477M      47       13/40    **画不出**（胡话反而 0.885 最高）
//   paraphrase-mpnet-base            288M      64        9/40    画得出，但名次全面变差
//
// 换 e5 的理由本来是跨语言那几对余弦好看（停车↔parking 0.504 → 0.849）。那个数是假的：
// e5 把**所有**东西都压进 0.76~0.89 这条窄带，停车↔抓紧（毫不相干）也是 0.840。
// 余弦高不代表分得开，而检索要的是分得开。落到名次上，e5 八问里赢五问、输两问，是噪声级的差别；
// 落到「搜不到就说搜不到」上它直接出局——库里有的最低 0.863，库里没有的最高 0.863，重合，
// 没有任何一条线能把两边分开。LaBSE 同样的病，还更重。
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
 * @param {{cacheDir:string, mirror?:string, model?:string, onProgress?:(pct:number)=>void, timeoutMs?:number}} opts
 * @returns {Promise<number[][]>} one unit-length vector per input
 */
function embed(texts, { cacheDir, mirror = '', model = MODEL, onProgress, timeoutMs = 4 * 60 * 1000 } = {}) {
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
    child.postMessage({ type: 'embed', id, texts, cfg: { model, cacheDir, mirror } });
  });
}

module.exports = { embed, available, reason, dispose: kill, MODEL };
