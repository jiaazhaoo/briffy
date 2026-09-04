'use strict';
// Turns the raw draws in assets/pet/raw into desktop-pet frames with real alpha.
//
//   node scripts/pet-cutout.js                    every raw png
//   node scripts/pet-cutout.js --only idle,blink
//   node scripts/pet-cutout.js --tolerance 70     widen the key-colour match
//
// Keying is a flood fill inward from the four edges, so a patch of the key colour
// enclosed by the body (between an ear and the head, say) is never punched out.
// The antialiased rim gets fractional alpha and is unpremultiplied against the key
// colour, which is what removes the green fringe.
const fs = require('fs');
const path = require('path');

let sharp;
try { sharp = require('sharp'); } catch {
  console.error('[cutout] needs sharp: npm install sharp');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const IN = path.join(ROOT, 'assets', 'pet', 'raw');
let OUT = path.join(ROOT, 'assets', 'pet');
const SIZE = 240;          // @2x of the 120px pet window
const CONTENT = 0.92;      // body fills this much of the square; the rest is drop-shadow room
const CANDIDATE = /^[A-Z]\d$/;

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[a.slice(2)] = argv[++i];
    else flags[a.slice(2)] = true;
  }
  return flags;
}

function hasAlpha(data) {
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
  return false;
}

// Average of the four corner pixels - the key colour as the encoder actually wrote it.
function cornerColor(data, w, h) {
  const at = (x, y) => (y * w + x) * 4;
  const px = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
  const c = [0, 0, 0];
  for (const p of px) for (let k = 0; k < 3; k++) c[k] += data[p + k] / px.length;
  return c.map(Math.round);
}

function dist(data, i, key) {
  const dr = data[i] - key[0], dg = data[i + 1] - key[1], db = data[i + 2] - key[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

// Flood fill from the edges through everything close enough to the key colour.
function keyOut(data, w, h, key, t0, t1) {
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    const p = y * w + x;
    if (seen[p] || dist(data, p * 4, key) >= t1) return;
    seen[p] = 1; stack.push(p);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const p = stack.pop();
    const x = p % w, y = (p - x) / w;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  let cleared = 0;
  for (let p = 0; p < seen.length; p++) {
    if (!seen[p]) continue;
    const i = p * 4;
    const d = dist(data, i, key);
    const a = d <= t0 ? 0 : Math.round(255 * Math.min(1, (d - t0) / (t1 - t0)));
    data[i + 3] = a;
    if (a === 0) { cleared++; continue; }
    // rim = a*subject + (1-a)*key, so recover the subject and drop the spill
    const f = a / 255;
    for (let k = 0; k < 3; k++) data[i + k] = Math.max(0, Math.min(255, Math.round((data[i + k] - key[k] * (1 - f)) / f)));
  }
  return cleared;
}

function alphaBox(data, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] <= 8) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

async function cutout(file, flags) {
  const name = path.basename(file, '.png');
  const src = sharp(file).ensureAlpha();
  const { data, info } = await src.raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;

  const notes = [];
  if (hasAlpha(data)) {
    notes.push('model returned alpha, no keying');
  } else {
    const key = flags['key-colour'] ? hex(flags['key-colour']) : cornerColor(data, w, h);
    const t1 = Number(flags.tolerance || 120);
    const cleared = keyOut(data, w, h, key, t1 * 0.5, t1);
    const pct = (100 * cleared) / (w * h);
    notes.push(`keyed rgb(${key.join(',')}), ${pct.toFixed(0)}% removed`);
    if (pct < 5) notes.push('WARNING: almost nothing removed - background is probably not flat');
  }

  const box = alphaBox(data, w, h);
  if (!box) throw new Error('nothing opaque left after keying');
  if (box.left === 0 || box.top === 0 || box.left + box.width === w || box.top + box.height === h) {
    notes.push('WARNING: subject touches the canvas edge - it was cropped in the draw');
  }

  const side = Math.round(Math.max(box.width, box.height) / CONTENT);
  const trimmed = await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .extract(box)
    .extend({
      top: Math.round((side - box.height) / 2),
      bottom: side - box.height - Math.round((side - box.height) / 2),
      left: Math.round((side - box.width) / 2),
      right: side - box.width - Math.round((side - box.width) / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const size = Number(flags.size || SIZE);
  await sharp(trimmed).resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toFile(path.join(OUT, `${name}@2x.png`));
  await sharp(trimmed).resize(size / 2, size / 2, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toFile(path.join(OUT, `${name}.png`));
  return { name, notes, box, src: `${w}x${h}` };
}

function hex(s) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(s).trim());
  if (!m) throw new Error(`--key-colour wants #rrggbb, got "${s}"`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// A single strip of every A1..C2 cutout, so the six candidates can be compared at a glance.
async function contactSheet(names, flags) {
  const cells = names.filter((n) => CANDIDATE.test(n));
  if (cells.length < 2) return null;
  const size = Number(flags.size || SIZE);
  const sheet = sharp({
    create: { width: size * cells.length, height: size, channels: 4, background: { r: 245, g: 245, b: 245, alpha: 1 } },
  });
  const composite = cells.map((n, i) => ({ input: path.join(OUT, `${n}@2x.png`), left: i * size, top: 0 }));
  const out = path.join(OUT, 'candidates.png');
  await sheet.composite(composite).png().toFile(out);
  return out;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const dir = flags.in ? path.resolve(ROOT, flags.in) : IN;
  if (flags.out) OUT = path.resolve(ROOT, flags.out);
  if (!fs.existsSync(dir)) throw new Error(`no raw draws in ${path.relative(ROOT, dir)} - run scripts/gen-pet.js first`);
  const only = flags.only ? String(flags.only).split(',') : null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).filter((f) => !only || only.includes(path.basename(f, '.png')));
  if (!files.length) throw new Error(`no matching png in ${path.relative(ROOT, dir)}`);

  fs.mkdirSync(OUT, { recursive: true });
  const done = [];
  for (const f of files) {
    try {
      const r = await cutout(path.join(dir, f), flags);
      done.push(r.name);
      console.log(`  ${r.name.padEnd(10)} ${r.src} -> ${r.box.width}x${r.box.height}  ${r.notes.join('; ')}`);
    } catch (err) {
      console.log(`  ${path.basename(f, '.png').padEnd(10)} FAILED: ${err.message}`);
    }
  }
  const sheet = await contactSheet(done, flags);
  console.log(`\n[cutout] ${done.length}/${files.length} frames -> ${path.relative(ROOT, OUT)}`);
  if (sheet) console.log(`[cutout] compare the candidates in ${path.relative(ROOT, sheet)}`);
}

main().catch((err) => { console.error(`[cutout] ${err.message}`); process.exit(1); });
