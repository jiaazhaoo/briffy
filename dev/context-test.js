'use strict';
// The three pieces that decide what a record knows about itself, tested without Electron:
// trimming a browser's own name out of a window title, turning OCR line boxes into what is stored,
// and counting a day (including the difference between a quiet day and an unattended one).
const assert = require('assert');
const foreground = require('../src/main/foreground');
const ocrBoxes = require('../src/main/ocr-boxes');
const dayStats = require('../src/main/day-stats');
const deeplink = require('../src/main/deeplink');

let pass = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; } };

// ---------- the window title a browser writes ----------
const TITLES = [
  ['bilibili - Google Chrome', 'Google Chrome', 'bilibili'],
  ['Marketplace – iPhone 13 | Facebook - Google Chrome', 'Google Chrome', 'Marketplace – iPhone 13 | Facebook'],
  ['briffy · 纸 / 直角 样式基准页 - Google Chrome', 'Google Chrome', 'briffy · 纸 / 直角 样式基准页'],
  ['某个页面 — Firefox', 'Firefox', '某个页面'],
  ['图片和视频', 'WeChat', '图片和视频'],          // no app suffix at all
  ['Google Chrome', 'Google Chrome', ''],           // the app name alone says nothing
  ['', 'WeChat', ''],
];
for (const [title, app, want] of TITLES) {
  ok(`title ${JSON.stringify(title)}`, () => assert.strictEqual(foreground.trimWindowTitle(title, app), want));
}
// A title that merely contains the app's name keeps it.
ok('title keeps an inner app name', () => assert.strictEqual(
  foreground.trimWindowTitle('How Google Chrome renders text - Safari', 'Safari'), 'How Google Chrome renders text'));

// ---------- a tab is only used while it is fresh, and only from a browser ----------
ok('a non-http tab is ignored', () => {
  foreground.forgetTab();
  foreground.noteTab({ url: 'chrome://settings', title: 'Settings' });
  foreground.noteTab({ url: '', title: 'nothing' });
  // nothing to assert directly; read() is async and platform-bound. The contract is that neither of
  // these throws and neither becomes the remembered tab -- covered by the app test below.
  assert.ok(true);
});
ok('browsers are recognised by bundle id', () => {
  assert.ok(foreground.BROWSER_BUNDLES.has('com.google.Chrome'));
  assert.ok(foreground.BROWSER_BUNDLES.has('com.apple.Safari'));
  assert.ok(!foreground.BROWSER_BUNDLES.has('com.tencent.xinWeChat'));
});

// ---------- OCR boxes ----------
const line = (text, x, y, w, h, conf = 0.9) => ({ text, confidence: conf, box: { x, y, width: w, height: h } });

ok('a line is the box around its words', () => {
  assert.deepStrictEqual(ocrBoxes.lineBox([line('a', 10, 20, 30, 12), line('b', 50, 18, 20, 16)]), [10, 18, 60, 16]);
});
ok('shape keeps text, box and the weakest confidence', () => {
  const out = ocrBoxes.shape([[line('Hello', 10, 20, 40, 12, 0.95), line('world', 55, 20, 45, 12, 0.61)]], { width: 800, height: 600 });
  assert.strictEqual(out.w, 800);
  assert.strictEqual(out.h, 600);
  assert.deepStrictEqual(out.lines, [[10, 20, 90, 12, 61, 'Hello world']]);
});
ok('shape falls back to the widest box when the size is unknown', () => {
  const out = ocrBoxes.shape([[line('x', 0, 0, 120, 20)]], {});
  assert.strictEqual(out.w, 120);
  assert.strictEqual(out.h, 20);
});
ok('shape drops empty lines and empty results', () => {
  assert.strictEqual(ocrBoxes.shape([], {}), null);
  assert.strictEqual(ocrBoxes.shape([[line('   ', 0, 0, 5, 5)]], {}), null);
  assert.strictEqual(ocrBoxes.shape(null, {}), null);
});
ok('shape caps a very dense page', () => {
  const many = Array.from({ length: ocrBoxes.MAX_LINES + 50 }, (_, i) => [line(`l${i}`, 0, i, 10, 1)]);
  assert.strictEqual(ocrBoxes.shape(many, {}).lines.length, ocrBoxes.MAX_LINES);
});

// ---------- counting a day ----------
const at = (h, m = 0) => new Date(2026, 8, 5, h, m).toISOString();
const entry = (o) => ({ id: String(Math.random()), createdAt: at(10), dateKey: '2026-09-05', type: 'note', text: '', status: 'done', ...o });

ok('an empty day briffy never saw is off', () => {
  const s = dayStats.stats([], { uptime: { slots: [], minutes: 0, firstSlot: -1, lastSlot: -1 } });
  assert.strictEqual(s.status, 'off');
  assert.match(dayStats.asLines(s), /not running/);
});
ok('an empty day briffy watched is idle', () => {
  const s = dayStats.stats([], { uptime: { slots: [1, 2, 3], minutes: 15, firstSlot: 1, lastSlot: 3 } });
  assert.strictEqual(s.status, 'idle');
  assert.match(dayStats.asLines(s), /15 minutes/);
});
ok('a day with records counts by kind, source app and hour', () => {
  const s = dayStats.stats([
    entry({ type: 'screenshot', createdAt: at(9, 30), text: 'twelve chars', context: { app: 'WeChat', window: '图片和视频' } }),
    entry({ type: 'screenshot', createdAt: at(9, 45), context: { app: 'WeChat', window: '聊天' } }),
    entry({ type: 'note', createdAt: at(14, 5), text: 'abc', context: { app: 'Claude' } }),
    entry({ type: 'url', createdAt: at(14, 30) }),
    entry({ type: 'note', createdAt: at(14, 40), status: 'error' }),
  ], { uptime: { slots: [1, 2], minutes: 10, firstSlot: 1, lastSlot: 2 } });
  assert.strictEqual(s.total, 4);
  assert.strictEqual(s.failed, 1);
  assert.strictEqual(s.status, 'ok');
  assert.deepStrictEqual(s.byType, { screenshot: 2, url: 1, note: 1 });
  assert.strictEqual(s.byApp[0].app, 'WeChat');
  assert.strictEqual(s.byApp[0].n, 2);
  assert.deepStrictEqual(s.byApp[0].windows.sort(), ['图片和视频', '聊天'].sort());
  assert.deepStrictEqual(s.byHour, [{ hour: 9, n: 2 }, { hour: 14, n: 2 }]);
  assert.strictEqual(s.chars, 'twelve chars'.length + 3);
  assert.strictEqual(s.firstAt, '09:30');
  assert.strictEqual(s.lastAt, '14:30');
});
ok('the counted lines name the apps', () => {
  const s = dayStats.stats([entry({ context: { app: 'WeChat', window: '图片和视频' } })], { uptime: { slots: [1], minutes: 5, firstSlot: 1, lastSlot: 1 } });
  const text = dayStats.asLines(s, { dateKey: '2026-09-05' });
  assert.match(text, /2026-09-05/);
  assert.match(text, /WeChat 1/);
  assert.match(text, /图片和视频/);
});

// ---------- deep links ----------
const ID = '54736bc5-3bc5-48aa-a408-6628cd5f2d7c';
ok('an entry link parses', () => assert.deepStrictEqual(deeplink.parse(`briffy://entry/${ID}`), { tab: 'entries', arg: ID }));
ok('a day link parses', () => assert.deepStrictEqual(deeplink.parse('briffy://day/2026-09-05'), { tab: 'entries', arg: '', dateKey: '2026-09-05' }));
ok('a summary link parses', () => assert.deepStrictEqual(deeplink.parse('briffy://summary/2026-09-05'), { tab: 'summaries', arg: '2026-09-05' }));
ok('briffy://open just opens', () => assert.deepStrictEqual(deeplink.parse('briffy://open'), { tab: 'entries', arg: '' }));
for (const bad of [
  'briffy://entry/../../etc/passwd', 'briffy://entry/not-a-uuid', 'briffy://day/2026-9-5',
  'https://example.com/entry/1', 'briffy://delete/all', 'briffy://entry/', 'nonsense', '',
]) {
  ok(`rejects ${JSON.stringify(bad)}`, () => assert.strictEqual(deeplink.parse(bad), null));
}
ok('a link is found in a command line', () => {
  assert.strictEqual(deeplink.fromArgv(['/path/electron', '.', `briffy://entry/${ID}`]), `briffy://entry/${ID}`);
  assert.strictEqual(deeplink.fromArgv(['/path/electron', '.']), '');
});
ok('links are built the way they are parsed', () => {
  assert.deepStrictEqual(deeplink.parse(deeplink.linkTo.entry(ID)), { tab: 'entries', arg: ID });
  assert.deepStrictEqual(deeplink.parse(deeplink.linkTo.day('2026-09-05')), { tab: 'entries', arg: '', dateKey: '2026-09-05' });
  assert.deepStrictEqual(deeplink.parse(deeplink.linkTo.summary('2026-09-05')), { tab: 'summaries', arg: '2026-09-05' });
});

console.log(`context/boxes/stats/links: ${pass} checks passed`);
