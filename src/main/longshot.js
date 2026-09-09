'use strict';
// Long screenshot: one rectangle, watched while the user scrolls, joined into a single tall picture.
//
// Why it is built this way. `desktopCapturer.getSources` costs about 190 ms a call whatever size you
// ask for, which is five frames a second -- far too coarse to follow a scroll. A live capture stream
// hands over a frame in 0.1 ms, so that is what this uses. The stream is opened when the user asks for
// a long shot and dropped the moment they are done: holding one open costs 2.4 % of a core and, worse,
// puts a screen-recording indicator in the menu bar for as long as it lives. briffy is not a recorder.
//
// briffy does the scrolling, and that is the whole design. It used to watch the user scroll and work
// out how far the content had moved by comparing frames, which cannot be made to work: real interfaces
// are periodic, so a join one card too far down looks as good as the right one. On an ordinary page of
// repeated sections the matcher locked onto the wrong period and turned 90 px of real scrolling into
// 7445 px of picture, silently. See src/main/scroll.js for the measurements.
//
// So the loop is step-and-shoot: post a scroll of a known size, wait for it to settle, take a frame,
// and confine the search to where the content can plausibly have got to. The first step also measures
// what a step is actually worth in this window, and every step after that is matched against that
// measurement, which is far tighter than any guess.
//
// The price is Accessibility, asked for the first time somebody takes a long shot and not before. If it
// is refused there is no long shot -- the old watch-and-guess mode is not offered as a fallback,
// because a picture that is quietly wrong is worse than no picture.
//
// The control strip excludes itself from capture (`setContentProtection`), so it can sit over the
// region being captured without ever appearing in it.
const { BrowserWindow, desktopCapturer, ipcMain, screen } = require('electron');
const path = require('path');
const scroll = require('./scroll');

const BAR_W = 268;
const BAR_H = 96;
const MARGIN = 18;

let session = null;      // { win, resolve, done, at }

function preloadPath() { return path.join(__dirname, '..', 'preload', 'longshot.js'); }
function pagePath() { return path.join(__dirname, '..', 'renderer', 'longshot', 'index.html'); }

/** The stream needs the id of this display as a capture source; the size tells us its real pixels. */
async function sourceFor(display) {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 160, height: 100 } });
  const hit = sources.find((s) => String(s.display_id) === String(display.id));
  return (hit || sources[0] || null);
}

/**
 * Puts the strip somewhere it is not in the way: under the region if there is room, above it if not,
 * and inside the display either way. It is excluded from capture regardless, so this is only about
 * not covering what the user is trying to read while they scroll.
 */
function barBounds(display, rect) {
  const b = display.bounds;
  const x = Math.round(Math.min(Math.max(b.x + rect.x, b.x + MARGIN), b.x + b.width - BAR_W - MARGIN));
  const below = b.y + rect.y + rect.height + MARGIN;
  const above = b.y + rect.y - BAR_H - MARGIN;
  const y = below + BAR_H <= b.y + b.height ? below : Math.max(b.y + MARGIN, above);
  return { x, y, width: BAR_W, height: BAR_H };
}

/**
 * @param {{display:object, rect:{x,y,width,height}, strings:object}} opts rect is in the display's
 *   own logical points, exactly as the selection overlay drew it.
 * @returns {Promise<{png:Buffer, width:number, height:number, frames:number}|null>} null when the
 *   user gave up or nothing could be joined.
 */
async function start({ display, rect, strings = {} }) {
  cancel();
  const source = await sourceFor(display);
  if (!source) return null;
  // Asked for here, at the moment somebody actually wants it. `ensure` puts the system dialog up the
  // first time; after that macOS will not ask again and only a trip to System Settings changes it, so
  // a false here on a later run means the user said no and meant it.
  const canScroll = scroll.allowed() || scroll.ensure();
  if (canScroll) scroll.open();
  // Where to put the pointer before each step: the middle of the region, in global screen points. A
  // scroll goes to whatever is under the pointer, and the control strip is deliberately in front.
  const at = {
    x: Math.round(display.bounds.x + rect.x + (rect.width / 2)),
    y: Math.round(display.bounds.y + rect.y + (rect.height / 2)),
  };

  const win = new BrowserWindow({
    ...barBounds(display, rect),
    frame: false, transparent: true, resizable: false, movable: true,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, roundedCorners: false, show: false,
    fullscreenable: false, hiddenInMissionControl: true, paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: false,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver', 1);
  // The whole point: the strip watches the region without ever being part of it.
  win.setContentProtection(true);
  win.keepProtected = true;   // 别的窗只在采集那一下消失（windows.hideForCapture），这条是常年的
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  return new Promise((resolve) => {
    session = { win, resolve, done: false, at };
    win.once('ready-to-show', () => { win.showInactive(); });
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('longshot:init', {
        sourceId: source.id,
        // The stream arrives at the display's real pixels; the renderer measures the ratio itself
        // rather than trusting scaleFactor, for the same reason region.js does (see grabDisplays).
        rect,
        display: { width: display.bounds.width, height: display.bounds.height, scaleFactor: display.scaleFactor || 1 },
        canScroll,
        strings,
      });
    });
    win.on('closed', () => { finish(null); });
    win.loadFile(pagePath());
  });
}

function finish(result) {
  if (!session || session.done) return;
  session.done = true;
  const { win, resolve } = session;
  session = null;
  scroll.close();
  if (win && !win.isDestroyed()) { try { win.destroy(); } catch (_) { /* already gone */ } }
  resolve(result);
}
function cancel() { finish(null); }
function active() { return !!session; }

function init() {
  // One step, awaited by the renderer so that the next frame is taken after the scroll and not during
  // it. Answering true means the event was posted, not that anything moved -- only the picture can say
  // that, and the renderer is the one holding it.
  ipcMain.handle('longshot:step', async (e, dy) => {
    if (!session || session.done) return false;
    if (!session.win || session.win.isDestroyed() || e.sender !== session.win.webContents) return false;
    const px = Number(dy);
    if (!Number.isFinite(px) || px <= 0 || px > 4000) return false;
    return scroll.step({ x: session.at.x, y: session.at.y, dy: px });
  });
  ipcMain.on('longshot:cancel', () => cancel());
  ipcMain.on('longshot:done', (_e, payload) => {
    if (!session || session.done) return;
    const data = payload && payload.png;
    if (!data || typeof data !== 'string') { cancel(); return; }
    const base64 = data.slice(data.indexOf(',') + 1);
    let png;
    try { png = Buffer.from(base64, 'base64'); } catch (_) { png = null; }
    if (!png || !png.length) { cancel(); return; }
    finish({ png, width: payload.width, height: payload.height, frames: payload.frames || 0 });
  });
  // A display going away takes the capture with it.
  screen.on('display-removed', () => { if (session) cancel(); });
}

module.exports = { init, start, cancel, active, barBounds, BAR_W, BAR_H };
