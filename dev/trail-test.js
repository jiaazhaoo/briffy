'use strict';
// 不用你动手存的那一层。
//
//   node dev/trail-test.js
//
// 这是 briffy 里第一样不是用户有意存下的东西，所以这一组里有一半是**护栏**，不是功能：
// 默认必须关着、关着的时候一个字节都不许写、正文不许进 entries/。
// 剩下的是「同一页不重复记」「坏行不炸」这些追加写文件特有的毛病。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { console.log(`  FAIL ${name} — ${e.message}`); process.exitCode = 1; }
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-trail-'));
const trail = require('../src/main/trail');
let settings = { recordTrail: true };
trail.init({ store: { workspaceDir: TMP, getSettings: () => settings } });

const today = require('../src/main/store').localDateKey();
const lines = () => trail.read(today);

ok('默认是关着的', () => {
  const { DEFAULT_SETTINGS } = require('../src/main/store');
  assert.strictEqual(DEFAULT_SETTINGS.recordTrail, false,
    'recordTrail 默认必须是 false：这一层记的是你路过的东西，不是你决定留下的');
});

ok('关着的时候，一个字节都不写', () => {
  settings = { recordTrail: false };
  trail.notePage({ url: 'https://example.com/a', title: 'A', text: '正文' });
  assert.strictEqual(lines().length, 0, '关着还写了');
  assert.ok(!fs.existsSync(path.join(TMP, 'trail')), '关着还建了目录');
  settings = { recordTrail: true };
});

ok('一页的正文记一条', () => {
  assert.ok(trail.notePage({ url: 'https://example.com/a', title: '甲', text: '  这是   正文  ' }));
  const r = lines();
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].kind, 'page');
  assert.strictEqual(r[0].text, '这是 正文', '空白应该压平');
  assert.strictEqual(r[0].window, '甲');
});

ok('同一个网址不重复记——刷新、回退、SPA 来回切都会再触发一次', () => {
  const before = lines().length;
  assert.strictEqual(trail.notePage({ url: 'https://example.com/a', title: '甲', text: '这是正文' }), false);
  assert.strictEqual(lines().length, before);
});

ok('换了网址就记', () => {
  assert.ok(trail.notePage({ url: 'https://example.com/b', title: '乙', text: '另一页' }));
  assert.strictEqual(lines().length, 2);
});

ok('空正文不记：一个只有导航的壳留下来没有意义', () => {
  assert.strictEqual(trail.notePage({ url: 'https://example.com/c', title: '丙', text: '   ' }), false);
});

ok('正文有上限，和扩展那边一致', () => {
  trail.notePage({ url: 'https://example.com/long', title: '长', text: 'x'.repeat(trail.MAX_TEXT + 5000) });
  const r = lines().pop();
  assert.strictEqual(r.text.length, trail.MAX_TEXT);
});

ok('坏行跳过，不炸——追加写的文件被中途杀掉会留下半行', () => {
  fs.appendFileSync(path.join(TMP, 'trail', `${today}.jsonl`), '{"at":"2026-09-07T0');
  const r = lines();
  assert.ok(r.length >= 3, JSON.stringify(r.length));
});

ok('有痕迹的那些天列得出来', () => {
  assert.ok(trail.days().includes(today), JSON.stringify(trail.days()));
});

ok('每个应用待了多久，按「到下一条为止」算', () => {
  // 待在同一个窗口里不动，每五分钟也会落一条心跳（tick 里那条规则），所以真实的一天里
  // 不会有超过五分钟的空档。这里的假数据要照着那个形状写，否则量出来的是上限不是时长。
  const day = '2026-09-01';
  fs.writeFileSync(path.join(TMP, 'trail', `${day}.jsonl`), [
    { at: '2026-09-01T09:00:00.000Z', kind: 'focus', app: 'Chrome', window: 'a' },
    { at: '2026-09-01T09:05:00.000Z', kind: 'focus', app: 'Chrome', window: 'a' },   // 心跳
    { at: '2026-09-01T09:10:00.000Z', kind: 'focus', app: 'Terminal', window: 'b' },
    { at: '2026-09-01T09:12:00.000Z', kind: 'focus', app: 'Chrome', window: 'c' },
    { at: '2026-09-01T09:15:00.000Z', kind: 'focus', app: 'Chrome', window: 'd' },
  ].map((x) => JSON.stringify(x)).join('\n') + '\n');
  const s = trail.spans(day);
  assert.strictEqual(s[0].app, 'Chrome');
  assert.strictEqual(s[0].secs, 300 + 300 + 180, JSON.stringify(s));   // 两段五分钟 + 三分钟，最后一条到自己是 0
  assert.strictEqual(s[1].secs, 120);
});

ok('一段最长按心跳算——中间可能锁屏或睡眠，那些不算「在用」', () => {
  const day = '2026-09-02';
  fs.writeFileSync(path.join(TMP, 'trail', `${day}.jsonl`), [
    { at: '2026-09-02T09:00:00.000Z', kind: 'focus', app: 'Chrome', window: 'a' },
    { at: '2026-09-02T20:00:00.000Z', kind: 'focus', app: 'Chrome', window: 'b' },
  ].map((x) => JSON.stringify(x)).join('\n') + '\n');
  const s = trail.spans(day);
  assert.strictEqual(s[0].secs, trail.HEARTBEAT_MS / 1000, '十一个小时被当成了「一直在用」');
});

ok('正文不进 entries/，那一页是「你决定留下的东西」', () => {
  const entries = path.join(TMP, 'entries');
  assert.ok(!fs.existsSync(entries), 'trail 写到 entries/ 里去了');
  assert.ok(fs.existsSync(path.join(TMP, 'trail')), 'trail 应该有自己的地方');
});

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* 系统会收 */ }
console.log(`\ntrail: ${pass} passed`);
process.exit(process.exitCode || 0);
