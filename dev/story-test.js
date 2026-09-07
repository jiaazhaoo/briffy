'use strict';
// 从一条记录长出去的那一片。
//
//   node dev/story-test.js
//
// 盯的是扩散的**形状**，不是它在真实数据上收了几条（那是 dev/story-bench.js 的活）：
// 强边走得远、弱边走不远、一页摘得越多那条边越不作数、每一条进来的记录都说得出为什么。
const assert = require('assert');
const story = require('../src/main/story');

let pass = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { console.log(`  FAIL ${name} — ${e.message}`); process.exitCode = 1; }
};

/** 手搓一张边表当 ctx。story.grow 认 ctx.edges，所以不用先搭一整张真图。 */
const ctxOf = (adj) => ({ ids: Object.keys(adj), edges: (id) => (adj[id] || []) });
const grow = (seed, ctx, opts) => story.grow(seed, ctx, opts);

ok('强边一路走得远，弱边一跳就停', () => {
  const s = grow('a', ctxOf({
    a: [{ to: 'b', kind: 'page', w: 1.0 }, { to: 'x', kind: 'run', w: 0.34 }],
    b: [{ to: 'c', kind: 'page', w: 1.0 }],
    c: [{ to: 'd', kind: 'page', w: 1.0 }],
    x: [{ to: 'y', kind: 'run', w: 0.34 }],
    d: [], y: [],
  }));
  const ids = s.members.map((m) => m.id);
  assert.ok(ids.includes('b') && ids.includes('c'), '满分边该走到两跳外：' + ids.join(','));
  assert.ok(!ids.includes('y'), '同一程走一跳就该停');
});

ok('每一条进来的都说得出是被哪条边放进来的', () => {
  const s = grow('a', ctxOf({ a: [{ to: 'b', kind: 'word', w: 0.6, words: ['tw20'] }], b: [] }));
  const b = s.members.find((m) => m.id === 'b');
  assert.strictEqual(b.via.kind, 'word');
  assert.deepStrictEqual(b.via.words, ['tw20']);
  assert.strictEqual(s.members[0].via, null, '种子没有来处');
});

ok('种子永远排第一', () => {
  const s = grow('a', ctxOf({ a: [{ to: 'b', kind: 'page', w: 1 }], b: [] }));
  assert.strictEqual(s.members[0].id, 'a');
  assert.strictEqual(s.members[0].score, 1);
});

ok('越远分越低，跳数对得上', () => {
  const s = grow('a', ctxOf({ a: [{ to: 'b', kind: 'page', w: 1 }], b: [{ to: 'c', kind: 'page', w: 1 }], c: [] }));
  const [A, B, C] = ['a', 'b', 'c'].map((id) => s.members.find((m) => m.id === id));
  assert.ok(A.score > B.score && B.score > C.score, '越远越轻');
  assert.deepStrictEqual([A.hop, B.hop, C.hop], [0, 1, 2]);
});

ok('一页摘得越多，那条同一处边越不作数——不然一个终端窗口能拉进半个工作区', () => {
  assert.strictEqual(story.pageWeight(3), story.W.page, '三条的页面算满分');
  assert.ok(story.pageWeight(17) < story.W.page * 0.3, '十七条的页面该被稀释：' + story.pageWeight(17));
});

ok('词越罕见，边越硬', () => {
  assert.ok(story.wordWeight(2) > story.wordWeight(14), 'tw20 该比 challenge 硬');
  assert.ok(story.wordWeight(40) > 0.4, '再泛也不是零，只是很轻');
});

ok('一片有上限，不会无限长下去', () => {
  const adj = {};
  for (let i = 0; i < 80; i++) adj[`n${i}`] = [{ to: `n${(i + 1) % 80}`, kind: 'page', w: 1 }, { to: `n${(i + 7) % 80}`, kind: 'page', w: 1 }];
  const s = grow('n0', ctxOf(adj), { max: 12 });
  assert.strictEqual(s.members.length, 12);
});

ok('边只留两头都在这一片里的', () => {
  const s = grow('a', ctxOf({ a: [{ to: 'b', kind: 'page', w: 1 }], b: [{ to: 'z', kind: 'run', w: 0.01 }], z: [] }));
  const ids = new Set(s.members.map((m) => m.id));
  for (const [x, y] of s.edges) assert.ok(ids.has(x) && ids.has(y), '边指到了片外');
});

ok('孤零零一条记录不炸，也不假装有一片', () => {
  const s = grow('lonely', ctxOf({ lonely: [] }));
  assert.strictEqual(s.members.length, 1);
  assert.deepStrictEqual(s.edges, []);
});

ok('空的种子不炸', () => {
  assert.deepStrictEqual(story.grow('', { ids: [] }).members, []);
});

console.log(`\nstory: ${pass} passed`);
process.exit(process.exitCode || 0);
