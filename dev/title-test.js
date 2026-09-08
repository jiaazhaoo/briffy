'use strict';
// 一条记录该叫什么。
//
//   node dev/title-test.js
//
// 盯的是两件事：占位标题该被换掉，和**不该被换掉的绝对不能换**。后者更要紧——
// 换错一次，你复制的那段话就变成了一个工具名，而且你不会发现，因为标题看上去挺正常。
const assert = require('assert');
const title = require('../src/main/title');

let pass = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { console.log(`  FAIL ${name} — ${e.message}`); process.exitCode = 1; }
};

ok('占位标题换成窗口标题', () => {
  assert.strictEqual(
    title.fromContext({ titleAuto: true }, { app: 'Google Chrome', window: '赛程分前后半程 - Claude' }),
    '赛程分前后半程 - Claude');
});

ok('内容来的标题一个字不动 —— 「Google Translate」不该盖过你复制的那句话', () => {
  const e = { titleAuto: false, title: 'Is it okay if I arrive at your place around nine?' };
  assert.strictEqual(title.fromContext(e, { app: 'Google Chrome', window: 'Google Translate' }), '');
});

ok('窗口标题和应用同名 = 等于没说', () => {
  // Claude 桌面版的窗口就叫「Claude」。这个工作区里它那 70 条只有 1 条带得上窗口标题。
  assert.strictEqual(title.fromContext({ titleAuto: true }, { app: 'Claude', window: 'Claude' }), '');
  assert.strictEqual(title.fromContext({ titleAuto: true }, { app: 'Finder', window: 'finder' }), '');
});

ok('太短、太长的都不要', () => {
  assert.strictEqual(title.fromContext({ titleAuto: true }, { app: 'X', window: 'a' }), '');
  assert.strictEqual(title.fromContext({ titleAuto: true }, { app: 'X', window: 'x'.repeat(200) }), '');
});

ok('空的、没有的，都不炸', () => {
  assert.strictEqual(title.fromContext({ titleAuto: true }, null), '');
  assert.strictEqual(title.fromContext(null, { window: 'x' }), '');
  assert.strictEqual(title.fromContext({ titleAuto: true }, { window: '   ' }), '');
});

ok('换行和多余空白挤掉', () => {
  assert.strictEqual(title.fromContext({ titleAuto: true }, { app: 'X', window: ' a\n  b ' }), 'a b');
});

console.log(`\ntitle: ${pass} passed`);
process.exit(process.exitCode || 0);
