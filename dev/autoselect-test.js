'use strict';
// What hovering offers you, measured.
//
//   node dev/autoselect-test.js
//
// The other half of dev/boxes-test.js, not a replacement for it. That one photographs a real interface
// and asks whether the detector finds a toolbar in a picture of a toolbar, which is the right question
// and needs a browser to ask. This one paints the interface itself, so that the grey step across every
// boundary is a number chosen in advance rather than whatever the renderer happened to produce.
//
// That difference is what this is for. boxes-test.js draws its panels with hairlines, which are easy to
// see, and it passed for months while pointing at a sidebar offered the whole window body instead --
// because a sidebar is not separated by a line, it is separated by about nine levels of grey, and a
// boundary block averages that down to four before any threshold sees it. Nothing here has a border.
//
// No browser needed either way: boxes.js takes plain arrays and returns plain numbers. The interface is
// dev/autoselect-fixture.js, where every rectangle's position is known exactly.
const boxes = require('../src/renderer/region/boxes');
const fixture = require('../dev/autoselect-fixture');

let pass = 0; let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}${detail ? `  ${detail}` : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

const { px, W, H, want, lines, cards, icon, content } = fixture.build();

const t0 = Date.now();
const found = boxes.find(px, W, H, 1);
const ms = Date.now() - t0;
const at = (x, y) => boxes.at(found, x, y, { maxW: W, maxH: H });
const near = (got, wanted, slack = 10) => !!got
  && Math.abs(got.x - wanted.x) <= slack && Math.abs(got.y - wanted.y) <= slack
  && Math.abs(got.w - wanted.w) <= slack * 2 && Math.abs(got.h - wanted.h) <= slack * 2;
const show = (b) => (b ? `${b.x},${b.y} ${b.w}x${b.h}` : 'nothing');

check('it finds something to offer', found.length > 3, `${found.length} boxes in ${ms}ms`);
// The overlay runs this once, while it is opening, over the whole screen. On a real 5504x2304 screen
// it is about 115 ms; this fixture is a twentieth of that area.
check('it is quick enough to run while the overlay opens', ms < 200, `${ms}ms on ${W}x${H}`);

// ---------- the elements, each pointed at where somebody would point ----------
for (const [name, { box, probe }] of Object.entries(want)) {
  const got = at(probe[0], probe[1]);
  check(`pointing at the ${name} offers the ${name}`, near(got, box), `${show(got)}, wanted ${show(box)}`);
}

// The one the coarse pass exists for: these cards have no border, only a shadow spread over 16 px, so
// no two neighbouring pixels differ by more than about one level. It is briffy's own look.
check('a card bounded by nothing but a shadow still comes back',
  near(at(cards[1].x + 800, cards[1].y + 180), cards[1]), show(at(cards[1].x + 800, cards[1].y + 180)));

// ---------- and the things it must not offer ----------
const word = lines[2][1];
check('pointing at a line of text offers what the text is written on, not the words',
  near(at(word.x + 4, word.y + 7), cards[1]), `${show(at(word.x + 4, word.y + 7))}, wanted ${show(cards[1])}`);
check('no word became a box of its own',
  !found.some((b) => lines.some((row) => row.some((l) => near(b, l, 4)))), '46 words');
check('a 20px icon is too small to be worth offering',
  !found.some((b) => near(b, icon, 4)), show(found.find((b) => near(b, icon, 4))));
check('the desktop is never offered',
  !found.some((b) => b.w >= W - 2 && b.h >= H - 2 && at(20, 20) === b), show(at(20, 20)));

// Nested panels: the innermost thing under the pointer, never its container.
const inner = at(cards[0].x + 10, cards[0].y + 10);
check('where boxes sit inside boxes it offers the innermost',
  near(inner, cards[0]), `${show(inner)}, wanted ${show(cards[0])}`);

// ---------- what it cannot do, written down so it stays known ----------
// A content area against its window is four grey levels. Halved by the averaging every pass does at a
// boundary, that is below any threshold that would still leave a photograph alone. Pointing at empty
// content therefore offers the window body, which is a reasonable thing to be given, and the exact
// selection is a drag away. Window snapping covers the rest.
const empty = at(content.x + 880, content.y + 690);
check('an unfindable content panel falls back to something sensible rather than nothing',
  !!empty && empty.w >= content.w && !(empty.w >= W - 2 && empty.h >= H - 2), show(empty));

console.log(`\nautoselect: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
