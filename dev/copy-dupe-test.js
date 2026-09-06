// One copy, one record (src/main/workspace.js — copyIdentity / findCopy).
//
//   npx electron dev/copy-dupe-test.js
//
// Runs the real ingest against a throwaway workspace, so nothing of the user's is touched.
//
// The accident these cases exist for: a single copy reaches the clipboard in more than one shape and
// each shape is filed separately. One WeChat screenshot did exactly that — a temporary file and a
// bitmap, nine seconds apart, 4.3 MB of JPEG and 16.6 MB of PNG, not a byte in common. Text and links
// have the same hazard, so they are checked here too.
const { app, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0; let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-copy-')));

app.whenReady().then(async () => {
  const { Store } = require('../src/main/store');
  const workspace = require('../src/main/workspace');
  const store = new Store();
  store.init();
  store.updateSettings({ clipboardWatch: false, ocrDroppedImages: false });
  workspace.init({ store, windows: { setPetState() {}, getState: () => 'idle', hideForCapture: async () => 0, restoreAfterCapture() {}, broadcastToWorkspace() {} } });
  const count = () => store.listDates().reduce((n, d) => n + store.loadDay(d).length, 0);
  const clip = { origin: 'clipboard', quiet: true };

  console.log('a picture that arrives as a file and then as a bitmap');
  const src = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png'));
  const asJpeg = path.join(app.getPath('userData'), 'shot.jpg');
  fs.writeFileSync(asJpeg, src.toJPEG(85));
  let n = count();
  await workspace.ingestFiles([asJpeg], clip);
  check('the file is filed', count() === n + 1, `${n} -> ${count()}`);
  n = count();
  check('the bitmap is recognised as the same picture', (await workspace.ingestClipboardImage(src.toPNG())) === null);
  check('and adds no record', count() === n);
  const other = nativeImage.createFromBuffer(src.resize({ width: 120 }).toPNG());
  check('a different picture still gets in', (await workspace.ingestClipboardImage(other.toPNG())) !== null);

  console.log('the same passage, whitespace aside');
  n = count();
  await workspace.ingestNote('明天上午和产品团队开会\n讨论第三季度预算', clip);
  check('the passage is filed', count() === n + 1);
  n = count();
  check('trailing spaces do not make it a new passage',
    (await workspace.ingestNote('明天上午和产品团队开会  \r\n讨论第三季度预算 ', clip)) === null);
  check('and add no record', count() === n);
  check('a different passage is still filed', (await workspace.ingestNote('完全不同的一段文字', clip)) !== null);
  check('typing a note yourself is never suppressed',
    (await workspace.ingestNote('明天上午和产品团队开会\n讨论第三季度预算', { quiet: true })) !== null);

  console.log('one link, however it was saved');
  n = count();
  await workspace.ingestUrl('https://example.com/a?x=1', clip);
  check('the link is filed', count() === n + 1);
  check('copying it again the same day is not a second record',
    (await workspace.ingestUrl('https://example.com/a?x=1', clip)) === null);
  check('a different link still is', (await workspace.ingestUrl('https://example.com/b', clip)) !== null);

  console.log('the identity is on the record, so a restart does not forget it');
  store.flushAll();
  const again = new Store();
  again.init();
  const withIds = again.listEntries({ limit: 50 }).filter((e) => e.copyId);
  check('records carry their copy identity', withIds.length >= 4, String(withIds.length));
  check('a picture identity keeps its size', withIds.some((e) => /^pic:\d+x\d+:[01]{64}$/.test(e.copyId)),
    withIds.map((e) => e.copyId.slice(0, 14)).join(' '));

  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
}).catch((e) => { console.error('SETUP FAILED', e); app.exit(1); });
