'use strict';
// 记录里反复出现的那些东西。
//
//   node dev/entity-test.js
//
// 盯两头：该认出来的（邮编、日期、距离、地名）认得出，该滤掉的（网页家具、中文虚词、
// briffy 自己的标题词）一个都别进来——**实体是要画在图上当节点的，一个叫「Privacy」的
// 节点比没有节点更糟**。
const assert = require('assert');
const ent = require('../src/main/entity');

let pass = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { console.log(`  FAIL ${name} — ${e.message}`); process.exitCode = 1; }
};
const texts = (entry, body) => ent.of(entry, body === undefined ? '' : body).map((x) => x.text);
const kinds = (entry, body) => Object.fromEntries(ent.of(entry, body === undefined ? '' : body).map((x) => [x.text, x.kind]));

ok('邮编认得出，而且带空格显示', () => {
  const got = texts({ title: 'Windsor Road, Egham TW20 0AE' });
  assert.ok(got.includes('TW20 0AE'), got.join(','));
  assert.strictEqual(kinds({ title: 'Windsor Road, Egham TW20 0AE' })['TW20 0AE'], 'place');
});

ok('邮编不会被拆成一个「带数字的词」', () => {
  assert.ok(!texts({ title: 'TW20 0AE' }).some((x) => /^0ae$/i.test(x)), '0AE 不该单独成为一个实体');
});

ok('日期认得出，中英文都要', () => {
  assert.ok(texts({ title: 'Sat 12 Sep 2026' }).includes('12 Sep 2026'));
  assert.ok(texts({ title: '2026年9月12日星期六' }).includes('2026年9月12日'));
  assert.strictEqual(kinds({ title: 'Sat 12 Sep 2026' })['12 Sep 2026'], 'date');
});

ok('距离和钱认得出', () => {
  const got = texts({ title: '1st Half Challenge (~50km) £139.00' });
  assert.ok(got.includes('50km'), got.join(','));
  assert.ok(got.includes('£139.00'), got.join(','));
});

ok('地名留着', () => {
  const got = texts({ title: 'Runnymede Pleasure Ground, Egham, Surrey' });
  for (const w of ['Runnymede', 'Egham', 'Surrey']) assert.ok(got.includes(w), `${w} 没了：${got.join(',')}`);
});

ok('网页家具词一个都不许进来——它们会变成图上一个叫「Privacy」的节点', () => {
  const got = texts({ title: 'Privacy Policy Terms Statement Cookie Settings Payment Methods' }).map((x) => x.toLowerCase());
  for (const w of ['privacy', 'policy', 'terms', 'statement', 'cookie', 'settings', 'payment', 'methods']) {
    assert.ok(!got.includes(w), `${w} 不该进来：${got.join(',')}`);
  }
});

ok('没大写过的英文词不是专名', () => {
  assert.ok(!texts({ title: 'x' }, 'the parking spot is labelled with a number').some((x) => /parking|spot|number/i.test(x)));
});

ok('briffy 自己的标题词说的是格式，不是内容', () => {
  const got = texts({ title: '语音 22:34' }).map((x) => x.toLowerCase());
  assert.ok(!got.includes('语音'), got.join(','));
});

ok('只在正文里的两字中文词太廉价，除非有谁拿它当过标题', () => {
  const body = '当了一大批的判例青年这类题材';
  assert.ok(!texts({ title: 'x' }, body).includes('青年'), '没人拿它当标题，不该进来');
  assert.ok(ent.of({ title: 'x' }, body, new Set(['青年'])).some((x) => x.text === '青年'), '有人拿它当过标题就该进来');
});

ok('抬头里的两字中文词照收——「车站」是内容', () => {
  assert.ok(texts({ title: '停 Staines 车站' }).includes('车站'));
});

ok('只被一条记录提到的不算这个工作区里的一样东西', () => {
  const ix = ent.index([{ id: 'a', title: 'Egham TW20 0AE' }, { id: 'b', title: '别的事情' }]);
  assert.strictEqual(ix.ents.size, 0, '就一条提到，谈不上是一样东西');
});

ok('两条都提到就立起来了，而且记得住是哪两条', () => {
  const ix = ent.index([
    { id: 'a', title: 'Windsor Road, Egham TW20 0AE' },
    { id: 'b', title: 'Runnymede Pleasure Ground, Egham, Surrey' },
  ]);
  const eg = [...ix.ents.values()].find((x) => x.text === 'Egham');
  assert.ok(eg, [...ix.ents.values()].map((x) => x.text).join(','));
  assert.deepStrictEqual(eg.records.sort(), ['a', 'b']);
});

ok('提到的记录越少，那条边越硬', () => {
  assert.ok(ent.weight(2) > ent.weight(20));
  assert.ok(ent.weight(200) > 0.5, '再常见也不是零，只是很轻');
});

ok('空的、没有的都不炸', () => {
  assert.deepStrictEqual(ent.of(null), []);
  assert.strictEqual(ent.index(null).ents.size, 0);
  assert.strictEqual(ent.index([]).byRecord.size, 0);
});

console.log(`\nentity: ${pass} passed`);
process.exit(process.exitCode || 0);
