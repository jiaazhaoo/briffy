'use strict';
// What macOS will and will not let the app do, and the one honest way to ask for each.
//
// The two permissions behave nothing alike, which is why a single "grant" button cannot cover both:
//   microphone     — the app can ask, and macOS shows its own dialog. One tap and it is done.
//   screen record  — the app cannot ask. macOS only offers it after a capture has been attempted once,
//                    and the switch lives in System Settings. It also does not take effect until the
//                    app is relaunched, so pretending otherwise would just look broken.
const { systemPreferences, desktopCapturer, shell, app } = require('electron');

const MAC = process.platform === 'darwin';

function micStatus() {
  if (!MAC) return 'granted';
  try { return systemPreferences.getMediaAccessStatus('microphone'); } catch (_) { return 'unknown'; }
}
function screenStatus() {
  if (!MAC) return 'granted';
  try { return systemPreferences.getMediaAccessStatus('screen'); } catch (_) { return 'unknown'; }
}
// 辅助功能：读辅助功能树的正文（ax-text）、窗口标题和前台应用（foreground）、长截图都靠它。
// 2026-09-16 之前这一项**根本没查过**——没给的话那几处只是静静地退回 OCR 和「未知」，
// 用户永远不知道少了什么。
function axStatus() {
  if (!MAC) return 'granted';
  try { return systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied'; } catch (_) { return 'unknown'; }
}

function status() {
  return {
    platform: process.platform,
    mic: micStatus(),
    screen: screenStatus(),
    ax: axStatus(),
    // Running from source, the permission is attached to Electron rather than to briffy, and the
    // System Settings list says so. Worth admitting rather than letting someone hunt for the wrong name.
    grantedTo: app.isPackaged ? app.getName() : 'Electron',
    packaged: app.isPackaged,
  };
}

/** macOS shows its own dialog here; there is nothing for us to draw. */
async function askMic() {
  if (!MAC) return { ok: true, status: 'granted' };
  try {
    await systemPreferences.askForMediaAccess('microphone');
  } catch (_) { /* already decided, or no access to ask */ }
  return { ok: micStatus() === 'granted', status: micStatus() };
}

/**
 * Screen recording cannot be requested. Attempting one capture is what makes macOS list the app in
 * System Settings at all, so we do that first and then open the pane the switch is on.
 */
async function askScreen() {
  if (!MAC) return { ok: true, status: 'granted' };
  try {
    await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
  } catch (_) { /* refusal is the expected outcome; it is what registers the app */ }
  const after = screenStatus();
  if (after !== 'granted') {
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  }
  return { ok: after === 'granted', status: after, needsRestart: after !== 'granted' };
}

/**
 * 辅助功能可以让系统弹一次提示（isTrustedAccessibilityClient(true)），但那个提示只弹一次，
 * 之后就只能去设置里拨。所以和屏幕录制一样：先弹，没成就打开那一页。
 */
async function askAx() {
  if (!MAC) return { ok: true, status: 'granted' };
  try { systemPreferences.isTrustedAccessibilityClient(true); } catch (_) { /* 提示弹不出来就算了 */ }
  const after = axStatus();
  if (after !== 'granted') await openSettingsPane('ax');
  return { ok: after === 'granted', status: after, needsRestart: after !== 'granted' };
}

const PANES = {
  mic: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  ax: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
};
function openSettingsPane(which) {
  if (!MAC) return Promise.resolve();
  return shell.openExternal(PANES[which] || PANES.screen);
}

/** 拨完开关要重启才生效。让用户自己去找「退出」再双击，是这条路上最容易断掉的一步。 */
function relaunch() {
  app.relaunch();
  app.exit(0);
}

module.exports = { status, askMic, askScreen, askAx, openSettingsPane, relaunch, micStatus, screenStatus, axStatus };
