'use strict';
// ax-text 里不碰系统的那部分：什么算「够用」，截图那一刻问的答案怎么交到处理那一刻。
//
//   node dev/ax-text-test.js
const assert = require('assert');
const ax = require('../src/main/ax-text');

let n = 0;
const ok = (name, f) => { f(); n++; console.log('  ✓', name); };

ok('three lines of real words are enough', () => {
  assert.strictEqual(ax.enough('Thirty years of planning applications sit in scans\nnobody knows where the sites are\nthis workflow reads them and traces the plot'), true);
});
ok('three lines of Chinese are enough', () => {
  assert.strictEqual(ax.enough('这块屏物理密度二百九十六，低密度的软化被高密度掩盖了大半\n就用现在的分辨率\n显示器的文字模糊是缩放的问题不是面板的问题'), true);
});
ok('an empty Notes window is not', () => {
  assert.strictEqual(ax.enough('iCloud\nNotes, No notes\nNotes\nNo Notes'), false);
});
ok('two long lines are not (a player: title and one caption)', () => {
  assert.strictEqual(ax.enough('A very long title of a video that goes on and on and on and on forever\nPlay Pause Mute Fullscreen Settings Subtitles'), false);
});
ok('digits and punctuation do not count as letters', () => {
  assert.strictEqual(ax.enough('12:30 · 14:00 · 16:45\n£10 £20 £30 £40 £50 £60\n2026-09-09 2026-09-10 2026-09-11 (1) (2) (3) (4)'), false);
});

const good = 'first line of the page with enough words in it\nsecond line of the page with enough words\nthird line of the page with enough words';
(async () => {
  const r1 = await (ax.hold('a', Promise.resolve({ text: good, title: 't' })), ax.take('a'));
  assert.deepStrictEqual(r1 && r1.text, good); n++; console.log('  ✓ take hands back what hold was given');
  const r2 = await ax.take('a');
  assert.strictEqual(r2, null); n++; console.log('  ✓ ...once');
  const r3 = await ax.take('never-held');
  assert.strictEqual(r3, null); n++; console.log('  ✓ nothing held → null (OCR runs)');
  const r4 = await (ax.hold('b', Promise.reject(new Error('osascript died'))), ax.take('b'));
  assert.strictEqual(r4, null); n++; console.log('  ✓ a failed read → null, never a throw');
  const r5 = await (ax.hold('c', Promise.resolve({ text: 'Play\nPause', title: 't' })), ax.take('c'));
  assert.strictEqual(r5, null); n++; console.log('  ✓ a thin answer → null (OCR runs)');
  const r6 = await (ax.hold('d', Promise.resolve(null)), ax.take('d'));
  assert.strictEqual(r6, null); n++; console.log('  ✓ no answer → null');
  ax.hold('e', null); const r7 = await ax.take('e');
  assert.strictEqual(r7, null); n++; console.log('  ✓ hold(id, null) holds nothing');
  console.log(`${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
