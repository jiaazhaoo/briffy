'use strict';
// Which lower corner a logo-style character rises from, so every avatar can be made to
// face the same way. The ip-as-logo pictures put the character in the lower-left or the
// lower-right and crop it there, so the corner with more character pixels along the edge
// is the anchor. We want them all rising from the lower-right toward the upper-left.
//
// Pure functions over a pixel accessor, so the main process (nativeImage BGRA bitmaps)
// and the dev scripts (sharp RGBA) share one heuristic.

const EDGE = 0.25;      // the outer quarter of the width on each side is "the edge"
const THRESHOLD = 60;   // rgb distance from the background that counts as character
const MARGIN = 1.15;    // one side must beat the other by this much before we call it

// px(x, y) -> [r, g, b]
function background(px, w, h) {
  // top corners are always background in these pictures - the character lives at the bottom
  const a = px(2, 2), b = px(w - 3, 2), c = px(Math.floor(w / 2), 2);
  return [0, 1, 2].map((i) => Math.round((a[i] + b[i] + c[i]) / 3));
}

function dist(p, bg) {
  const dr = p[0] - bg[0], dg = p[1] - bg[1], db = p[2] - bg[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** @returns {'left'|'right'|'center'} the corner the character is anchored to */
function anchor(px, w, h, bg = background(px, w, h)) {
  const edge = Math.max(1, Math.round(w * EDGE));
  let left = 0, right = 0;
  const step = Math.max(1, Math.floor(w / 120));   // sample; the answer is not subtle
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < edge; x += step) if (dist(px(x, y), bg) > THRESHOLD) left++;
    for (let x = w - edge; x < w; x += step) if (dist(px(x, y), bg) > THRESHOLD) right++;
  }
  if (left > right * MARGIN) return 'left';
  if (right > left * MARGIN) return 'right';
  return 'center';
}

/** true when the picture should be mirrored to rise from the lower-right */
function needsFlip(px, w, h, bg) { return anchor(px, w, h, bg) === 'left'; }

// In-place horizontal mirror of an interleaved pixel buffer with `ch` channels.
function flipH(data, w, h, ch) {
  const row = w * ch;
  const tmp = new Uint8Array(ch);
  for (let y = 0; y < h; y++) {
    const base = y * row;
    for (let x = 0; x < w >> 1; x++) {
      const a = base + x * ch, b = base + (w - 1 - x) * ch;
      for (let k = 0; k < ch; k++) { tmp[k] = data[a + k]; data[a + k] = data[b + k]; data[b + k] = tmp[k]; }
    }
  }
  return data;
}

module.exports = { anchor, needsFlip, flipH, background };
