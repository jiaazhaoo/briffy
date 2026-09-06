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

function status() {
  return {
    platform: process.platform,
    mic: micStatus(),
    screen: screenStatus(),
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

function openSettingsPane(which) {
  if (!MAC) return Promise.resolve();
  const pane = which === 'mic'
    ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
    : 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
  return shell.openExternal(pane);
}

module.exports = { status, askMic, askScreen, openSettingsPane, micStatus, screenStatus };
