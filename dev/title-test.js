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

// ── 一条记录该叫什么（降级链）

ok('图上字最大的那一行当标题', () => {
  const lines = [[0, 0, 200, 20, 99, '小字一行凑数'], [0, 40, 400, 80, 99, 'Ultra Challenge'], [0, 90, 100, 18, 99, '又一行小字']];
  assert.strictEqual(title.fromPicture(lines), 'Ultra Challenge');
});

ok('菜单栏不算标题 —— 全屏截图的第一行几乎总是它', () => {
  assert.ok(!title.meaty('é Claude File Edit View Go Window Help 5% ) + 9 0 Fri 4 Sep'));
  assert.ok(title.meaty('Ultra Challenge'));
});

ok('OCR 认不准的那几行丢掉 —— 「：文//：: 88 1 chresus」就是这么来的', () => {
  const lines = [[0, 0, 900, 90, 40, '：文//：: 88 1 chresus D 8'], [0, 90, 300, 40, 99, 'Ultra Challenge']];
  assert.strictEqual(title.fromPicture(lines), 'Ultra Challenge');
});

ok('一个正经词都没有的行丢掉', () => {
  assert.ok(!title.meaty('A it'));
  assert.ok(!title.meaty('23:00 6条'));
});

ok('开头那串图标剪掉，但真的字不能误伤', () => {
  assert.strictEqual(title.clip('● 日 ← → Briffy 本地开发'), 'Briffy 本地开发');
  assert.strictEqual(title.clip('(1) Facebook'), 'Facebook');
  assert.strictEqual(title.clip('9月12日周六 出发'), '9月12日周六 出发');   // 9 后面没空格，不该剥
});

ok('长句子剪在标点上，不硬切字', () => {
  const t = title.clip('不太行，得有时间戳的概念，你参考一下 screenpipe 的 ui 是怎么设计的');
  assert.ok(t.endsWith('…'), t);
  assert.ok(t.length <= 28, `太长了：${t}`);
  assert.ok(!t.includes('screenpipe'), '该在前面就断了');
});

ok('全是虚词的关键词不当标题 —— 语音转写常见', () => {
  assert.strictEqual(title.fromTags(["I'm", "it's", 'idea', 'sure']), '');
  assert.strictEqual(title.fromTags(['Claude Code', 'limits', 'Weekly']), 'Claude Code · limits · Weekly');
});

ok('**只给占位标题起名** —— 这条比起得好更要紧', () => {
  // 实测的反例：这句话的窗口标题是「Google Translate」，换过去就把内容换成了工具名
  const e = { title: 'Is it okay if I arrive at your place around nine?', context: { window: 'Google Translate' } };
  assert.strictEqual(title.of(e), '');
  assert.ok(title.isPlaceholder('截图 22:46'));
  assert.ok(title.isPlaceholder(''));
  assert.ok(!title.isPlaceholder('Ultra Challenge'));
});

ok('占位的那些，一路降级下去总有个名字', () => {
  assert.strictEqual(title.of({ title: '截图 22:46', context: { app: 'Chrome', window: '(1) Facebook' } }), 'Facebook');
  assert.strictEqual(title.of({ title: '截图 22:46', tags: ['Claude Code', 'limits'] }), 'Claude Code · limits');
  assert.strictEqual(title.of({ title: '语音 03:00', text: '我在测试语音识别' }), '我在测试语音识别');
  assert.strictEqual(title.of({ title: '截图 22:46' }, { fallback: '截图 22:46' }), '截图 22:46');
});

console.log(`\ntitle: ${pass} passed`);
process.exit(process.exitCode || 0);
