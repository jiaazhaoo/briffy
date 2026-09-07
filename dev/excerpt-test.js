'use strict';
// 一条记录里，给模型看哪一段。
//
//   node dev/excerpt-test.js
//
// 这个文件是从一次真实的失败里长出来的。问「我最近有个 walking 挑战…」，取回来的一条报名记录
// 1285 字，「12 Sep 2026」在第 329 字、「Walking Only」在第 380 字；当时每条只给模型 200 字，
// 于是它看到的是「Select category / Complete form / Checkout / 闲置 15 分钟会掉线」——网页的
// 导航条和 cookie 提示。日期和项目名一个字都没到它面前，它只好去猜，猜错了。
//
// 取开头这件事对网页尤其致命：网页的开头几乎永远是导航、语言选择、同意条款，正文在中间。
const assert = require('assert');
const llm = require('../src/main/llm');

let pass = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { console.log(`  FAIL ${name} — ${e.message}`); process.exitCode = 1; }
};

// 真实那条记录的形状：前面三百多字全是网页外壳，要的东西在后面。
const CHROME = 'English (Great Britain) Select category Complete form Checkout '
  + 'You may lose your registration spot if your browser session is idle for more than 15 minutes. '
  + 'See our Privacy Statement for information on how we process your personal data. '
  + 'Account Information Hello, Jia zhao Change account Registration ';
const MEAT = 'Sat 12 Sep 2026 Ultra March 1st Half Challenge (~50km) Walking Only - Self Funding Adult £ 139.00 ';
const PAGE = CHROME + MEAT + 'Waivers & Agreements Please read the following waivers carefully. '.repeat(6);

ok('命中的那一段被截出来，不是开头那一段', () => {
  const out = llm._windowAround(PAGE, ['walking', '挑战'], 200);
  assert.ok(out.includes('12 Sep 2026'), '日期没进来: ' + out);
  assert.ok(out.includes('Walking Only'), '项目名没进来: ' + out);
  assert.ok(out.startsWith('…'), '截过的段落要有省略号: ' + out.slice(0, 20));
});

ok('大小写不一样也认得——原文写的是 Walking，问的是 walking', () => {
  const out = llm._windowAround(PAGE, ['walking'], 200);
  assert.ok(out.includes('Walking Only'), out);
});

ok('一个词都对不上就退回开头，不要乱截', () => {
  const out = llm._windowAround(PAGE, ['完全不相干的词'], 120);
  assert.strictEqual(out, PAGE.slice(0, 120));
});

ok('命中就在开头附近，就别加省略号了', () => {
  const out = llm._windowAround(PAGE, ['English'], 200);
  assert.strictEqual(out, PAGE.slice(0, 200));
});

ok('本来就短的记录，原样给', () => {
  const short = 'Ultra March 1st Half Challenge';
  assert.strictEqual(llm._windowAround(short, ['walking'], 200), short);
});

ok('没有词也不炸', () => {
  assert.strictEqual(llm._windowAround(PAGE, [], 100), PAGE.slice(0, 100));
  assert.strictEqual(llm._windowAround(PAGE, undefined, 100), PAGE.slice(0, 100));
});

ok('编号清单里，每条给的是命中那一段', () => {
  const entries = [];
  for (let i = 0; i < 6; i++) {
    entries.push({ id: `e${i}`, dateKey: '2026-09-06', createdAt: '2026-09-06T20:50:00.000Z', type: 'note', title: `第 ${i} 条`, text: PAGE });
  }
  const out = llm._buildNumbered(entries, 6000, ['walking']);
  const lines = out.split('\n').filter((l) => l.startsWith('[') && !l.includes('omitted'));
  assert.strictEqual(lines.length, 6, out);
  for (const l of lines) assert.ok(l.includes('12 Sep 2026'), '有一条还是给了开头: ' + l.slice(0, 120));
});

ok('一次给的字数没有变多，只是换了位置', () => {
  const entries = [{ id: 'a', dateKey: '2026-09-06', createdAt: '2026-09-06T20:50:00.000Z', type: 'note', title: 't', text: PAGE }];
  const out = llm._buildNumbered(entries, 8000, ['walking']);
  assert.ok(out.length <= 8000 + 200, out.length);
});

console.log(`\nexcerpt: ${pass} passed`);
process.exit(process.exitCode || 0);
