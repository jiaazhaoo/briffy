'use strict';
// 有没有新版本，以及怎么换上。
//
// macOS 上只有一种走法：Squirrel.Mac，它认 **zip**，不认 dmg——dmg 是给人拖的，不是给程序换的。
// 所以 build.mac.target 里那个 zip 不是多余的，它就是更新用的那一份；dmg 只给第一次装的人。
// 更新包的签名必须和已装的那一份对得上，否则 Squirrel 会拒绝，而且是**安静地**拒绝。
//
// **不自动下载。** 这个应用 516MB。在别人的网上替他做这个决定不合适，何况这是 briffy 唯一一个
// 自己发起的对外请求——其余的联网都是你按了什么才发生的（问模型、抓一张图）。所以它有开关，
// 查的时候只问一行版本号，下不下载是你点的，而且按钮上写着这一版有多大。
//
// 三件在别处会咬人的事：
//   1. **从源码跑不了。** autoUpdater 要 app-update.yml，那是打包时才写进去的；没有它会直接抛。
//      所以这里先看 app.isPackaged，并且把「不可用」当成一种正常状态报出去，而不是当成错误。
//   2. **下完不等于换上。** Squirrel 把新版放在一边，等应用退出才替换。话必须说成「重启后生效」，
//      不然看着就像下了个寂寞。
//   3. **查不到不是出错。** 断网、GitHub 抽风、一个 release 都还没发过，都会走到 error 这一支。
//      这种时候不该弹东西吓人——安静记下，设置页里看得到就够了。只有你自己点「检查更新」时，
//      才把失败说出来：那一下你在等一个回答。
const { app } = require('electron');

const CHECK_DELAY_MS = 30 * 1000;          // 启动后先让应用把自己安顿好，再去问
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000; // 一天四次。更勤没有意义，发版没有这么频繁

let deps = null;
let updater = null;      // 懒加载：从源码跑的时候连 require 都不必
let timer = null;
/** @type {{phase:string, version:string, size:number, percent:number, error:string, manual:boolean}} */
let state = { phase: 'idle', version: '', size: 0, percent: 0, error: '', manual: false };

function emit(patch) {
  state = { ...state, ...patch };
  if (deps && deps.onState) deps.onState(status());
}
/** @returns {{phase:string, version:string, current:string, size:number, percent:number, error:string, supported:boolean}} */
function status() {
  return { ...state, current: app.getVersion(), supported: app.isPackaged };
}

function load() {
  if (updater) return updater;
  updater = require('electron-updater').autoUpdater;
  // 半个 G 的东西，不问一声就往下拉是不礼貌的。见文件头。
  updater.autoDownload = false;
  // 下好了就等退出那一刻换上——用户不点「立即重启」也不会白下一次。
  updater.autoInstallOnAppQuit = true;
  updater.logger = null;
  updater.on('update-available', (info) => {
    const size = (info.files || []).reduce((n, f) => Math.max(n, Number(f.size) || 0), 0);
    emit({ phase: 'available', version: info.version, size, percent: 0, error: '' });
  });
  updater.on('update-not-available', () => emit({ phase: 'uptodate', version: '', error: '' }));
  updater.on('download-progress', (p) => emit({ phase: 'downloading', percent: Math.round(p.percent || 0) }));
  updater.on('update-downloaded', (info) => emit({ phase: 'ready', version: info.version, percent: 100 }));
  updater.on('error', (e) => emit({ phase: 'error', error: String((e && e.message) || e) }));
  return updater;
}

/**
 * 去问一次。`manual` 是「用户按了检查更新」——只有那时候才把失败摆到脸上，
 * 定时那几次失败了就安静躺在设置页里。
 */
async function check({ manual = false } = {}) {
  if (!app.isPackaged) { emit({ phase: 'unsupported', manual, error: '' }); return status(); }
  if (state.phase === 'checking' || state.phase === 'downloading') return status();
  if (!manual && deps && deps.getSettings && deps.getSettings().autoUpdate === false) return status();
  emit({ phase: 'checking', manual, error: '' });
  try {
    await load().checkForUpdates();
  } catch (e) {
    emit({ phase: 'error', error: String((e && e.message) || e) });
  }
  return status();
}

/** 你点了下载才走这儿。进度经 onState 一路报到设置页上。 */
async function download() {
  if (!app.isPackaged || state.phase !== 'available') return status();
  emit({ phase: 'downloading', percent: 0, error: '' });
  try {
    await load().downloadUpdate();
  } catch (e) {
    emit({ phase: 'error', error: String((e && e.message) || e) });
  }
  return status();
}

/** 立刻重启换上。没下完之前按不动——按钮那边也是灰的。 */
function install() {
  if (state.phase !== 'ready') return false;
  setImmediate(() => load().quitAndInstall());
  return true;
}

function start(d) {
  deps = d;
  stop();
  if (!app.isPackaged) { emit({ phase: 'unsupported' }); return; }
  timer = setTimeout(function tick() {
    check().catch(() => {});
    timer = setTimeout(tick, CHECK_EVERY_MS);
  }, CHECK_DELAY_MS);
}
function stop() { if (timer) { clearTimeout(timer); timer = null; } }

module.exports = { start, stop, check, download, install, status };
