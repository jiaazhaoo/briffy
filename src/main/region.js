'use strict';
// Region capture: freeze every display, show the frozen picture full-screen, let the user drag a box.
//
// Speed is the whole point here — a screenshot tool that takes half a second to appear feels broken.
// Three things keep it quick:
//   · the overlay windows are created once and reused (hidden, not destroyed), so opening is a show()
//   · the frozen desktop travels as JPEG rather than PNG (13 ms vs 60 ms for a 2560×1440 screen)
//   · the pet is hidden with a short, measured wait instead of a conservative one
const { BrowserWindow, screen, ipcMain, desktopCapturer } = require('electron');
const path = require('path');

const IDLE_KEEP_MS = 3 * 60 * 1000;   // drop the warm windows if unused for a while

let session = null;           // { resolve, done, restore }
const pool = new Map();       // display id -> { win, ready:Promise }
let idleTimer = null;

function preloadPath() { return path.join(__dirname, '..', 'preload', 'region.js'); }
function pagePath() { return path.join(__dirname, '..', 'renderer', 'region', 'index.html'); }

// ---------- window pool ----------
function createOverlay(display) {
  const { x, y, width, height } = display.bounds;
  const win = new BrowserWindow({
    x, y, width, height,
    frame: false, transparent: false, backgroundColor: '#000000',
    alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false,
    fullscreenable: false, hasShadow: false, roundedCorners: false, show: false,
    enableLargerThanScreen: true, hiddenInMissionControl: true, paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: false,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver', 1);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  const ready = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.loadFile(pagePath());
  win.on('closed', () => { for (const [id, e] of pool) if (e.win === win) pool.delete(id); });
  return { win, ready };
}

/** Keeps one hidden, already-loaded overlay per display so that opening one costs a show(). */
function warm() {
  for (const display of screen.getAllDisplays()) {
    if (!pool.has(display.id)) pool.set(display.id, createOverlay(display));
  }
  scheduleIdleDrop();
}
function scheduleIdleDrop() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (session) return;
    for (const { win } of pool.values()) { try { win.destroy(); } catch (_) { /* ignore */ } }
    pool.clear();
  }, IDLE_KEEP_MS);
}

/** Grabs every display at native resolution as a frozen picture. */
async function grabDisplays() {
  const displays = screen.getAllDisplays();
  const maxScale = Math.max(...displays.map((d) => d.scaleFactor || 1), 1);
  const b = displays.reduce((a, d) => ({
    minX: Math.min(a.minX, d.bounds.x), minY: Math.min(a.minY, d.bounds.y),
    maxX: Math.max(a.maxX, d.bounds.x + d.bounds.width), maxY: Math.max(a.maxY, d.bounds.y + d.bounds.height),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round((b.maxX - b.minX) * maxScale), height: Math.round((b.maxY - b.minY) * maxScale) },
  });
  return displays.map((display, i) => ({
    display,
    image: sources.find((s) => String(s.display_id) === String(display.id))?.thumbnail || sources[i]?.thumbnail || sources[0]?.thumbnail,
  }));
}

/**
 * @param {{hideWindows:()=>Promise<void>, restoreWindows:()=>void, strings:object}} deps
 * @returns {Promise<{png:Buffer, width:number, height:number, display:object}|null>}
 */
async function selectRegion(deps) {
  if (session) cancel();
  warm();                                   // no-op when the windows are already warm
  const wait = await deps.hideWindows();
  if (wait) await new Promise((r) => setTimeout(r, wait));

  let shots;
  try {
    shots = await grabDisplays();
  } catch (e) {
    deps.restoreWindows();
    throw e;
  }

  return new Promise((resolve) => {
    session = { resolve, done: false, restore: deps.restoreWindows, shown: [] };
    for (const { display, image } of shots) {
      if (!image || image.isEmpty()) continue;
      const entry = pool.get(display.id) || createOverlay(display);
      pool.set(display.id, entry);
      const { win, ready } = entry;
      win.frozen = image;                   // the crop is taken from this, so quality is untouched
      win.displayInfo = display;
      session.shown.push(win);
      ready.then(() => {
        if (!session || session.done || win.isDestroyed()) return;
        win.webContents.send('region:init', {
          image: `data:image/jpeg;base64,${image.toJPEG(88).toString('base64')}`,
          scale: display.scaleFactor || 1,
          strings: deps.strings,
        });
        win.setBounds(display.bounds);
        win.showInactive();
        win.focus();
      });
    }
    if (!session.shown.length) finish(null);
  });
}

function hideOverlays() {
  if (!session) return;
  for (const win of session.shown) {
    if (win.isDestroyed()) continue;
    win.hide();
    win.frozen = null;
    if (!win.webContents.isDestroyed()) win.webContents.send('region:reset');
  }
}

function finish(result) {
  if (!session || session.done) return;
  session.done = true;
  const { resolve, restore } = session;
  hideOverlays();
  session = null;
  scheduleIdleDrop();
  if (restore) restore();
  resolve(result);
}
function cancel() { finish(null); }
function active() { return !!session; }

function init() {
  ipcMain.on('region:cancel', () => cancel());
  ipcMain.on('region:select', (event, rect) => {
    if (!session || session.done) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || !win.frozen) { cancel(); return; }
    const scale = (win.displayInfo && win.displayInfo.scaleFactor) || 1;
    const full = win.frozen;
    const size = full.getSize();
    const crop = {
      x: Math.max(0, Math.round(rect.x * scale)),
      y: Math.max(0, Math.round(rect.y * scale)),
      width: Math.round(rect.width * scale),
      height: Math.round(rect.height * scale),
    };
    crop.width = Math.min(crop.width, size.width - crop.x);
    crop.height = Math.min(crop.height, size.height - crop.y);
    if (crop.width < 4 || crop.height < 4) { cancel(); return; }
    const cropped = full.crop(crop);
    finish({ png: cropped.toPNG(), width: crop.width, height: crop.height, display: win.displayInfo });
  });
  // A display being added or removed invalidates the warm windows.
  screen.on('display-added', () => { if (!session) warm(); });
  screen.on('display-removed', () => {
    if (session) return;
    for (const [id, e] of pool) if (!screen.getAllDisplays().some((d) => d.id === id)) { try { e.win.destroy(); } catch (_) { /* ignore */ } pool.delete(id); }
  });
}

module.exports = { init, warm, selectRegion, cancel, active };
