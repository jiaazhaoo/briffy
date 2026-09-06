'use strict';
// End-to-end, under Electron, against a throwaway userData -- the user's own workspace is never touched.
// Saves a picture with words in it and a note, then checks that the record knows where it came from,
// that the OCR line boxes were written beside it, that briffy left a mark for the day, and that the
// recap can be produced by counting alone.
//
//   npx electron dev/context-ingest-test.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app } = require('electron');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-ctx-'));
app.setPath('userData', TMP);

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await app.whenReady();

  const { Store, localDateKey } = require('../src/main/store');
  const workspace = require('../src/main/workspace');
  const uptime = require('../src/main/uptime');
  const dayStats = require('../src/main/day-stats');
  const ocrBoxes = require('../src/main/ocr-boxes');
  const foreground = require('../src/main/foreground');

  const store = new Store();
  store.init();
  store.updateSettings({ languages: ['zh-Hans', 'en'], ocrDroppedImages: true, recordContext: true });

  // The pet and its balloon are not running, so everything the pipeline says goes nowhere.
  const windows = {
    setPetState() {}, getState: () => 'idle', broadcastToWorkspace() {}, sendPetCommand() {},
    hideForCapture: async () => 0, restoreAfterCapture() {}, openWorkspace() {},
  };
  workspace.init({ store, windows });
  uptime.init({ store });

  // ---------- 1. what this machine can tell us ----------
  const probe = await foreground.probe();
  check('the front app can be read', probe.ok && !!probe.app, `app=${probe.app || '-'} window=${probe.window || '(needs Accessibility)'}`);

  // A tab pushed by the extension is remembered; anything that is not a web page is not.
  foreground.noteTab({ url: 'https://example.com/a', title: 'Example' });
  foreground.noteTab({ url: 'chrome://settings', title: 'Settings' });
  const ctx = await foreground.read({ maxAgeMs: 0 });
  check('reading context never throws and never blocks', true, ctx ? `${ctx.app}${ctx.window ? ` / ${ctx.window}` : ''}` : 'briffy itself (correctly ignored)');

  // ---------- 2. a picture with words in it ----------
  const sample = process.env.CTX_IMAGE || findSampleScreenshot();
  let picture = null;
  if (sample) {
    const t0 = Date.now();
    const [entry] = await workspace.ingestFiles([sample], { quiet: true });
    const saveMs = Date.now() - t0;
    check('saving is not slowed down by looking up the context', saveMs < 400, `${saveMs} ms`);
    picture = entry;
    // wait for the queue: OCR on a 4K screenshot takes a few seconds
    for (let i = 0; i < 120 && store.getEntry(entry.id).status === 'processing'; i++) await sleep(500);
    const done = store.getEntry(entry.id);
    check('the picture was read', done.status !== 'error', done.error || `${(done.text || '').length} chars`);
    check('the line boxes were kept', done.ocrBoxes > 0, `${done.ocrBoxes || 0} lines`);
    const boxes = ocrBoxes.load(done);
    if (boxes) {
      const inside = boxes.lines.every(([x, y, w, h]) => x >= 0 && y >= 0 && x + w <= boxes.w + 1 && y + h <= boxes.h + 1);
      check('every box lies inside the picture', inside, `${boxes.w}x${boxes.h}`);
      check('every box carries its own text', boxes.lines.every((l) => typeof l[5] === 'string' && l[5].length), '');
      const bytes = fs.statSync(path.join(store.paths().ocr, done.dateKey, `${done.id}.json`)).size;
      check('the sidecar is small', bytes < 200 * 1024, `${(bytes / 1024).toFixed(1)} KB`);
    } else {
      check('every box lies inside the picture', false, 'no sidecar written');
    }
  } else {
    console.log('skip picture checks: no sample screenshot found (set CTX_IMAGE)');
  }

  // ---------- 3. a note, pinned, with a line of its own ----------
  const note = await workspace.ingestNote('Postgres: FATAL role "briffy" does not exist', { quiet: true });
  await sleep(300);
  store.updateEntry(note.id, { pinned: true, note: '记得改连接串' });
  const pinned = store.pinnedEntries();
  check('a pinned record is findable', pinned.length === 1 && pinned[0].id === note.id, '');
  check('the note survives on the record', store.getEntry(note.id).note === '记得改连接串', '');
  check('search reaches the note text', store.listEntries({ query: '连接串' }).length === 1, '');
  check('the pinned filter works', store.listEntries({ pinned: true }).length === 1, '');
  check('stats count what is pinned', store.stats().pinned === 1, '');

  // ---------- 4. briffy leaves a mark for the day ----------
  uptime.start();
  uptime.flush();
  const today = localDateKey();
  const up = uptime.forDate(today);
  check('the day is marked as watched', up.slots.length >= 1, `${up.minutes} min, from ${uptime.clock(up.firstSlot)}`);
  check('the mark is on disk', fs.existsSync(path.join(store.paths().uptime, `${today}.json`)), '');

  // ---------- 5. the recap can be produced by counting ----------
  const st = dayStats.stats(store.entriesForDate(today), { uptime: up });
  check('the day counts up', st.total === (picture ? 2 : 1) && st.status === 'ok', `${st.total} kept, status ${st.status}`);
  const counted = dayStats.asLines(st, { dateKey: today });
  check('the counted lines mention the kinds', /note/.test(counted), counted.split('\n')[1] || '');

  const quiet = dayStats.stats([], { uptime: { slots: [1, 2], minutes: 10, firstSlot: 1, lastSlot: 2 } });
  const never = dayStats.stats([], { uptime: { slots: [], minutes: 0, firstSlot: -1, lastSlot: -1 } });
  check('a quiet day and an unattended one are told apart', quiet.status === 'idle' && never.status === 'off', '');

  uptime.stop();
  store.flushAll();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* leave it */ }
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('TEST_ERROR', e && e.stack || e); process.exit(1); });

/** A screenshot from the user's own workspace makes the best sample; it is only read, never changed. */
function findSampleScreenshot() {
  const roots = [
    path.join(os.homedir(), 'Library', 'Application Support', 'briffy', 'workspace', 'screenshots'),
    path.join(os.homedir(), 'Library', 'Application Support', 'DailyLogs', 'workspace', 'screenshots'),
  ];
  for (const root of roots) {
    let days = [];
    try { days = fs.readdirSync(root).sort().reverse(); } catch (_) { continue; }
    for (const day of days) {
      let files = [];
      try { files = fs.readdirSync(path.join(root, day)).filter((f) => f.endsWith('.png')); } catch (_) { continue; }
      if (files.length) return path.join(root, day, files[0]);
    }
  }
  return '';
}
