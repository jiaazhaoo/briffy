'use strict';
// The boxes a screenshot is already made of, so hovering can offer one.
//
// Until now the overlay could only offer whole windows: the window list says where every window is,
// hover one and it lights up. That is the easy half. What people actually reach for is smaller -- a
// toolbar, a card, a message, one panel of a split view -- and no list has those in it. The
// accessibility API does, and it was measured first: `AXUIElementCopyElementAtPosition` answers, but
// reading the frame back needs a struct out-parameter that the JXA bridge will not hand over
// (`Ref has incompatible type`), so it would take a native helper, a second permission prompt, and it
// would still come back empty in the apps people screenshot most -- Electron apps, canvases, games.
//
// The picture is already here, though. The overlay is holding a frozen shot of the whole screen, and
// interface is not a photograph: it is flat fills separated by straight edges. So the fills are what
// gets found. Every run of pixels that is not an edge is flood-filled into one region, and each
// region's bounding box is a candidate; a card's white fill wraps around its own text and comes back
// as the card, a toolbar's fill comes back as the toolbar, and a paragraph of text -- broken into
// hundreds of tiny pieces -- comes back as nothing, which is right, because nobody wants to select
// the inside of a letter.
//
// What it cannot see is a boundary made only of a soft shadow: spread over a dozen pixels, no two of
// them differ by enough to be an edge. Window snapping still covers those, and that is the fallback.
//
// Plain arrays in, plain numbers out: no canvas, no DOM, so it can be tested outside a browser.

// Two passes, because interfaces draw their boundaries two ways.
//
//   fine     half size, a real step between neighbours -- hairlines, borders, flat panels
//   coarse   quarter size, a much smaller step -- a boundary made only of a soft shadow
//
// The second one is not a nicety. briffy's own look is white slips on an off-white ground with no
// border at all: nine grey levels spread over sixteen pixels, which at half size is a step of one and
// invisible to any threshold worth having. At quarter size the same shadow is four pixels of six, and
// it comes back exactly (measured: 26,26,462,148 against a true 24,24,464,150 -- two pixels, which is
// the working scale's own quantum). Anything that looks like a box at either scale is offered.
// The coarse threshold is 4 and not 6 because 6 could not see a sidebar. Panels in real interfaces are
// separated by very little -- a VS Code sidebar against its editor is 7 grey levels, an ordinary page's
// #f8f9fa against white is 7 -- and a boundary block at quarter size averages the two sides together,
// which halves whatever step there was. At 6 the sidebar in dev/autoselect-fixture.js was invisible and
// pointing at it offered the whole window body instead; at 4 it comes back. Measured on a real
// 5504x2304 screen the change costs nothing: 87 boxes and 147 ms became 92 boxes and 113 ms.
//
// Below 4 nothing further is gained on that fixture, and a 4-level boundary (a content area against its
// window) stays out of reach at every setting -- that one is left to window snapping.
const PASSES = [{ scale: 2, edge: 14 }, { scale: 4, edge: 4 }];
const SCALE = 2;          // the fine pass, kept named for the tests
const EDGE = 14;          // grey levels between neighbours, at working scale, that count as an edge
const MIN_SIDE = 16;      // in working pixels; below this it is a glyph or an icon, not a region
const MIN_AREA = 900;     // ditto -- 30x30 at working scale
const FILL_RATIO = 0.25;  // a region must fill this much of its own box, or its box means nothing
const NEAR = 3;           // boxes within this many working pixels on every side are the same box

/** RGBA -> grey at 1/`scale`, every block averaged. */
function grey(rgba, width, height, scale = SCALE) {
  const w = Math.max(1, Math.floor(width / scale));
  const h = Math.max(1, Math.floor(height / scale));
  const out = new Uint8Array(w * h);
  const per = scale * scale;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = 0; dy < scale; dy++) {
        let i = ((((y * scale) + dy) * width) + (x * scale)) * 4;
        for (let dx = 0; dx < scale; dx++, i += 4) {
          sum += ((rgba[i] * 77) + (rgba[i + 1] * 150) + (rgba[i + 2] * 29)) >> 8;
        }
      }
      out[(y * w) + x] = (sum / per) | 0;
    }
  }
  return { data: out, w, h };
}

/** 1 where a pixel differs from the one to its left or the one above it by more than `edge`. */
function edges(img, edge = EDGE) {
  const { data, w, h } = img;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w) + x;
      const v = data[i];
      let d = 0;
      if (x > 0) { const a = v - data[i - 1]; d = a < 0 ? -a : a; }
      if (y > 0) { const b = v - data[i - w]; const ab = b < 0 ? -b : b; if (ab > d) d = ab; }
      out[i] = d > edge ? 1 : 0;
    }
  }
  return out;
}

/**
 * Every flat region's bounding box, in working pixels.
 *
 * The flood fill is iterative on a typed stack on purpose: recursion on a screenful of background is
 * a stack overflow, and it is not a hypothetical one -- the desktop wallpaper is usually the single
 * biggest region on screen.
 */
function regions(img, mask) {
  const { w, h } = img;
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const out = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || mask[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let x0 = start % w, x1 = x0, y0 = (start / w) | 0, y1 = y0, area = 0;
    while (top > 0) {
      const i = stack[--top];
      const x = i % w, y = (i / w) | 0;
      area++;
      if (x < x0) x0 = x; else if (x > x1) x1 = x;
      if (y < y0) y0 = y; else if (y > y1) y1 = y;
      if (x > 0 && !seen[i - 1] && !mask[i - 1]) { seen[i - 1] = 1; stack[top++] = i - 1; }
      if (x < w - 1 && !seen[i + 1] && !mask[i + 1]) { seen[i + 1] = 1; stack[top++] = i + 1; }
      if (y > 0 && !seen[i - w] && !mask[i - w]) { seen[i - w] = 1; stack[top++] = i - w; }
      if (y < h - 1 && !seen[i + w] && !mask[i + w]) { seen[i + w] = 1; stack[top++] = i + w; }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bw < MIN_SIDE || bh < MIN_SIDE || bw * bh < MIN_AREA) continue;
    // An L-shaped or ring-shaped region has a box far bigger than itself; offering that box would
    // light up a rectangle the user can see is not the thing under the cursor.
    if (area < bw * bh * FILL_RATIO) continue;
    out.push({ x: x0, y: y0, w: bw, h: bh, area });
  }
  return out;
}

/** Same box twice (a fill and its own border, say) -- keep the outer one. */
function dedupe(list, near = NEAR) {
  const sorted = [...list].sort((a, b) => (b.w * b.h) - (a.w * a.h));
  const keep = [];
  for (const b of sorted) {
    let dup = false;
    for (const k of keep) {
      if (Math.abs(k.x - b.x) <= near && Math.abs(k.y - b.y) <= near
        && Math.abs((k.x + k.w) - (b.x + b.w)) <= near && Math.abs((k.y + k.h) - (b.y + b.h)) <= near) { dup = true; break; }
    }
    if (!dup) keep.push(b);
  }
  return keep;
}

/**
 * @param {Uint8ClampedArray|Uint8Array} rgba the frozen screenshot
 * @param {number} width @param {number} height its own pixels
 * @param {number} [toScale] divide the answer by this, to hand back boxes in the overlay's own points
 * @returns {Array<{x,y,w,h}>} biggest first
 */
function find(rgba, width, height, toScale = 1) {
  const all = [];
  for (const { scale, edge } of PASSES) {
    const img = grey(rgba, width, height, scale);
    const k = scale / (toScale || 1);
    for (const b of regions(img, edges(img, edge))) {
      all.push({
        x: Math.round(b.x * k), y: Math.round(b.y * k),
        w: Math.round(b.w * k), h: Math.round(b.h * k),
        area: b.area * scale * scale,
      });
    }
  }
  // The two passes see many of the same panels; NEAR is in working pixels, so allow for the coarser one.
  return dedupe(all, NEAR * PASSES[PASSES.length - 1].scale);
}

/**
 * The one to offer for a cursor at (x, y): the smallest box it is inside.
 *
 * Smallest, because hovering is how you say "this thing, the one I am pointing at"; the bigger boxes
 * around it are its container, and the container is what dragging a rectangle -- or clicking a window
 * -- is for. A box within a hair of the whole screen is never offered: that is the desktop.
 */
function at(boxes, x, y, { maxW = Infinity, maxH = Infinity } = {}) {
  let best = null;
  for (const b of boxes) {
    if (x < b.x || y < b.y || x >= b.x + b.w || y >= b.y + b.h) continue;
    if (b.w >= maxW - 2 && b.h >= maxH - 2) continue;
    if (!best || b.w * b.h < best.w * best.h) best = b;
  }
  return best;
}

const API = { grey, edges, regions, dedupe, find, at, PASSES, SCALE, EDGE, MIN_SIDE, MIN_AREA, FILL_RATIO };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else if (typeof window !== 'undefined') window.boxes = API;
