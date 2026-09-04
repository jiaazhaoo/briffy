'use strict';
// Puts a picture inside the pet's round frame.
//
//   node scripts/pet-avatar.js https://cdn.ipaslogo.com/.../some-cat.webp   any logo from ipaslogo.com
//   node scripts/pet-avatar.js ./somewhere/mascot.png                       a local file
//   node scripts/pet-avatar.js --default                                    rebuild the bundled default
//
// This writes the fallback that ships with the app. What an installed copy actually
// wears is picked in Settings > 小动物形象 and lives in userData (src/main/petskin.js).
//
// Writes assets/pet/avatar.png (240x240, @2x of the 120px pet window). The circle,
// the ring and the shadow are done in CSS, so this only has to produce a square.
// A picture with transparency is flattened onto --bg so the circle stays filled.
const fs = require('fs');
const path = require('path');
const orient = require('../src/main/orient');

let sharp;
try { sharp = require('sharp'); } catch {
  console.error('[avatar] needs sharp: npm install sharp');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'pet', 'avatar.png');
const CATALOG = path.join(ROOT, 'assets', 'pet', 'catalog.json');
const SIZE = 240;
const DEFAULT_BG = '#fff3e2';   // only used to back a source picture that has transparency
// the bundled fallback: "Cat 3" from the free library - dark navy cat on coral, the
// clearest read of the lot at 120px on both light and dark desktops
const DEFAULT_KEY = '9fd672b1fc19e9ac-cat-3';

function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { rest.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[a.slice(2)] = argv[++i];
    else flags[a.slice(2)] = true;
  }
  return { flags, source: rest[0] };
}

function rgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`--bg wants #rrggbb, got "${hex}"`);
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, alpha: 1 };
}

async function load(source) {
  if (/^https?:/i.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${source}`);
    return { buf: Buffer.from(await res.arrayBuffer()), from: source };
  }
  const file = path.resolve(ROOT, source);
  if (!fs.existsSync(file)) throw new Error(`no such file: ${source}`);
  return { buf: fs.readFileSync(file), from: path.relative(ROOT, file) };
}

function defaultUrl() {
  const c = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  return c.original.replace('{k}', DEFAULT_KEY);
}

async function main() {
  const { flags, source } = parseArgs(process.argv.slice(2));
  const bg = rgb(flags.bg || DEFAULT_BG);

  let src = source;
  if (!src || flags.default) {
    if (!src && !flags.default) {
      console.log('usage: node scripts/pet-avatar.js <image url | file>   (or --default)');
      console.log('       free logos: https://ipaslogo.com  - or just pick one in Settings');
    }
    src = defaultUrl();
  }

  const { buf, from } = await load(src);
  const meta = await sharp(buf).metadata();
  // cover-crop to a square, then flatten so a transparent source still fills the circle
  const { data, info } = await sharp(buf)
    .resize(SIZE, SIZE, { fit: 'cover', position: 'centre' })
    .flatten({ background: bg })
    .raw().toBuffer({ resolveWithObject: true });
  // same rule as src/main/petskin.js: everyone rises from the lower-right
  const { width: w, height: h, channels: ch } = info;
  const px = (x, y) => { const i = (y * w + x) * ch; return [data[i], data[i + 1], data[i + 2]]; };
  const flipped = orient.needsFlip(px, w, h);
  if (flipped) orient.flipH(data, w, h, ch);
  const png = await sharp(data, { raw: { width: w, height: h, channels: ch } }).png({ compressionLevel: 9 }).toBuffer();
  console.log(`[avatar] source ${meta.width}x${meta.height} ${meta.format}${meta.hasAlpha ? ' (alpha flattened)' : ''}${flipped ? ' - mirrored to face up-left' : ''}`);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, png);
  console.log(`[avatar] ${from} -> ${path.relative(ROOT, OUT)} (${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(0)} KB)`);
}

main().catch((err) => { console.error(`[avatar] ${err.message}`); process.exit(1); });
