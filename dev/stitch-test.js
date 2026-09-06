'use strict';
// The stitcher, on made-up pages that scroll by a known amount.
//
//   node dev/stitch-test.js
//
// Every case here is a page whose exact scroll is known, so the answer is checkable rather than
// eyeballed. The ones that matter are the refusals: a long screenshot that quietly splices the same
// rows in twice is worse than one that stops early, because nobody re-reads a screenshot closely
// enough to notice.
const assert = require('assert');
const stitch = require('../src/renderer/longshot/stitch');

let pass = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; } };

const W = 240; const H = 400;

/** A page of `rows` rows of pseudo-random text-ish noise, deterministic so runs compare. */
function page(rows, seed = 1, { blank = false, repeatEvery = 0 } = {}) {
  const px = new Uint8Array(W * rows * 4);
  let r = seed;
  const rnd = () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff; };
  for (let y = 0; y < rows; y++) {
    const src = repeatEvery ? (y % repeatEvery) : y;
    let rr = (src + 1) * 7919;
    const nextByte = () => { rr = (rr * 1103515245 + 12345) & 0x7fffffff; return (rr >> 16) & 0xff; };
    for (let x = 0; x < W; x++) {
      const i = ((y * W) + x) * 4;
      const v = blank ? 250 : (rnd() < 0.82 ? 250 : nextByte() & 0x7f);
      px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255;
    }
  }
  return px;
}

/** The window on to that page, `H` rows tall, starting at `top`. */
function view(pagePx, top) {
  const out = new Uint8Array(W * H * 4);
  out.set(pagePx.subarray(top * W * 4, (top + H) * W * 4));
  return out;
}
const g = (rgba) => stitch.prepare(rgba, W, H);

// ---------- it finds a scroll it should find ----------
const doc = page(2000, 7);
// Every value, not a handful of round ones: the first version of this only matched multiples of four
// and a test of 8/40/120/200/280 sailed straight past it.
for (let scrolled = 1; scrolled <= 300; scrolled += 1) {
  ok(`a scroll of ${scrolled} rows is measured exactly`, () => {
    const r = stitch.newRowsFor(g(view(doc, 0)), g(view(doc, scrolled)), H);
    assert.ok(r, 'no match at all');
    assert.strictEqual(r.newRows, scrolled, `said ${r.newRows}, actually ${scrolled}`);
  });
}

// ---------- and refuses the ones it should refuse ----------
ok('a still screen adds nothing', () => {
  assert.strictEqual(stitch.newRowsFor(g(view(doc, 300)), g(view(doc, 300)), H), null);
});
ok('scrolling back up adds nothing', () => {
  assert.strictEqual(stitch.newRowsFor(g(view(doc, 300)), g(view(doc, 200)), H), null);
});
ok('a jump past a whole screenful is refused, not guessed', () => {
  // nothing in common, so there is no honest way to join them
  assert.strictEqual(stitch.newRowsFor(g(view(doc, 0)), g(view(doc, 900)), H), null);
});
ok('a different page entirely is refused', () => {
  assert.strictEqual(stitch.newRowsFor(g(view(doc, 0)), g(view(page(2000, 99), 0)), H), null);
});
ok('a blank stretch is refused rather than repeated', () => {
  // every position fits equally well; accepting one would splice blank rows in forever
  const empty = page(2000, 3, { blank: true });
  assert.strictEqual(stitch.newRowsFor(g(view(empty, 0)), g(view(empty, 60)), H), null);
});
ok('a list of identical rows is refused', () => {
  const striped = page(2000, 5, { repeatEvery: 20 });
  const r = stitch.newRowsFor(g(view(striped, 0)), g(view(striped, 60)), H);
  // either it refuses, or it must have got the exact answer -- a wrong multiple of the stripe is the
  // failure this test exists for
  if (r) assert.ok(Math.abs(r.newRows - 60) <= stitch.SHRINK, `spliced at ${r.newRows}, not 60`);
});

// ---------- a whole scroll, joined end to end ----------
ok('an uneven scroll, frame after frame, rebuilds the page exactly', () => {
  // deliberately ragged, the way a trackpad actually behaves
  const steps = [37, 91, 12, 150, 63, 4, 205, 88, 119, 46, 7, 171];
  let at = 0;
  let prev = g(view(doc, at));
  let total = H;               // the first frame is kept whole
  for (let i = 0; i < steps.length; i++) {
    at += steps[i];
    const cur = g(view(doc, at));
    const r = stitch.newRowsFor(prev, cur);
    assert.ok(r, `frame ${i + 1} (scrolled ${steps[i]}) did not match`);
    assert.strictEqual(r.newRows, steps[i], `frame ${i + 1}: said ${r.newRows}, actually ${steps[i]}`);
    total += r.newRows;
    prev = cur;
  }
  assert.strictEqual(total, H + at, `built ${total} rows, the page gave ${H + at}`);
});

// ---------- furniture: the bars and columns that do not scroll ----------
// This is the bug the whole rewrite is for. A view whose bottom rows are a pinned bar used to be
// refused for ever: the strip looked for was cut from the very bottom, that strip *was* the bar, it
// matched perfectly where it already sat, and the answer came back "it did not move". On a page with
// a header, a footer and a sidebar, 17 real frames out of 17 were thrown away and the long screenshot
// was one screenful.
/** The same page, with `top` rows of pinned header and `bot` rows of pinned footer drawn over it. */
function furnish(rgba, { top = 0, bot = 0, side = 0 } = {}) {
  const out = new Uint8Array(rgba);
  const set = (x, y, v) => { const i = ((y * W) + x) * 4; out[i] = v; out[i + 1] = v; out[i + 2] = v; };
  for (let y = 0; y < top; y++) for (let x = 0; x < W; x++) set(x, y, (x * 13 + y * 29) & 0xff);
  for (let y = H - bot; y < H; y++) for (let x = 0; x < W; x++) set(x, y, (x * 7 + y * 3) & 0xff);
  for (let y = 0; y < H; y++) for (let x = 0; x < side; x++) set(x, y, (x * 31 + (y % 40) * 5) & 0xff);
  return out;
}
const fg = (rgba) => stitch.prepare(rgba, W, H);

ok('a pinned footer no longer makes every frame unmatchable', () => {
  const a = fg(furnish(view(doc, 0), { bot: 48 }));
  const b = fg(furnish(view(doc, 120), { bot: 48 }));
  const r = stitch.newRowsFor(a, b);
  assert.ok(r, 'refused — this is the 17-out-of-17 bug');
  assert.strictEqual(r.newRows, 120, `said ${r.newRows}, actually 120`);
  assert.ok(Math.abs(r.bottom - 48) <= 8, `footer measured ${r.bottom}, actually 48`);
});
ok('a pinned header is measured and matched around', () => {
  const r = stitch.newRowsFor(fg(furnish(view(doc, 0), { top: 56 })), fg(furnish(view(doc, 90), { top: 56 })));
  assert.ok(r, 'refused');
  assert.strictEqual(r.newRows, 90);
  assert.ok(Math.abs(r.top - 56) <= 12, `header measured ${r.top}, actually 56`);
});
ok('header, footer and a static sidebar all at once', () => {
  const f = { top: 56, bot: 48, side: 60 };
  for (const dy of [8, 41, 137, 220]) {
    const r = stitch.newRowsFor(fg(furnish(view(doc, 0), f)), fg(furnish(view(doc, dy), f)));
    assert.ok(r, `refused a scroll of ${dy}`);
    assert.strictEqual(r.newRows, dy, `said ${r.newRows}, actually ${dy}`);
  }
});
ok('a still screen behind furniture still adds nothing', () => {
  const f = { top: 56, bot: 48, side: 60 };
  assert.strictEqual(stitch.newRowsFor(fg(furnish(view(doc, 300), f)), fg(furnish(view(doc, 300), f))), null);
});
ok('with furniture, a jump past the overlap is still refused', () => {
  const f = { top: 56, bot: 48 };
  assert.strictEqual(stitch.newRowsFor(fg(furnish(view(doc, 0), f)), fg(furnish(view(doc, 900), f))), null);
});
ok('nothing is claimed as new beyond the part of the view that moves', () => {
  const f = { top: 56, bot: 48 };
  const r = stitch.newRowsFor(fg(furnish(view(doc, 0), f)), fg(furnish(view(doc, 280), f)));
  if (r) assert.ok(r.newRows <= H - r.top - r.bottom, `${r.newRows} rows out of a ${H - r.top - r.bottom}-row band`);
});

// ---------- the greyscale reduction itself ----------
ok('the coarse scale shrinks both ways, the fine one keeps every row', () => {
  const p = stitch.prepare(page(40, 1), W, 40);
  assert.strictEqual(p.coarse.w, W / stitch.SHRINK);
  assert.strictEqual(p.coarse.h, 40 / stitch.SHRINK);
  assert.strictEqual(p.fine.w, W / stitch.SHRINK);
  assert.strictEqual(p.fine.h, 40, 'the fine pass must keep full row resolution or odd scrolls never line up');
});
ok('white stays white and black stays black', () => {
  const px = new Uint8Array(8 * 8 * 4).fill(255);
  assert.strictEqual(stitch.grey(px, 8, 8).data[0], 255);
  assert.strictEqual(stitch.grey(new Uint8Array(8 * 8 * 4), 8, 8).data[0], 0);
});

console.log(`stitch: ${pass} checks passed`);
