'use strict';
// OCR is a plain text-recognition step – it never involves an LLM.
// Engine: PP-OCR (PaddleOCR) models run locally through onnxruntime-node.
// The English/Chinese model set is bundled with the app; other scripts download on first use.
const fs = require('fs');
const os = require('os');
const path = require('path');

const IDLE_MS = 2 * 60 * 1000;   // free the ~450 MB working set soon after the user stops capturing

// Runtime settings tuned for laptops rather than for the fastest possible single run. Measured on a
// 2560×1440 screenshot with v6-tiny: defaults cost 750 MB peak and 4.5 s of CPU across every core;
// these settings cost ~450 MB and 2.2 s of CPU, with ~1 % less text recognised.
//   · half the cores (2-4) instead of all of them, so the fans stay down and the UI stays responsive
//   · no CPU arena: onnxruntime otherwise keeps its scratch memory reserved between runs
//   · cap the detection input at 1280 px: screenshots are usually 1440-2160 px tall and lose nothing
function runtimeOptions() {
  const cores = os.cpus().length || 4;
  const threads = Math.max(2, Math.min(4, Math.floor(cores / 2)));
  return {
    session: { intraOpNumThreads: threads, interOpNumThreads: 1, enableCpuMemArena: false },
    detection: { maxSideLength: 1280 },
  };
}

// PP-OCR model sets. `langs` lists the language codes each set covers well; sizeMB is the download size.
// sizeMB values are the measured download size (detection + recognition + dictionary).
const PADDLE_MODELS = {
  'v6-tiny': { preset: 'V6_TINY_MODEL', sizeMB: 6, bundled: true, langs: ['zh-Hans', 'zh-Hant', 'en'], name: 'PP-OCRv6 tiny' },
  'v6-small': { preset: 'V6_SMALL_MODEL', sizeMB: 30, langs: ['zh-Hans', 'zh-Hant', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'it', 'ru'], name: 'PP-OCRv6 small' },
  'v6-medium': { preset: 'V6_MEDIUM_MODEL', sizeMB: 132, langs: ['zh-Hans', 'zh-Hant', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'it', 'ru'], name: 'PP-OCRv6 medium' },
  'v5-mobile': { preset: 'V5_MOBILE_MODEL', sizeMB: 20, langs: ['zh-Hans', 'zh-Hant', 'en'], name: 'PP-OCRv5 mobile' },
  'v5-korean': { preset: 'V5_KOREAN_MOBILE_MODEL', sizeMB: 17, langs: ['ko'], name: 'PP-OCRv5 Korean' },
  'v5-latin': { preset: 'V5_LATIN_MOBILE_MODEL', sizeMB: 12, langs: ['fr', 'de', 'es', 'pt', 'it', 'vi', 'id', 'nl', 'pl', 'tr'], name: 'PP-OCRv5 Latin' },
  'v5-cyrillic': { preset: 'V5_CYRILLIC_MOBILE_MODEL', sizeMB: 12, langs: ['ru'], name: 'PP-OCRv5 Cyrillic' },
  'v5-arabic': { preset: 'V5_ARABIC_MOBILE_MODEL', sizeMB: 12, langs: ['ar'], name: 'PP-OCRv5 Arabic' },
  'v5-thai': { preset: 'V5_THAI_MOBILE_MODEL', sizeMB: 12, langs: ['th'], name: 'PP-OCRv5 Thai' },
  'v3-japanese': { preset: 'V3_JAPANESE_MOBILE_MODEL', sizeMB: 14, langs: ['ja'], name: 'PP-OCRv3 Japanese' },
};
const DEFAULT_PADDLE_MODEL = 'v6-tiny';   // bundled with the app; covers Chinese + English

/** Models shipped inside the app (…/bundled-models/ocr/<key>), so a fresh install works offline. */
function bundledDir() {
  const dir = path.join(__dirname, '..', '..', 'bundled-models', 'ocr');
  return dir.includes('app.asar') ? dir.replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked') : dir;
}

/**
 * Picks the model set to use: the caller's preference when it covers the configured languages, otherwise
 * the smallest set that does. `preferred` comes from the hardware probe (v6-tiny on modest machines).
 */
function modelForLanguages(codes, preferred) {
  const wanted = (codes || []).filter(Boolean);
  const covers = (key) => PADDLE_MODELS[key] && wanted.every((c) => PADDLE_MODELS[key].langs.includes(c));
  if (!wanted.length) return preferred && PADDLE_MODELS[preferred] ? preferred : DEFAULT_PADDLE_MODEL;
  if (preferred && covers(preferred)) return preferred;
  if (covers(DEFAULT_PADDLE_MODEL)) return DEFAULT_PADDLE_MODEL;
  for (const key of Object.keys(PADDLE_MODELS)) if (covers(key)) return key;
  return 'v6-small'; // best general model; unknown scripts degrade rather than fail
}

// Did OCR actually read anything, or is this the noise a photograph leaves behind?
//
// It matters because "no text" is what routes a picture to the local image classifier, and OCR
// almost never answers with nothing at all: a photograph of a dog came back as "N\nN\nM\nX\n2 2"
// and one of a circuit board as "2 2\n2 2 2 3 2 2 2 2", both non-empty, both meaningless. Across
// this workspace the two populations do not overlap even slightly -- every noise result has zero
// words of two letters or more and zero CJK characters, while the thinnest real one has eleven words
// and eight CJK characters -- so a low bar separates them with room to spare.
const WORD_RE = /[A-Za-z\u00c0-\u024f]{2,}/g;
const CJK_RE = /[\u4e00-\u9fff\u3040-\u30ff]/g;

function hasWords(text) {
  const t = String(text || '');
  return (t.match(WORD_RE) || []).length >= 2 || (t.match(CJK_RE) || []).length >= 4;
}

function cleanText(text) {
  if (!text) return '';
  const cjk = '[぀-ヿ㐀-䶿一-鿿]';
  return text
    .replace(new RegExp(`(?<=${cjk})[ \\t]+(?=${cjk})`, 'gu'), '')
    .replace(new RegExp(`(?<=${cjk})[ \\t]+(?=[，。！？、：；）】」』])`, 'gu'), '')
    .replace(new RegExp(`(?<=[（【「『])[ \\t]+(?=${cjk})`, 'gu'), '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

let chain = Promise.resolve();
let idleTimer = null;
let service = null;      // { instance, key }
let loading = null;
let catalogue = null;

function touchIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { terminate().catch(() => {}); }, IDLE_MS);
}

async function loadCatalogue() {
  if (!catalogue) catalogue = await import('ppu-paddle-ocr');
  return catalogue;
}

/** Returns the three model files for a preset, downloading them only if they are not bundled or cached. */
async function ensureModels(modelKey, cacheDir, onProgress) {
  const mod = await loadCatalogue();
  const urls = mod[PADDLE_MODELS[modelKey].preset];
  if (!urls) throw new Error(`Unknown OCR model ${modelKey}`);

  const bundled = path.join(bundledDir(), modelKey);
  const fromBundle = {};
  let complete = true;
  for (const [role, url] of Object.entries(urls)) {
    const file = path.join(bundled, url.split('/').pop());
    if (fs.existsSync(file)) fromBundle[role] = file; else complete = false;
  }
  if (complete) return fromBundle;

  const target = path.join(cacheDir, modelKey);
  fs.mkdirSync(target, { recursive: true });
  const files = {};
  const parts = Object.entries(urls);
  let index = 0;
  for (const [role, url] of parts) {
    const name = url.split('/').pop();
    index++;
    if (fromBundle[role]) { files[role] = fromBundle[role]; continue; }
    const file = path.join(target, name);
    files[role] = file;
    if (fs.existsSync(file) && fs.statSync(file).size > 1024) continue;
    if (onProgress) onProgress({ stage: 'download', file: name, part: index, parts: parts.length, percent: 0 });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Cannot download ${name}: HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    const tmp = `${file}.part`;
    const out = fs.createWriteStream(tmp);
    let received = 0;
    for await (const chunk of res.body) {
      received += chunk.length;
      out.write(Buffer.from(chunk));
      if (onProgress && total) onProgress({ stage: 'download', file: name, part: index, parts: parts.length, percent: Math.round((received / total) * 100) });
    }
    await new Promise((resolve, reject) => { out.end(resolve); out.on('error', reject); });
    fs.renameSync(tmp, file);
    if (onProgress) onProgress({ stage: 'download', file: name, part: index, parts: parts.length, percent: 100 });
  }
  return files;
}

async function getService(modelKey, cacheDir, onProgress) {
  const key = `${modelKey}|${cacheDir}`;
  if (service && service.key === key) return service.instance;
  if (loading) { await loading.catch(() => {}); if (service && service.key === key) return service.instance; }
  loading = (async () => {
    const mod = await loadCatalogue();
    const files = await ensureModels(modelKey, cacheDir, onProgress);
    if (service) { await service.instance.destroy?.().catch(() => {}); service = null; }
    if (onProgress) onProgress({ stage: 'load', percent: 0 });
    const tuned = runtimeOptions();
    const instance = new mod.PaddleOcrService({
      model: { detection: files.detection, recognition: files.recognition, charactersDictionary: files.charactersDictionary },
      session: tuned.session,
      detection: tuned.detection,
    });
    await instance.initialize();
    service = { instance, key };
  })();
  try { await loading; } finally { loading = null; }
  return service.instance;
}

/**
 * @param {Buffer|string} image   PNG/JPEG buffer or file path
 * @param {{languages?:string[], model?:string, cacheDir:string}} cfg
 * @param {(p:{stage:string, percent:number, file?:string, part?:number, parts?:number})=>void} [onProgress]
 * @returns {Promise<{text:string, engine:string, model:string, confidence?:number, lines?:Array}>}
 *   `lines` are the recognised items grouped by line, each with its box in the picture's own pixel
 *   coordinates -- the detection pass produced them anyway, and ocr-boxes.js keeps them.
 */
async function recognize(image, cfg, onProgress) {
  const run = async () => {
    const modelKey = cfg.model && PADDLE_MODELS[cfg.model] ? cfg.model : modelForLanguages(cfg.languages, cfg.preferred);
    const instance = await getService(modelKey, cfg.cacheDir, onProgress);
    if (onProgress) onProgress({ stage: 'recognize', percent: 0 });
    const buf = Buffer.isBuffer(image) ? image : fs.readFileSync(image);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    // noCache: the library keys its result cache on the image bytes alone, so a cached result would be
    // returned even after switching models.
    const t0 = Date.now();
    const result = await instance.recognize(ab, { noCache: true });
    const ms = Date.now() - t0;
    recordRun(modelKey, ms);
    touchIdle();
    if (onProgress) onProgress({ stage: 'recognize', percent: 100 });
    return { text: cleanText(result && result.text), confidence: result && result.confidence, lines: (result && result.lines) || null, engine: 'paddle', model: modelKey, ms };
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

/** Makes sure the models are on disk (used by the setup wizard). */
async function prepare(cfg, onProgress) {
  const modelKey = cfg.model && PADDLE_MODELS[cfg.model] ? cfg.model : modelForLanguages(cfg.languages);
  await ensureModels(modelKey, cfg.cacheDir, onProgress);
  return { engine: 'paddle', model: modelKey, name: PADDLE_MODELS[modelKey].name };
}

// Recent run times per model, so the app can notice that its guess about this machine was too optimistic.
const runs = new Map();
const SLOW_MS = 6000;      // a screenshot that takes longer than this is disruptive
const SLOW_RUNS = 3;       // require a few slow runs before changing anything

function recordRun(modelKey, ms) {
  const list = runs.get(modelKey) || [];
  list.push(ms);
  if (list.length > 5) list.shift();
  runs.set(modelKey, list);
}

/** @returns {{model:string, median:number}|null} the model that is consistently too slow here, if any. */
function tooSlow() {
  for (const [model, list] of runs) {
    if (list.length < SLOW_RUNS) continue;
    const sorted = [...list].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median > SLOW_MS) return { model, median };
  }
  return null;
}
function forgetRuns(modelKey) { if (modelKey) runs.delete(modelKey); else runs.clear(); }

async function terminate() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (service) { const s = service; service = null; await s.instance.destroy?.().catch(() => {}); }
}

module.exports = {
  recognize, prepare, terminate, cleanText, hasWords, modelForLanguages, bundledDir, runtimeOptions,
  tooSlow, forgetRuns, recordRun, PADDLE_MODELS, DEFAULT_PADDLE_MODEL,
};
