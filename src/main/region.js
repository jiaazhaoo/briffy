'use strict';
// Region capture: freeze every display, show the frozen picture full-screen, let the user drag a box.
//
// Speed is the whole point here — a screenshot tool that takes half a second to appear feels broken.
// Three things keep it quick:
//   · the overlay windows are created once and reused (hidden, not destroyed), so opening is a show()
//   · the frozen desktop travels as JPEG rather than PNG (13 ms vs 60 ms for a 2560×1440 screen)
//   · the pet is hidden with a short, measured wait instead of a conservative one
const { BrowserWindow, nativeImage, screen, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const windowList = require('./window-list');

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

let ns = null; let nsTried = false;
function native() {
  if (!nsTried) {
    nsTried = true;
    try { ns = require('node-screenshots'); } catch (e) { console.warn('[region] node-screenshots unavailable:', e.message.split('\n')[0]); ns = null; }
  }
  return ns;
}

/**
 * Every display, frozen, at its own real pixels.
 *
 * Measured on this machine, three displays:
 *   node-screenshots, all of them at once   108 ms   ← this
 *   desktopCapturer, all of them            212 ms   ← the fallback below
 *
 * The route through raw bytes is not an optimisation, it is the only route worth taking. The library
 * will hand over a PNG, but encoding one costs 133 ms and decoding it back into a NativeImage another
 * 138 ms -- together slower than the API this replaces. `toRaw` plus `createFromBitmap` costs 75 + 5.
 */
/**
 * node-screenshots hands over RGBA; `nativeImage.createFromBitmap` wants the platform's own order,
 * which is BGRA everywhere Electron runs. Handed the buffer as it comes, every pixel gets its red
 * and its blue swapped -- a hue shift over the whole frozen desktop, and over every crop saved out
 * of it, uniform enough that it reads as "something is off" rather than as an obvious fault.
 * (dev/region-color-check.js measures it against the library's own PNG, which has no such ambiguity.)
 *
 * One 32-bit rotate per pixel rather than four byte moves: 12.7M pixels on this machine's screen,
 * and this route was taken to be fast. Everything Electron supports is little-endian, so in memory
 * R,G,B,A reads as a word 0xAABBGGRR -- the fix is to trade its two ends and leave green and alpha be.
 */
function toBGRA(raw) {
  if ((raw.byteOffset & 3) === 0 && (raw.length & 3) === 0) {
    const u = new Uint32Array(raw.buffer, raw.byteOffset, raw.length >>> 2);
    for (let i = 0; i < u.length; i++) {
      const p = u[i];
      u[i] = (p & 0xff00ff00) | ((p >>> 16) & 0xff) | ((p & 0xff) << 16);
    }
    return raw;
  }
  for (let i = 0; i + 3 < raw.length; i += 4) { const r = raw[i]; raw[i] = raw[i + 2]; raw[i + 2] = r; }
  return raw;
}

async function grabNative(displays) {
  const lib = native();
  if (!lib) return null;
  let monitors;
  try { monitors = lib.Monitor.all(); } catch (_) { return null; }
  if (!monitors.length) return null;
  // The library reports the same ids and the same logical bounds as Electron does -- checked against
  // every attached display -- so they pair up by id, with position as the fallback.
  const pick = (display) => monitors.find((m) => String(m.id()) === String(display.id))
    || monitors.find((m) => m.x() === display.bounds.x && m.y() === display.bounds.y)
    || null;

  const shots = await Promise.all(displays.map(async (display) => {
    const mon = pick(display);
    if (!mon) return { display, image: null };
    try {
      const img = await mon.captureImage();
      const raw = toBGRA(await img.toRaw());
      return { display, image: nativeImage.createFromBitmap(raw, { width: img.width, height: img.height }) };
    } catch (e) {
      console.warn('[region] native capture failed for one display:', e.message);
      return { display, image: null };
    }
  }));
  // All or nothing: a half-native, half-fallback set would mix two coordinate conventions.
  return shots.every((s) => s.image && !s.image.isEmpty()) ? shots : null;
}

/**
 * The fallback, and what briffy used to do.
 *
 * desktopCapturer takes one thumbnailSize for all screens and scales each screen's picture to FIT
 * that box, up or down, keeping its own aspect ratio. Asking for the size of the whole desktop --
 * three displays side by side -- therefore hands back each screen blown up to the width of all three
 * (measured here: a 3840-pixel-wide display came back 6827 wide, a 1280-wide one 6144), and a crop
 * that multiplies by the display's scale factor lands in the wrong place. The box is the largest
 * single display instead, so the biggest screen is exact and the others are close; the crop itself
 * never assumes a ratio but measures it (see region:select).
 */
async function grabWithCapturer(displays) {
  const box = displays.reduce((a, d) => ({
    width: Math.max(a.width, Math.round(d.bounds.width * (d.scaleFactor || 1))),
    height: Math.max(a.height, Math.round(d.bounds.height * (d.scaleFactor || 1))),
  }), { width: 1, height: 1 });
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: box });
  return displays.map((display, i) => {
    let image = sources.find((s) => String(s.display_id) === String(display.id))?.thumbnail || sources[i]?.thumbnail || sources[0]?.thumbnail;
    if (image && !image.isEmpty()) {
      const f = display.scaleFactor || 1;
      const native2 = { width: Math.round(display.bounds.width * f), height: Math.round(display.bounds.height * f) };
      const got = image.getSize();
      // a smaller display comes back blown up to the box; bring it back to its own pixels
      if (got.width > native2.width + 2 || got.height > native2.height + 2) image = image.resize({ ...native2, quality: 'best' });
    }
    return { display, image };
  });
}

/**
 * 把画上去的那一层叠回裁好的原图上。
 *
 * **底图那一半从来没离开过主进程。** 送到渲染层去的那张桌面是 JPEG（为了快，见文件头那笔账），
 * 拿它当底图存出去等于凭空掉一次画质；所以渲染层只交出标注那一层——底下透明、和裁剪框同尺寸，
 * 在这里按 alpha 叠回从没被压过的那张原图上。
 *
 * 主进程没有 canvas，所以自己算。Electron 的位图是**预乘**的（dev 里量过：rgba(255,0,0,128)
 * 读回来是 r=128,a=128），所以公式是 out = base·(1−a) + ink，ink 不再乘一遍 alpha——
 * 多乘那一下会让所有半透明的边缘发暗，笔画看着像镶了一圈黑边。
 */
function overlay(base, dataUrl) {
  const comma = String(dataUrl || '').indexOf(',');
  if (comma < 0) return base;
  let layer;
  try { layer = nativeImage.createFromBuffer(Buffer.from(dataUrl.slice(comma + 1), 'base64')); } catch (_) { return base; }
  if (!layer || layer.isEmpty()) return base;
  const size = base.getSize();
  const ls = layer.getSize();
  // 对不上就整层不叠：错位的标注比没有标注糟糕得多，而这里没有第二次机会去问。
  if (ls.width !== size.width || ls.height !== size.height) {
    console.warn(`[region] ink layer ${ls.width}×${ls.height} != crop ${size.width}×${size.height}, dropped`);
    return base;
  }
  const out = base.toBitmap();
  const ink = layer.toBitmap();
  for (let i = 0; i < out.length; i += 4) {
    const a = ink[i + 3];
    if (!a) continue;
    if (a === 255) { out[i] = ink[i]; out[i + 1] = ink[i + 1]; out[i + 2] = ink[i + 2]; continue; }
    const k = (255 - a) / 255;
    out[i] = Math.round(out[i] * k) + ink[i];
    out[i + 1] = Math.round(out[i + 1] * k) + ink[i + 1];
    out[i + 2] = Math.round(out[i + 2] * k) + ink[i + 2];
  }
  return nativeImage.createFromBitmap(out, size);
}

async function grabDisplays() {
  const displays = screen.getAllDisplays();
  return (await grabNative(displays)) || grabWithCapturer(displays);
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

  // Both at once: the capture costs about 190 ms and the window list about 104 ms, so asking for
  // snapping alongside it adds nothing to how long the overlay takes to appear. The list is read
  // before the overlay is shown, so the overlay itself can never turn up in it.
  let shots; let windows = [];
  try {
    [shots, windows] = await Promise.all([grabDisplays(), windowList.list()]);
  } catch (e) {
    deps.restoreWindows();
    throw e;
  }

  const cursor = screen.getCursorScreenPoint();
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
          // picture pixels per window pixel -- measured, not the display's nominal factor (see grabDisplays)
          scale: image.getSize().width / (display.bounds.width || 1),
          windows: windowList.forDisplay(windows, display),
          // Where the pointer already is. Without this the overlay knows nothing until the mouse moves,
          // so pressing the shortcut while resting over a window highlighted nothing at all until you
          // jiggled it -- the first thing anybody notices, and it made snapping look broken.
          cursor: { x: cursor.x - display.bounds.x, y: cursor.y - display.bounds.y },
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
    // The box was drawn over the frozen picture stretched to the window, so the mapping from the box
    // to picture pixels is simply picture size over window size -- whatever the capture came back as.
    const full = win.frozen;
    const size = full.getSize();
    const wb = win.getBounds();
    const sx = size.width / (wb.width || 1);
    const sy = size.height / (wb.height || 1);
    const crop = {
      x: Math.max(0, Math.round(rect.x * sx)),
      y: Math.max(0, Math.round(rect.y * sy)),
      width: Math.round(rect.width * sx),
      height: Math.round(rect.height * sy),
    };
    crop.width = Math.min(crop.width, size.width - crop.x);
    crop.height = Math.min(crop.height, size.height - crop.y);
    if (crop.width < 4 || crop.height < 4) { cancel(); return; }
    const cropped = rect.ink ? overlay(full.crop(crop), rect.ink) : full.crop(crop);
    finish({ png: cropped.toPNG(), width: crop.width, height: crop.height, display: win.displayInfo });
  });
  // The same box, but the user wants what is below it too. Nothing is cropped here: the frozen
  // picture is one screenful and a long shot is made of many, so this hands back where to look and
  // lets longshot.js watch that rectangle live. See src/main/longshot.js.
  ipcMain.on('region:long', (event, rect) => {
    if (!session || session.done) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || !win.displayInfo) { cancel(); return; }
    if (!rect || rect.width < 40 || rect.height < 40) { cancel(); return; }
    finish({
      long: true,
      display: win.displayInfo,
      // in the display's own logical points, which is what the overlay draws in
      rect: {
        x: Math.max(0, Math.round(rect.x)),
        y: Math.max(0, Math.round(rect.y)),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    });
  });

  // A display being added or removed invalidates the warm windows.
  screen.on('display-added', () => { if (!session) warm(); });
  screen.on('display-removed', () => {
    if (session) return;
    for (const [id, e] of pool) if (!screen.getAllDisplays().some((d) => d.id === id)) { try { e.win.destroy(); } catch (_) { /* ignore */ } pool.delete(id); }
  });
}

module.exports = { init, warm, selectRegion, cancel, active, toBGRA, overlay };
