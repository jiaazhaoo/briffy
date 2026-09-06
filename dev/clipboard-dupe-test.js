// One picture, one record — even when the clipboard hands it over twice in two shapes.
//
//   npx electron dev/clipboard-dupe-test.js <a.jpg> <b.png>
//
// Runs the real ingest against a throwaway workspace, so nothing of the user's is touched. Give it
// two encodings of the same picture (the bug was a WeChat screenshot arriving as a temporary file and
// then as a bitmap, nine seconds apart); with no arguments it makes its own pair.
const { app, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0; let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-dupe-')));

app.whenReady().then(async () => {
  const { Store } = require('../src/main/store');
  const workspace = require('../src/main/workspace');
  const store = new Store();
  store.init();
  store.updateSettings({ clipboardWatch: false, ocrDroppedImages: false, smartTags: false });
  workspace.init({ store, windows: { setPetState() {}, getState: () => 'idle', hideForCapture: async () => 0, restoreAfterCapture() {}, broadcastToWorkspace() {} } });

  let [a, b] = process.argv.slice(2).filter((x) => !x.startsWith('-'));
  if (!a || !fs.existsSync(a)) {
    // two encodings of one picture, made here so the test stands on its own
    const src = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png'));
    a = path.join(app.getPath('userData'), 'made.jpg');
    b = path.join(app.getPath('userData'), 'made.png');
    fs.writeFileSync(a, src.toJPEG(82));
    fs.writeFileSync(b, src.toPNG());
  }
  console.log(`the same picture, as ${path.basename(a)} (${(fs.statSync(a).size / 1e6).toFixed(1)} MB) and ${path.basename(b)} (${(fs.statSync(b).size / 1e6).toFixed(1)} MB)`);

  const count = () => store.listDates().reduce((n, d) => n + store.loadDay(d).length, 0);
  const before = count();

  // 1. the clipboard offers the temporary file, and it is filed
  await workspace.ingestFiles([a], { origin: 'clipboard', quiet: true });
  const afterFile = count();
  check('the file is filed', afterFile === before + 1, `${before} -> ${afterFile}`);

  // 2. seconds later the same picture arrives as a bitmap
  const asBitmap = await workspace.ingestClipboardImage(fs.readFileSync(b));
  const afterBitmap = count();
  check('the bitmap is recognised as the same picture', asBitmap === null);
  check('and no second record appears', afterBitmap === afterFile, `${afterFile} -> ${afterBitmap}`);

  // 3. a genuinely different picture still gets in
  const other = path.join(app.getPath('userData'), 'other.png');
  const img = nativeImage.createFromBuffer(fs.readFileSync(b)).resize({ width: 200 });
  const inverted = Buffer.from(img.toBitmap());
  for (let i = 0; i < inverted.length; i += 4) { inverted[i] = 255 - inverted[i]; inverted[i + 1] = 255 - inverted[i + 1]; inverted[i + 2] = 255 - inverted[i + 2]; }
  const size = img.getSize();
  fs.writeFileSync(other, nativeImage.createFromBitmap(inverted, size).toPNG());
  await workspace.ingestClipboardImage(fs.readFileSync(other));
  check('a different picture is still filed', count() === afterBitmap + 1, `${afterBitmap} -> ${count()}`);

  // 4. the deterministic half: shapes seen together are one event, whichever one we file
  const cw = require('../src/main/clipboard-watch');
  const both = { types: ['text/uri-list', 'image/png'], files: ['/tmp/shot.png'], text: '', png: fs.readFileSync(b) };
  const [fileSig, imageSig] = cw.signatures(both);
  cw.noteOtherShapes(both, fileSig);
  check('the shape we filed is not suppressed later', !cw.isOtherShape(fileSig));
  check('the shape we left behind is', cw.isOtherShape(imageSig));
  check('and only once, so copying it again still counts', !cw.isOtherShape(imageSig));
  cw.noteOtherShapes({ types: ['text/plain'], files: [], text: 'just some words', png: null }, 'text:none');
  check('a copy with one shape leaves nothing behind', !cw.isOtherShape(cw.signatures({ types: [], files: [], text: '', png: null })[0] || 'x'));

  console.log(`\n${pass} passed, ${fail} failed`);
  store.flushAll();
  app.exit(fail ? 1 : 0);
}).catch((e) => { console.error('SETUP FAILED', e); app.exit(1); });
