'use strict';
// Full-screen capture of the display under the mouse cursor (works on Windows and macOS).
const { desktopCapturer, screen, systemPreferences } = require('electron');

function screenPermissionStatus() {
  if (process.platform !== 'darwin') return 'granted';
  try { return systemPreferences.getMediaAccessStatus('screen'); } catch (_) { return 'unknown'; }
}

async function captureDisplayUnderCursor() {
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const scale = display.scaleFactor || 1;
  const thumbnailSize = {
    width: Math.round(display.size.width * scale),
    height: Math.round(display.size.height * scale),
  };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
  if (!sources.length) throw new Error('No screen source available');

  let source = sources.find((s) => String(s.display_id) === String(display.id));
  if (!source) {
    const all = screen.getAllDisplays();
    const idx = all.findIndex((d) => d.id === display.id);
    source = sources[idx] || sources[0];
  }
  const image = source.thumbnail;
  if (!image || image.isEmpty()) {
    throw new Error(process.platform === 'darwin'
      ? 'Screen capture returned an empty image – grant Screen Recording permission in System Settings › Privacy & Security'
      : 'Screen capture returned an empty image');
  }
  const size = image.getSize();
  return {
    image,
    png: image.toPNG(),
    width: size.width,
    height: size.height,
    displayId: display.id,
    displayLabel: source.name,
  };
}

module.exports = { captureDisplayUnderCursor, screenPermissionStatus };
