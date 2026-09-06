'use strict';
// Which picture goes in the pet's round frame.
//
// assets/pet/catalog.json is a snapshot of the free logo library on ipaslogo.com
// (3448 of them, refreshed with `npm run pet:catalog`). It holds only ids, names and
// each picture's background colour - about 250 KB - so the settings grid can paint
// coloured placeholders instantly. The pictures themselves stay on their CDN and are
// loaded lazily while browsing; when one is picked, that single original is downloaded
// into userData and the pet never touches the network again.
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const orient = require('./orient');

const ASSETS = path.join(__dirname, '..', '..', 'assets', 'pet');
const CATALOG = path.join(ASSETS, 'catalog.json');
const BUILTIN = path.join(ASSETS, 'avatar.png');
const SIZE = 240;   // @2x of the 120px pet window

let catalog = null;

function load() {
  if (catalog) return catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  } catch (err) {
    console.warn('[petskin] no catalogue, the picker will be empty:', err.message);
    catalog = { count: 0, logos: [], thumb: '', original: '' };
  }
  return catalog;
}

function userFile() { return path.join(app.getPath('userData'), 'pet-avatar.png'); }

// The picked picture lives in userData; the bundled one is the fallback and is
// read-only once the app is packaged.
function file(store) {
  const picked = userFile();
  return store.getSettings().petAvatar && fs.existsSync(picked) ? picked : BUILTIN;
}

// The pet only draws itself when it is itself. Pick a logo out of the catalogue and it goes back to
// being a picture in a frame -- animating someone else's mark would be putting words in its mouth.
function isBuiltin(store) { return file(store) === BUILTIN; }

function url(store) {
  const f = file(store);
  let stamp = 0;
  try { stamp = fs.statSync(f).mtimeMs; } catch (_) { /* falls back to 0 */ }
  return `${pathToFileURL(f).href}?v=${Math.round(stamp)}`;   // ?v busts the renderer's image cache
}

function catalogue(store) {
  const c = load();
  return { thumb: c.thumb, count: c.count || c.logos.length, logos: c.logos, current: store.getSettings().petAvatar || '' };
}

async function apply(store, key) {
  const c = load();
  const entry = c.logos.find((l) => l.k === key);
  if (!entry) throw new Error(`unknown logo: ${key}`);
  const src = c.original.replace('{k}', key);
  const res = await fetch(src);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${src}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // the originals are square PNGs on a solid background, so a plain resize is all it takes
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) throw new Error('the downloaded picture could not be decoded');
  const { image, flipped } = facingUpLeft(img.resize({ width: SIZE, height: SIZE, quality: 'best' }));
  fs.writeFileSync(userFile(), image.toPNG());
  store.updateSettings({ petAvatar: key });
  return { key, name: entry.n, bg: entry.bg, flipped };
}

// Every avatar rises from the lower-right toward the upper-left; one drawn the other way
// round is mirrored. toBitmap/createFromBitmap are both BGRA, so the flip is byte-exact.
function facingUpLeft(img) {
  const { width: w, height: h } = img.getSize();
  const bmp = img.toBitmap();
  const px = (x, y) => { const i = (y * w + x) * 4; return [bmp[i + 2], bmp[i + 1], bmp[i]]; };
  if (!orient.needsFlip(px, w, h)) return { image: img, flipped: false };
  return { image: nativeImage.createFromBitmap(orient.flipH(bmp, w, h, 4), { width: w, height: h }), flipped: true };
}

function reset(store) {
  try { fs.unlinkSync(userFile()); } catch (_) { /* nothing to remove */ }
  store.updateSettings({ petAvatar: '' });
}

module.exports = { catalogue, apply, reset, url, file, isBuiltin };
