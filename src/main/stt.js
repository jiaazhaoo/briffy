'use strict';
// Speech-to-text with Whisper running locally through @huggingface/transformers (onnxruntime-node).
// The model is downloaded once into <userData>/models and cached on disk.

const path = require('path');
const fs = require('fs');

const IDLE_MS = 10 * 60 * 1000;
const STT_MODELS = [
  { id: 'Xenova/whisper-tiny.en', name: 'Whisper tiny · 只能识别英语 (~40 MB, 随包内置)', english: true, bundled: true },
  { id: 'Xenova/whisper-base.en', name: 'Whisper base · 只能识别英语 (~80 MB)', english: true },
  { id: 'Xenova/whisper-tiny', name: 'Whisper tiny · 多语言 (~40 MB, 较粗糙)' },
  { id: 'Xenova/whisper-base', name: 'Whisper base · 多语言 (~80 MB)' },
  { id: 'Xenova/whisper-small', name: 'Whisper small · 中英等多语言 (~250 MB, 推荐)' },
  { id: 'Xenova/whisper-medium', name: 'Whisper medium · 多语言 (~800 MB, 最准但慢)' },
];
const DEFAULT_MODEL = 'Xenova/whisper-tiny.en';
const MULTILINGUAL_DEFAULT = 'Xenova/whisper-small';

/**
 * The language packs decide the model, exactly as they already decide the OCR one.
 *
 * A checkpoint whose id ends in `.en` does not merely skip language detection -- it cannot represent
 * anything but English, so Chinese speech comes back as English-sounding nonsense with no error and no
 * warning. The bundled default is one of those, which means every install that picks a non-English pack
 * is quietly unable to transcribe it. Being wrong is worse than being 200 MB larger.
 *
 * @param {string[]} languages the two configured packs, e.g. ['zh-Hans', 'en']
 * @param {string} chosen      whatever is in settings
 * @returns {{model:string, upgraded:boolean, needed:string}}
 */
function modelForLanguages(languages, chosen) {
  const model = chosen || DEFAULT_MODEL;
  const wanted = (languages || []).map((l) => String(l || '').split('-')[0].toLowerCase()).filter(Boolean);
  const needed = wanted.find((l) => l !== 'en') || '';
  if (!needed || !/\.en$/i.test(model)) return { model, upgraded: false, needed: '' };
  return { model: MULTILINGUAL_DEFAULT, upgraded: true, needed };
}

/** Models shipped inside the app (…/bundled-models/stt/<org>/<name>), so a fresh install works offline. */
function bundledDir() {
  const dir = path.join(__dirname, '..', '..', 'bundled-models', 'stt');
  return dir.includes('app.asar') ? dir.replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked') : dir;
}
function isBundled(model) {
  try { return fs.existsSync(path.join(bundledDir(), ...String(model).split('/'), 'config.json')); } catch (_) { return false; }
}

let mod = null;
let pipe = null;
let pipeKey = '';
let loading = null;
let idleTimer = null;
let chain = Promise.resolve();

async function loadModule() {
  if (!mod) mod = await import('@huggingface/transformers');
  return mod;
}

function configureEnv(env, cfg) {
  if (cfg.cacheDir) { env.cacheDir = cfg.cacheDir; env.useFSCache = true; }
  const mirror = (cfg.mirror || '').trim();
  env.remoteHost = mirror ? (mirror.endsWith('/') ? mirror : `${mirror}/`) : 'https://huggingface.co/';
  // Prefer the copy shipped with the app; fall back to downloading anything else.
  const local = isBundled(cfg.model);
  env.allowLocalModels = local;
  env.allowRemoteModels = !local;
  if (local) env.localModelPath = bundledDir();
}

function touchIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { dispose().catch(() => {}); }, IDLE_MS);
}

async function getPipeline(cfg, onProgress) {
  const key = `${cfg.model}|${cfg.mirror || ''}|${cfg.cacheDir || ''}`;
  if (pipe && pipeKey === key) return pipe;
  if (loading) { await loading.catch(() => {}); if (pipe && pipeKey === key) return pipe; }
  loading = (async () => {
    const { pipeline, env } = await loadModule();
    configureEnv(env, cfg);
    if (pipe) { await pipe.dispose().catch(() => {}); pipe = null; pipeKey = ''; }
    const progress_callback = (p) => {
      if (!onProgress || !p) return;
      if (p.status === 'progress' && typeof p.progress === 'number') onProgress('download', p.progress / 100, p.file);
      else if (p.status === 'ready') onProgress('ready', 1);
    };
    const opts = { device: 'cpu', progress_callback };
    try {
      pipe = await pipeline('automatic-speech-recognition', cfg.model, { ...opts, dtype: 'q8' });
    } catch (e) {
      console.warn('[stt] q8 weights unavailable, falling back to fp32:', e.message);
      pipe = await pipeline('automatic-speech-recognition', cfg.model, { ...opts, dtype: 'fp32' });
    }
    pipeKey = key;
  })();
  try { await loading; } finally { loading = null; }
  return pipe;
}

/**
 * transformers.js does not auto-detect the spoken language (an unspecified language silently means English,
 * which makes Whisper *translate* other languages). This runs one decoder step and picks the most likely
 * language among the user's configured language packs.
 * @param {Float32Array} pcm
 * @param {string[]} candidates whisper language codes, e.g. ['zh', 'en']
 * @returns {Promise<string|null>}
 */
async function detectLanguage(p, pcm, candidates) {
  const gc = p.model.generation_config;
  if (!gc || !gc.is_multilingual || !gc.lang_to_id) return Array.isArray(candidates) && candidates[0] ? candidates[0] : null;
  // candidates === 'all' → choose among every language Whisper knows
  const uniq = candidates === 'all'
    ? Object.keys(gc.lang_to_id).map((k) => k.replace(/^<\||\|>$/g, ''))
    : [...new Set((candidates || []).filter(Boolean))];
  if (!uniq.length) return null;
  if (uniq.length === 1) return uniq[0];
  const ids = uniq.map((c) => gc.lang_to_id[`<|${c}|>`]);
  if (ids.some((x) => x === undefined)) return uniq[0];
  const { Tensor } = await loadModule();
  const sr = (p.processor.feature_extractor.config && p.processor.feature_extractor.config.sampling_rate) || 16000;
  const window = pcm.length > sr * 30 ? pcm.subarray(0, sr * 30) : pcm;
  const { input_features } = await p.processor(window);
  const decoder_input_ids = new Tensor('int64', new BigInt64Array([BigInt(gc.decoder_start_token_id)]), [1, 1]);
  const out = await p.model({ input_features, decoder_input_ids });
  const logits = out.logits;
  const vocab = logits.dims[logits.dims.length - 1];
  const offset = logits.data.length - vocab; // logits of the last (only) decoder position
  let best = uniq[0];
  let bestScore = -Infinity;
  uniq.forEach((code, i) => {
    const score = Number(logits.data[offset + ids[i]]);
    if (score > bestScore) { bestScore = score; best = code; }
  });
  return best;
}

/**
 * @param {Float32Array} pcm  mono PCM at 16 kHz, values in [-1, 1]
 * @param {{model:string, cacheDir:string, mirror?:string, language?:string|null, candidates?:string[]}} cfg
 *        `language` forces a language; otherwise the language is detected among `candidates`.
 * @param {(stage:string, progress:number, detail?:string)=>void} [onProgress]
 * @returns {Promise<{text:string, language:string|null, chunks?:Array<{text,start,end}>}>}
 *   `chunks` only when `cfg.timestamps` asked for them: they cost extra decoding, and only the one
 *   caller that has to line words up against voices needs them (see src/main/attribute.js).
 */
/** The transcriber's chunks, in the shape attribute.js wants -- or nothing when none were asked for. */
function timed(out) {
  const raw = out && Array.isArray(out.chunks) ? out.chunks : null;
  if (!raw) return undefined;
  return raw.map((c) => {
    const [start, end] = Array.isArray(c.timestamp) ? c.timestamp : [null, null];
    return { text: String(c.text || '').trim(), start, end };
  }).filter((c) => c.text);
}

async function transcribe(pcm, cfg, onProgress) {
  const run = async () => {
    const p = await getPipeline(cfg, onProgress);
    if (onProgress) onProgress('transcribe', 0);
    // English-only checkpoints (…-tiny.en) reject `language` / `task` entirely.
    const englishOnly = !(p.model.generation_config && p.model.generation_config.is_multilingual);
    if (englishOnly) {
      const out = await p(pcm, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: !!cfg.timestamps });
      touchIdle();
      const text = out && typeof out.text === 'string' ? out.text : '';
      return { text: text.replace(/\s+/g, (m) => (m.includes('\n') ? '\n' : ' ')).trim(), language: 'en', chunks: timed(out) };
    }
    let language = cfg.language || null;
    if (!language && cfg.candidates && (cfg.candidates === 'all' || cfg.candidates.length)) {
      try {
        language = await detectLanguage(p, pcm, cfg.candidates);
        console.log('[stt] detected language:', language);
      } catch (e) {
        console.warn('[stt] language detection failed:', e.message);
        language = Array.isArray(cfg.candidates) ? cfg.candidates[0] : null;
      }
    }
    const opts = { chunk_length_s: 30, stride_length_s: 5, task: 'transcribe', return_timestamps: !!cfg.timestamps };
    if (language) opts.language = language;
    const out = await p(pcm, opts);
    touchIdle();
    const text = out && typeof out.text === 'string' ? out.text : '';
    return { text: text.replace(/\s+/g, (m) => (m.includes('\n') ? '\n' : ' ')).trim(), language, chunks: timed(out) };
  };
  const job = chain.then(run, run);
  chain = job.catch(() => {});
  return job;
}

/** Downloads and warms the speech model without transcribing anything (used by the setup wizard). */
async function prepare(cfg, onProgress) {
  await getPipeline(cfg, onProgress);
  if (onProgress) onProgress('ready', 1);
  touchIdle();
  return { model: cfg.model };
}

async function dispose() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (pipe) {
    const p = pipe;
    pipe = null; pipeKey = '';
    await p.dispose().catch(() => {});
  }
}

module.exports = { transcribe, prepare, dispose, bundledDir, isBundled, modelForLanguages, STT_MODELS, DEFAULT_MODEL, MULTILINGUAL_DEFAULT };
