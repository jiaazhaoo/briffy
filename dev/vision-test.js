// Naming a picture that has no words in it (src/main/vision.js). `node dev/vision-test.js`.
//
// The bug these cases exist for: Apple's calibrated filter is per-class, so a class the classifier
// almost never predicts clears the bar on a confidence of 0.008 -- which is how a blue cartoon
// paperclip came back as "food, animal". Measured over photographs, real labels sit between 0.38 and
// 0.95 and the junk at 0.13 and below, so a flat floor separates them. The last block runs the real
// macOS classifier when there is one; everything above it is pure and runs anywhere.
const vision = require('../src/main/vision.js');
const { hasWords } = require('../src/main/ocr.js');

let pass = 0; let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}
const names = (labels) => vision.pick(labels).map((l) => l.label);

console.log('the gate: OCR noise is not text, and must route to the classifier');
// verbatim from this workspace -- what OCR returns for a photograph of a dog, and of a circuit board
for (const junk of ['', ' \n ', '1', '6', 'N\nN\nM\nX\n2 2', '2 2\n2 2 2 3 2 2 2 2']) {
  check(`${JSON.stringify(junk)} is not text`, !hasWords(junk));
}
// and the thinnest genuine results, which must not be thrown away
for (const real of ['TH16PRO + RAPID COOLING + W DDDDDDDD 手机半',
  'briffy 每天的小记录 三记录测', 'add a payment method ANNUAL MONTHLY save']) {
  check(`${JSON.stringify(real.slice(0, 22))}… is text`, hasWords(real));
}
check('four CJK characters are enough on their own', hasWords('測試繁體中文'));
check('three are not', !hasWords('測試繁'));
check('two latin words are enough', hasWords('ok fine'));
check('one is not', !hasWords('ok'));

console.log('a label below the confidence floor is not a label');
// exactly what Vision returned for the paperclip icon, and for a photograph of two people
const icon = [{ label: 'food', conf: 0.008 }, { label: 'animal', conf: 0 }];
const people = [{ label: 'people', conf: 0.801 }, { label: 'adult', conf: 0.801 },
  { label: 'clothing', conf: 0.132 }, { label: 'food', conf: 0 }];
check('the icon yields nothing at all', names(icon).length === 0, names(icon).join(','));
check('the photograph keeps its real labels', names(people).includes('people'), names(people).join(','));
check('and drops the junk that rode along', !names(people).includes('food') && !names(people).includes('clothing'),
  names(people).join(','));
check('the floor is not so high it empties a photograph',
  names([{ label: 'sky', conf: 0.379 }]).length === 1);

console.log('the specific word comes before the category it belongs to');
// a dog arrives as its whole branch, every level carrying the same confidence
const dog = ['animal', 'canine', 'dog', 'mammal', 'fence'].map((label) => ({ label, conf: 0.436 }));
check('"dog" and "fence" outrank "animal"', names(dog).indexOf('dog') < names(dog).indexOf('animal'),
  names(dog).join(','));
check('but the category is still there', names(dog).includes('mammal'), names(dog).join(','));
check('underscores become spaces',
  names([{ label: 'interior_room', conf: 0.86 }])[0] === 'interior room');
check('an empty identifier is dropped', names([{ label: '  ', conf: 0.9 }]).length === 0);
check('no more than eight survive',
  names(Array.from({ length: 20 }, (_, i) => ({ label: `l${i}`, conf: 0.5 }))).length === 8);
check('an empty input is handled', names([]).length === 0 && vision.pick(null).length === 0);

console.log('flat pictures are drawings, noisy ones are photographs');
function bgra(w, h, fn) {
  const b = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const [r, g, bl] = fn(i % w, Math.floor(i / w));
    b[i * 4] = bl; b[i * 4 + 1] = g; b[i * 4 + 2] = r; b[i * 4 + 3] = 255;
  }
  return b;
}
const flat = vision.shape(bgra(64, 64, () => [16, 82, 232]), 64, 64);
check('one solid colour is maximally flat', flat.flatness === 1, String(flat.flatness));
check('and reads as an illustration', flat.form === 'illustration', flat.form);
check('whose colour is named', flat.colour === 'blue', flat.colour);
check('a single-colour picture names one colour', flat.colours.length === 1, JSON.stringify(flat.colours));

let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % 256; };
const noise = vision.shape(bgra(64, 64, () => [rnd(), rnd(), rnd()]), 64, 64);
// measured on real photographs: 0.16 (a dog), 0.20 (a room), 0.29 (mountains), 0.35 (a screen).
// Icons and app windows measured 0.77 to 0.84, so the 0.6 line has room on both sides.
check('noise lands in the photograph range', noise.flatness < 0.5, String(noise.flatness));
check('and reads as a photograph', noise.form === 'photo', noise.form);

// A red shape on a white ground: the subject names the picture, not the backdrop it sits on. Area
// alone would answer "white" here, and "orange" for a blue paperclip on a peach field.
const halves = vision.shape(bgra(64, 64, (x) => (x < 40 ? [240, 240, 240] : [200, 30, 30])), 64, 64);
check('a two-tone frame is still an illustration', halves.form === 'illustration', String(halves.flatness));
check('the coloured shape names the picture, not the ground', halves.colour === 'red', halves.colour);
check('and the ground is named too, so a two-tone picture is not a coin flip',
  halves.colours.join(',') === 'red,white', halves.colours.join(','));

// but when nothing is colourful, the largest area is all there is to go on
const grey = vision.shape(bgra(64, 64, (x) => (x < 40 ? [30, 30, 30] : [200, 200, 200])), 64, 64);
check('a picture with no colour still gets named', grey.colours.length >= 1, JSON.stringify(grey.colours));

console.log('colours are named the way a person would name them');
for (const [rgb, want] of [[[0, 0, 0], 'black'], [[255, 255, 255], 'white'], [[128, 128, 128], 'grey'],
  [[230, 20, 20], 'red'], [[20, 200, 60], 'green'], [[30, 60, 220], 'blue'],
  [[240, 200, 30], 'yellow'], [[110, 70, 30], 'brown']]) {
  const got = vision.colourName(...rgb);
  check(`rgb(${rgb.join(',')}) is ${want}`, got === want, got);
}

console.log('what the classifier saw is said in the app\'s language');
// These words are all a wordless picture has. OCR text and transcripts are the user's own content and
// stay as captured; these are the app's description of a picture, so they follow the app's language.
const { label } = require('../src/main/vision-labels.js');
check('a translated identifier comes back translated', label('interior_room', 'zh') === '室内房间', label('interior_room', 'zh'));
check('an underscore pair reads as one word', label('sunset_sunrise', 'zh') === '日出日落');
check('English keeps the identifier, spaced out', label('interior_room', 'en') === 'interior room');
check('an untranslated identifier is kept, not dropped', label('anchovy', 'zh') === 'anchovy');
check('and it is still readable in English', label('alligator_crocodile', 'en') === 'alligator crocodile');
check('a word we made up ourselves is translated too', label('illustration', 'zh') === '插画' && label('blue', 'zh') === '蓝色');
check('nothing in is nothing out', label('', 'zh') === '' && label(null, 'en') === '');

console.log('on a machine without the classifier, nothing throws');
(async () => {
  if (!vision.available()) {
    const r = await vision.describe('/nonexistent.png');
    check('describe() answers with an empty list', Array.isArray(r.words) && r.words.length === 0);
  } else {
    const missing = await vision.describe('/nonexistent-image-path.png');
    check('a missing file yields no words, not an exception', missing.words.length === 0, JSON.stringify(missing));
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
