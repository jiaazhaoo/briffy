'use strict';
// 磁盘索引：找得准，而且不必把工作区读进内存。
//
//   node dev/index-test.js
//
// 这里钉的是 ask.js 会崩掉的那件事的替代品。旧路径是 store.listEntries({ limit: Infinity })——
// 20 万条实测 215MB 堆、707ms 打分，按真实长度外推到 185 万条是 7GB。索引这条路只读命中的那几行。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const idx = require('../src/main/index-db');

let pass = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; } };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-index-'));
const WS = path.join(TMP, 'entries');
fs.mkdirSync(WS, { recursive: true });

function day(key, list) { fs.writeFileSync(path.join(WS, `${key}.json`), JSON.stringify(list)); }
const entry = (id, over = {}) => ({
  id, createdAt: `${over.dateKey || '2026-09-06'}T12:00:00.000Z`, type: 'note',
  title: '', text: '', summary: '', tags: [], ...over,
});

day('2026-09-04', [
  entry('a', { dateKey: '2026-09-04', title: '语音 22:34', text: '当了一大批的判例青年', type: 'audio' }),
  entry('b', { dateKey: '2026-09-04', title: '浏览器扩展的样式', text: '弹窗改成一行页脚', context: { app: 'Google Chrome' } }),
]);
day('2026-09-05', [
  entry('c', { dateKey: '2026-09-05', title: 'conference room booking', text: 'change the flow so conflicts show up first' }),
  entry('d', { dateKey: '2026-09-05', title: '麦克风白名单', text: '输入法不该算，按路径排除', pinned: true }),
]);
day('2026-09-06', [
  entry('e', { dateKey: '2026-09-06', title: '截图 23:26', text: '长截图拼接的接缝', type: 'screenshot' }),
]);

const src = { dir: WS, loadDay: (k) => JSON.parse(fs.readFileSync(path.join(WS, `${k}.json`), 'utf8')) };
idx.open(TMP, WS);
const first = idx.sync(src);

ok('第一次同步把每天都收进来了', () => {
  assert.strictEqual(first.days, 3, `${first.days} 天`);
  assert.strictEqual(idx.stats().entries, 5, `${idx.stats().entries} 条`);
});

ok('再同步一次什么都不做——天文件没变就不该重读', () => {
  const again = idx.sync(src);
  assert.strictEqual(again.days, 0, `又读了 ${again.days} 天`);
});

ok('改了一天，只重读那一天', () => {
  day('2026-09-06', [
    entry('e', { dateKey: '2026-09-06', title: '截图 23:26', text: '长截图拼接的接缝', type: 'screenshot' }),
    entry('f', { dateKey: '2026-09-06', title: '新加的一条', text: '向量重排' }),
  ]);
  const d = idx.sync(src);
  assert.strictEqual(d.days, 1, `${d.days} 天`);
  assert.strictEqual(idx.stats().entries, 6);
});

// ---------- 中文，这是 FTS5 自己做不到的 ----------
ok('搜中文词能搜到——FTS5 自带的分词器在这里返回 0', () => {
  assert.deepStrictEqual(idx.search({ query: '麦克风' }).ids, ['d']);
  assert.deepStrictEqual(idx.search({ query: '白名单' }).ids, ['d']);
});

ok('中英文各搜各的都行', () => {
  assert.deepStrictEqual(idx.search({ query: 'conference booking' }).ids, ['c']);
  assert.deepStrictEqual(idx.search({ query: '拼接' }).ids, ['e']);
});

ok('几个词是「都要有」，不是「有一个就行」', () => {
  // 「长截图 拼接」只有 e 两个都占；退回 OR 时才会把别的捞进来
  assert.deepStrictEqual(idx.search({ query: '长截图 拼接' }).ids, ['e']);
});

ok('一个词都对不上时，退回 OR，而不是直接空手', () => {
  const r = idx.search({ query: '麦克风 完全不存在的词' });
  assert.deepStrictEqual(r.ids, ['d'], JSON.stringify(r.ids));
});

// ---------- 元数据过滤，个人检索的主力 ----------
ok('按天取', () => {
  assert.deepStrictEqual(idx.search({ from: '2026-09-04', to: '2026-09-04' }).ids.sort(), ['a', 'b']);
});
ok('按类型取', () => {
  assert.deepStrictEqual(idx.search({ type: 'audio' }).ids, ['a']);
});
ok('按来源应用取', () => {
  assert.deepStrictEqual(idx.search({ app: 'chrome' }).ids, ['b']);
});
ok('只看收藏的', () => {
  assert.deepStrictEqual(idx.search({ pinned: true }).ids, ['d']);
});
ok('词和范围一起用', () => {
  assert.deepStrictEqual(idx.search({ query: '截图', from: '2026-09-06' }).ids, ['e']);
  assert.deepStrictEqual(idx.search({ query: '截图', to: '2026-09-05' }).ids, []);
});

ok('没有词的时候按时间倒着给，这就是「把这段时间给我」', () => {
  const r = idx.search({ from: '2026-09-04', to: '2026-09-06' });
  assert.strictEqual(r.scored, false);
  assert.strictEqual(r.ids.length, 6);
});

// ---------- 太常见的词要被丢掉，否则 ORDER BY rank 会拖垮整条查询 ----------
ok('出现在大多数记录里的词不参与匹配', () => {
  const many = [];
  for (let i = 0; i < 40; i++) many.push(entry(`x${i}`, { dateKey: '2026-09-07', title: `第 ${i} 条`, text: '记录 记录 briffy' }));
  many.push(entry('needle', { dateKey: '2026-09-07', title: '独一无二的那条', text: '记录 芹泽' }));
  day('2026-09-07', many);
  idx.sync(src);
  // 「记录」几乎每条都有，「芹泽」只有一条：结果应该是那一条，而不是四十一条
  const r = idx.search({ query: '记录 芹泽' });
  assert.deepStrictEqual(r.ids, ['needle'], JSON.stringify(r.ids.slice(0, 5)));
});

ok('每天有多少条，是粗筛那一层要用的', () => {
  const d = idx.days({ from: '2026-09-04', to: '2026-09-06' });
  assert.strictEqual(d.length, 3);
  assert.strictEqual(d.find((x) => x.day === '2026-09-04').n, 2);
});

// ---------- 索引是可以扔的 ----------
ok('换了工作区就重建，不会拿旧索引去答新工作区', () => {
  idx.close();
  idx.open(TMP, path.join(TMP, 'another-workspace'));
  assert.strictEqual(idx.stats().entries, 0, '旧索引没被清掉');
});

idx.close();
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* 留着也行 */ }
console.log(`index: ${pass} checks passed`);
