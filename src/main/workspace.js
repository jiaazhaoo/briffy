'use strict';
// Ingestion + processing pipeline. Everything that enters the workspace becomes an entry, then a serial
// queue runs OCR / speech-to-text / page fetching and finally asks Claude for five words (+ title, summary).
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const ocr = require('./ocr');
const vision = require('./vision');
const { uiLanguage } = require('./languages');
const { label: visionLabel } = require('./vision-labels');
const stt = require('./stt');
const sttRun = require('./stt-run');
const llm = require('./llm');
const hardware = require('./hardware');
const web = require('./web');
const { extractPdfText } = require('./pdftext');
const { whisperLang } = require('./languages');
const { localDateKey, timeStamp } = require('./store');
const { captureDisplayUnderCursor, screenPermissionStatus } = require('./capture');
const { normalizeChineseScript } = require('./chinese');
const region = require('./region');
const longshot = require('./longshot');
const clipboardWatch = require('./clipboard-watch');
const pictureId = require('./picture-id');
const ocrBoxes = require('./ocr-boxes');
const diarize = require('./diarize');
const { attribute, asLines, shares } = require('./attribute');
const foreground = require('./foreground');
const { clipboard, ClipboardItem } = require('electron');
const { t } = require('./i18n');

const IMAGE_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
};
const TEXT_EXT = new Set([
  '.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.log', '.xml', '.html', '.htm', '.yaml', '.yml', '.js', '.mjs', '.cjs',
  '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs', '.rb', '.php', '.sh', '.bat', '.ps1',
  '.sql', '.ini', '.toml', '.cfg', '.conf', '.env', '.tex', '.srt', '.vtt',
]);
const MAX_COPY_BYTES = 200 * 1024 * 1024;

let store; let windows;
const queue = [];
let running = false;
const pcmCache = new Map(); // entryId -> Float32Array (first run only; retries read the wav file)

function init(deps) { store = deps.store; windows = deps.windows; ocrBoxes.init(deps); diarize.init(deps); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- helpers ----------
function safeName(name) {
  const cleaned = String(name).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || 'file';
  const ext = path.extname(cleaned);
  const base = cleaned.slice(0, cleaned.length - ext.length).slice(0, 80);
  return base + ext;
}
function uniquePath(dir, name) {
  let candidate = path.join(dir, name);
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let i = 1;
  while (fs.existsSync(candidate)) candidate = path.join(dir, `${base}-${i++}${ext}`);
  return candidate;
}
function dayDir(kind) {
  const dir = path.join(store.paths()[kind], localDateKey());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function fmtClock(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function classify(file) {
  const ext = path.extname(file).toLowerCase();
  if (IMAGE_MIME[ext]) return { type: 'image', mime: IMAGE_MIME[ext] };
  if (ext === '.pdf') return { type: 'pdf', mime: 'application/pdf' };
  if (TEXT_EXT.has(ext)) return { type: 'text', mime: 'text/plain' };
  return { type: 'file', mime: '' };
}

// ---------- WAV (16 kHz mono 16-bit) ----------
function writeWav(file, pcm, sampleRate = 16000) {
  const buf = Buffer.alloc(44 + pcm.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + pcm.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    buf.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
}
// Reads any PCM wav (8/16/24/32-bit int or 32-bit float, mono or multi-channel) as mono 16 kHz float samples.
function readWav(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Not a WAV file');
  let pos = 12; let fmt = null; let data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') {
      fmt = { format: buf.readUInt16LE(pos + 8), channels: buf.readUInt16LE(pos + 10), sampleRate: buf.readUInt32LE(pos + 12), bits: buf.readUInt16LE(pos + 22) };
    } else if (id === 'data') {
      data = buf.subarray(pos + 8, Math.min(pos + 8 + size, buf.length));
      break;
    }
    pos += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('Malformed WAV file');
  const { channels, sampleRate, bits, format } = fmt;
  const bytes = bits / 8;
  const frames = Math.floor(data.length / (bytes * channels));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const off = (i * channels + c) * bytes;
      let v = 0;
      if (bits === 16) v = data.readInt16LE(off) / 32768;
      else if (bits === 32 && format === 3) v = data.readFloatLE(off);
      else if (bits === 32) v = data.readInt32LE(off) / 2147483648;
      else if (bits === 24) v = (((data[off] | (data[off + 1] << 8) | (data[off + 2] << 16)) << 8) >> 8) / 8388608;
      else if (bits === 8) v = (data[off] - 128) / 128;
      sum += v;
    }
    mono[i] = sum / channels;
  }
  if (sampleRate === 16000) return mono;
  const ratio = sampleRate / 16000;
  const out = new Float32Array(Math.floor(frames / ratio));
  for (let i = 0; i < out.length; i++) {
    const src = i * ratio; const j = Math.floor(src); const frac = src - j;
    out[i] = mono[j] * (1 - frac) + (mono[Math.min(j + 1, frames - 1)] || 0) * frac;
  }
  return out;
}

// Where the user was when they saved this. The record is filed first and gains its context a moment
// later, never the other way round -- reading a window title costs half a second on macOS and a save
// must not wait for it. See foreground.js.
function attachContext(entry, pending) {
  if (!entry) return entry;
  const apply = (ctx) => { if (ctx && ctx.app && store.getEntry(entry.id)) store.updateEntry(entry.id, { context: ctx }); };
  if (pending) pending.then(apply).catch(() => {});
  else foreground.readInto(apply);
  return entry;
}

// ---------- ingestion ----------
/** Saves a captured PNG as a screenshot entry, and puts it on the clipboard when the user wants that. */
function saveShot(png, { width, height, displayLabel, region = false, context = null }) {
  const s = store.getSettings();
  const now = new Date();
  const file = uniquePath(dayDir('screenshots'), `${timeStamp(now)}${region ? '-region' : ''}.png`);
  fs.writeFileSync(file, png);
  if (s.captureToClipboard !== false) {
    // The clipboard watcher must not record what we just put there – that would file the same
    // screenshot twice, once as a capture and once as a clipboard item.
    clipboardWatch.ignoreNext(png);
    // Electron's clipboard is the async W3C-style API: one ClipboardItem per entry, no writeImage().
    clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })])
      .catch((e) => console.warn('[capture] clipboard write failed:', e.message));
  }
  const entry = store.addEntry({
    type: 'screenshot',
    title: t(region ? 'regionTitle' : 'screenshotTitle', { time: fmtClock(now) }),
    path: store.relPath(file),
    mime: 'image/png',
    size: png.length,
    width,
    height,
    displayLabel,
    region,
  });
  attachContext(entry, context);
  // 存好了就是存好了——后面的 OCR / 起标题是后台的事，不该由它挂在脸上
  windows.setPetState('success', { message: s.captureToClipboard !== false ? t('capturedCopiedShort') : t('capturedShort') });
  enqueue(entry.id);
  return entry;
}

async function captureScreenshot() {
  // Sampled before anything is hidden or shown, so it names the app the user was actually looking at.
  const context = foreground.read();
  windows.setPetState('capturing');            // the shutter flash says it; no need to also say it
  const wait = await windows.hideForCapture();
  let shot;
  try {
    if (wait) await sleep(wait);
    shot = await captureDisplayUnderCursor();
  } catch (e) {
    windows.restoreAfterCapture();
    const hint = process.platform === 'darwin' && screenPermissionStatus() !== 'granted' ? t('screenPermission') : e.message;
    windows.setPetState('error', { message: t('captureFailed', { msg: hint }) });
    throw e;
  }
  windows.restoreAfterCapture();
  return saveShot(shot.png, { width: shot.width, height: shot.height, displayLabel: shot.displayLabel, context });
}

/** Drag-a-box capture. Resolves to null when the user cancels. */
async function captureRegion() {
  if (region.active()) return null;
  const context = foreground.read();           // before the selection overlay covers the screen
  windows.setPetState('capturing');            // the selection overlay carries its own instructions
  let picked;
  try {
    picked = await region.selectRegion({
      hideWindows: () => windows.hideForCapture(),
      restoreWindows: () => windows.restoreAfterCapture(),
      strings: { hint: t('regionHint'), ok: t('regionOk'), cancel: t('regionCancel'), long: t('regionLong') },
    });
  } catch (e) {
    windows.restoreAfterCapture();
    const hint = process.platform === 'darwin' && screenPermissionStatus() !== 'granted' ? t('screenPermission') : e.message;
    windows.setPetState('error', { message: t('captureFailed', { msg: hint }) });
    throw e;
  }
  if (!picked) { windows.setPetState('idle'); return null; }
  // The same box, but the user wants what is below it as well: hand the rectangle to longshot.js,
  // which watches it live while they scroll. See src/main/longshot.js for why it cannot reuse the
  // frozen picture the overlay was showing.
  if (picked.long) return captureLong(picked, context);
  return saveShot(picked.png, {
    width: picked.width,
    height: picked.height,
    displayLabel: picked.display && picked.display.label,
    region: true,
    context,
  });
}

/** A scrolling capture, from the rectangle the overlay handed over to a single tall picture. */
async function captureLong(picked, context) {
  windows.setPetState('processing', { message: t('longStarting') });
  let shot;
  try {
    shot = await longshot.start({
      display: picked.display,
      rect: picked.rect,
      strings: {
        starting: t('longStarting'), scroll: t('longScroll'), done: t('longDone'),
        cancel: t('longCancel'), full: t('longFull'), failed: t('longFailed'), tooFast: t('longTooFast'),
        needsAccess: t('longNeedsAccess'),
      },
    });
  } catch (e) {
    windows.setPetState('error', { message: t('captureFailed', { msg: e.message }) });
    return null;
  }
  if (!shot) { windows.setPetState('idle'); return null; }
  // Only a first screenful and nothing joined on to it is not a long shot; say so rather than file a
  // plain screenshot the user did not ask for.
  if (!shot.frames || shot.frames < 2) {
    windows.setPetState('error', { message: t('longNothing'), ms: 6000 });
    return null;
  }

  const now = new Date();
  const file = uniquePath(dayDir('screenshots'), `${timeStamp(now)}-long.png`);
  fs.writeFileSync(file, shot.png);
  const entry = store.addEntry({
    type: 'screenshot',
    title: t('longTitle', { time: fmtClock(now) }),
    path: store.relPath(file),
    mime: 'image/png',
    size: shot.png.length,
    width: shot.width,
    height: shot.height,
    region: true,
    longShot: true,
    displayLabel: picked.display && picked.display.label,
  });
  attachContext(entry, context);
  windows.setPetState('success', { message: t('longSaved', { h: shot.height }) });
  enqueue(entry.id);
  return entry;
}

/**
 * Adds who-said-what to a recording that already has its words.
 * @returns {Promise<object|null>} fields to merge into the entry, or null when it could not be done.
 */
async function runDiarization(id, pcm, chunks, langs, settings) {
  if (!diarize.ready()) {
    setProgress(id, t('diarizeDownloading', { pct: 0 }), true);
    const got = await diarize.ensureModels((p) => {
      if (p.stage === 'download') setProgress(id, t('diarizeDownloading', { pct: p.percent }));
    });
    if (!got) return null;
  }
  setProgress(id, t('diarizeRunning'), true);
  const dia = await diarize.run(pcm);
  diarize.release();
  if (!dia || !dia.segments.length) return null;

  // 说话人只按这一段录音里说得多少编号：说话人 1 / 2 / 3。没有名字，也不跨录音认人。
  const nameOf = (personId) => {
    const rank = dia.speakers.findIndex((x) => x.id === personId);
    return t('speakerN', { n: rank >= 0 ? rank + 1 : '?' });
  };
  const turns = attribute(chunks || [], dia.segments);
  const spoken = shares(turns);
  const speakers = dia.speakers.map((sp) => ({
    ...sp,
    seconds: (spoken.find((x) => x.speaker === sp.id) || {}).seconds || sp.seconds,
  }));
  // Only rewrite the transcript when the split actually says something: one speaker, or no timestamps
  // to place the words with, and the plain text is what it was.
  const useTurns = turns.length > 1 && speakers.length > 1 && turns.some((x) => x.speaker);
  return {
    speakers,
    speakerTurns: turns.map((x) => ({ speaker: x.speaker, start: x.start, end: x.end, text: x.text })),
    ...(useTurns ? { text: asLines(turns, nameOf) } : {}),
  };
}

// ---------- one copy, one record ----------
//
// The accident this exists to stop: a single copy reaches the clipboard in more than one shape, and
// each shape is filed as if it were a separate thing. A WeChat screenshot leaves a temporary file
// beside the bitmap and deletes the file seconds later, so the leftover bitmap looks new. The same
// hazard exists for text (as words and as a .txt file) and for links (copied, then bookmarked).
//
// Byte equality cannot see any of that -- the shapes are different encodings by definition -- so
// every copy is given an *identity* instead, and that identity is written onto the record. Being on
// the record rather than in memory means it survives a restart and covers a gap of minutes.
//
// The windows differ because the questions differ. A picture or a passage arriving twice within two
// minutes is one event seen twice; the same thing an hour later is a person asking for it again, and
// a log should record that. A link is not a moment but an identity: saving the same one twice in a
// day is an accident either way, which is the rule bookmarks already followed.
const COPY_WINDOW_MS = 2 * 60 * 1000;
const RECENT_TO_SCAN = 120;

/** Trailing spaces and CRLF are not a different passage. The stored text keeps its original bytes. */
function normalizeCopyText(text) {
  return String(text).normalize('NFC').replace(/\r\n?/g, '\n').split('\n')
    .map((l) => l.replace(/[ \t\u3000]+/g, ' ').trimEnd()).join('\n').trim();
}

function copyIdentity(kind, payload) {
  if (kind === 'pic') { const f = pictureId.fingerprint(payload); return f ? `pic:${f}` : ''; }
  if (kind === 'url') { const u = String(payload || '').trim().toLowerCase(); return u ? `url:${u}` : ''; }
  const t = normalizeCopyText(payload);
  return t ? `txt:${crypto.createHash('md5').update(t).digest('hex')}` : '';
}

/**
 * The record this copy would duplicate, if there is one.
 * @param {string} id from copyIdentity
 * @param {{withinMs?:number, today?:boolean}} scope
 */
function findCopy(id, { withinMs = COPY_WINDOW_MS, today = false } = {}) {
  if (!id) return null;
  const now = Date.now();
  const pool = today ? store.entriesForDate(localDateKey()) : store.listEntries({ limit: RECENT_TO_SCAN });
  for (const e of pool) {
    if (!e.copyId) continue;
    if (!today && now - Date.parse(e.createdAt) > withinMs) continue;
    if (e.copyId === id) return e;
    // a picture re-encoded is not byte-identical, so those compare by gradient (see picture-id.js)
    if (id.startsWith('pic:') && e.copyId.startsWith('pic:') && pictureId.alike(e.copyId.slice(4), id.slice(4))) return e;
  }
  return null;
}

async function ingestFiles(paths, { origin = '', quiet = false } = {}) {
  const added = [];
  let skippedDirs = 0;
  for (const src of paths || []) {
    let st;
    try { st = fs.statSync(src); } catch (_) { continue; }
    if (st.isDirectory()) { skippedDirs++; continue; }
    const { type, mime } = classify(src);
    let copyId = '';
    if (origin === 'clipboard' && type === 'image' && st.size <= MAX_COPY_BYTES) {
      let bytes = null;
      try { bytes = fs.readFileSync(src); } catch (_) { bytes = null; }
      copyId = bytes ? copyIdentity('pic', bytes) : '';
      if (findCopy(copyId)) { console.log('[clipboard] the same picture is already filed; skipping', path.basename(src)); continue; }
    }
    const name = safeName(path.basename(src));
    let stored;
    let linked = false;
    if (st.size <= MAX_COPY_BYTES) {
      stored = uniquePath(dayDir('files'), name);
      fs.copyFileSync(src, stored);
    } else {
      stored = src; linked = true; // too big to duplicate: keep a reference to the original
    }
    const entry = store.addEntry({
      type, mime, size: st.size, linked, copyId,
      title: name,
      path: linked ? stored : store.relPath(stored),
      originalPath: src,
      origin,
    });
    added.push(attachContext(entry));
    enqueue(entry.id);
  }
  if (added.length) { if (!quiet) windows.setPetState('success', { message: added.length > 1 ? t('savedN', { n: added.length }) : t('saved') }); }
  else if (skippedDirs) { if (!quiet) windows.setPetState('error', { message: t('skippedDir') }); }
  else if (!quiet) windows.setPetState('error', { message: t('nothingDropped') });
  return added;
}

async function ingestUrl(url, { origin = '', quiet = false } = {}) {
  const normalized = web.normalizeUrl(url);
  const copyId = copyIdentity('url', normalized);
  if (origin === 'clipboard') {
    // A bare link adds nothing to a link already saved today -- least of all to a bookmark, which
    // came with the page's text. The richer record stands.
    const twin = findCopy(copyId, { today: true });
    if (twin) { console.log('[clipboard] this link is already saved today; skipping'); return null; }
  }
  const entry = attachContext(store.addEntry({ type: 'url', title: normalized, url: normalized, mime: 'text/uri-list', origin, copyId }));
  if (!quiet) windows.setPetState('success', { message: t('saved') });
  enqueue(entry.id);
  return entry;
}

// A note's title is its first line, cut to fit -- at the last space or punctuation rather than at a
// fixed character, so the heading does not end on half a word ("你看看蛛丝") with the other half
// opening the body underneath it.
function noteTitle(line, max = 60) {
  const s = String(line || '').trim();
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  let cut = -1;
  for (let i = head.length - 1; i >= 24; i--) {
    if (/[\s,，。；;：:！!？?、)）]/.test(head[i])) { cut = i; break; }
  }
  return `${(cut > 0 ? head.slice(0, cut) : head).trim()}…`;
}

async function ingestNote(text, { origin = '', quiet = false } = {}) {
  const body = String(text || '').trim();
  if (!body) return null;
  const copyId = copyIdentity('txt', body);
  if (origin === 'clipboard' && findCopy(copyId)) { console.log('[clipboard] the same passage is already filed; skipping'); return null; }
  const firstLine = noteTitle(body.split('\n')[0]);
  const file = uniquePath(dayDir('files'), `${timeStamp()}-${origin === 'clipboard' ? 'clip' : 'note'}.txt`);
  fs.writeFileSync(file, body, 'utf8');
  const entry = attachContext(store.addEntry({ type: 'note', title: firstLine || t('noteTitle'), text: body, path: store.relPath(file), mime: 'text/plain', size: Buffer.byteLength(body), origin, copyId }));
  if (!quiet) windows.setPetState('success', { message: t('saved') });
  enqueue(entry.id);
  return entry;
}

// An image copied to the clipboard (PNG bytes from Electron's NativeImage).
async function ingestClipboardImage(png) {
  const copyId = copyIdentity('pic', png);
  const twin = findCopy(copyId);
  if (twin) { console.log('[clipboard] the same picture is already filed; skipping the bitmap'); return null; }
  const now = new Date();
  const file = uniquePath(dayDir('files'), `${timeStamp(now)}-clip.png`);
  fs.writeFileSync(file, png);
  let size = {};
  try { size = require('electron').nativeImage.createFromBuffer(png).getSize(); } catch (_) { /* ignore */ }
  const entry = store.addEntry({
    type: 'image', mime: 'image/png', size: png.length, width: size.width, height: size.height, copyId,
    title: t('clipImageTitle', { time: fmtClock(now) }),
    path: store.relPath(file),
    origin: 'clipboard',
  });
  attachContext(entry);
  enqueue(entry.id);
  return entry;
}

const MEDIA_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif', 'image/bmp': '.bmp',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov', 'video/x-matroska': '.mkv',
  'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/flac': '.flac', 'audio/wav': '.wav', 'audio/ogg': '.ogg',
  'application/vnd.apple.mpegurl': '.m3u8', 'application/dash+xml': '.mpd',
};

/**
 * One item handed over by the browser extension. `body` is `{file, size}` when the extension downloaded the
 * bytes for us, or null when only the URL is known (streams, videos the user chose not to download, errors).
 */
async function ingestBrowserMedia(meta, body) {
  const kind = meta.kind === 'stream' ? 'video' : meta.kind;
  const pageHost = (() => { try { return new URL(meta.pageUrl || meta.url).hostname.replace(/^www\./, ''); } catch (_) { return ''; } })();
  const base = safeName(meta.filename || (() => { try { return decodeURIComponent(new URL(meta.url).pathname.split('/').pop() || ''); } catch (_) { return ''; } })() || 'media');
  const ext = path.extname(base) || MEDIA_EXT[meta.mime] || (kind === 'image' ? '.jpg' : kind === 'video' ? '.mp4' : kind === 'audio' ? '.mp3' : '');
  const name = `${base.replace(/\.[^.]*$/, '')}${ext}`;

  const common = {
    url: meta.url,
    origin: 'browser',
    sourcePage: meta.pageUrl || '',
    sourceTitle: meta.pageTitle || '',
    mime: meta.mime || '',
    width: meta.width || undefined,
    height: meta.height || undefined,
    alt: meta.alt || '',
    error: meta.fetchError ? t('mediaFetchFailed', { msg: meta.fetchError }) : '',
  };

  if (body && body.file) {
    const stored = uniquePath(dayDir('files'), name);
    fs.renameSync(body.file, stored);
    const type = kind === 'image' ? 'image' : kind === 'video' ? 'video' : kind === 'audio' ? 'media' : 'file';
    const entry = store.addEntry({
      ...common,
      type,
      title: (meta.title || meta.alt || '').slice(0, 80) || name,
      path: store.relPath(stored),
      size: body.size,
    });
    enqueue(entry.id);
    return entry;
  }

  // A stream never arrives as bytes: the extension only ever had a playlist, and fetching that would
  // save a few kilobytes of text. If the user asked for the file, ffmpeg goes and assembles it here --
  // it follows the manifest, pulls every segment and muxes the separate picture and sound back together.
  if (meta.kind === 'stream' && meta.downloadVideos) {
    const entry = store.addEntry({
      ...common,
      type: 'video',
      title: (meta.title || meta.alt || '').slice(0, 80) || name,
      text: [meta.pageTitle, meta.url].filter(Boolean).join('\n'),
      mime: 'video/mp4',
      progress: t('streamQueued'),
    });
    downloadStream(entry.id, meta).catch((e) => {
      store.updateEntry(entry.id, { status: 'error', error: e.message || String(e), progress: '' });
    });
    return entry;
  }

  // no bytes: keep the address so it is searchable and can be fetched later
  const entry = store.addEntry({
    ...common,
    type: kind === 'image' ? 'image' : kind === 'video' ? 'video' : kind === 'audio' ? 'media' : 'url',
    title: (meta.title || meta.alt || '').slice(0, 80) || (meta.pageTitle ? `${meta.pageTitle} · ${name}` : name),
    linkOnly: true,
    text: [meta.pageTitle, meta.alt, meta.url].filter(Boolean).join('\n'),
    mime: meta.mime || 'text/uri-list',
  });
  enqueue(entry.id);
  return entry;
}

// Pulls a whole stream down with ffmpeg, then hands the finished file to the normal tagging queue.
// Runs outside the serial queue on purpose: a feature film is minutes of work and must not hold up the
// screenshot someone takes while it runs.
async function downloadStream(entryId, meta) {
  const ffmpeg = require('./ffmpeg');
  const stream = require('./stream');
  const found = await ffmpeg.find();
  if (!found) {
    store.updateEntry(entryId, {
      status: 'error', progress: '', linkOnly: true,
      error: t('streamNeedsFfmpeg'),
    });
    return;
  }
  const base = safeName((meta.title || 'video').slice(0, 60)) || 'video';
  const target = uniquePath(dayDir('files'), `${base}${stream.suggestExtension(meta.mime)}`);
  store.updateEntry(entryId, { progress: t('streamStarting') });

  let lastPct = -1;
  await stream.download(meta.url, target, {
    pageUrl: meta.pageUrl || '',
    onProgress: (p) => {
      if (p.percent === lastPct) return;
      lastPct = p.percent;
      store.updateEntry(entryId, { progress: t('streamProgress', { pct: p.percent }) });
    },
  });

  const size = (() => { try { return fs.statSync(target).size; } catch (_) { return 0; } })();
  if (!size) throw new Error(t('streamEmpty'));
  const info = await stream.probe(target).catch(() => null);
  store.updateEntry(entryId, {
    path: store.relPath(target),
    size,
    progress: '',
    linkOnly: false,
    width: info && info.width ? info.width : undefined,
    height: info && info.height ? info.height : undefined,
    durationSec: info && info.duration ? Math.round(info.duration) : undefined,
  });
  enqueue(entryId);
}

// A page the user bookmarked in the browser. The text arrives already extracted, because the tab is
// the only place it exists in readable form on the sites people actually bookmark.
// Returns null when the same URL was already saved today, so double-clicking a star does not double-save.
// A post's own address, not one of the pages hanging off it, and not the tracking it picked up on the
// way. x.com's "Views" counter links to /status/<id>/analytics -- a page only the author can open --
// and bookmarking a tweet from its own page used to save exactly that, a dead link for everyone else.
// The extension gets this right now (extension/extract.js); the same correction is repeated here so a
// copy of the extension that has not been reloaded yet still files something that opens.
//
// Only parameters known to be tracking come off. A query string is decoration on some sites and
// load-bearing on others: 小红书 links stop working without their xsec_token.
const POST_VIEW = /\/(analytics|photo\/\d+|video\/\d+|retweets|likes|quotes|history|hidden|comment)\/?$/;
const POST_PATH = /\/(status\/\d+|comments\/[a-z0-9]+|explore\/[a-z0-9]+|discovery\/item\/[a-z0-9]+|question\/\d+\/answer\/\d+|p\/\d+|video\/[A-Za-z0-9]+)/i;
const TRACKING = /^(utm_\w+|spm_id_from|vd_source|from_source|from_spmid|share_source|share_medium|share_plat|share_tag|share_session_id|unique_k|s|t|ref|ref_src|ref_url|refer|refer_flag|xhsshare|appuid|apptime|si|feature|pp)$/i;

function canonicalPostUrl(url) {
  let u;
  try { u = new URL(String(url || '')); } catch (_) { return String(url || ''); }
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.pathname = u.pathname.replace(/\/$/, '') || '/';
  const trimmed = u.pathname.replace(POST_VIEW, '');
  if (POST_PATH.test(trimmed)) u.pathname = trimmed;
  return u.href.replace(/\?$/, '');
}

async function ingestBookmark(page) {
  const url = canonicalPostUrl(String(page.url || '').trim());
  if (!/^https?:\/\//i.test(url)) throw new Error('bookmark needs an http(s) url');
  const today = store.entriesForDate(localDateKey());
  const already = today.find((e) => e.origin === 'bookmark' && e.url === url);
  if (already) {
    // Saying nothing here reads exactly like a broken feature: you click, and the app is silent.
    windows.setPetState('success', { message: t('bookmarkDuplicate', { title: (already.title || url).slice(0, 40) }), ms: 3000 });
    return null;
  }

  const title = String(page.title || '').trim().slice(0, 200);
  const text = String(page.text || '').trim();
  const body = [title, page.byline ? `— ${page.byline}` : '', page.excerpt || '', text, url]
    .filter(Boolean).join('\n\n').slice(0, 20000);

  // Keep the article next to the entry: the site may change it or take it down.
  const file = uniquePath(dayDir('files'), `${safeName(title || 'bookmark').slice(0, 60)}.txt`);
  let stored = '';
  try { fs.writeFileSync(file, body, 'utf8'); stored = store.relPath(file); } catch (_) { /* keep the entry anyway */ }

  const entry = store.addEntry({
    type: 'url',
    origin: 'bookmark',
    url,
    copyId: copyIdentity('url', web.normalizeUrl(url)),   // so copying the same link later is not a second record
    title: title || url,
    text: body,
    path: stored,
    mime: 'text/plain',
    size: Buffer.byteLength(body),
    sourceTitle: title,
    sourcePage: url,
    byline: page.byline || '',
    savedBy: page.why || '',
  });
  enqueue(entry.id);
  windows.setPetState('success', { message: t('bookmarkSaved', { title: (title || url).slice(0, 40) }), ms: 3000 });
  return entry;
}

// True when this exact text already lives in the workspace (e.g. the user copied it out of an entry).
function hasText(text) {
  const needle = String(text).trim();
  if (!needle) return false;
  return store.listEntries({ limit: 300 }).some((e) => e.text && e.text.trim() === needle);
}

// Called with whatever was dropped on the character: file paths, URLs and/or plain text.
async function ingestDrop({ paths = [], urls = [], text = '' } = {}, opts = {}) {
  const out = [];
  if (paths.length) out.push(...await ingestFiles(paths, opts));
  for (const u of urls) if (web.isUrl(u)) out.push(await ingestUrl(u, opts));
  if (!paths.length && !urls.length && text) {
    if (web.isUrl(text)) out.push(await ingestUrl(text, opts));
    else { const e = await ingestNote(text, opts); if (e) out.push(e); }
  }
  if (!out.length && !paths.length && !opts.quiet) windows.setPetState('error', { message: t('nothingDropped') });
  return out;
}

const SILENCE_PEAK = 0.004;

async function ingestAudio({ webm, pcm, sampleRate = 16000, durationSec = 0, peak, mic = '', auto = false, because = '' }) {
  if (pcm && !(pcm instanceof Float32Array)) {
    // Int16 samples from the renderer (or any array-like of 16-bit values)
    const src = pcm; pcm = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) pcm[i] = src[i] / 32768;
  }
  if (!pcm || pcm.length < sampleRate * 0.7) {
    if (!auto) windows.setPetState('error', { message: t('recordingTooShort') });
    return null;
  }
  const now = new Date();
  const dir = dayDir('audio');
  const stamp = timeStamp(now);
  const wavFile = uniquePath(dir, `${stamp}.wav`);
  writeWav(wavFile, pcm, sampleRate);
  let webmRel = '';
  if (webm && webm.length) {
    const webmFile = uniquePath(dir, `${stamp}.webm`);
    fs.writeFileSync(webmFile, Buffer.from(webm.buffer || webm, webm.byteOffset || 0, webm.byteLength));
    webmRel = store.relPath(webmFile);
  }
  const entry = store.addEntry({
    type: 'audio',
    title: t('voiceTitle', { time: fmtClock(now) }),
    path: webmRel || store.relPath(wavFile),
    wavPath: store.relPath(wavFile),
    mime: webmRel ? 'audio/webm' : 'audio/wav',
    size: pcm.length * 2,
    durationSec: Math.round(durationSec || pcm.length / sampleRate),
    mic,
    auto,
    // 哪个应用开着麦克风，才让这段被录下来。自动录音是唯一不用你动手的功能，它录了什么、为什么录，
    // 事后必须查得出来。缺了这一条，「微信输入法把我口述的每句话都录了」只能靠时间戳去猜。
    because,
  });
  attachContext(entry);                        // what was on screen while this was dictated
  // A silent capture (wrong microphone selected in the OS) is reported instead of transcribed.
  let measuredPeak = typeof peak === 'number' ? peak : 0;
  if (typeof peak !== 'number') for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]); if (a > measuredPeak) measuredPeak = a; }
  if (measuredPeak < SILENCE_PEAK) {
    const msg = t('silentRecording', { mic: mic || 'default' });
    store.updateEntry(entry.id, { status: 'error', error: msg, peak: measuredPeak });
    if (!auto) windows.setPetState('error', { message: msg, ms: 9000 });
    return entry;
  }
  store.updateEntry(entry.id, { peak: Math.round(measuredPeak * 1000) / 1000 });
  pcmCache.set(entry.id, pcm);
  // Automatic recordings say nothing at all -- they happen by themselves, possibly several times an
  // hour, and a balloon for each would be the clipboard mistake over again. See the note there.
  if (!auto) windows.setPetState('success');       // 录完就是录完了，转写在后台跑
  enqueue(entry.id);
  return entry;
}

// ---------- processing queue ----------
function enqueue(id) {
  if (!queue.includes(id)) queue.push(id);
  pump();
}
// Saving something must stay cheap. Everything the everyday flow needs is local and quick -- OCR
// reads a screenshot in about half a second, the classifier names a picture in about the same, and
// what a picture is comes from whichever of them found something. A language model adds one title and
// one sentence on top of that, and measured here a 9B takes 21 seconds to write them even when it is
// handed nothing but eight words. That is what makes the fan run, so it is not part of saving any
// more: it happens when someone asks for it, by retrying an entry.
const askedForAi = new Set();

function retry(id, { withAi = true } = {}) {
  const e = store.getEntry(id);
  if (!e) return false;
  if (withAi) askedForAi.add(id); else askedForAi.delete(id);
  store.updateEntry(id, { status: 'processing', error: '', progress: '' });
  enqueue(id);
  return true;
}
function pump() {
  if (running) return;
  const id = queue.shift();
  if (!id) return;
  running = true;
  processEntry(id)
    .catch((e) => console.error('[workspace] processing failed', e))
    .finally(() => { running = false; if (queue.length) pump(); });
}

let lastProgressAt = 0;
// Progress belongs on the entry, not in the character's mouth. Reading text, downloading a model, transcribing,
// picking words -- none of it is news, it is the machine narrating itself, and it was doing so several
// times a second. The workspace card shows every step; the balloon is kept for what was actually saved.
// The pet still changes to its processing state, so it looks busy without saying anything.
function setProgress(id, text, force = false) {
  const now = Date.now();
  if (!force && now - lastProgressAt < 400) return;
  lastProgressAt = now;
  store.updateEntry(id, { progress: text });
  // 不再把进度写到脸上。这是后台的活（OCR、起标题），东西早就存下了；
  // 让它一直顶着三个点，等于把后处理的时间算进了「存东西」这个动作里。
  // 进度还是照写进这条记录，工作区那边看得到。
}

// 一条记录处理完、又没什么可报的，就把脸放回待机。
// （以前是「队列里还有就继续处理中」——那正是把后台的时间挂在脸上。）
function announceQueue() {
  if (windows.getState() !== 'recording') windows.setPetState('idle');
}


// OCR runs on a dedicated recognition engine (PP-OCR / tesseract); no language model is involved.
function ocrConfig(s, langs) {
  // s.ocrModel === '' means "let the app decide": the hardware probe proposes a size, the language pair
  // can override it, and a model that turns out to be too slow here is dropped a size (see checkOcrSpeed).
  return {
    model: s.ocrModel || '',
    preferred: s.ocrModelAuto || hardware.ocrModel().model,
    languages: langs,
    cacheDir: store.paths().ocrModels,
  };
}

// If the automatically chosen model is consistently slow on this machine, step down and remember it.
function checkOcrSpeed() {
  const s = store.getSettings();
  if (s.ocrModel) return;                                   // the user picked a model explicitly
  const slow = ocr.tooSlow();
  const fallback = ocr.DEFAULT_PADDLE_MODEL;               // the smallest bundled set
  if (!slow || slow.model === fallback) return;
  // only step down when the smaller model still covers the configured languages
  if (ocr.modelForLanguages(s.languages, fallback) !== fallback) return;
  console.log(`[ocr] ${slow.model} takes ${slow.median} ms per image here; switching to ${fallback}`);
  ocr.forgetRuns();
  store.updateSettings({ ocrModelAuto: fallback });
  // A step's consequence, not news: it is in the log and in Settings › this machine.
  console.log(`[ocr] ${slow.model} was too slow here; using ${fallback} from now on`);
}
function ocrProgress(id) {
  return (p) => {
    if (p.stage === 'download') setProgress(id, t('ocrDownloading', { pct: p.percent, part: p.part, parts: p.parts }));
    else if (p.stage === 'load') setProgress(id, t('ocrLoading'), true);
    else setProgress(id, `${t('ocrRunning')}${p.percent ? ` ${p.percent}%` : ''}`);
  };
}

// What a picture is, when it has no words of its own.
//
// There used to be a "three words" for every record here, pulled out of its own text by TF-IDF and a
// semantic re-rank. Measured over this workspace it earned nothing: 209 of 220 of those words already
// appeared verbatim in the text that search covers anyway, so they widened no search; a quarter were
// fragments or function words ("comes", "right side", 擎天 cut out of 擎天柱); and the same text saved
// twice produced two different sets. The eleven words that did reach past the text were almost all the
// classifier's, on pictures with no text at all -- which is the one case where a description is the
// only handle a record has. That case is what is left.
function describeEntry(entry, text) {
  const filename = entry.path ? path.basename(entry.path) : '';
  const seen = !ocr.hasWords(text) && entry.visionLabels ? String(entry.visionLabels).trim() : '';
  return { seen, title: entry.title || filename, summary: '', source: seen ? 'vision' : 'local' };
}

async function processEntry(id) {
  const entry = store.getEntry(id);
  if (!entry) return;
  store.updateEntry(id, { status: 'processing', error: '' });
  const s = store.getSettings();
  const langs = s.languages;
  const aiCfg = llm.config(store);
  const wantsAi = askedForAi.delete(id);   // set only by retry(); saving never asks
  const configured = llm.isConfigured(aiCfg);
  const abs = entry.path ? store.absPath(entry.path) : '';
  const filename = entry.path ? path.basename(entry.path) : '';
  let text = entry.text || '';
  let visionText = '';   // words for a picture that has none of its own
  let aiInput = null;
  const patch = {};

  try {
    switch (entry.type) {
      case 'screenshot':
      case 'image': {
        if (entry.linkOnly || !abs) { // an image we only know the address of
          aiInput = { kind: 'text', text: entry.text || '', url: entry.url, filename,
            context: [entry.sourceTitle ? `Found on the page: ${entry.sourceTitle}` : '', entry.alt ? `Image description: ${entry.alt}` : ''].filter(Boolean).join('\n') };
          break;
        }
        if (entry.type === 'screenshot' || s.ocrDroppedImages) {
          setProgress(id, t('ocrRunning'), true);
          const r = await ocr.recognize(abs, ocrConfig(s, langs), ocrProgress(id));
          text = r.text;
          patch.text = text;
          patch.ocrModel = r.model;
          store.updateEntry(id, { ocrModel: r.model, ocrMs: r.ms });
          checkOcrSpeed();
          store.updateEntry(id, { text });
          // The same pass already worked out where every line is; keeping it costs one small file.
          const boxes = ocrBoxes.save(entry, r.lines, { width: entry.width, height: entry.height });
          if (boxes) { patch.ocrBoxes = boxes; store.updateEntry(id, { ocrBoxes: boxes }); }
        }
        // The picture itself is never sent to a language model. When OCR came back with text, that
        // text is the description -- a model looking at a screenshot of words we already hold as
        // words costs seconds and gigabytes and tells us nothing new. Only a picture with no words
        // in it poses a real question, and macOS answers that one locally in about 0.4 s.
        if (!ocr.hasWords(text)) {
          setProgress(id, t('visionRunning'), true);
          const seen = await vision.describe(abs, { ui: uiLanguage(langs) });
          visionText = seen.text;
          if (visionText) {
            patch.visionLabels = visionText;
            patch.visionIds = seen.ids.join(',');      // the untranslated names, for a later language change
            store.updateEntry(id, { visionLabels: visionText, visionIds: patch.visionIds });
          }
        }
        aiInput = {
          kind: 'image', imageMime: entry.mime, text, labels: visionText,
          context: [
            entry.type === 'screenshot' ? `Screenshot of the user's screen taken at ${entry.createdAt}.` : '',
            entry.sourceTitle ? `Saved from the web page: ${entry.sourceTitle}` : '',
            entry.alt ? `Image description on that page: ${entry.alt}` : '',
          ].filter(Boolean).join('\n') || undefined,
          filename: entry.type === 'image' ? filename : undefined,
          url: entry.url,
        };
        break;
      }
      case 'audio': {
        const wav = store.absPath(entry.wavPath || entry.path);
        const pcm = pcmCache.get(id) || readWav(wav);
        pcmCache.delete(id);
        setProgress(id, t('sttLoading'), true);
        // 'auto' → detect among all Whisper languages; 'packs' → only the two configured language packs; else forced
        const mode = s.sttLanguage || 'auto';
        const language = mode === 'auto' || mode === 'packs' ? null : whisperLang(mode);
        const candidates = mode === 'auto' ? 'all' : langs.map(whisperLang).filter(Boolean);
        // The bundled checkpoint is English-only, and an English-only Whisper does not fail on Chinese --
        // it invents English. So the language packs pick the model, and the bigger one is fetched once.
        const pick = stt.modelForLanguages(langs, s.sttModel);
        if (pick.upgraded) {
          store.updateSettings({ sttModel: pick.model });
          setProgress(id, t('sttUpgrading'), true);
        }
        // Out of process: a checkpoint this machine cannot run aborts inside onnxruntime and would
        // otherwise take the whole app -- and the recording -- down with it.
        // Timestamps cost extra decoding, so they are only asked for when somebody is going to line
        // the words up against voices.
        const wantSpeakers = s.diarize === true;
        const result = await sttRun.transcribe(pcm,
          { model: pick.model, cacheDir: store.paths().models, mirror: s.hfMirror, language, candidates, timestamps: wantSpeakers },
          (stage, p) => {
            if (stage === 'download') setProgress(id, t('sttDownloading', { pct: Math.round(p * 100) }));
            else if (stage === 'transcribe') setProgress(id, t('sttTranscribing'), true);
          },
          {
            onCrash: (bad, next) => {
              console.warn(`[stt] ${bad} crashed on this machine; falling back to ${next}`);
              store.updateSettings({ sttModel: next });
              setProgress(id, t('sttFellBack', { bad: bad.split('/').pop(), next: next.split('/').pop() }), true);
            },
          });
        text = result.language === 'zh' && s.normalizeChineseScript !== false ? normalizeChineseScript(result.text, langs) : result.text;
        patch.text = text;
        store.updateEntry(id, { text, sttLanguage: result.language || '', sttModel: result.model || pick.model });

        // Who was speaking. Runs after the words, on the same audio, and only changes how the
        // transcript reads -- if any part of it fails the recording keeps the plain text it already has.
        if (wantSpeakers) {
          try {
            const dia = await runDiarization(id, pcm, result.chunks, langs, s);
            if (dia) { Object.assign(patch, dia); store.updateEntry(id, dia); text = dia.text || text; }
          } catch (e) {
            console.warn('[diarize] skipped:', e.message);
          }
        }
        aiInput = { kind: 'text', text, context: `Voice note recorded at ${entry.createdAt}, ${entry.durationSec || '?'} seconds, automatically transcribed.` };
        break;
      }
      case 'pdf': {
        setProgress(id, t('pdfReading'), true);
        try {
          const r = await extractPdfText(abs);
          text = r.text;
          patch.text = text;
          store.updateEntry(id, { text, pages: r.pages });
        } catch (e) {
          console.warn('[workspace] pdf text extraction failed:', e.message);
        }
        aiInput = { kind: 'pdf', pdf: abs, pdfText: text, filename };
        break;
      }
      case 'text': {
        text = fs.readFileSync(abs, 'utf8').slice(0, 200000);
        patch.text = text;
        store.updateEntry(id, { text });
        aiInput = { kind: 'text', text, filename };
        break;
      }
      case 'url': {
        // A bookmark already has its text: the tab read it while logged in. Re-fetching the address
        // from here would get the login shell instead and overwrite the real thing with nothing.
        if (entry.origin === 'bookmark' && (entry.text || '').trim()) {
          aiInput = { kind: 'text', text: entry.text, url: entry.url, filename,
            context: entry.byline ? `Author: ${entry.byline}` : '' };
          break;
        }
        setProgress(id, t('fetching'), true);
        const r = await web.fetchUrl(entry.url);
        if (r.kind === 'pdf') {
          const file = uniquePath(dayDir('files'), safeName(r.title || 'download.pdf').replace(/(\.pdf)?$/i, '.pdf'));
          fs.writeFileSync(file, r.pdf);
          store.updateEntry(id, { path: store.relPath(file), mime: 'application/pdf', size: r.pdf.length, type: 'pdf' });
          try {
            const p = await extractPdfText(r.pdf);
            text = p.text; patch.text = text;
            store.updateEntry(id, { text, pages: p.pages });
          } catch (e) { console.warn('[workspace] pdf text extraction failed:', e.message); }
          aiInput = { kind: 'pdf', pdf: r.pdf, pdfText: text, url: entry.url };
        } else if (r.kind === 'image') {
          // an image dragged out of a browser: store it like a dropped image (OCR + vision tagging)
          const extByMime = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/bmp': '.bmp' };
          const ext = extByMime[r.mime] || path.extname(r.title) || '.img';
          const file = uniquePath(dayDir('files'), safeName(r.title || `image${ext}`).replace(/\.[^.]*$/, '') + ext);
          fs.writeFileSync(file, r.image);
          store.updateEntry(id, { type: 'image', path: store.relPath(file), mime: r.mime, size: r.image.length, title: r.title || entry.title });
          if (s.ocrDroppedImages && extByMime[r.mime]) {
            setProgress(id, t('ocrRunning'), true);
            const r2 = await ocr.recognize(file, ocrConfig(s, langs), ocrProgress(id));
            text = r2.text;
            patch.text = text;
            store.updateEntry(id, { ocrModel: r2.model, ocrMs: r2.ms });
            checkOcrSpeed();
            store.updateEntry(id, { text });
          }
          if (!ocr.hasWords(text)) {
            setProgress(id, t('visionRunning'), true);
            const seenWeb = await vision.describe(file, { ui: uiLanguage(langs) });
            visionText = seenWeb.text;
            if (visionText) { patch.visionLabels = visionText; patch.visionIds = seenWeb.ids.join(','); }
          }
          aiInput = { kind: 'image', imageMime: r.mime, text, labels: visionText, url: entry.url, filename: r.title };
        } else {
          text = r.text || '';
          patch.text = text;
          store.updateEntry(id, { text, title: r.title && r.title !== entry.url ? r.title : entry.title });
          aiInput = { kind: 'text', text, url: entry.url, context: r.title ? `Page title: ${r.title}` : undefined };
        }
        break;
      }
      case 'note':
        aiInput = { kind: 'text', text: entry.text };
        break;
      case 'video':
      case 'media':
        // no local analysis for audio/video files yet: tag from the page context and the file name
        aiInput = { kind: 'text', text: entry.text || '', filename, url: entry.url,
          context: [entry.sourceTitle ? `Found on the page: ${entry.sourceTitle}` : '', entry.alt ? `Description: ${entry.alt}` : '', `Media type: ${entry.mime || 'video/audio'}`].filter(Boolean).join('\n') };
        break;
      default:
        aiInput = { kind: 'meta', filename, context: `File type: ${entry.mime || path.extname(filename) || 'unknown'}, size ${entry.size} bytes.` };
    }

    let result;
    let warning = '';
    if (wantsAi && configured) {
      setProgress(id, t('tagging'), true);
      try {
        const written = await llm.describe(aiCfg, aiInput);
        // The words stay local; the model only supplies the title and the one-line summary.
        result = { ...describeEntry({ ...entry, ...patch }, text), title: written.title, summary: written.summary, model: written.model, source: aiCfg.provider };
      } catch (e) {
        console.warn(`[workspace] describing via ${aiCfg.provider} failed:`, e.message);
        warning = e.message;
        result = describeEntry({ ...entry, ...patch }, text);
      }
    } else {
      result = describeEntry({ ...entry, ...patch }, text);
      // Only worth saying when the model was actually wanted; during ordinary saving nothing is missing.
      if (wantsAi && !configured) warning = t('noProvider');
    }
    const current = store.getEntry(id) || entry;
    const keepTitle = current.type === 'screenshot' || current.type === 'audio' || current.type === 'note';
    store.updateEntry(id, {
      title: result.title && !keepTitle ? result.title : (current.title || result.title),
      aiTitle: result.title || '',
      summary: result.summary || '',
      tagsSource: result.source,
      model: result.model || '',
      status: 'done',
      progress: '',
      error: warning,
    });
    // The one thing worth saying out loud: what was actually recorded. The title says what it is, the
    // Everything that happened in between stayed quiet.
    //
    // Except for a clipboard copy, which says nothing at all. Copying is something you do dozens of
    // times an hour without meaning to file anything, and a balloon for each one turns the pet into a
    // nuisance. Those records are still saved, and the shelf under the pet is where they show up.
    if (current.origin === 'clipboard' || current.auto) { announceQueue(); return; }
    const heading = (result.title || '').trim().slice(0, 34);
    const message = heading ? t('recorded', { title: heading }) : t('tagsDone');
    windows.setPetState('success', { message, sticky: false });
  } catch (e) {
    console.error('[workspace] entry failed', id, e);
    store.updateEntry(id, { status: 'error', error: e.message || String(e), progress: '' });
    windows.setPetState('error', { message: t('error', { msg: e.message || e }) });
  }
}

function pending() { return queue.length + (running ? 1 : 0); }

/**
 * Rewrite the words on every picture the classifier named, in the language the app now speaks.
 *
 * The identifiers it answered with are kept alongside the words (visionIds), so this is a lookup, not
 * a second look at the picture -- no file is opened and nothing is reprocessed. Records saved before
 * that field existed still work: the words were stored as the identifiers themselves, so they map
 * back one to one.
 * @returns {number} how many records changed
 */
function relabelVision(ui) {
  let n = 0;
  for (const key of store.listDates()) {
    for (const e of store.loadDay(key)) {
      if (e.tagsSource !== 'vision' || !(e.visionIds || e.visionLabels)) continue;
      const ids = (e.visionIds || e.visionLabels).split(',').map((x) => x.trim().replace(/ /g, '_')).filter(Boolean);
      if (!ids.length) continue;
      const text = ids.map((id) => visionLabel(id, ui)).join(', ');
      if (text === e.visionLabels && e.visionIds) continue;
      store.updateEntry(e.id, { visionIds: ids.join(','), visionLabels: text });
      n++;
    }
  }
  if (n) console.log(`[vision] relabelled ${n} record(s) in ${ui}`);
  return n;
}

module.exports = { init, relabelVision, captureScreenshot, captureRegion, ingestFiles, ingestUrl, ingestNote, ingestDrop, ingestAudio, ingestClipboardImage, ingestBrowserMedia, ingestBookmark, hasText, retry, pending, readWav };
