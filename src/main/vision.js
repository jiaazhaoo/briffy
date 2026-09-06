'use strict';
// Naming what is in a picture, for the pictures OCR found no words in.
//
// The rule this file serves: an image is never handed to a language model. OCR runs first, and when
// it returns text, that text *is* the description -- asking a vision model to look at a screenshot of
// words we already hold as words costs seconds and gigabytes and adds nothing. Only when OCR comes
// back empty is there a real question ("what is this a picture of?"), and even then the answer comes
// from macOS's own classifier: no download, no resident memory, about 0.4 s.
//
// Reached through osascript because Vision is Objective-C only and this app ships no native module.
// The script cannot live beside this file: once packaged the app is an asar archive, and osascript,
// an outside process, cannot read a path inside it. So it is written to a temp file on first use.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { label } = require('./vision-labels');

// Two filters, because each catches what the other misses.
//
// Apple's calibration (hasMinimumRecall:forPrecision:) is the documented way to ask the classifier
// for its defensible answers rather than merely its highest-scoring ones -- but it is per-class, so a
// class the model almost never predicts can clear the bar on a confidence of 0.008. That is how a
// blue cartoon paperclip came back as "food, animal". A flat confidence floor catches exactly those:
// measured over a set of photographs, real labels land between 0.38 and 0.95 while the junk sits at
// 0.13 and below, so the two populations are cleanly separated and 0.15 sits in the gap.
const MIN_RECALL = 0.3;
const MIN_PRECISION = 0.7;
const MIN_CONF = 0.15;
const MAX_LABELS = 8;
const TIMEOUT_MS = 10000;

const JXA = `
ObjC.import('Vision'); ObjC.import('Foundation');
function run(argv) {
  var url = $.NSURL.fileURLWithPath($(argv[0]));
  var handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $());
  var cls = $.VNClassifyImageRequest.alloc.init;
  var faces = $.VNDetectFaceRectanglesRequest.alloc.init;
  var err = Ref();
  if (!handler.performRequestsError($([cls, faces]), err)) {
    return JSON.stringify({ error: 'vision request failed' });
  }
  var labels = [];
  var res = cls.results;
  if (res) {
    for (var i = 0; i < res.count; i++) {
      var o = res.objectAtIndex(i);
      if (o.hasMinimumRecallForPrecision(${MIN_RECALL}, ${MIN_PRECISION})) {
        labels.push({ label: ObjC.unwrap(o.identifier), conf: Math.round(o.confidence * 1000) / 1000 });
      }
    }
  }
  var nFaces = 0;
  if (faces.results) nFaces = parseInt(faces.results.count, 10) || 0;
  return JSON.stringify({ labels: labels, faces: nFaces });
}
`;

// Vision answers with a hierarchy, and every level of it carries the same confidence: a dog arrives
// as "animal, canine, dog, mammal". Nothing in the observation marks which of the four is the
// specific one, so the supercategories move to the back rather than being dropped -- when a broad
// word is all there is, "animal" still beats nothing.
const BROAD = new Set([
  'animal', 'mammal', 'canine', 'feline', 'bird', 'reptile', 'fish', 'insect', 'plant',
  'material', 'structure', 'object', 'conveyance', 'equipment', 'machine', 'people', 'person',
  'adult', 'outdoor', 'indoor', 'nature', 'abstract', 'art',
]);

/** Confidence floor, then supercategories last. Pure; exported for the tests. */
function pick(labels, minConf = MIN_CONF) {
  const clean = (labels || [])
    .filter((l) => l && Number(l.conf) >= minConf)
    .map((l) => ({ conf: Number(l.conf), label: String(l.label || '').replace(/_/g, ' ').trim() }))
    .filter((l) => l.label);
  const key = (l) => l.label.replace(/ /g, '_');
  return [...clean.filter((l) => !BROAD.has(key(l))), ...clean.filter((l) => BROAD.has(key(l)))]
    .slice(0, MAX_LABELS);
}

// ---------- the fallback, for pictures Vision cannot name ----------
// A classifier trained on photographs has nothing to say about a flat blue cartoon, and says it by
// returning nothing. Rather than leave the entry with no words at all, describe the two things about
// a picture that are true without recognising anything in it: whether it is a photograph or a drawn
// image, and its dominant colour.

const HUES = [
  [15, 'red'], [45, 'orange'], [70, 'yellow'], [160, 'green'],
  [200, 'teal'], [255, 'blue'], [290, 'purple'], [335, 'pink'], [360, 'red'],
];

function colourName(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const v = max / 255, s = max === 0 ? 0 : (max - min) / max;
  if (v < 0.18) return 'black';
  if (s < 0.12) return v > 0.85 ? 'white' : 'grey';
  let h;
  if (max === min) h = 0;
  else if (max === r) h = (60 * (g - b) / (max - min) + 360) % 360;
  else if (max === g) h = 60 * (b - r) / (max - min) + 120;
  else h = 60 * (r - g) / (max - min) + 240;
  if (h >= 15 && h < 45 && v < 0.6) return 'brown';
  return (HUES.find(([edge]) => h < edge) || HUES[HUES.length - 1])[1];
}

/**
 * Two statistics over a small BGRA thumbnail. `flatness` is the share of neighbouring pixel pairs
 * that quantise to the same colour: drawn images are built from flat regions and score high (0.77 to
 * 0.84 measured on icons and app windows), photographs are noisy and score low (0.16 to 0.35).
 * Pure; exported for the tests.
 * @param {Buffer|Uint8Array} bgra raw BGRA pixels
 */
function shape(bgra, w, h) {
  const at = (i) => [bgra[i * 4 + 2] >> 3, bgra[i * 4 + 1] >> 3, bgra[i * 4] >> 3];
  const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  let pairs = 0, alike = 0;
  const bins = new Map();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, q = at(i);
      const k = (q[0] << 10) | (q[1] << 5) | q[2];
      bins.set(k, (bins.get(k) || 0) + 1);
      if (x + 1 < w) { pairs++; if (same(q, at(i + 1))) alike++; }
      if (y + 1 < h) { pairs++; if (same(q, at(i + w))) alike++; }
    }
  }
  // Area alone names the backdrop, not the subject: the app's own icon is a blue paperclip on a
  // peach field, and the honest-looking answer "orange" describes the part nobody was looking at.
  // Tallying by colour *name* rather than by exact value keeps a shaded subject in one bucket -- the
  // paperclip's gradient splits into a dozen quantised bins, none of them large -- and then weighting
  // each bucket's share by how colourful it is picks the thing out of the ground it sits on. A
  // picture that really is grey has nothing colourful to find, so the largest area names it.
  const tally = new Map();
  for (const [k, n] of bins) {
    const rgb = [((k >> 10) & 31) << 3, ((k >> 5) & 31) << 3, (k & 31) << 3];
    const name = colourName(...rgb);
    const acc = tally.get(name) || { n: 0, r: 0, g: 0, b: 0 };
    acc.n += n; acc.r += rgb[0] * n; acc.g += rgb[1] * n; acc.b += rgb[2] * n;
    tally.set(name, acc);
  }
  const total = w * h || 1;
  const ranked = [...tally.entries()]
    .map(([name, a]) => {
      const mx = Math.max(a.r, a.g, a.b) / a.n, mn = Math.min(a.r, a.g, a.b) / a.n;
      return { name, share: a.n / total, score: (a.n / total) * (mx === 0 ? 0 : (mx - mn) / mx) };
    })
    .sort((x, y) => y.score - x.score);
  // A two-tone graphic is a coin flip between its two colours -- the icon here is 67% peach and 29%
  // blue, and a hair's difference in the averages decides it. Naming both is both steadier and a
  // fairer account of the picture than picking one of them by a hair.
  let colours = ranked.filter((c) => c.share >= 0.15).slice(0, 2).map((c) => c.name);
  if (!colours.length) {
    const widest = [...tally.entries()].sort((x, y) => y[1].n - x[1].n)[0];
    colours = widest ? [widest[0]] : ['grey'];
  }
  const flatness = pairs ? alike / pairs : 0;
  return { flatness, colour: colours[0], colours, form: flatness > 0.6 ? 'illustration' : 'photo' };
}

function thumbnail(imagePath) {
  try {
    // eslint-disable-next-line global-require
    const { nativeImage } = require('electron');
    const img = nativeImage.createFromPath(imagePath);
    if (!img || img.isEmpty()) return null;
    const small = img.resize({ width: 64, height: 64, quality: 'good' });
    const size = small.getSize();
    return { bgra: small.toBitmap(), w: size.width, h: size.height };
  } catch (e) {
    return null; // outside Electron, or an image Chromium cannot decode
  }
}

// ---------- driving Vision ----------
let scriptPath = '';
let supported;

function usable() {
  if (supported === undefined) supported = process.platform === 'darwin';
  return supported;
}

function ensureScript() {
  if (scriptPath && fs.existsSync(scriptPath)) return scriptPath;
  const file = path.join(os.tmpdir(), `briffy-vision-${process.pid}.js`);
  fs.writeFileSync(file, JXA, 'utf8');
  scriptPath = file;
  return file;
}

function classify(imagePath) {
  return new Promise((resolve) => {
    let script;
    try { script = ensureScript(); } catch (e) { resolve({ labels: [], faces: 0, error: e.message }); return; }
    execFile('osascript', ['-l', 'JavaScript', script, imagePath], { timeout: TIMEOUT_MS },
      (err, stdout) => {
        if (err) { resolve({ labels: [], faces: 0, error: err.message }); return; }
        try {
          const r = JSON.parse(String(stdout).trim());
          resolve({ labels: r.labels || [], faces: r.faces || 0, error: r.error || '' });
        } catch (e) {
          resolve({ labels: [], faces: 0, error: `unreadable output: ${String(stdout).slice(0, 80)}` });
        }
      });
  });
}

/**
 * Name what is in a picture, in the language the app is set to.
 *
 * These words are all a wordless picture has, so unlike OCR text or a transcript -- which are the
 * user's own content and stay as captured -- they are the app's description and follow the app's
 * language, like every other label it writes. The classifier only speaks English identifiers, so
 * vision-labels.js carries the translation; anything it has no word for stays as it came.
 *
 * Never throws: an unsupported platform, a missing binary and an image nothing recognises all arrive
 * the same way -- as words the caller can use or an empty list.
 * @param {string} imagePath absolute path to the image
 * @param {{ui?:string}} [opts] `ui` is 'zh' or 'en'
 * @returns {Promise<{words:string[], text:string, ids:string[], faces:number, kind:string, error:string}>}
 *   `words` run most specific first and are ready to show; `ids` are the untranslated identifiers, so
 *   the same picture can be renamed into another language later without looking at it again.
 */
async function describe(imagePath, { ui = 'en' } = {}) {
  const say = (ids, kind, faces, error) => ({
    words: ids.map((id) => label(id, ui)), text: ids.map((id) => label(id, ui)).join(', '),
    ids, faces, kind, error: error || '',
  });
  if (!usable()) return say([], '', 0, 'not macOS');
  const r = await classify(imagePath);
  const ids = pick(r.labels).map((l) => l.label.replace(/ /g, '_'));
  if (r.faces > 0 && !ids.some((w) => /^(people|person)$/.test(w))) {
    ids.unshift(r.faces === 1 ? 'person' : 'people');
  }
  if (ids.length) return say(ids, 'photo', r.faces, r.error);

  const thumb = thumbnail(imagePath);
  if (!thumb) return say([], '', r.faces, r.error);
  const s = shape(thumb.bgra, thumb.w, thumb.h);
  return say([s.form, ...s.colours], 'graphic', r.faces, r.error);
}

module.exports = {
  available: usable, describe, pick, shape, colourName,
  BROAD, MIN_CONF, MIN_RECALL, MIN_PRECISION,
};
