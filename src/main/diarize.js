'use strict';
// Telling voices apart, and remembering them.
//
// Two separate jobs, and the second is the one that makes the feature worth having.
//
//   1. Within one recording: who spoke when. sherpa-onnx (Apache-2.0) runs pyannote segmentation and a
//      speaker-embedding model through ONNX -- no Python, no server, and briffy already ships
//      onnxruntime for Whisper and PaddleOCR, so this is the same kind of dependency, not a new one.
//   2. Across recordings: that "speaker 1" in Tuesday's meeting is the same person as in Thursday's.
//      Diarization on its own cannot say that -- its labels are local to one file and arbitrary
//      (measured: a four-person clip came back as speakers 0, 1, 2 and 7). So every speaker's voice is
//      averaged into a print, kept in the workspace, and the next recording is matched against it. Name
//      somebody once and they stay named.
//
// The two halves use two different libraries, and not by choice. sherpa's own embedding extractor
// **cannot run inside Electron at all**: `compute()` hands back an external buffer, which Electron's
// V8 memory cage refuses outright ("External buffers are not allowed"). The same call works in plain
// node. A utilityProcess does not help, and neither does ELECTRON_RUN_AS_NODE -- the restriction is in
// the V8 build, not the environment. sherpa's *diarizer* is fine, because it returns plain objects.
// So the prints are taken with transformers.js instead, which briffy already ships for Whisper and
// which returns ordinary tensors. Measured on a two-speaker clip: the same voice scores 0.93 and 0.98,
// two different voices 0.75 -- a clear gap, which is where SAME_PERSON comes from.
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
// And this one gives briffy the prints it keeps between recordings. Downloaded by transformers.js into
// the same cache as the speech models.
const PRINT_MODEL = 'Xenova/wavlm-base-plus-sv';

const RATE = 16000;
// Cosine similarity above which two voices are taken to be the same person across recordings. 0.5 is
// sherpa's own default for clustering *within* a file; matching across files is a bigger claim -- it
// puts words in a named person's mouth -- so this is deliberately stricter.
// Tuned to the model actually used. wavlm x-vectors sit high for everybody -- two strangers still
// score about 0.75 -- so this is not a general "similar voices" number and must not be lowered towards
// one. Measured: same speaker 0.93-0.98, different speakers 0.75.
const SAME_PERSON = 0.85;
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

/** One voice, as 512 numbers. See the note at the top for why this is not sherpa's own extractor. */
let printer = null;
async function loadPrinter() {
  if (printer) return printer;
  const { AutoProcessor, AutoModel } = await import('@huggingface/transformers');
  const cache = store.paths().models;
  const [processor, model] = await Promise.all([
    AutoProcessor.from_pretrained(PRINT_MODEL, { cache_dir: cache }),
    AutoModel.from_pretrained(PRINT_MODEL, { cache_dir: cache, dtype: 'q8' }),
  ]);
  printer = { processor, model };
  return printer;
}
async function embed(voice) {
  const p = await loadPrinter();
  const inputs = await p.processor(Float32Array.from(voice));
  const out = await p.model(inputs);
  const tensor = out.embeddings || out.output;
  return tensor ? Array.from(tensor.data) : null;
}

/** Frees the models; they are ~35 MB resident and a recording may be the only one all day. */
function release() { diarizer = null; extractor = null; printer = null; }

// ---------- who is who, across recordings ----------
function peopleFile() { return path.join(store.paths().workspace, 'speakers.json'); }

function loadPeople() {
  try {
    const raw = JSON.parse(fs.readFileSync(peopleFile(), 'utf8'));
    return Array.isArray(raw.people) ? raw.people : [];
  } catch (_) { return []; }
}
function savePeople(people) {
  try { require('./store').writeJsonAtomic(peopleFile(), { people }); }
  catch (e) { console.warn('[diarize] cannot save speakers:', e.message); }
}

function cosine(a, b) {
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/**
 * The person this voice belongs to, remembering them if they are new.
 * A print is the running mean of every recording they have been heard in, weighted by how long they
 * spoke, so one noisy sentence cannot drag an established voice away from itself.
 */
function identify(people, print, seconds) {
  let best = null; let bestScore = 0;
  for (const p of people) {
    const score = cosine(p.print, print);
    if (score > bestScore) { bestScore = score; best = p; }
  }
  if (best && bestScore >= SAME_PERSON) {
    const w = best.seconds / (best.seconds + seconds);
    best.print = best.print.map((v, i) => (v * w) + (print[i] * (1 - w)));
    best.seconds = Math.round(best.seconds + seconds);
    best.lastAt = new Date().toISOString();
    return { person: best, score: bestScore, isNew: false };
  }
  const person = {
    id: `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    name: '',                     // the user names them; until then the interface numbers them
    print: Array.from(print),
    seconds: Math.round(seconds),
    firstAt: new Date().toISOString(),
    lastAt: new Date().toISOString(),
  };
  people.push(person);
  return { person, score: bestScore, isNew: true };
}

/** Everyone briffy has heard, most-heard first. For the interface, without the prints. */
function people() {
  return loadPeople()
    .map(({ id, name, seconds, firstAt, lastAt }) => ({ id, name, seconds, firstAt, lastAt }))
    .sort((a, b) => b.seconds - a.seconds);
}

/** Give a voice a name. Returns false when there is no such voice. */
function rename(id, name) {
  const all = loadPeople();
  const hit = all.find((p) => p.id === id);
  if (!hit) return false;
  hit.name = String(name || '').slice(0, 60);
  savePeople(all);
  return true;
}

// ---------- the work ----------
/**
 * @param {Float32Array} pcm 16 kHz mono
 * @returns {Promise<{segments:Array<{start:number,end:number,speaker:string}>, speakers:Array}|null>}
 *   null when the models are missing or the library will not load. `speaker` is a durable person id,
 *   not a per-file number.
 */
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

  const all = loadPeople();
  const mapping = new Map();
  const heard = [];
  for (const [local, info] of byLocal) {
    if (info.seconds < MIN_SPEAK_SEC) continue;
    // The print is taken from this speaker's longest stretches, up to a handful of seconds: the more
    // continuous the audio, the cleaner the voice in it.
    const spans = [...info.spans].sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, 4);
    const chunks = [];
    let total = 0;
    for (const s of spans) {
      const from = Math.max(0, Math.floor(s.start * RATE));
      const to = Math.min(samples.length, Math.ceil(s.end * RATE));
      if (to - from < RATE * 0.4) continue;
      chunks.push(samples.subarray(from, to));
      total += to - from;
      if (total > RATE * 8) break;
    }
    if (!total) continue;
    const voice = new Float32Array(total);
    let at = 0;
    for (const c of chunks) { voice.set(c, at); at += c.length; }
    let print;
    try { print = await embed(voice); }
    catch (err) { console.warn('[diarize] voice print failed:', err.message); continue; }
    if (!print || !print.length) continue;
    const { person, isNew } = identify(all, print, info.seconds);
    mapping.set(local, person.id);
    heard.push({ id: person.id, name: person.name, seconds: Math.round(info.seconds), isNew });
  }
  savePeople(all);

  const segments = raw
    .filter((s) => mapping.has(String(s.speaker)))
    .map((s) => ({ start: Number(s.start.toFixed(2)), end: Number(s.end.toFixed(2)), speaker: mapping.get(String(s.speaker)) }));
  if (!segments.length) return null;
  return { segments, speakers: heard.sort((a, b) => b.seconds - a.seconds) };
}

module.exports = {
  init, ensureModels, ready, run, release, people, rename, identify, cosine,
  SEGMENTATION, EMBEDDING, SAME_PERSON, RATE,
};
