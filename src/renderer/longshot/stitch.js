'use strict';
// Joining one screenful to the next, by finding where they overlap.
//
// A long screenshot is the user scrolling while briffy watches one rectangle. Nothing tells us how far
// they scrolled -- the app being captured is not ours -- so each new frame has to be matched against
// the one before, and only the part below the match is new.
//
// The match is done twice, and the reason is worth writing down because the first version was wrong.
// Shrinking both directions by four makes the search cheap, but the blocks are aligned to each frame's
// own top edge: scroll by 88 pixels and the blocks line up, scroll by 90 and every block straddles a
// different pair of source rows. Measured on noise, that was the difference between an exact hit and
// no match at all -- and people scroll by whatever number of pixels they scroll by. So:
//
//   1. coarse   quarter scale both ways, over the whole frame, to find roughly where
//   2. fine     full row resolution (columns still averaged) over a dozen rows around that guess
//
// Only the fine score decides whether the frame is used, so the coarse pass never has to be right,
// only close.
//
// **The guards below are not enough on their own, and that is by design of the caller.** Real
// interfaces are periodic -- rows, cards, list items, all near-identical -- so the correct join is only
// marginally better than the wrong one a whole card further down, and a distinctness test cannot tell
// them apart. Measured on an ordinary page of repeated sections: the search locked onto the wrong
// period and spliced the same two sections in dozens of times, producing 7445 px of picture from a
// page that had moved 90. (The synthetic test that passed used random noise, which is the easiest
// possible case for correlation and told us nothing.)
//
// So the caller must say how far the content can plausibly have moved, and it can, because briffy now
// does the scrolling itself: `expect` bounds the search to what one step could have produced. Without
// it this file will happily find the wrong repeat.
//
// Three ways this can still go wrong, all refused rather than papered over:
//   · nothing matches well          mid-scroll blur, a menu opened, a video playing
//   · the best match says it did not move
//   · the strip being matched carries no detail (a blank margin), or fits in many places about as
//     well (a list of identical rows) -- splicing on either would repeat content silently, which is
//     the worst failure a long screenshot can have, because nobody re-reads one closely enough to notice
//
// The strip is not simply taken from the very bottom. A page often ends its screenful in a flat band
// of background or a solid block of colour, and a strip cut from that could be matched anywhere; the
// caller would then be told "no" for as long as that band stayed at the foot of the view. So the lower
// half is searched for the most distinctive strip available, and that is the one looked for.
//
// Plain arrays in, plain numbers out: no canvas, no DOM, so it can be tested outside a browser.

const SHRINK = 4;              // the coarse pass shrinks by this in both directions
const PROBE_ROWS = 72;         // how much of the previous frame's tail to look for, full-size rows
const MIN_PROBE_ROWS = 16;
const REFINE = 2 * SHRINK;     // rows either side of the coarse guess that the fine pass examines
const MAX_TOTAL_ROWS = 30000;  // a runaway match would otherwise grow until memory ran out
// A match is believed only when it is clearly better than the rest of the search; 1 would accept a tie.
const DISTINCTNESS = 1.2;
const MIN_CONTRAST = 2.5;      // mean deviation out of 255 below which a strip is featureless
const TOLERANCE = 12;          // mean absolute difference, out of 255, still counted as the same content
// Sticky furniture. A row or a column whose two frames differ by less than this did not move.
const SAME_TOL = 3;
const MIN_MOVING = 0.2;        // less of the view than this actually moving: treat it as still
const MAX_STATIC_COLS = 0.75;  // more static columns than this and the mask is measuring nothing

/**
 * RGBA bytes -> grey, shrunk by `sx` across and `sy` down, every block **averaged**.
 * `sy = 1` keeps every row, which is what the fine pass needs to be free of the alignment problem.
 */
function grey(rgba, width, height, sx = SHRINK, sy = SHRINK) {
  const w = Math.max(1, Math.floor(width / sx));
  const h = Math.max(1, Math.floor(height / sy));
  const out = new Uint8Array(w * h);
  const per = sx * sy;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = 0; dy < sy; dy++) {
        let i = ((((y * sy) + dy) * width) + (x * sx)) * 4;
        for (let dx = 0; dx < sx; dx++, i += 4) {
          sum += ((rgba[i] * 77) + (rgba[i + 1] * 150) + (rgba[i + 2] * 29)) >> 8;   // luma, in integers
        }
      }
      out[(y * w) + x] = (sum / per) | 0;
    }
  }
  return { data: out, w, h };
}

/** Both scales of one frame, prepared once and reused: it is compared against the next frame and the previous. */
function prepare(rgba, width, height) {
  return {
    height,
    coarse: grey(rgba, width, height, SHRINK, SHRINK),
    fine: grey(rgba, width, height, SHRINK, 1),
  };
}

/** How much a strip varies about its own mean. A strip without any cannot be matched on. */
/**
 * The lowest strip in a frame that has enough detail to be looked for.
 *
 * Lowest, not most distinctive. How far the strip sits from the bottom is exactly how much scrolling
 * can still be followed in one frame -- a strip taken from halfway up cannot detect a scroll longer
 * than half a screen. Taking the *most* contrasty one instead cost the ability to follow a 300-row
 * jump on a 400-row frame, which is an ordinary flick of a trackpad. So it starts at the bottom and
 * only climbs when the bottom has nothing in it, and never past a third of the way up.
 *
 * @returns {number} its top row, or -1 when even that much of the frame is featureless.
 */
function bestProbeTop(img, rows, from = 0, to = img.h) {
  const lowest = to - rows;
  if (lowest < from) return -1;
  const span = to - from;
  const highest = Math.max(from, from + Math.floor(span * 0.66) - rows);
  const step = Math.max(1, Math.round(rows / 3));
  for (let top = lowest; top >= highest; top -= step) {
    if (contrast(img, top, rows) >= MIN_CONTRAST) return top;
  }
  return -1;
}

function contrast(img, top, rows) {
  const { data, w } = img;
  const n = rows * w;
  let sum = 0;
  for (let i = top * w; i < (top + rows) * w; i++) sum += data[i];
  const mean = sum / n;
  let dev = 0;
  for (let i = top * w; i < (top + rows) * w; i++) { const d = data[i] - mean; dev += d < 0 ? -d : d; }
  return dev / n;
}

/**
 * Mean absolute difference between `rows` rows of two grey images. Gives up once it cannot win.
 * `cols`, when given, is a per-column flag: only columns marked 1 are counted. That is how a static
 * sidebar is kept out of the score -- it is identical wherever you put it, so averaging it in drags
 * every candidate towards the same number and the real answer stops standing out.
 */
function rowsDiff(a, aTop, b, bTop, w, rows, giveUpAt, cols) {
  let sum = 0;
  let n = 0;
  for (let r = 0; r < rows; r++) {
    const ai = (aTop + r) * w;
    const bi = (bTop + r) * w;
    if (cols) {
      for (let x = 0; x < w; x++) { if (!cols[x]) continue; const d = a[ai + x] - b[bi + x]; sum += d < 0 ? -d : d; n++; }
    } else {
      for (let x = 0; x < w; x++) { const d = a[ai + x] - b[bi + x]; sum += d < 0 ? -d : d; }
      n += w;
    }
    if (giveUpAt !== undefined && n && sum / n > giveUpAt) return Infinity;
  }
  return n ? sum / n : Infinity;
}

/**
 * The furniture: which rows at the top and bottom of the view stayed put, and which columns did.
 *
 * This is the thing the first version got wrong, and it got it wrong in the worst possible way -- it
 * looked for the previous frame's tail starting at the very bottom of the view. On any page with a
 * bar pinned to the bottom (a chat box, a toolbar, a "12 selected" strip, a browser's find bar) that
 * tail *is* the bar. It matches the next frame perfectly at offset zero, the answer comes back "it
 * did not move", and the long screenshot stops at one screenful for as long as that bar is there.
 * Measured on an ordinary page with a header, a footer and a sidebar: 17 frames out of 17 refused.
 *
 * So the frames are compared where they sit first. Rows that are the same at offset zero while the
 * middle of the view is plainly moving are furniture: they are matched around, and they are written
 * into the tall picture once rather than once per screenful.
 *
 * @returns {{top:number, bottom:number, cols:Uint8Array|null, moving:boolean}} rows counted at full
 *   resolution; `cols` is one flag per column of the shrunk images, or null when masking would
 *   measure nothing.
 */
function bands(prev, next) {
  const a = prev.fine, b = next.fine;
  const w = a.w, h = Math.min(a.h, b.h);
  const rowDiff = new Float32Array(h);
  let movingRows = 0;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    const i = y * w;
    for (let x = 0; x < w; x++) { const d = a.data[i + x] - b.data[i + x]; sum += d < 0 ? -d : d; }
    rowDiff[y] = sum / w;
    if (rowDiff[y] > SAME_TOL) movingRows++;
  }
  // Nothing much moved: the user is reading, not scrolling. Say so rather than calling the whole
  // view furniture -- with the view still, every row is "static" and every band measurement is noise.
  if (movingRows < h * MIN_MOVING) return { top: 0, bottom: 0, cols: null, moving: false };

  let top = 0;
  while (top < h && rowDiff[top] <= SAME_TOL) top++;
  let bottom = 0;
  while (bottom < h - top && rowDiff[h - 1 - bottom] <= SAME_TOL) bottom++;

  // Columns, measured only over the part that moves: a sidebar is static there too, and that is
  // exactly what we want to drop from the score.
  let cols = null;
  const from = top, to = h - bottom;
  if (to - from > 8) {
    cols = new Uint8Array(w);
    let staticCols = 0;
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = from; y < to; y++) { const d = a.data[(y * w) + x] - b.data[(y * w) + x]; sum += d < 0 ? -d : d; }
      const same = (sum / (to - from)) <= SAME_TOL;
      cols[x] = same ? 0 : 1;
      if (same) staticCols++;
    }
    if (staticCols > w * MAX_STATIC_COLS || staticCols === 0) cols = null;
  }
  return { top, bottom, cols, moving: true };
}

/**
 * How far the content moved between two prepared frames.
 * @returns {{rows:number, score:number, distinct:number}|null} `rows` is in full-size pixels; null
 *   when the frame should be thrown away.
 */
/**
 * @param {{tolerance?:number, expect?:{min:number,max:number}}} opts `expect` is how far, in rows, the
 *   content can plausibly have moved since `prev`. Anything outside it is refused outright -- that is
 *   the only thing that survives a page of repeated cards.
 */
function findOffset(prev, next, { tolerance = TOLERANCE, expect = null } = {}) {
  if (!prev || !next || prev.coarse.w !== next.coarse.w || prev.height !== next.height) return null;

  // Where the furniture is, so the search happens between it rather than on it.
  const band = bands(prev, next);
  if (!band.moving) return null;
  const S = SHRINK;
  const cTopLimit = Math.ceil(band.top / S);                       // in coarse rows
  const cBotLimit = Math.floor((prev.height - band.bottom) / S);
  const cols = band.cols;

  // ---- coarse: roughly where, over the moving part of the frame ----
  const cw = prev.coarse.w;
  const cProbe = Math.min(
    Math.max(Math.floor(PROBE_ROWS / S), Math.floor(MIN_PROBE_ROWS / S)),
    Math.floor((cBotLimit - cTopLimit) / 2),
  );
  if (cProbe < 2) return null;
  const cTop = bestProbeTop(prev.coarse, cProbe, cTopLimit, cBotLimit);
  if (cTop < 0) return null;

  // Only where the content could actually have got to. Everything else in this function was written
  // to work without knowing that, and it cannot: on a page of repeated sections the join one section
  // too far down scores about as well as the right one, and the search picked whichever happened to
  // win. Measured, with the search left open: joins of 936 rows and 184 rows alternating where the
  // truth was 560 every time -- one section long, then one section short, for the whole picture.
  const yLo = expect ? Math.max(cTopLimit, cTop - Math.ceil(expect.max / S)) : cTopLimit;
  const yHi = expect ? Math.min(cBotLimit - cProbe, cTop - Math.floor(expect.min / S)) : cBotLimit - cProbe;
  const scores = [];
  let cBest = Infinity; let cAt = -1;
  for (let y = yLo; y <= yHi; y++) {
    const sc = rowsDiff(prev.coarse.data, cTop, next.coarse.data, y, cw, cProbe, undefined, cols);
    scores.push(sc);
    if (sc < cBest) { cBest = sc; cAt = y; }
  }
  if (cAt < 0) return null;

  // On a repeating pattern many places fit about as well; picking one would splice the same rows in
  // again and again. Judged on the coarse pass, which is the one that looked everywhere.
  //
  // Only when the search *was* everywhere. Given a band, most of what it looks at is within a few rows
  // of the answer and scores nearly as well by construction, so this test would throw away every
  // correct join. The band is the stronger guard anyway: it rules the repeat out rather than noticing
  // afterwards that two places were hard to tell apart.
  const sorted = [...scores].sort((a, b) => a - b);
  const middle = sorted[Math.floor(sorted.length / 2)] || 0;
  const distinct = cBest > 0 ? middle / cBest : Infinity;
  if (!expect && scores.length > 4 && distinct < DISTINCTNESS) return null;

  // ---- fine: exactly where, on full rows, near the guess ----
  const fw = prev.fine.w;
  const fTopLimit = band.top;
  const fBotLimit = prev.height - band.bottom;
  const fProbe = Math.min(Math.max(PROBE_ROWS, MIN_PROBE_ROWS), Math.floor((fBotLimit - fTopLimit) / 2));
  if (fProbe < MIN_PROBE_ROWS) return null;
  // the same strip, at full row resolution: where the coarse one starts, in real rows
  const fTop = Math.min(fBotLimit - fProbe, Math.max(fTopLimit, cTop * S));
  const guess = fTop - ((cTop - cAt) * S);
  const from = Math.max(fTopLimit, guess - REFINE);
  const to = Math.min(fBotLimit - fProbe, guess + REFINE);
  let best = Infinity; let bestAt = -1;
  for (let y = from; y <= to; y++) {
    const sc = rowsDiff(prev.fine.data, fTop, next.fine.data, y, fw, fProbe, best, cols);
    if (sc < best) { best = sc; bestAt = y; }
  }
  if (bestAt < 0 || best > tolerance) return null;

  const moved = fTop - bestAt;         // the strip used to end at the bottom; now it ends higher up
  if (moved <= 0) return null;         // nothing moved, or the view went backwards
  return { rows: moved, score: best, distinct, top: band.top, bottom: band.bottom };
}

/**
 * How many rows at the bottom of `next` are new.
 * @returns {{newRows:number, score:number}|null} null when the frame adds nothing usable.
 */
function newRowsFor(prev, next, opts) {
  const hit = findOffset(prev, next, opts);
  if (!hit) return null;
  // Never more than the moving part of the view: beyond that the scroll outran the overlap and the
  // rows in between were never seen.
  const band = next.height - hit.top - hit.bottom;
  const rows = Math.min(band, hit.rows);
  if (rows < 1) return null;
  // The fine pass refines around the coarse guess and can step a little outside the band; a join that
  // ends up outside it is refused rather than trimmed, because a join in the wrong place is not made
  // right by being the right length.
  const want = opts && opts.expect;
  if (want && (rows < want.min || rows > want.max)) return null;
  return { newRows: rows, score: hit.score, top: hit.top, bottom: hit.bottom };
}

// One file, two homes: `require`d by the tests under node, and loaded as an ordinary <script> by the
// page. Fetching the text and running it through `new Function` was the first attempt and the page's
// Content-Security-Policy refused it, rightly -- `unsafe-eval` is not something to switch on so that
// one module can be shared.
const API = {
  grey, prepare, contrast, bestProbeTop, bands, findOffset, newRowsFor, rowsDiff,
  SHRINK, PROBE_ROWS, REFINE, MAX_TOTAL_ROWS, DISTINCTNESS, MIN_CONTRAST, TOLERANCE, SAME_TOL,
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else if (typeof window !== 'undefined') window.stitch = API;
