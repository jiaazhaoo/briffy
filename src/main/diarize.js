'use strict';
// Telling voices apart inside one recording.
//
// sherpa-onnx (Apache-2.0) runs pyannote segmentation and a speaker-embedding model through ONNX --
// no Python, no server, and briffy already ships onnxruntime for Whisper and PaddleOCR, so this is
// the same kind of dependency, not a new one. It answers one question: who spoke when, in this file.
// The labels are local to the file and arbitrary (measured: a four-person clip came back as speakers
// 0, 1, 2 and 7), so they are re-ordered by how much each person talks and shown as 说话人 1 / 2 / 3.
//
// **It deliberately does not remember anyone between recordings.** There used to be a second half:
// every voice was averaged into a print, kept in speakers.json, matched against the next recording,
// and could be given a name. It was cut on 2026-09-06 -- 「不同会议有不同的人」: a name you gave in
// Tuesday's meeting is noise in Thursday's, and the list of half-named voices in the settings page
// was work the app asked of you without giving anything back. Numbers inside one recording are the
// part that earns its keep.
//
// Measured on this machine with the official test clips: a 57 s four-speaker Chinese recording took
// 3.8 s (0.07x real time) and found exactly four; a 16 s two-speaker English one took 0.6 s and found
// exactly two. A five-minute meeting is therefore about twenty seconds of work, which is the same order
// as the transcription it runs beside.
//
// Models are fetched once, on first use, like the OCR and speech ones: ~35 MB for the pair.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFile } = require('child_process');

const RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';
const SEGMENTATION = {
  url: `${RELEASE}/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2`,
  dir: 'sherpa-onnx-pyannote-segmentation-3-0',
  file: 'model.onnx',
  sizeMB: 7,
};
// Trained on Chinese *and* English together, which is the pair briffy is usually asked for. The
// English-only and Chinese-only CAM++ models are the same size and worse at the other language.
// Used *inside* sherpa's diarizer, which needs an embedding model of its own to cluster one recording.
// Trained on Chinese and English together, which is the pair briffy is usually asked for.
const EMBEDDING = {
  url: `${RELEASE}/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx`,
  file: 'campplus-zh-en.onnx',
  sizeMB: 28,
};
const RATE = 16000;

const MIN_SPEAK_SEC = 1.0;      // a cluster with less than this is not enough voice to remember

let deps = null;
let sherpa = null;
let diarizer = null;
let extractor = null;
let store = null;

function init(d) { deps = d; store = d.store; }

function modelsDir() { return path.join(store.paths().models, 'diarize'); }
function segPath() { return path.join(modelsDir(), SEGMENTATION.dir, SEGMENTATION.file); }
function embPath() { return path.join(modelsDir(), EMBEDDING.file); }
function ready() { return fs.existsSync(segPath()) && fs.existsSync(embPath()); }

function lib() {
  if (sherpa === undefined) return null;
  if (!sherpa) {
    try { sherpa = require('sherpa-onnx-node'); }
    catch (e) { console.warn('[diarize] sherpa-onnx unavailable:', e.message.split('\n')[0]); sherpa = undefined; return null; }
  }
  return sherpa;
}

// ---------- models ----------
async function download(url, to, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`cannot download ${path.basename(url)}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const tmp = `${to}.part`;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const out = fs.createWriteStream(tmp);
  let got = 0;
  for await (const chunk of res.body) {
    got += chunk.length;
    out.write(Buffer.from(chunk));
    if (onProgress && total) onProgress(Math.round((got / total) * 100));
  }
  await new Promise((resolve, reject) => { out.end(resolve); out.on('error', reject); });
  fs.renameSync(tmp, to);
}

/** bzip2 is not in node, and this is the only archive briffy ever unpacks, so tar does it. */
function untarBz2(file, into) {
  return new Promise((resolve, reject) => {
    execFile('tar', ['xjf', file, '-C', into], { timeout: 120000 }, (err) => (err ? reject(err) : resolve()));
  });
}

async function ensureModels(onProgress) {
  if (ready()) return true;
  const dir = modelsDir();
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(embPath())) {
    if (onProgress) onProgress({ stage: 'download', part: 1, parts: 2, percent: 0 });
    await download(EMBEDDING.url, embPath(), (p) => onProgress && onProgress({ stage: 'download', part: 1, parts: 2, percent: p }));
  }
  if (!fs.existsSync(segPath())) {
    const tar = path.join(dir, 'segmentation.tar.bz2');
    if (onProgress) onProgress({ stage: 'download', part: 2, parts: 2, percent: 0 });
    await download(SEGMENTATION.url, tar, (p) => onProgress && onProgress({ stage: 'download', part: 2, parts: 2, percent: p }));
    await untarBz2(tar, dir);
    try { fs.rmSync(tar, { force: true }); } catch (_) { /* leave it */ }
  }
  return ready();
}

function engines() {
  const s = lib();
  if (!s || !ready()) return null;
  if (!diarizer) {
    diarizer = new s.OfflineSpeakerDiarization({
      segmentation: { pyannote: { model: segPath() }, numThreads: 2, debug: false },
      embedding: { model: embPath(), numThreads: 2, debug: false },
      // -1 lets it work out how many people there are rather than being told
      clustering: { numClusters: -1, threshold: 0.5 },
      minDurationOn: 0.3,
      minDurationOff: 0.5,
    });
  }
  return { diarizer };
}

/** Frees the models; they are ~35 MB resident and a recording may be the only one all day. */
function release() { diarizer = null; extractor = null; }

async function run(pcm, { onProgress } = {}) {
  const e = engines();
  if (!e) return null;
  // napi refuses a buffer it did not allocate ("External buffers are not allowed"), which is exactly
  // what arrives from a wav reader or an IPC hop, so it is copied first.
  const samples = pcm instanceof Float32Array && pcm.buffer.byteLength === pcm.length * 4
    ? Float32Array.from(pcm) : Float32Array.from(pcm);
  if (samples.length < RATE * 1.5) return null;      // too short for anyone to be told apart

  if (onProgress) onProgress('diarize');
  const raw = e.diarizer.process(samples);
  if (!raw || !raw.length) return null;

  // Group the file's own labels, and measure how long each of them speaks.
  const byLocal = new Map();
  for (const seg of raw) {
    const key = String(seg.speaker);
    const cur = byLocal.get(key) || { seconds: 0, spans: [] };
    cur.seconds += seg.end - seg.start;
    cur.spans.push(seg);
    byLocal.set(key, cur);
  }

  // 按说得多少排个序，就是「说话人 1 / 2 / 3」。**不留声纹、不跨录音认人**——
  // 那一半在 2026-09-06 删了，理由见文件抬头。
  const ranked = [...byLocal.entries()]
    .filter(([, info]) => info.seconds >= MIN_SPEAK_SEC)
    .sort((a, b) => b[1].seconds - a[1].seconds);
  if (!ranked.length) return null;
  const mapping = new Map();
  const heard = ranked.map(([local, info], i) => {
    const id = `s${i + 1}`;
    mapping.set(local, id);
    return { id, seconds: Math.round(info.seconds) };
  });

  const segments = raw
    .filter((s) => mapping.has(String(s.speaker)))
    .map((s) => ({ start: Number(s.start.toFixed(2)), end: Number(s.end.toFixed(2)), speaker: mapping.get(String(s.speaker)) }));
  if (!segments.length) return null;
  return { segments, speakers: heard };
}

module.exports = { init, ensureModels, ready, run, release, SEGMENTATION, EMBEDDING, RATE };
