'use strict';
// 自动双链的三种边。
//
//   node dev/links-test.js
//
// 这一组盯的是边的**来路**，不是它连得多不多：同一处必须精确（宁可没有边也不要错的边），
// 同一程必须只按时间断开，而外壳标题（“Google Chrome”“Claude”）永远不许变成一个页面节点——
// 它一旦成了节点，半个工作区会挂在它下面，整张图就废了。
const assert = require('assert');
const links = require('../src/main/links');

let pass = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { console.log(`  FAIL ${name} — ${e.message}`); process.exitCode = 1; }
};

const T = (h, m) => `2026-09-06T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
const clip = (id, title, win, h, m, extra = {}) =>
  ({ id, title, createdAt: T(h, m), context: { app: 'Google Chrome', window: win }, ...extra });

// 真实那一晚的形状：报名 → 找停车，三条停车记录是从「赛程分前后半程 - Claude」那一页上摘的，
// 而同一小时里还收藏了那一页本身。
const DAY = [
  clip('reg1', 'English (Great Britain)', 'Thames Path Ultra Challenge 2026', 21, 36),
  clip('reg0', '1st Half Challenge', 'Thames Path Ultra Challenge 2026', 21, 44),
  clip('reg2', 'Thank you! Your registration is complete.', 'Thames Path Ultra Challenge 2026', 21, 56),
  // 收藏了那一页：它带的是网址，而剪贴板那几条带的是标题——同一页的两个说法
  { id: 'mark', title: '赛程分前后半程 - Claude', url: 'https://claude.ai/chat/abc',
    createdAt: T(22, 5), context: { app: 'Google Chrome', window: '赛程分前后半程 - Claude', url: 'https://claude.ai/chat/abc' } },
  clip('p1', 'Bishops Park, Fulham', '赛程分前后半程 - Claude', 22, 3),
  clip('p2', '停 Staines 车站', '赛程分前后半程 - Claude', 22, 14),
  clip('p3', '£10 接驳车直接送你回去取车', '赛程分前后半程 - Claude', 22, 15),
  clip('p4', 'Windsor Road, Egham TW20 0AE', 'Your location to Staines Train Station', 22, 19),
];
// 隔了一天，是另一段操作
DAY.push({ id: 'later', title: '别的事', createdAt: '2026-09-07T10:00:00.000Z',
  context: { app: 'Google Chrome', window: 'Some Other Page' } });

ok('页面身份：url 优先，锚点和末尾斜杠不算', () => {
  assert.strictEqual(links.normUrl('https://a.com/x/#top'), 'https://a.com/x');
  assert.strictEqual(links.normUrl('https://a.com/x/'), 'https://a.com/x');
  assert.strictEqual(links.normUrl('not a url'), '');
});

ok('外壳标题不许成为页面——它一旦成了节点，半个工作区都挂它下面', () => {
  for (const w of ['Google Chrome', 'Claude', 'WeChat', '新标签页', '']) {
    assert.deepStrictEqual(links.pageKeysOf(clip('x', 't', w, 1, 0)), [], `${w} 不该有 key`);
  }
  assert.deepStrictEqual(links.pageKeysOf({ context: { app: 'Notion', window: 'Notion' } }), [], '等于应用名的也是外壳');
});

ok('浏览器加的前缀不算另一页', () => {
  assert.deepStrictEqual(links.pageKeysOf(clip('x', 't', 'Find in page Thames Path', 1, 0)), ['Thames Path']);
});

// 别名合并之后，那一页的 key 是网址（网址是真身份，标题只是它的一个说法）
const CLAUDE = 'https://claude.ai/chat/abc';

ok('同一处：三条停车记录挂到同一页上，一字不差', () => {
  const g = links.build(DAY);
  const p = g.pages.get(CLAUDE);
  assert.ok(p, `这一页该在，现有：${[...g.pages.keys()].join(' | ')}`);
  assert.deepStrictEqual(p.clips.slice().sort(), ['p1', 'p2', 'p3']);
});

ok('网址和标题是同一页的两个说法，不该裂成两个节点', () => {
  const g = links.build(DAY);
  assert.ok(!g.pages.has('赛程分前后半程 - Claude'), '标题不该另起一个节点');
  assert.strictEqual(g.pages.get(CLAUDE).name, '赛程分前后半程 - Claude', '名字要人读得懂，不能是网址');
});

ok('收藏了那一页，书签就是这个节点本身，不是它的兄弟', () => {
  const g = links.build(DAY);
  const p = g.pages.get(CLAUDE);
  assert.strictEqual(p.page, 'mark');
  assert.ok(!p.clips.includes('mark'), '页面自己不算自己的摘录');
});

ok('反向：一条摘录说得出它是从哪儿来的', () => {
  const g = links.build(DAY);
  const l = links.linksOf('p2', g);
  assert.ok(l.source, '该有来处');
  assert.strictEqual(l.source.page, 'mark');
  assert.strictEqual(l.source.name, '赛程分前后半程 - Claude');
});

ok('正向：打开那一页，看得见从它上面摘了哪几条', () => {
  const g = links.build(DAY);
  const l = links.linksOf('mark', g);
  assert.deepStrictEqual(l.clips.slice().sort(), ['p1', 'p2', 'p3']);
  assert.strictEqual(l.source, null, '页面自己没有来处');
});

ok('同一程：一晚上是一段，隔了三小时的那条不在里面', () => {
  const g = links.build(DAY);
  assert.strictEqual(g.runs.length, 2, JSON.stringify(g.runs));
  assert.ok(g.runs[0].includes('reg1') && g.runs[0].includes('p4'));
  assert.deepStrictEqual(g.runs[1], ['later']);
});

ok('同一程串起的是页面，不是每条记录两两相连', () => {
  const g = links.build(DAY);
  const chain = links.chainOf(g.runs[0], g, (id) => DAY.find((e) => e.id === id));
  assert.deepStrictEqual(chain.map((c) => c.name), [
    'Thames Path Ultra Challenge 2026',
    '赛程分前后半程 - Claude',
    'Your location to Staines Train Station',
  ], JSON.stringify(chain.map((c) => c.name)));
});

ok('攒太多条的 key 整组丢掉，不截断——半张图比没有图更骗人', () => {
  const many = [];
  for (let i = 0; i < 70; i++) many.push(clip(`m${i}`, `t${i}`, '某个外壳页', 10, i % 60));
  const g = links.build(many, { maxClips: 60 });
  assert.ok(!g.pages.has('某个外壳页'), '该整组丢掉');
  assert.strictEqual(g.keyOf.get('m0'), undefined, '成员身上的 key 也要清掉');
});

ok('没有可信身份的记录，一条边都不给', () => {
  const g = links.build([{ id: 'bare', title: '一句话', createdAt: T(9, 0) }]);
  const l = links.linksOf('bare', g);
  assert.strictEqual(l.source, null);
  assert.deepStrictEqual(l.clips, []);
});

ok('空工作区不炸', () => {
  const g = links.build([]);
  assert.strictEqual(g.pages.size, 0);
  assert.deepStrictEqual(links.linksOf('nope', g).clips, []);
});

console.log(`\nlinks: ${pass} passed`);
process.exit(process.exitCode || 0);
