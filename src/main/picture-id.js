'use strict';
// Telling whether two pictures are the same picture, when their bytes are not.
//
// One WeChat screenshot arrives twice. The clipboard carries both a temporary file it just wrote and
// the bitmap itself; the watcher prefers files, saves that, and a few seconds later WeChat deletes
// the temporary file -- so the next poll sees only the bitmap, reads it as something new, and saves
// the same photograph a second time. Measured on a real pair: a 4.3 MB JPEG and a 16.6 MB PNG, both
// 4096x3072, identical to the eye and sharing not one byte.
//
// A difference hash is the right instrument for that. Shrink to nine by eight, go grey, and record
// for each pixel whether it is brighter than the one to its right: 64 bits describing the picture's
// gradients rather than its pixels, which survives re-encoding and a change of format.
//
// The threshold is measured, not guessed. Over the pictures in a real workspace, re-encoding one as
// PNG moves it 0 bits and as JPEG at quality 85 at most 2, so two is enough to recognise the same
// picture in another wrapper. Anything looser starts merging different pictures: two variants of the
// same drawn logo came out 4 bits apart. Pixel dimensions have to match as well, which is what a
// clipboard handing over one picture twice always gives and what those two logos did not
// (1410x1390 against 1390x1408).
const crypto = require('crypto');

const SIZE = 8;                  // 8x8 comparisons, so 64 bits
const NEAR = 2;                  // bits of difference still counted as the same picture

/**
 * @param {Buffer} buf encoded image bytes (PNG, JPEG, …)
 * @returns {string} '<width>x<height>:<64 bits>', or '' if the bytes are not a picture
 */
function fingerprint(buf) {
  let img;
  try {
    // eslint-disable-next-line global-require
    const { nativeImage } = require('electron');
    img = nativeImage.createFromBuffer(buf);
  } catch (_) {
    return '';                   // outside Electron
  }
  if (!img || img.isEmpty()) return '';
  const full = img.getSize();
  const small = img.resize({ width: SIZE + 1, height: SIZE, quality: 'good' });
  const b = small.toBitmap();    // BGRA
  const size = small.getSize();
  if (size.width < SIZE + 1 || size.height < SIZE) return '';
  const grey = (i) => b[i + 2] * 0.299 + b[i + 1] * 0.587 + b[i] * 0.114;
  let bits = '';
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * size.width + x) * 4;
      bits += grey(i) > grey(i + 4) ? '1' : '0';
    }
  }
  return `${full.width}x${full.height}:${bits}`;
}

/** How many of the 64 bits differ. Infinity when the two are not the same shape at all. */
function distance(a, b) {
  const [da, ba] = String(a || '').split(':');
  const [db, bb] = String(b || '').split(':');
  if (!ba || !bb || da !== db || ba.length !== bb.length) return Infinity;
  let n = 0;
  for (let i = 0; i < ba.length; i++) if (ba[i] !== bb[i]) n++;
  return n;
}

const alike = (a, b) => distance(a, b) <= NEAR;

/**
 * A short memory of the pictures just filed, so the same one arriving in another wrapper is not filed
 * again. Deliberately short: copying a picture again a minute later is a person asking for it twice,
 * while the same picture in two shapes seconds apart is one event seen twice.
 */
function recentPictures(windowMs = 60000) {
  let seen = [];   // { bits, at }
  return {
    /** @returns {boolean} true when this picture was filed a moment ago */
    saw(bits, now = Date.now()) {
      if (!bits) return false;
      seen = seen.filter((s) => now - s.at < windowMs);
      return seen.some((s) => alike(s.bits, bits));
    },
    remember(bits, now = Date.now()) {
      if (!bits) return;
      seen = seen.filter((s) => now - s.at < windowMs);
      seen.push({ bits, at: now });
      if (seen.length > 12) seen.shift();
    },
    get size() { return seen.length; },
  };
}

module.exports = { fingerprint, distance, alike, recentPictures, SIZE, NEAR };
