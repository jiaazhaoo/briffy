'use strict';
// A clipboard copy is saved without the cat saying anything.
//
//   npx electron dev/clipboard-quiet-test.js
//
// Copying happens dozens of times an hour without meaning to file anything, so a balloon for each one
// turns the pet into a nuisance. The end of the pipeline has always known this (processEntry returns
// early for `origin: 'clipboard'`), but the watcher used to announce the moment a copy landed, before
// any of that ran. This drives the real watcher against the real system clipboard and records every
// order the pet is given: the record must still be filed, and not one of those orders may carry words.
//
// A capture (the hotkey) still speaks, and that is checked too -- silence is the rule for copying, not
// for everything.
const { app, clipboard, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0; let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-quiet-'));
app.setPath('userData', TMP);

app.whenReady().then(async () => {
  const { Store } = require('../src/main/store');
  const workspace = require('../src/main/workspace');
  const clipboardWatch = require('../src/main/clipboard-watch');

  const store = new Store();
  store.init();
  store.updateSettings({ clipboardWatch: true, clipboardMinChars: 4, ocrDroppedImages: false, recordContext: false });

  // Every order the pet is given, in order. `message` is what would appear in the balloon.
  const said = [];
  const windows = {
    setPetState(state, opts = {}) { said.push({ state, message: opts.message || '' }); },
    getState: () => 'idle',
    hideForCapture: async () => 0,
    restoreAfterCapture() {},
    broadcastToWorkspace() {},
  };
  workspace.init({ store, windows });

  const count = () => store.listDates().reduce((n, d) => n + store.loadDay(d).length, 0);
  const spoken = () => said.filter((x) => x.message);

  // The watcher takes the current clipboard as its starting point, so whatever the user happens to
  // have copied is not filed by this test.
  clipboardWatch.start({ store, workspace });
  await sleep(1200);
  said.length = 0;

  // ---------- 1. copied text ----------
  const before = count();
  const text = `briffy quiet test ${Date.now()} — a passage long enough to be worth filing`;
  clipboard.writeText(text);
  await sleep(2500);
  check('a copied passage is filed', count() > before, `${count() - before} new`);
  check('and the cat says nothing about it', spoken().length === 0,
    spoken().map((x) => `${x.state}: ${x.message}`).join(' | '));

  // ---------- 2. a copied picture ----------
  said.length = 0;
  const afterText = count();
  clipboard.write([new (require('electron').ClipboardItem)({
    'image/png': new Blob([nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png')).toPNG()], { type: 'image/png' }),
  })]);
  await sleep(2500);
  check('a copied picture is filed', count() > afterText, `${count() - afterText} new`);
  check('and the cat says nothing about that either', spoken().length === 0,
    spoken().map((x) => `${x.state}: ${x.message}`).join(' | '));

  clipboardWatch.stop();

  // ---------- 3. everything else still speaks ----------
  said.length = 0;
  await workspace.ingestNote('a note the user typed on purpose', { origin: '' });
  check('a note saved on purpose is still announced', spoken().length > 0,
    spoken().map((x) => x.message).join(' | ') || 'nothing said');

  said.length = 0;
  await workspace.ingestNote('another clipboard passage entirely', { origin: 'clipboard', quiet: true });
  check('the same note arriving from the clipboard is not', spoken().length === 0,
    spoken().map((x) => x.message).join(' | '));

  // ---------- 4. no dead strings left behind ----------
  const i18n = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'i18n.js'), 'utf8');
  check('the announcement strings are gone', !/clipSaved/.test(i18n), 'clipSaved… still in i18n.js');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  const watch = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'clipboard-watch.js'), 'utf8');
  check('and so is the hook they hung on', !/onCapture/.test(main) && !/onCapture/.test(watch), '');

  console.log(`\n${pass} passed, ${fail} failed`);
  store.flushAll();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* leave it */ }
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('TEST_ERROR', e && e.stack || e); process.exit(1); });
