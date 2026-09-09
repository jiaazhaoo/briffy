'use strict';
// 形状那一层的规则本身。真实工作区上的账在 dev/recall-arch-bench.js。
//
//   node dev/shape-test.js
const assert = require('assert');
const shape = require('../src/main/shape');

let pass = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; } };

// ---------- 这句话在找什么 ----------
ok('问地址 → 邮编', () => {
  for (const q of ['起点和终点的具体地址是什么', '我把车停在哪了', 'TW20 是哪儿', 'what is the address']) {
    assert.strictEqual(shape.shapeOf(q), 'postcode', q);
  }
});
ok('问时间 → 时刻', () => assert.strictEqual(shape.shapeOf('那个活动几点开始'), 'time'));
ok('问钱 → 金额', () => assert.strictEqual(shape.shapeOf('报名费多少钱'), 'money'));
ok('问型号 → 型号串', () => assert.strictEqual(shape.shapeOf('我看的那个显示器是什么型号'), 'code'));
ok('问单号 → 型号串', () => assert.strictEqual(shape.shapeOf('保险的保单编号是多少'), 'code'));
ok('「本地模型」不该被「型」字触发', () => {
  // 量出来的真实误伤：这一问触发了型号那一档，二十个名额被型号串占满。
  for (const q of ['这台机器推荐用哪个本地模型', '换个什么模型好']) assert.strictEqual(shape.shapeOf(q), '', q);
});
ok('认不出就是空字符串（那时走全扫）', () => {
  for (const q of ['screenpipe 是怎么采集的', '我存的那个视频讲什么', '']) assert.strictEqual(shape.shapeOf(q), '');
});

// ---------- 形状本身 ----------
ok('完整邮编', () => {
  assert.ok(shape.has('Runnymede Pleasure Ground, Egham, Surrey TW20 0AE', 'postcode'));
  assert.ok(shape.has('基地营在园内 Fielders Meadow, SW6 6EA', 'postcode'));
  assert.ok(!shape.has('Parking space on Buckingham Court, TW18', 'postcode'));
});
ok('半截邮编只有松的那一档认', () => {
  assert.ok(shape.has('Parking space on Buckingham Court, TW18', 'postcodeLoose'));
  assert.ok(shape.has('Windsor Road, Egham TW20 0AE', 'postcodeLoose'));
});
ok('时刻', () => {
  assert.ok(shape.has('Ultra March 08:30 集体出发', 'time'));
  assert.ok(!shape.has('出发时间大概是早上', 'time'));
});
ok('金额', () => {
  assert.ok(shape.has('Amount paid £139.00', 'money'));
  assert.ok(shape.has('每晚 £320、最少 14 晚', 'money'));
  assert.ok(!shape.has('50km 的路程', 'money'));
});
ok('型号串', () => {
  assert.ok(shape.has('Dell ultrawide monitor p3425we', 'code'));
  assert.ok(shape.has('Policy number XA20014390917', 'code'));
});
ok('认不出的形状名，一律不命中', () => {
  assert.strictEqual(shape.has('随便什么字', '不存在的形状'), false);
  assert.strictEqual(shape.has(null, 'postcode'), false);
});

// ---------- 排序：短记录 + 形状在标题里 ----------
const E = (title, text) => ({ id: title, title, text });
ok('标题就是答案的短记录排在最前', () => {
  const gold = E('Runnymede Pleasure Ground, Egham, Surrey TW20 0AE', 'Runnymede Pleasure Ground, Egham, Surrey TW20 0AE');
  const page = E('Scan to Boundary', `${'x'.repeat(5000)} Cartref, Queenborough Lane, Braintree, Essex CM7 8QD`);
  assert.ok(shape.rank(gold, 'postcode', []) > shape.rank(page, 'postcode', []));
});
ok('问题里的词只算一点分，不能盖过标题', () => {
  const gold = E('Windsor Road, Egham TW20 0AE', 'Windsor Road, Egham TW20 0AE');
  const wordy = E('一页网页', `${'地址 '.repeat(60)} Essex CM7 8QD`);
  assert.ok(shape.rank(gold, 'postcode', ['地址']) > shape.rank(wordy, 'postcode', ['地址']));
});

// ---------- 全库扫 ----------
const CORPUS = [
  E('Runnymede Pleasure Ground, Egham, Surrey TW20 0AE', 'Runnymede Pleasure Ground, Egham, Surrey TW20 0AE'),
  E('Scan to Boundary', `${'x'.repeat(3000)} Braintree, Essex CM7 8QD`),
  E('我们这个 app 现在占用 1.8g', '我们这个 app 现在占用 1.8g，这是不能接受的'),
];
ok('scan 只给带这个形状的，按 rank 排', () => {
  const ids = shape.scan(CORPUS, 'postcode', []);
  assert.deepStrictEqual(ids, ['Runnymede Pleasure Ground, Egham, Surrey TW20 0AE', 'Scan to Boundary']);
});
ok('scanWords 按命中的词排，标题命中算两分', () => {
  const ids = shape.scanWords(CORPUS, ['占用']);
  assert.strictEqual(ids[0], '我们这个 app 现在占用 1.8g');
});
ok('一个词都没命中的不进来', () => assert.deepStrictEqual(shape.scanWords(CORPUS, ['完全不存在的词']), []));

// ---------- 配额：谁也不许独占 ----------
const many = (p, n) => Array.from({ length: n }, (_, i) => `${p}${i}`);
ok('形状最多占一半', () => {
  const out = shape.blend({ found: many('f', 30), shapeHits: many('s', 30), scanHits: [], keep: 24 });
  assert.strictEqual(out.filter((x) => x.startsWith('s')).length, 12);
});
ok('索引找到的那几条留得住位子（认错形状时就靠它）', () => {
  const out = shape.blend({ found: many('f', 30), shapeHits: many('s', 30), scanHits: many('n', 30), keep: 24 });
  assert.strictEqual(out.filter((x) => x.startsWith('f')).length, shape.KEEP_FOUND);
  assert.strictEqual(out.length, 24);
});
ok('没有形状时，全扫把名额填满', () => {
  const out = shape.blend({ found: many('f', 3), shapeHits: [], scanHits: many('n', 40), keep: 24 });
  assert.strictEqual(out.length, 24);
  assert.strictEqual(out.filter((x) => x.startsWith('f')).length, 3);
});
ok('三条腿都空就是空，不报错', () => assert.deepStrictEqual(shape.blend({ keep: 24 }), []));
ok('不重复', () => {
  const out = shape.blend({ found: ['a', 'b'], shapeHits: ['b', 'c'], scanHits: ['a', 'c', 'd'], keep: 24 });
  assert.deepStrictEqual([...new Set(out)], out);
});
ok('凑不满就少给几条，不硬凑', () => {
  const out = shape.blend({ found: ['a'], shapeHits: ['b'], scanHits: [], keep: 24 });
  assert.strictEqual(out.length, 2);
});

console.log(`shape: ${pass} passed`);
