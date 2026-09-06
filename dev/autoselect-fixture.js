'use strict';
// The interface that dev/autoselect-test.js points at, painted into a plain RGBA buffer.
//
// Kept apart from the test because the thresholds in boxes.js were chosen against it too, and a fixture
// that lives inside one test tends to get bent until that test passes. Everything here is stated as a
// rectangle with a known position, and the grey steps between neighbouring surfaces are the point:
//
//   window against desktop        133   nothing has trouble with this
//   toolbar against window         15   about where a half-size pass can still see it
//   toolbar against content        11
//   sidebar against window          9
//   toolbar against sidebar         6   real interfaces separate panels by about this much
//   sidebar against content         5   and sometimes by this much
//   card against content            4   spread over 16 px of shadow, so ~1 a pixel at full size
//
// Those are not invented. A VS Code sidebar against its editor is 7 levels, an ordinary web page's
// #f8f9fa against white is 7, and briffy's own slips are a shadow and nothing else.
//
// The photograph in the corner is here to be the other half of every threshold question: anything low
// enough to find a 5-level panel edge must not turn a photograph into fifty boxes.

const W = 1600; const H = 1000;

const DESKTOP = [122, 122, 128];
const WINDOW = [255, 255, 255];
const TOOLBAR = [240, 240, 242];
const SIDEBAR = [246, 246, 248];
const CONTENT = [251, 251, 253];
const CARD = [255, 255, 255];
const TEXT = [40, 40, 44];

const win = { x: 120, y: 90, w: 1200, h: 800 };
const toolbar = { x: 120, y: 90, w: 1200, h: 56 };
// Inset, so that the window has some of itself showing. Without that margin the toolbar, the sidebar
// and the content tile the window exactly, there is no pixel that belongs to the window alone, and a
// probe meant for the window lands on the content -- which `at` answers correctly and which looks,
// from the outside, exactly like a failure to find the window.
const sidebar = { x: 136, y: 162, w: 244, h: 712 };
const content = { x: 396, y: 162, w: 908, h: 712 };
const cards = [
  { x: 420, y: 190, w: 860, h: 200 },
  { x: 420, y: 420, w: 860, h: 200 },
  { x: 420, y: 650, w: 860, h: 140 },
];
const icon = { x: 150, y: 176, w: 20, h: 20 };
const PHOTO = { x: 420, y: 810, w: 300, h: 60 };

function build() {
  const px = new Uint8ClampedArray(W * H * 4);
  const fill = (x, y, w, h, [r, g, b]) => {
    for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy++) {
      for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx++) {
        const i = ((yy * W) + xx) * 4;
        px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
      }
    }
  };
  /** A shadow like the one under a slip: spread so wide that no two neighbouring pixels differ much. */
  const shadow = (x, y, w, h, spread, ground) => {
    for (let d = spread; d >= 1; d--) {
      const t = (spread - d + 1) / spread;
      const c = ground.map((v) => Math.round(v - (18 * t)));
      fill(x - d, y - d, w + (2 * d), h + (2 * d), c);
    }
  };

  fill(0, 0, W, H, DESKTOP);
  fill(win.x, win.y, win.w, win.h, WINDOW);
  fill(toolbar.x, toolbar.y, toolbar.w, toolbar.h, TOOLBAR);
  fill(sidebar.x, sidebar.y, sidebar.w, sidebar.h, SIDEBAR);
  fill(content.x, content.y, content.w, content.h, CONTENT);
  fill(icon.x, icon.y, icon.w, icon.h, TEXT);
  for (const c of cards) { shadow(c.x, c.y, c.w, c.h, 16, CONTENT); fill(c.x, c.y, c.w, c.h, CARD); }

  // A paragraph in the middle card: the shape that must stay words rather than becoming boxes.
  const lines = [];
  for (let i = 0; i < 6; i++) {
    const y = cards[1].y + 30 + (i * 26);
    let x = cards[1].x + 24;
    const row = [];
    while (x < cards[1].x + cards[1].w - 120) {
      const wl = 40 + (((i * 37) + x) % 90);
      fill(x, y, wl, 14, TEXT);
      row.push({ x, y, w: wl, h: 14 });
      x += wl + 14;
    }
    lines.push(row);
  }

  // A photograph: no straight edges, no flat fills, nothing anybody wants a box around.
  let seed = 7;
  const rnd = () => { seed = ((seed * 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let yy = PHOTO.y; yy < PHOTO.y + PHOTO.h; yy++) {
    for (let xx = PHOTO.x; xx < PHOTO.x + PHOTO.w; xx++) {
      const i = ((yy * W) + xx) * 4;
      const base = 90 + (110 * Math.sin((xx / 23) + Math.cos(yy / 17)));
      const v = Math.max(0, Math.min(255, base + ((rnd() - 0.5) * 60)));
      px[i] = v; px[i + 1] = v * 0.85; px[i + 2] = v * 0.7; px[i + 3] = 255;
    }
  }

  // Not the whole window. A flood fill cannot return one: the toolbar's own edge runs the full width
  // and cuts the window in two, so what comes back is the toolbar and the body beneath it. That is
  // right rather than a shortfall -- selecting a whole window is what the window list is for, and
  // boxes.js says so itself -- but it does mean the thing to expect here is the body.
  const body = { x: win.x, y: toolbar.y + toolbar.h, w: win.w, h: win.h - toolbar.h };
  // The content panel is deliberately not in here. It sits four grey levels off the window behind it,
  // and every pass averages a boundary block with both its sides, so that step halves before any
  // threshold sees it. No setting that also leaves a photograph alone can find it. What happens instead
  // is checked at the end of the test, as the limit it is.
  const want = {
    body: { box: body, probe: [win.x + win.w - 8, win.y + win.h - 8] },
    toolbar: { box: toolbar, probe: [toolbar.x + 900, toolbar.y + 28] },
    sidebar: { box: sidebar, probe: [sidebar.x + 130, sidebar.y + 500] },
    card1: { box: cards[0], probe: [cards[0].x + 400, cards[0].y + 100] },
    card2: { box: cards[1], probe: [cards[1].x + 800, cards[1].y + 180] },
    card3: { box: cards[2], probe: [cards[2].x + 400, cards[2].y + 70] },
  };
  return { px, W, H, want, lines, cards, icon, win, toolbar, sidebar, content };
}

module.exports = { build, W, H, PHOTO, TEXT };
