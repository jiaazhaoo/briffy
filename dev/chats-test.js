'use strict';
// 问过的那些对话，留在磁盘上。
//
//   node dev/chats-test.js
//
// 这一组盯的是「历史」这件事本身：切页回来还在、标题从第一句问的话来、原子写不留半个文件、
// 坏文件不炸掉整张列表。渲染那一半这一页本来就有，缺的一直是这一半。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { console.log(`  FAIL ${name} — ${e.message}`); process.exitCode = 1; }
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-chats-'));
const chats = require('../src/main/chats');
chats.init({ store: { workspaceDir: TMP } });
const turn = (q, a) => ({ question: q, answer: a, sources: [], used: [] });

ok('一条都没有的时候，列表是空的，不是炸的', () => {
  assert.deepStrictEqual(chats.list(), []);
});

ok('问一句就开一条，标题是那句话本身', () => {
  const { chat, created } = chats.append('', turn('我最近有个 walking 挑战', '在 9 月 12 日'));
  assert.ok(created);
  assert.strictEqual(chat.title, '我最近有个 walking 挑战');
  assert.strictEqual(chat.turns.length, 1);
});

ok('接着问，落在同一条里，标题不变', () => {
  const first = chats.list()[0];
  const { chat, created } = chats.append(first.id, turn('多少钱', '£139'));
  assert.strictEqual(created, false);
  assert.strictEqual(chat.turns.length, 2);
  assert.strictEqual(chat.title, '我最近有个 walking 挑战', '第二句不该改标题');
});

ok('切页回来还在——这就是这个文件存在的理由', () => {
  const id = chats.list()[0].id;
  const again = chats.read(id);
  assert.strictEqual(again.turns.length, 2);
  assert.strictEqual(again.turns[1].answer, '£139');
});

ok('新的在前', () => {
  // 等时钟走过一毫秒再建第二条。不等的话两条的 updatedAt 会一模一样，这一句断言的就不是
  // 「新的在前」而是平局时谁碰巧排前面——那是 2026-09-10 之前每六次红一次的原因。
  const t0 = Date.now();
  while (Date.now() === t0) { /* 毫秒级的时间戳，等它跳一下 */ }
  chats.append('', turn('后来问的', 'x'));
  const l = chats.list();
  assert.strictEqual(l[0].title, '后来问的', JSON.stringify(l.map((c) => c.title)));
  assert.strictEqual(l.length, 2);
});

ok('改名字', () => {
  const id = chats.list().find((c) => c.title === '后来问的').id;
  chats.rename(id, '  报名那件事  ');
  assert.strictEqual(chats.read(id).title, '报名那件事', '前后空白该去掉');
});

ok('删掉', () => {
  const id = chats.list()[0].id;
  assert.ok(chats.remove(id));
  assert.ok(!chats.list().some((c) => c.id === id));
  assert.strictEqual(chats.remove(id), false, '删第二次不该假装成功');
});

ok('坏文件跳过，不炸掉整张列表', () => {
  fs.writeFileSync(path.join(TMP, 'chats', 'broken.json'), '{ 半个');
  const l = chats.list();
  assert.ok(Array.isArray(l) && l.length >= 1, JSON.stringify(l));
});

ok('id 不能拿来走出这个目录', () => {
  assert.strictEqual(chats.read('../../../etc/passwd'), null);
  assert.strictEqual(chats.remove('../../../etc/passwd'), false);
});

ok('写是原子的：不留半个文件', () => {
  // 换名之后目录里不该有 .tmp 剩下
  chats.append('', turn('再问一句', 'y'));
  const left = fs.readdirSync(path.join(TMP, 'chats')).filter((f) => f.endsWith('.tmp'));
  assert.deepStrictEqual(left, [], '留下了临时文件：' + left.join(','));
});

ok('一条对话有上限，不会无限长下去', () => {
  const { chat } = chats.append('', turn('长的', '0'));
  let id = chat.id;
  for (let i = 1; i <= chats.KEEP_TURNS + 5; i++) chats.append(id, turn(`第 ${i} 句`, String(i)));
  const c = chats.read(id);
  assert.strictEqual(c.turns.length, chats.KEEP_TURNS);
  assert.strictEqual(c.turns[c.turns.length - 1].answer, String(chats.KEEP_TURNS + 5), '留下的该是最近的');
  assert.strictEqual(c.title, '长的', '砍掉开头之后标题不该跟着变');
});

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* 系统会收 */ }
console.log(`\nchats: ${pass} passed`);
process.exit(process.exitCode || 0);
