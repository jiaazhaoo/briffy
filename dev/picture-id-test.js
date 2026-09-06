// Telling one picture from another when the bytes differ (src/main/picture-id.js).
// `node dev/picture-id-test.js` — the pure half runs anywhere; the half that decodes a real image
// needs Electron, so run it with `npx electron dev/picture-id-test.js` to cover that too.
//
// The bug these cases exist for: one WeChat screenshot produced two records. The clipboard offered
// the same photograph as a temporary file and as a bitmap, seconds apart, and nothing tied them
// together — a 4.3 MB JPEG and a 16.6 MB PNG, both 4096x3072, identical to the eye, no byte shared.
const { distance, alike, recentPictures, NEAR } = require('../src/main/picture-id.js');

let pass = 0; let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}
const bits = (s) => s.padEnd(64, '0');
const fp = (w, h, b) => `${w}x${h}:${bits(b)}`;
const flip = (f, n) => { const [d, b] = f.split(':'); const a = [...b]; for (let i = 0; i < n; i++) a[i] = a[i] === '1' ? '0' : '1'; return `${d}:${a.join('')}`; };
const base = fp(4096, 3072, '0100111001100110011001100010001000110101110011011100001011010000');

console.log('the same picture re-encoded is still the same picture');
check('nothing changed', distance(base, base) === 0);
check('the noise a re-encode adds still matches', alike(base, flip(base, NEAR)), String(distance(base, flip(base, NEAR))));
check('one bit past the line does not', !alike(base, flip(base, NEAR + 1)));
check('a different picture does not', !alike(base, fp(4096, 3072, '1'.repeat(64))));
// two variants of one drawn logo came 4 bits apart at different sizes: neither half may match alone
check('a close picture at another size is not the same picture', !alike(base, flip(fp(4090, 3072, base.split(':')[1]), 1)));
check('the same bits at another size never match', distance(base, fp(1410, 1390, base.split(':')[1])) === Infinity);
check('a missing fingerprint never matches', !alike('', base) && !alike(base, ''));

console.log('the memory forgets, so copying something again still records it');
const seen = recentPictures(1000);
const t0 = 1000000;
check('a picture nobody has filed is new', !seen.saw(base, t0));
seen.remember(base, t0);
check('the same one a second later is not', seen.saw(flip(base, 2), t0 + 500), 'should match within the window');
check('and past the window it is again', !seen.saw(base, t0 + 1500));
seen.remember(fp(8, 8, '1010'), t0 + 1500);
check('remembering prunes what expired', seen.size === 1, String(seen.size));
const many = recentPictures(60000);
for (let i = 0; i < 20; i++) many.remember(flip(fp(9, 9, '1'.repeat(64)), i), t0 + i);
check('the memory stays small', many.size <= 12, String(many.size));

// Only under Electron: decode two real encodings of one picture and check they land together.
if (process.versions && process.versions.electron) {
  const { app } = require('electron');
  const fs = require('fs');
  const { fingerprint } = require('../src/main/picture-id.js');
  app.whenReady().then(() => {
    const a = process.argv[2]; const b = process.argv[3];
    if (a && b && fs.existsSync(a) && fs.existsSync(b)) {
      const fa = fingerprint(fs.readFileSync(a));
      const fb = fingerprint(fs.readFileSync(b));
      check('two encodings of one picture match', alike(fa, fb), `distance ${distance(fa, fb)}`);
      check('a fingerprint carries its size', /^\d+x\d+:[01]{64}$/.test(fa), fa.slice(0, 24));
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    app.exit(fail ? 1 : 0);
  });
} else {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
