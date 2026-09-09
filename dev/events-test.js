'use strict';
// 事件是怎么从清单上整理出来的——钉的是规则，不是产出（产出在 dev/events-bench.js）。
//
//   node dev/events-test.js
const assert = require('assert');
const story = require('../src/main/story');

let pass = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; } };

// 一份假的词表视图：每条记录几个词，每个词 df
function view(words, df) {
  return {
    ev: {
      words: { get: (id) => new Set(words[id] || []) },
      df: { get: (w) => df[w] || 0 },
      text: { get: (w) => w },
    },
    total: 100,
  };
}
// 测试里的链接默认带一个硬理由（邮编）：没理由的链接现在不算数（story.strong）
const HARD = () => ({ kind: 'word', pairs: [{ a: 'TW20 0AE', b: 'TW20 0AE', k: 'place', df: 3 }] });
const L = (pairs) => new Map(Object.entries(pairs).map(([id, arr]) => [id, arr.map(([to, score, why]) => ({ id: to, score, hop: 1, why: why || HARD() }))]));

ok('互为前三近邻的连成一块，单向的不算', () => {
  // a b c 互相都在对方前三；h 把 a b c 都列在前三里，但它们的前三里没有 h
  const lists = L({
    a: [['b', 0.8], ['c', 0.7], ['x', 0.3]],
    b: [['a', 0.8], ['c', 0.6], ['x', 0.3]],
    c: [['a', 0.7], ['b', 0.6], ['x', 0.3]],
    h: [['a', 0.5], ['b', 0.5], ['c', 0.5]],
    x: [['y', 0.2]], y: [['x', 0.2]],
  });
  const ev = story.events(lists, view({}, {}));
  assert.strictEqual(ev.length, 1);
  const core = ev[0].members.filter((m) => m.tier === 'core').map((m) => m.id).sort();
  assert.deepStrictEqual(core, ['a', 'b', 'c']);
  // h 沾边：它的前几条里有核心成员
  const touch = ev[0].members.filter((m) => m.tier === 'touch').map((m) => m.id);
  assert.deepStrictEqual(touch, ['h']);
});

ok('参与强度：核心 = 和块里最近那条的分数；沾边 = 那条单向链接的分数', () => {
  const lists = L({
    a: [['b', 0.9], ['c', 0.5]], b: [['a', 0.9], ['c', 0.5]], c: [['a', 0.5], ['b', 0.5]],
    h: [['c', 0.42]],
  });
  const ev = story.events(lists, view({}, {}));
  const by = Object.fromEntries(ev[0].members.map((m) => [m.id, m]));
  assert.strictEqual(by.a.score, 0.9);
  assert.strictEqual(by.c.score, 0.5);
  assert.strictEqual(by.h.score, 0.42);
  assert.strictEqual(by.h.tier, 'touch');
});

ok('两块共有三个锚词才并成一件', () => {
  const lists = L({
    a: [['b', 0.8], ['c', 0.7]], b: [['a', 0.8], ['c', 0.7]], c: [['a', 0.7], ['b', 0.7]],
    d: [['e', 0.8], ['f', 0.7]], e: [['d', 0.8], ['f', 0.7]], f: [['d', 0.7], ['e', 0.7]],
  });
  const df = { tw20: 3, staines: 4, ultra: 5, dell: 2, 记录: 30 };
  // 两块各自至少两条带着 tw20 / staines / ultra → 三个共有锚词 → 一件
  const merged = story.events(lists, view({
    a: ['tw20', 'staines', 'ultra'], b: ['tw20', 'staines', 'ultra'], c: ['记录'],
    d: ['tw20', 'staines', 'ultra'], e: ['tw20', 'staines', 'ultra'], f: ['dell'],
  }, df));
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].members.filter((m) => m.tier === 'core').length, 6);
  // 只共有两个 → 还是两件
  const apart = story.events(lists, view({
    a: ['tw20', 'staines'], b: ['tw20', 'staines'], c: ['记录'],
    d: ['tw20', 'staines'], e: ['tw20', 'staines'], f: ['dell'],
  }, df));
  assert.strictEqual(apart.length, 2);
  // 泛词（df 30）不算锚，共有再多也不并
  const generic = story.events(lists, view({
    a: ['记录', 'x1', 'x2'], b: ['记录', 'x1', 'x2'], c: [],
    d: ['记录', 'x1', 'x2'], e: ['记录', 'x1', 'x2'], f: [],
  }, { 记录: 30, x1: 30, x2: 30 }));
  assert.strictEqual(generic.length, 2);
});

ok('只有一条记录自己带的锚词说明不了这一块', () => {
  const lists = L({
    a: [['b', 0.8], ['c', 0.7]], b: [['a', 0.8], ['c', 0.7]], c: [['a', 0.7], ['b', 0.7]],
    d: [['e', 0.8], ['f', 0.7]], e: [['d', 0.8], ['f', 0.7]], f: [['d', 0.7], ['e', 0.7]],
  });
  const df = { p: 3, q: 3, r: 3 };
  // 每块只有一条带着 p q r → 不算这一块的锚 → 不并
  const ev = story.events(lists, view({ a: ['p', 'q', 'r'], d: ['p', 'q', 'r'] }, df));
  assert.strictEqual(ev.length, 2);
});

ok('不够几条的不算一件事', () => {
  const lists = L({ a: [['b', 0.8]], b: [['a', 0.8]] });
  assert.strictEqual(story.events(lists, view({}, {})).length, 0);
});

ok('核心多的排前面；名字从核心成员的词里起', () => {
  const lists = L({
    a: [['b', 0.8], ['c', 0.7]], b: [['a', 0.8], ['c', 0.7]], c: [['a', 0.7], ['b', 0.7]],
    d: [['e', 0.8], ['f', 0.7], ['g', 0.6]], e: [['d', 0.8], ['f', 0.7], ['g', 0.6]], f: [['d', 0.7], ['e', 0.7], ['g', 0.6]], g: [['d', 0.6], ['e', 0.6], ['f', 0.6]],
  });
  const ev = story.events(lists, view({ d: ['runnymede', 'egham'], e: ['runnymede'], f: ['runnymede', 'egham'], g: ['egham'] }, { runnymede: 3, egham: 4 }));
  assert.strictEqual(ev[0].members.filter((m) => m.tier === 'core').length, 4);
  assert.ok(ev[0].name.includes('runnymede'), ev[0].name);
});

ok('eventsOf：这一条在哪几件里，核心排在沾边前面', () => {
  const lists = L({
    a: [['b', 0.8], ['c', 0.7]], b: [['a', 0.8], ['c', 0.7]], c: [['a', 0.7], ['b', 0.7]],
    d: [['e', 0.8], ['f', 0.7], ['a', 0.5]], e: [['d', 0.8], ['f', 0.7]], f: [['d', 0.7], ['e', 0.7]],
  });
  const ev = story.events(lists, view({}, {}));
  const of = story.eventsOf('d', ev);
  assert.strictEqual(of.length, 2);
  assert.strictEqual(of[0].tier, 'core');
  assert.strictEqual(of[1].tier, 'touch');
  assert.strictEqual(story.eventsOf('nobody', ev).length, 0);
});

ok('谱系：同一页的先归成一站，站与站之间按共用词连主轴，同一段操作不进图', () => {
  const W = (...ws) => ({ kind: 'word', pairs: ws.map((w) => ({ a: w, b: w, k: 'place', df: 3 })) });
  const P = (n) => ({ kind: 'page', name: n });
  // p 是一页，c1 c2 摘自它；a 靠 tw20 连着 p；d 靠 ultra 连着 a；r 和 a 只是同一段操作
  const lists = new Map(Object.entries({
    p: [['c1', 0.85, { kind: 'page' }], ['c2', 0.85, { kind: 'page' }], ['a', 0.6, W('tw20')]],
    c1: [['p', 0.85, P('那一页')], ['c2', 0.85, { kind: 'page' }], ['a', 0.5, W('staines')]],
    c2: [['p', 0.85, P('那一页')], ['c1', 0.85, { kind: 'page' }]],
    a: [['p', 0.6, W('tw20')], ['c1', 0.5, W('staines')], ['d', 0.55, W('ultra')], ['r', 0.42, { kind: 'run' }]],
    d: [['a', 0.55, W('ultra')], ['p', 0.3, W('x')]],
    r: [['a', 0.42, { kind: 'run' }], ['d', 0.4, { kind: 'run' }]],
  }).map(([id, arr]) => [id, arr.map(([to, score, why]) => ({ id: to, score, why }))]));
  const ev = { members: ['p', 'c1', 'c2', 'a', 'd', 'r'].map((id) => ({ id, tier: 'core', score: 0.7 })) };
  const g = story.lineage(ev, lists);
  // 四站：{p,c1,c2}、{a}、{d}、{r}
  assert.strictEqual(g.stops.length, 4);
  const pageStop = g.stops.find((s) => s.members.includes('c1'));
  assert.strictEqual(pageStop.id, 'p');                       // 代表是那一页本身
  assert.deepStrictEqual(pageStop.members.slice().sort(), ['c1', 'c2', 'p']);
  // 主轴：p ↔ a（tw20 0.6）最强，再走 a ↔ d（ultra 0.55）
  const names = g.spine.map((i) => g.stops[i].id);
  assert.deepStrictEqual(names, ['p', 'a', 'd']);
  assert.deepStrictEqual(g.edges.map((e) => e.why.pairs[0].a), ['tw20', 'ultra']);
  // r 和谁都没有共用词（只有同一段操作），挂在主轴第一站底下、没有理由
  const rHang = g.hang.find((h) => g.stops[h.stop].id === 'r');
  assert.ok(rHang && rHang.why === null);
});

ok('谱系：只有一条核心也画得出来', () => {
  const lists = new Map([['a', []], ['h', [{ id: 'a', score: 0.5, why: HARD() }]]]);
  const g = story.lineage({ members: [{ id: 'a', tier: 'core', score: 1 }, { id: 'h', tier: 'touch', score: 0.5 }] }, lists);
  assert.strictEqual(g.stops.length, 1);
  assert.deepStrictEqual(g.spine, [0]);
  assert.strictEqual(g.edges.length, 0);
  assert.strictEqual(g.hang.length, 0);           // 沾边的不画
});

ok('硬不硬：一个软词不算，UKPC / 邮编 / 地名 / 两个词以上算', () => {
  const p = (a, k) => ({ kind: 'word', pairs: [{ a, b: a, k, df: 5 }] });
  assert.strictEqual(story.strong({ why: p('Read', 'name') }), false);
  assert.strictEqual(story.strong({ why: p('直接', 'name') }), false);
  assert.strictEqual(story.strong({ why: p('UKPC', 'name') }), true);
  assert.strictEqual(story.strong({ why: p('TW18 4JG', 'place') }), true);
  assert.strictEqual(story.strong({ why: p('泰晤士河', 'name') }), true);
  assert.strictEqual(story.strong({ why: { kind: 'word', pairs: [{ a: 'London', k: 'name' }, { a: 'Staines', k: 'name' }] } }), true);
  assert.strictEqual(story.strong({ why: { kind: 'run' } }), false);
  assert.strictEqual(story.strong({ why: { kind: 'page', name: 'x' } }), true);
  assert.strictEqual(story.strong({}), false);
});

ok('谱系：同一页存了几次的副本归一站', () => {
  const lists = new Map([
    ['a', [{ id: 'b', score: 0.9, why: HARD() }, { id: 'c', score: 0.5, why: HARD() }]],
    ['b', [{ id: 'a', score: 0.9, why: HARD() }]],
    ['c', [{ id: 'a', score: 0.5, why: HARD() }]],
  ]);
  const titles = { a: '赛程分前后半程 - Claude', b: 'Fulham 赛程分前后半程 - Claude', c: 'Windsor Road' };
  const ev = { members: ['a', 'b', 'c'].map((id) => ({ id, tier: 'core', score: 0.7 })) };
  const g = story.lineage(ev, lists, (id) => titles[id]);
  assert.strictEqual(g.stops.length, 2);
  const ab = g.stops.find((s) => s.members.includes('a'));
  assert.ok(ab.members.includes('b'));
});

ok('两跳的理由不算数：它讲的是路上最后一段，不是这两条之间的关系', () => {
  const P = (n) => ({ kind: 'page', name: n });
  assert.strictEqual(story.direct({ hop: 1 }), true);
  assert.strictEqual(story.direct({ hop: 2 }), false);
  assert.strictEqual(story.strong({ hop: 2, why: P('那一页') }), false);
  assert.strictEqual(story.strong({ hop: 1, why: P('那一页') }), true);
  // 两块之间只有一条两跳的同一页链接：不并
  const lists = new Map(Object.entries({
    a: [['b', 0.9], ['c', 0.7]], b: [['a', 0.9], ['c', 0.7]], c: [['a', 0.7], ['b', 0.7]],
    d: [['e', 0.9], ['f', 0.7]], e: [['d', 0.9], ['f', 0.7]], f: [['d', 0.7], ['e', 0.7]],
  }).map(([id, arr]) => [id, arr.map(([to, score]) => ({ id: to, score, hop: 1, why: HARD() }))]));
  lists.get('a').push({ id: 'd', score: 0.48, hop: 2, why: P('赛程') });
  assert.strictEqual(story.events(lists, view({}, {})).length, 2);
  // 同一条改成一跳：并成一件
  lists.get('a')[lists.get('a').length - 1].hop = 1;
  assert.strictEqual(story.events(lists, view({}, {})).length, 1);
});

console.log(`events: ${pass} passed`);
