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

// 空手是有意义的答案：上层看到空手才知道该退回「把这段时间给我」。曾经在这里加过一级 OR 兜底，
// 结果「今天做了什么」被三条弱匹配顶掉了时间回退，「麦克风白名单」捞回十七条噪音——两头都坏。
ok('有一个词对不上，就是没有，不要凑合着给', () => {
  assert.deepStrictEqual(idx.search({ query: '麦克风 完全不存在的词' }).ids, []);
});

ok('连写的长词，整串相邻找不到时拆开找，但不拆到单字', () => {
  // 「麦克风白名单」ICU 切成 麦克/风/白/名单：整串相邻没有，拆开靠 麦克 + 名单 找得到，
  // 而 风 和 白 这种单字到处都是，带上它们就成噪音了
  assert.deepStrictEqual(idx.search({ query: '麦克风白名单' }).ids, ['d']);
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

// ---------- 一句话和几个关键词，不是一回事 ----------
// 这一组是从一次真实的失败里长出来的：问「我最近有个 walking 挑战，你帮我看看记录帮我生成行程单」，
// 那一周 208 条记录里报名信息一条也没被取到，模型只好去猜日期。三处都错，缺一不可。

ok('一整句没有标点的中文，不会被拼成一个相邻短语', () => {
  // 「你帮我看看记录帮我生成行程单」ICU 切成十个词。把它们拼成相邻短语，等于要求这句话原样
  // 出现在某条记录里——永远不成立，而它是 AND 的一项，会把同一个 AND 里真有用的词一起打死。
  const keys = idx.termsOf('你帮我看看记录帮我生成行程单').map((p) => p.key);
  assert.ok(!keys.some((k) => k.split(' ').length > 3), '还在拼长短语: ' + JSON.stringify(keys));
  assert.ok(keys.includes('看看') && keys.includes('记录'), JSON.stringify(keys));
  assert.ok(!keys.includes('我') && !keys.includes('帮'), '单字不该留下: ' + JSON.stringify(keys));
});

ok('df 是「多少条记录里有」，不是「一共出现多少次」', () => {
  day('2026-09-08', [entry('rep', { dateKey: '2026-09-08', title: '重复', text: '芜湖 芜湖 芜湖 芜湖 芜湖' })]);
  idx.sync(src);
  const [t] = idx.termsOf('芜湖');
  assert.strictEqual(t.df, 1, `一条记录里写五遍，df 还是 1，实际 ${t.df}`);
});

ok('一句话：靠共同命中的稀有词找得到，不必条条都对上', () => {
  day('2026-09-09', [
    entry('reg', { dateKey: '2026-09-09', title: 'Sat 12 Sep 2026', text: 'Ultra March 1st Half Challenge 50km Walking Only 挑战 £139' }),
    entry('noise', { dateKey: '2026-09-09', title: '别的', text: '今天生成了一份行程 看看而已' }),
  ]);
  idx.sync(src);
  // 没有任何一条同时含着 walking / 挑战 / 生成 / 行程 / 看看——「都要有」在这里必定交白卷
  const r = idx.search({ query: '我有个 walking 挑战，你帮我看看记录帮我生成行程单' });
  assert.ok(r.ids.includes('reg'), '报名那条没被取到: ' + JSON.stringify(r.ids));
  assert.ok(r.scored, '不该退回成时间范围');
});

ok('几个关键词还是「都要有」，这一级不受影响', () => {
  // 两个词是关键词不是句子：漏一个就是问的不是这件事，仍然交白卷
  assert.deepStrictEqual(idx.search({ query: '麦克风 完全不存在的词' }).ids, []);
  assert.deepStrictEqual(idx.search({ query: '长截图 拼接' }).ids, ['e']);
});

ok('稀有词不够两个就不启动，时间回退保得住', () => {
  // 「今天做了什么」把时间词拿走之后只剩「做了什么」，凑不出两个稀有词——
  // 必须继续交白卷，上层才知道该把这一天整个给他
  assert.deepStrictEqual(idx.search({ query: '做了什么' }).ids, []);
});

ok('search 把用到的词一起交出来，上层要拿它去截正文', () => {
  const r = idx.search({ query: '麦克风白名单' });
  assert.ok(Array.isArray(r.terms) && r.terms.length, JSON.stringify(r.terms));
  assert.ok(r.terms.some((w) => w.indexOf(' ') < 0), '中文的词要拼回没有空格的样子: ' + JSON.stringify(r.terms));
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

ok('改了表结构要重建表，不是只删行', () => {
  // 实测踩过，而且是升级路径上必踩：schema 从 5 升到 6 时只 DELETE 不 DROP，
  // `CREATE TABLE IF NOT EXISTS` 碰到上一代的旧表整句跳过，新加的列永远长不出来。
  // 结果是升级后第一次启动直接死在「table entries has no column named hash」，
  // 索引一条都建不起来，而这条错只在 console 里，界面上什么都看不出来。
  idx.close();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-schema-'));
  const { DatabaseSync } = require('node:sqlite');
  const old = new DatabaseSync(path.join(dir, 'index.db'));
  old.exec('CREATE TABLE meta(k TEXT PRIMARY KEY, v TEXT); CREATE TABLE entries(rowid INTEGER PRIMARY KEY, id TEXT UNIQUE, day TEXT);');
  old.prepare('INSERT INTO meta(k,v) VALUES(?,?)').run('schema', '1');
  old.close();

  idx.open(dir, WS);
  const probe = new DatabaseSync(path.join(dir, 'index.db'));
  const cols = probe.prepare('PRAGMA table_info(entries)').all().map((r) => r.name);
  probe.close();
  assert.ok(cols.includes('hash'), '旧表没被换掉，列还是老的：' + cols.join(','));
  assert.ok(cols.includes('type'), cols.join(','));
  idx.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

idx.close();
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* 留着也行 */ }
console.log(`index: ${pass} checks passed`);
