'use strict';
// 缺「屏幕录制」权限时，截图必须**不拍**，并且把人领到该去的地方。
//
// 这条存在的理由：macOS 在这件事上不报错。没有权限时它照样返回一张图，只是里面所有窗口都被
// 抹掉了，只剩壁纸。所以「拍到的东西是不是空的」这种事后检查一律看不出来——唯一的办法是
// 事先问，而这个测试守的就是那一问还在。2026-09-10 用户把一份新的 .app 装到 /Applications，
// 权限跟着旧路径留在原地，框选遮罩于是冻住一张干净的桌面，看着像是应用把人退了出去。
//
// electron 和两个只在 macOS 上有意义的模块都换成替身，所以这一份在任何机器上都跑得动，
// 也不碰真实的授权状态。
const path = require('path');
const Module = require('module');
const ROOT = path.join(__dirname, '..');

const calls = { askScreen: 0, pet: [], captured: 0, opened: 0 };
let status = 'denied';

const electron = {
  app: { getPath: () => path.join(require('os').tmpdir(), 'gate-test'), getName: () => 'briffy',
    getVersion: () => 't', isPackaged: true, getLocale: () => 'en-US', on() {}, whenReady: async () => {} },
  screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ id: 1, size: { width: 1, height: 1 } }), getAllDisplays: () => [], on() {} },
  desktopCapturer: { getSources: async () => [] },
  systemPreferences: { getMediaAccessStatus: () => status, askForMediaAccess: async () => true },
  shell: { openExternal: async () => { calls.opened++; } },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  clipboard: { writeImage() {}, readText: () => '', readImage: () => ({ isEmpty: () => true }) },
  BrowserWindow: class { constructor() {} static getAllWindows() { return []; } },
  ipcMain: { on() {}, handle() {} }, session: { defaultSession: {} }, powerMonitor: { on() {} },
  globalShortcut: { register: () => true, unregisterAll() {} }, Menu: { buildFromTemplate: () => ({}) }, Tray: class {},
};

const orig = Module._load;
Module._load = function (req) {
  if (req === 'electron') return electron;
  if (req === './capture') {
    return { screenPermissionStatus: () => status,
      captureDisplayUnderCursor: async () => { calls.captured++; return { png: Buffer.alloc(1), width: 1, height: 1, displayLabel: '' }; } };
  }
  if (req === './permissions') {
    return { askScreen: async () => { calls.askScreen++; calls.opened++; return { ok: status === 'granted', status, needsRestart: true }; },
      status: () => ({ grantedTo: 'briffy', packaged: true }) };
  }
  return orig.apply(this, arguments);
};

const workspace = require(path.join(ROOT, 'src', 'main', 'workspace.js'));
workspace.init({ store: { getSettings: () => ({}) }, windows: {
  setPetState: (s, o) => calls.pet.push(`${s}|${((o || {}).message || '').slice(0, 30)}`),
  hideForCapture: async () => 0, restoreAfterCapture() {},
} });

let pass = 0; let total = 0;
const check = (ok, line) => { total++; if (ok) pass++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${line}`); };

(async () => {
  // 1. 没有权限：两条路都不拍，都引导
  const shot = await workspace.captureScreenshot();
  check(shot === null && calls.captured === 0, `整屏，无权限：没拍（返回 ${shot}，捕获调用 ${calls.captured} 次）`);
  check(calls.askScreen === 1 && calls.pet.some((p) => p.startsWith('error|')), `整屏，无权限：开了设置并说了话（askScreen ${calls.askScreen}，气泡 ${JSON.stringify(calls.pet)}）`);

  // 2. 连按不该弹出五扇设置窗
  await workspace.captureScreenshot();
  await workspace.captureRegion();
  check(calls.askScreen === 1, `连按三下只推一次设置（askScreen ${calls.askScreen}）`);
  check(calls.pet.filter((p) => p.startsWith('error|')).length === 3, `但每一下都告诉你为什么（气泡 ${calls.pet.filter((p) => p.startsWith('error|')).length} 次）`);
  check(calls.captured === 0, `三下一张都没拍（捕获调用 ${calls.captured} 次）`);

  // 3. 给了权限就照常走
  status = 'granted';
  calls.captured = 0;
  await workspace.captureScreenshot().catch(() => {});
  check(calls.captured === 1, `有权限：照常拍（捕获调用 ${calls.captured} 次）`);

  console.log(`${pass}/${total} passed`);
  process.exit(pass === total ? 0 : 1);
})();
