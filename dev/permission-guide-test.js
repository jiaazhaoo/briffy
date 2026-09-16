'use strict';
// 任何功能因为系统权限失效时，都得把引导页开出来——只讲缺的那一项，一个键通到那一页设置，一个键重启。
//
//   node dev/permission-guide-test.js
//
// 2026-09-16 用户定的规矩。起因：换了版本后签名一变，旧的屏幕录制授权对新包无效，
// 而设置里那个开关看着还是开的。briffy 那时唯一的提示是小猫身上 9 秒的一句话——
// 小猫又被设计成永远不进任何截图。用户按了六天截图，以为软件坏了。
//
// 这个台子守三件事：每个失效点都接了引导；三项权限（屏幕 / 麦克风 / 辅助功能）都在；
// 引导页里那三句话（点名功能、「开关看着是开的也要关一下」、重启键）两种语言都有。
// 窗口真开起来什么样，预览里看：/onboarding?guide=screen&feature=截图&grantafter=5
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const main = R('src/main/main.js');
const workspace = R('src/main/workspace.js');
const windows = R('src/main/windows.js');
const permissions = R('src/main/permissions.js');
const ob = R('src/renderer/onboarding/onboarding.js');
const obHtml = R('src/renderer/onboarding/index.html');
const obCss = R('src/renderer/onboarding/onboarding.css');
const preload = R('src/preload/onboarding.js');
const i18n = R('src/main/i18n.js');

let pass = 0;
const ok = (name, fn) => {
  try { fn(); pass++; } catch (e) { console.log(`  FAIL ${name} — ${e.message}`); process.exitCode = 1; }
};

// ---------- 每个失效点都接了引导 ----------
ok('截图被权限拦住时开引导', () => {
  const fn = workspace.slice(workspace.indexOf('async function ensureScreenAccess'));
  assert.ok(/openGuide\('screen'/.test(fn.slice(0, fn.indexOf('\n}'))), 'ensureScreenAccess 里没开引导');
});
ok('麦克风被拒时开引导', () => assert.ok(/pet:mic-denied[\s\S]{0,300}openGuide\('mic'/.test(main), '收到 pet:mic-denied 没开引导'));
ok('换了版本第一次启动，缺哪项就开哪项，之后不再念', () => {
  assert.ok(/permGuideVersion/.test(main), '没有「每个版本只提一次」的记号');
  assert.ok(/s0\.setupDone && s0\.permGuideVersion !== ver/.test(main), '该在 setupDone 之后才提，首次引导本身就讲权限');
  assert.ok(/openGuide\(missing\[0\], missing\[1\]\)/.test(main));
});
ok('小猫身上那句话没被删掉——引导是加上去的，不是换掉的', () => {
  assert.ok(/screenBlockedAgain/.test(workspace), '截图那条路的小猫提示没了');
  assert.ok(/message: t\('micDenied'\)/.test(main), '麦克风那条路的小猫提示没了');
});

// ---------- 三项权限 ----------
ok('permissions.status() 报三项', () => {
  assert.ok(/ax: axStatus\(\)/.test(permissions));
  assert.ok(/isTrustedAccessibilityClient\(false\)/.test(permissions), '辅助功能得问系统，不是猜');
  assert.ok(/isTrustedAccessibilityClient\(true\)/.test(permissions), 'askAx 该让系统弹一次');
});
ok('三个设置面板的地址都有', () => {
  for (const p of ['Privacy_Microphone', 'Privacy_ScreenCapture', 'Privacy_Accessibility']) assert.ok(permissions.includes(p), p);
});
ok('有 relaunch，而且接到了 IPC 和页面', () => {
  assert.ok(/function relaunch\(\)[\s\S]*app\.relaunch\(\)[\s\S]*app\.exit\(0\)/.test(permissions));
  assert.ok(/ob:relaunch/.test(main) && /ob:relaunch/.test(preload), 'ob:relaunch 没接通');
  assert.ok(/btnRestart[\s\S]*ob\.relaunch\(\)/.test(ob), '页面上的重启键没接');
});
ok('引导页把辅助功能也列进去了', () => {
  assert.ok(/id: 'ax'/.test(ob));
  assert.strictEqual((ob.match(/\{ id: '(mic|screen|ax)'/g) || []).length, 3, 'PERMS 该有三项');
});

// ---------- 引导页 ----------
ok('引导模式只讲那一项', () => {
  assert.ok(/const GUIDE = /.test(ob) && /PERMS\.filter\(\(x\) => x\.id === GUIDE\)/.test(ob));
});
ok('窗开到那一项：主进程把 guide 和 feature 传成 query', () => {
  assert.ok(/function openGuide\(which, feature\)/.test(windows));
  // rendererPath(...) 自己带一对括号，所以别用 [^)]* 去跨它
  assert.ok(/loadFile\(rendererPath\('onboarding', 'index\.html'\), \{ query: q \}\)/.test(windows), 'loadFile 没带 query');
});
ok('三句关键文案两种语言都有', () => {
  for (const k of ['guideTitle', 'guideStale', 'guideGranted', 'guideRestart', 'permNameScreen', 'permNameMic', 'permNameAx', 'permAx']) {
    assert.strictEqual((ob.match(new RegExp(`\\b${k}:`, 'g')) || []).length, 2, `${k} 该在 zh 和 en 各出现一次`);
  }
  // 那个坑必须写在页面上：开关看着是开的也要关一下再开
  assert.ok(/guideStale: '[^']*关掉再打开/.test(ob) && /guideStale: '[^']*off and on again/.test(ob));
});
ok('主进程点名功能的三个词两种语言都有', () => {
  for (const k of ['featScreenshot', 'featVoice', 'featWindowText']) {
    assert.strictEqual((i18n.match(new RegExp(`\\b${k}:`, 'g')) || []).length, 2, k);
  }
});
ok('引导模式藏掉六步导航，露出两个键', () => {
  assert.ok(/id="btnLater"/.test(obHtml) && /id="btnRestart"/.test(obHtml));
  assert.ok(/body\.guide #btnBack, body\.guide #btnNext, body\.guide \.steps/.test(obCss), '导航没藏');
  assert.ok(/body\.guide \.guide-only \{ display: inline-flex; \}/.test(obCss));
});
ok('给了之后重启键才变主键（没给时重启了也没用）', () => {
  assert.ok(/btnRestart'\)\.classList\.toggle\('primary', ok\)/.test(ob));
});
ok('引导模式每 2 秒问一次权限——用户是去别的窗口拨开关的，这边得自己看见', () => {
  assert.ok(/setInterval\(refreshPerms, 2000\)/.test(ob));
});

console.log(`permission-guide: ${pass} passed`);
