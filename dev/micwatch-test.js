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

// 这条是那两条 B 站录音换来的。采集麦克风的不是主进程，是 Chromium 的音频辅助进程，它住在
// Contents/Frameworks 底下——只认 Contents/MacOS 的话，briffy 会把自己当成「别的软件」，然后一直录。
ok('自己的 helper 也算自己，它才是真正开麦的那个', () => {
  const app = '/Applications/briffy.app';
  const root = micwatch.ownRootOf(`${app}/Contents/MacOS/briffy`, 'darwin');
  assert.strictEqual(root, app, '要认到整个 .app，不是 Contents/MacOS');
  // 采集麦克风的进程住在这里，之前它不以 Contents/MacOS 开头，于是被当成了「别的软件」
  const helper = `${app}/Contents/Frameworks/briffy Helper.app/Contents/MacOS/briffy Helper`;
  assert.ok(helper.startsWith(root), '把自己的 helper 当成别人 = 自己录自己，永不停止');
});

ok('不在 .app 里的时候，还是按可执行文件所在目录算', () => {
  assert.strictEqual(micwatch.ownRootOf('/opt/briffy/bin/briffy', 'linux'), '/opt/briffy/bin');
  assert.strictEqual(micwatch.ownRootOf('/opt/briffy/bin/briffy', 'darwin'), '/opt/briffy/bin');
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

// ---------- 浏览器按站点放行 ----------
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome Helper';
const SAFARI = '/Applications/Safari.app/Contents/MacOS/Safari';

ok('浏览器停在会议那一页，跟着录', () => {
  const got = micwatch.follow(found(CHROME), { allow: ['meet.google.com'], tabUrl: 'https://meet.google.com/abc-defg-hij' });
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].site, 'meet.google.com');
});

ok('同一个浏览器开着别的网站，不录', () => {
  assert.deepStrictEqual(
    names(micwatch.follow(found(CHROME), { allow: ['meet.google.com'], tabUrl: 'https://mail.google.com/' })), []);
});

// 这是把整个浏览器写进白名单会犯的错：网页里的语音输入和输入法是同一类问题
ok('不知道停在哪一页时，浏览器不算放行', () => {
  assert.deepStrictEqual(names(micwatch.follow(found(CHROME), { allow: ['meet.google.com'], tabUrl: '' })), []);
  assert.deepStrictEqual(names(micwatch.follow(found(SAFARI), { allow: ['meet.google.com'] })), []);
});

ok('子域名算，形近的域名不算', () => {
  const at = (u) => names(micwatch.follow(found(CHROME), { allow: ['zoom.us'], tabUrl: u })).length;
  assert.strictEqual(at('https://us02web.zoom.us/j/123'), 1, '子域名该算');
  assert.strictEqual(at('https://notzoom.us/j/123'), 0, 'notzoom.us 不是 zoom.us');
  assert.strictEqual(at('https://zoom.us.evil.com/'), 0, '把它放在前面也不算');
});

ok('站点只对浏览器生效，别的应用不会因为你开着那一页就被录', () => {
  assert.deepStrictEqual(
    names(micwatch.follow(found(MEETING), { allow: ['meet.google.com'], tabUrl: 'https://meet.google.com/x' })), []);
});

ok('同一项既能匹配应用也能匹配站点', () => {
  // zoom.us 既是进程名也是域名，不需要分成两种写法
  assert.deepStrictEqual(names(micwatch.follow(found(ZOOM), { allow: ['zoom.us'] })), ['zoom.us']);
  assert.strictEqual(micwatch.follow(found(CHROME), { allow: ['zoom.us'], tabUrl: 'https://zoom.us/j/1' }).length, 1);
});

ok('排除名单不看站点：占着麦克风就是占着，跟在哪一页无关', () => {
  assert.deepStrictEqual(
    names(micwatch.follow(found(SPEECHD), { ignore: ['corespeechd'], tabUrl: 'https://meet.google.com/x' })), []);
});

// ---------- 默认名单是这台电脑上装了的东西 ----------
const apps = require('../src/main/apps');

ok('没设置过时，用的是探测出来的那份，不是写死的', () => {
  const { DEFAULT_SETTINGS } = require('../src/main/store');
  assert.strictEqual(DEFAULT_SETTINGS.autoRecordAllow, null, '写死的名单是别人的电脑的');
  assert.ok(apps.defaultAllow().length >= apps.SITES.length, '至少该有那几个会议网站');
});

ok('默认名单里没有重复项', () => {
  const list = apps.defaultAllow().map((x) => x.toLowerCase());
  assert.strictEqual(new Set(list).size, list.length, list.join('、'));
});

ok('默认名单不会放行输入法，也不会放行随便一个应用', () => {
  const allow = apps.defaultAllow();
  const RANDOM = '/Applications/Preview.app/Contents/MacOS/Preview';
  assert.deepStrictEqual(names(micwatch.follow(found(WETYPE, RANDOM), { allow })), []);
});

ok('装了的会议软件会进默认名单', () => {
  // 这台机器上装了什么不归测试管，所以查的是「探测到的每一个，都在默认名单里」
  const { meeting } = apps.detect();
  const allow = apps.defaultAllow().map((x) => x.toLowerCase());
  for (const m of meeting) assert.ok(allow.includes(m.binary.toLowerCase()), `${m.name} 没进名单`);
});

ok('探测到的每个应用都能说出它的可执行文件名', () => {
  const { meeting, browsers } = apps.detect();
  for (const a of [...meeting, ...browsers]) {
    assert.ok(a.binary && !a.binary.includes('/'), `${a.name} -> ${JSON.stringify(a.binary)}`);
    assert.ok(a.name && a.path.endsWith('.app'), JSON.stringify(a));
  }
});

ok('名单里的一项能翻回这台电脑上那个软件的名字', () => {
  const { meeting } = apps.detect();
  if (!meeting.length) return;                       // 一台没装会议软件的机器，这条无从检查
  const [m] = meeting;
  const [d] = apps.describe([m.binary]);
  assert.strictEqual(d.kind, 'app');
  assert.strictEqual(d.label, m.name);
  assert.strictEqual(d.entry, m.binary);
});

ok('站点认得出来，没装的软件不会被说成装了', () => {
  assert.deepStrictEqual(apps.describe(['meet.google.com'])[0].kind, 'site');
  assert.deepStrictEqual(apps.describe(['SomeThingNobodyHas'])[0].kind, 'unknown');
});

ok('浏览器不进默认名单——它是按站点放行的', () => {
  const allow = apps.defaultAllow().map((x) => x.toLowerCase());
  for (const b of apps.detect().browsers) {
    assert.ok(!allow.includes(b.binary.toLowerCase()), `${b.name} 不该整个被放行`);
  }
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
