'use strict';
// 谁开着麦克风，briffy 就跟着谁录 —— 这份名单里该有谁。
//
//   node dev/micwatch-test.js
//
// 这是自动录音里唯一一处"决定录什么"的判断，其余都是管道，所以它值得单独有测试。写这个测试的起因
// 是一个真实的坏结果：用微信输入法口述的每一句话都被存成了录音。输入法一按语音输入就打开麦克风，
// 而当时的规则是"别人开了我就跟着录"。
const assert = require('assert');
const micwatch = require('../src/main/micwatch');

let pass = 0;
const ok = (name, fn) => {
  try { fn(); pass++; } catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
};

const WETYPE = '/Library/Input Methods/WeType.app/Contents/MacOS/WeType';
const SOGOU = '/Library/Input Methods/SogouInput.app/Contents/MacOS/SogouInput';
const PRESSHOLD = '/System/Library/Input Methods/PressAndHold.app/Contents/MacOS/PAH_Extension';
const ZOOM = '/Applications/zoom.us.app/Contents/MacOS/zoom.us';
const MEETING = '/Applications/TencentMeeting.app/Contents/MacOS/TencentMeeting';
const SPEECHD = '/usr/libexec/corespeechd';
const names = (list) => list.map((h) => h.name);
const found = (...exes) => exes.map((exe, i) => ({ pid: 100 + i, exe }));

// ---------- 起因 ----------
ok('微信输入法的语音输入不算「有人在用麦克风」', () => {
  assert.deepStrictEqual(names(micwatch.follow(found(WETYPE))), []);
});

ok('没见过的输入法一样不算，因为判断的是目录不是名字', () => {
  assert.deepStrictEqual(names(micwatch.follow(found(SOGOU, PRESSHOLD))), []);
});

ok('但同一时刻真的在开会，会议还是要录', () => {
  assert.deepStrictEqual(names(micwatch.follow(found(WETYPE, ZOOM))), ['zoom.us']);
});

// ---------- 原本就有的两条 ----------
ok('常驻录音器不算', () => {
  assert.deepStrictEqual(names(micwatch.follow(found(SPEECHD))), []);
});

ok('自己不算，否则一开麦就永远停不下来', () => {
  const path = require('path');
  const own = path.join(path.dirname(process.execPath), 'whatever');
  assert.deepStrictEqual(names(micwatch.follow(found(own))), []);
});

ok('别的应用开了麦克风，就跟着录', () => {
  assert.deepStrictEqual(names(micwatch.follow(found(ZOOM, MEETING))), ['zoom.us', 'TencentMeeting']);
});

// ---------- 白名单 ----------
ok('白名单为空时，除了排除的都跟着录', () => {
  assert.deepStrictEqual(names(micwatch.follow(found(ZOOM, MEETING), { allow: [] })), ['zoom.us', 'TencentMeeting']);
});

ok('填了白名单，就只录名单里的', () => {
  assert.deepStrictEqual(names(micwatch.follow(found(ZOOM, MEETING), { allow: ['zoom'] })), ['zoom.us']);
});

ok('名单项可以写进程名，也可以写路径的一段', () => {
  assert.deepStrictEqual(names(micwatch.follow(found(ZOOM), { allow: ['/Applications/zoom.us.app'] })), ['zoom.us']);
  assert.deepStrictEqual(names(micwatch.follow(found(MEETING), { allow: ['tencentmeeting'] })), ['TencentMeeting']);
});

ok('白名单不会把排除名单推翻', () => {
  // 把 corespeechd 写进白名单也没用：它 24 小时占着麦克风，认了它就等于一直录
  assert.deepStrictEqual(names(micwatch.follow(found(SPEECHD), { allow: ['corespeechd'] })), []);
});

ok('输入法写进白名单也没用', () => {
  assert.deepStrictEqual(names(micwatch.follow(found(WETYPE), { allow: ['WeType'] })), []);
});

// 名单里一个空字符串会让 ''.includes('') 成立，也就是「谁都算」——正好是白名单该防的反面
ok('名单里的空项什么都不匹配，不会变成放行一切', () => {
  assert.deepStrictEqual(names(micwatch.follow(found(ZOOM), { allow: ['', '   '] })), []);
  assert.deepStrictEqual(names(micwatch.follow(found(ZOOM), { ignore: ['', '  '] })), ['zoom.us']);
});

ok('拿到的每一条都带着完整路径，设置页才能把它写进名单', () => {
  const [h] = micwatch.follow(found(ZOOM));
  assert.strictEqual(h.exe, ZOOM);
  assert.strictEqual(typeof h.pid, 'number');
});

// ---------- pmset 的输出 ----------
ok('从 pmset 的输出里认出谁在采集音频', () => {
  const text = [
    'Assertion status system-wide:',
    '   PreventUserIdleSystemSleep      1',
    'Listed by owning process:',
    'pid 591(coreaudiod): [0x000b] 05:22:21 PreventUserIdleSystemSleep named: "com.apple.audio.context"',
    '\tCreated for PID: 38745.',
    '\tResources: audio-in 9270A4B4-151B-477F-B6ED-85B36278491A',
    'pid 591(coreaudiod): [0x000c] 00:00:31 PreventUserIdleSystemSleep named: "com.apple.audio.context"',
    '\tCreated for PID: 1102.',
    '\tResources: audio-in AAAA1111-2222-3333-4444-555566667777',
    'pid 400(other): [0x000d] 01:00:00 PreventUserIdleSystemSleep named: "something else"',
    '\tCreated for PID: 999.',
    '\tResources: display',
  ].join('\n');
  assert.deepStrictEqual(micwatch._pidsFrom(text).sort((a, b) => a - b), [1102, 38745]);
});

ok('没有人在采集音频时，名单是空的', () => {
  assert.deepStrictEqual(micwatch._pidsFrom('Assertion status system-wide:\n   Foo 0\n'), []);
  assert.deepStrictEqual(micwatch.follow([]), []);
});

console.log(`micwatch: ${pass} checks passed`);
