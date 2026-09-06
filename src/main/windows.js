'use strict';
// Window management: the character on the desktop, its speech bubble (a click-through window) and the
// workspace window.
const { app, BrowserWindow, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

// The pet window is larger than the 54px circle it shows (see pet.css --s / --d): the
// transparent margin is where the shadow, the recording ring and every gesture happen,
// so nothing is ever sliced off by the window's rectangular edge.
const PET_W = 80;
const PET_H = 80;
const PET_CIRCLE = 54;
const BUBBLE_W = 320;
const BUBBLE_H = 100;
const SHELF_W = 300;             // the window; the panel inside it is 268 wide, the rest is its shadow
const SHELF_PAD = 32;            // that strip, in px -- the panel's left edge sits this far in
const SHELF_MIN_H = 200;
const SHELF_MAX_H = 640;
const SHELF_GAP = 10;            // clearance kept between the panel and the pet
const SHELF_CLOSE_MS = 320;      // long enough to cross the gap from the pet to the panel
const SHELF_FADE_MS = 300;       // the slide-out, if the renderer never reports it finished
const MARGIN = 12;
const TRANSIENT = { capturing: 4000, success: 4500, error: 7000, summary: 25000 };

let store;
let petWin = null;
let bubbleWin = null;
let wsWin = null;
let bubbleTimer = null;
let bubbleShowTimer = null;
let wantBubbleShown = false;
let bubbleState = '';      // the state the balloon is currently showing
let bubbleAt = '';         // where it was last placed, so it is not re-positioned 4x a second
let stateTimer = null;
let state = 'idle';
let badge = false;
let hiddenForCapture = false;
let petHidden = false;
let hiddenForFullscreen = false;
let fullscreenTimer = null;
let drag = null;
let pendingNavigate = null;
let shelfWin = null;
let shelfCloseTimer = null;
let shelfShowTimer = null;
let shelfHideTimer = null;
let wantShelfShown = false;
let shelfOpen = false;

let deps = {};
function init(d) {
  deps = d;
  store = d.store;
  petHidden = !!store.getSettings().petHidden;
}

const rendererPath = (...p) => path.join(__dirname, '..', 'renderer', ...p);
const preloadPath = (name) => path.join(__dirname, '..', 'preload', name);
const assetPath = (name) => path.join(__dirname, '..', '..', 'assets', name);

function defaultPetPosition() {
  const { workArea } = screen.getPrimaryDisplay();
  return { x: workArea.x + workArea.width - PET_W - MARGIN, y: workArea.y + workArea.height - PET_H - MARGIN };
}
// 卡片在 80×80 的窗口里的位置（见 pet.css .float::before）：贴边时要把这圈余地补偿掉
const PET_INSET = { left: 10, top: 6, right: 10, bottom: 6 };

// 常驻头像永远贴着某一条屏幕边——离哪条近就贴哪条
function snapToEdge(x, y) {
  const wa = screen.getDisplayMatching({ x, y, width: PET_W, height: PET_H }).workArea;
  const cx = Math.min(Math.max(x, wa.x), wa.x + wa.width - PET_W);
  const cy = Math.min(Math.max(y, wa.y), wa.y + wa.height - PET_H);
  const d = {
    left: cx - wa.x, right: (wa.x + wa.width - PET_W) - cx,
    top: cy - wa.y, bottom: (wa.y + wa.height - PET_H) - cy,
  };
  const near = Object.keys(d).reduce((a, k) => (d[k] < d[a] ? k : a), 'left');
  if (near === 'left') return { x: Math.round(wa.x - PET_INSET.left), y: Math.round(cy) };
  if (near === 'right') return { x: Math.round(wa.x + wa.width - PET_W + PET_INSET.right), y: Math.round(cy) };
  if (near === 'top') return { x: Math.round(cx), y: Math.round(wa.y - PET_INSET.top) };
  return { x: Math.round(cx), y: Math.round(wa.y + wa.height - PET_H + PET_INSET.bottom) };
}

function clampToDisplays(x, y) {
  const wa = screen.getDisplayMatching({ x, y, width: PET_W, height: PET_H }).workArea;
  return {
    x: Math.round(Math.min(Math.max(x, wa.x), wa.x + wa.width - PET_W)),
    y: Math.round(Math.min(Math.max(y, wa.y), wa.y + wa.height - PET_H)),
  };
}

// ---------- pet ----------
function createPetWindow() {
  const pos = store.getSettings().petPosition || defaultPetPosition();
  const { x, y } = clampToDisplays(pos.x, pos.y);
  petWin = new BrowserWindow({
    width: PET_W, height: PET_H, x, y,
    frame: false, transparent: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, roundedCorners: false, show: false,
    hiddenInMissionControl: true,
    title: 'briffy Pet',
    webPreferences: {
      preload: preloadPath('pet.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  petWin.setAlwaysOnTop(true, 'floating', 1);
  petWin.setContentProtection(EXCLUDE_FROM_CAPTURE);   // keeps the pet out of the screenshots it takes
  // Not over full-screen apps. A film or a presentation is the one time the whole screen is the point,
  // and a character in the corner of it is in the way. On macOS a full-screen app gets a Space of its own and
  // this flag is all it takes to stay out of it.
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  petWin.loadFile(rendererPath('pet', 'index.html'));
  petWin.once('ready-to-show', () => { if (!petHidden) petWin.showInactive(); watchFullscreen(); });
  petWin.on('closed', () => { petWin = null; });
  petWin.webContents.on('did-finish-load', () => sendState());
  petWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return petWin;
}

function createBubbleWindow() {
  bubbleWin = new BrowserWindow({
    width: BUBBLE_W, height: BUBBLE_H,
    frame: false, transparent: true, resizable: false, movable: false, focusable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, roundedCorners: false, show: false,
    hiddenInMissionControl: true,
    title: 'briffy Bubble',
    webPreferences: { preload: preloadPath('bubble.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  bubbleWin.setIgnoreMouseEvents(true);
  bubbleWin.setContentProtection(EXCLUDE_FROM_CAPTURE);
  bubbleWin.setAlwaysOnTop(true, 'floating', 2);
  bubbleWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  bubbleWin.loadFile(rendererPath('bubble', 'index.html'));
  bubbleWin.on('closed', () => { bubbleWin = null; });
  return bubbleWin;
}

/** Places the balloon window against the pet and returns where its tail has to point. */
function layoutBubble() {
  if (!petWin || !bubbleWin) return null;
  const [px, py] = petWin.getPosition();
  const wa = screen.getDisplayMatching({ x: px, y: py, width: PET_W, height: PET_H }).workArea;
  // the balloon sits up and to the left of the pet, its tail tip landing on the circle's
  // top edge (the circle starts (PET_H - PET_CIRCLE) / 2 into the window)
  const pad = (PET_H - PET_CIRCLE) / 2;
  let x = px + PET_W - BUBBLE_W + 18;
  let y = py + pad - BUBBLE_H + 9;
  let below = false;
  if (y < wa.y) { y = py + PET_H - pad - 9; below = true; }
  if (x < wa.x) x = wa.x + 4;
  if (x + BUBBLE_W > wa.x + wa.width) x = wa.x + wa.width - BUBBLE_W - 4;
  const at = `${Math.round(x)},${Math.round(y)}`;
  if (at !== bubbleAt) { bubbleWin.setPosition(Math.round(x), Math.round(y)); bubbleAt = at; }
  const tail = Math.round(px + PET_W * 0.5 - x); // px from the balloon window's left edge to the pet's centre
  return { below, tail: Math.min(Math.max(tail, 24), BUBBLE_W - 24) };
}

// Repositioning a balloon that is already on screen (the pet was dragged): no new text, no pop.
function positionBubble() {
  const layout = layoutBubble();
  if (layout) bubbleWin.webContents.send('bubble:layout', layout);
}

// The balloon used to be put on screen in the same tick as the message was sent to it, so it appeared
// still showing the previous message at the previous tail position and only snapped to the new one a
// frame or two later -- read as a stutter every single time the character said anything. Now the window is
// positioned and filled while it is still hidden, and only shown once the renderer says it has painted.
function showBubble(text, { ms = 4000, sticky = false } = {}) {
  if (!bubbleWin || !petWin) return;
  const layout = layoutBubble() || {};
  // While recording, the timer rewrites this text four times a second. Replaying the balloon's entrance
  // on every one of those is what made it flicker, so it only plays when the balloon actually arrives
  // or when the character has changed what it is doing.
  const pop = !bubbleWin.isVisible() || state !== bubbleState;
  bubbleState = state;
  bubbleWin.webContents.send('bubble:text', { text, state, pop, ...layout });
  const canShow = !hiddenForCapture && !petHidden && !hiddenForFullscreen;
  if (canShow && !bubbleWin.isVisible()) {
    wantBubbleShown = true;
    if (bubbleShowTimer) clearTimeout(bubbleShowTimer);
    // never let a renderer that fails to answer swallow the message entirely
    bubbleShowTimer = setTimeout(revealBubble, 150);
  }
  if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
  if (!sticky) bubbleTimer = setTimeout(hideBubble, ms);
}
function revealBubble() {
  if (bubbleShowTimer) { clearTimeout(bubbleShowTimer); bubbleShowTimer = null; }
  if (!wantBubbleShown) return;
  wantBubbleShown = false;
  if (bubbleWin && !bubbleWin.isDestroyed() && !hiddenForCapture && !petHidden && !hiddenForFullscreen && !bubbleWin.isVisible()) {
    bubbleWin.showInactive();
  }
}
function hideBubble() {
  if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
  if (bubbleShowTimer) { clearTimeout(bubbleShowTimer); bubbleShowTimer = null; }
  wantBubbleShown = false;
  bubbleState = '';
  if (bubbleWin && bubbleWin.isVisible()) bubbleWin.hide();
}
ipcMain.on('bubble:painted', () => revealBubble());

// ---------- the shelf ----------
// Resting the pointer on the pet slides out a column of the last things saved, flush against the
// right edge of the screen. It is a separate window because the pet's own is 80px square and a panel
// cannot grow out of it; the window is kept alive and hidden between visits so opening costs a show().
function createShelfWindow() {
  shelfWin = new BrowserWindow({
    width: SHELF_W, height: SHELF_MAX_H,
    frame: false, transparent: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, roundedCorners: false, show: false,
    hiddenInMissionControl: true, paintWhenInitiallyHidden: true,
    title: 'briffy Shelf',
    webPreferences: {
      preload: preloadPath('shelf.js'), contextIsolation: true, nodeIntegration: false, sandbox: false,
      backgroundThrottling: false,
    },
  });
  shelfWin.setAlwaysOnTop(true, 'floating', 2);
  shelfWin.setContentProtection(EXCLUDE_FROM_CAPTURE);
  shelfWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  shelfWin.loadFile(rendererPath('shelf', 'index.html'));
  shelfWin.on('closed', () => { shelfWin = null; shelfOpen = false; });
  shelfWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return shelfWin;
}

/**
 * Against the right edge of whichever display the pet is on -- and never over the pet.
 *
 * The pet lives in that same corner, so a panel spanning the full height would sit right on top of it:
 * the character would vanish behind the thing it opened, and the window would swallow every click meant for
 * it. So where the two would meet, the panel stops short on whichever side of the pet has more room --
 * the same rule the speech balloon follows. Anywhere else on the screen there is no conflict and the
 * panel takes the whole height it wants.
 */
function layoutShelf() {
  if (!shelfWin || !petWin) return;
  const [px, py] = petWin.getPosition();
  const wa = screen.getDisplayMatching({ x: px, y: py, width: PET_W, height: PET_H }).workArea;
  // 面板站在头像正上方，右边缘和头像的右边缘对齐——不贴屏幕边
  const right = px + PET_W - PET_INSET.right;
  const x = Math.round(Math.min(Math.max(right - SHELF_W, wa.x - SHELF_PAD), wa.x + wa.width - SHELF_W + SHELF_PAD));
  const top = wa.y + MARGIN;
  const bottom = py + PET_INSET.top - SHELF_GAP;
  let h = Math.round(Math.max(SHELF_MIN_H, Math.min(SHELF_MAX_H, bottom - top)));
  let y = Math.round(bottom - h);
  if (bottom - top < SHELF_MIN_H) {                 // 头像贴在屏幕顶上，上面放不下，就落到它下面
    y = Math.round(py + PET_H - PET_INSET.bottom + SHELF_GAP);
    h = Math.round(Math.max(SHELF_MIN_H, Math.min(SHELF_MAX_H, wa.y + wa.height - MARGIN - y)));
  }
  shelfWin.setBounds({ x, y, width: SHELF_W, height: h });
}

/** The fifteen most recent records, reduced to what a card shows. */
function shelfEntries() {
  // Pinned first, then the most recent. Something kept on purpose should not scroll away after a
  // busy hour, which is the whole reason for pinning it.
  const pinned = store.pinnedEntries({ limit: 6 });
  const seen = new Set(pinned.map((e) => e.id));
  const recent = store.listEntries({ limit: 15 + pinned.length }).filter((e) => !seen.has(e.id));
  const list = [...pinned, ...recent].slice(0, 15);
  return list.map((e) => {
    const abs = e.path ? store.absPath(e.path) : '';
    const picture = (e.type === 'screenshot' || e.type === 'image') && abs;
    return {
      id: e.id,
      title: (e.title || e.url || '').slice(0, 90),
      createdAt: e.createdAt,
      type: e.type,
      kind: deps.typeLabel ? deps.typeLabel(e.type) : e.type,
      thumb: picture ? pathToFileURL(abs).href : '',
      file: !!abs,
      pinned: !!e.pinned,
      note: (e.note || '').slice(0, 90),
    };
  });
}

// Same trick as the balloon: fill and place the window while it is still hidden, and only put it on
// screen once the renderer says it has drawn. Showing first and animating after meant the slide began
// on a window that was not on screen yet, so it arrived already half-finished -- read as a stutter.
function showShelf() {
  if (!shelfWin || shelfWin.isDestroyed() || !petWin) return;
  if (hiddenForCapture || petHidden || hiddenForFullscreen) return;
  if (shelfCloseTimer) { clearTimeout(shelfCloseTimer); shelfCloseTimer = null; }
  if (shelfHideTimer) { clearTimeout(shelfHideTimer); shelfHideTimer = null; }
  const alreadyUp = shelfWin.isVisible() && shelfOpen;
  shelfOpen = true;
  if (!alreadyUp) layoutShelf();                    // never move the panel out from under the pointer
  shelfWin.webContents.send('shelf:show', {
    entries: shelfEntries(),
    strings: deps.shelfStrings ? deps.shelfStrings() : {},
    replay: !alreadyUp,
  });
  if (alreadyUp) return;                            // on screen already: new content, no entrance
  wantShelfShown = true;
  if (shelfShowTimer) clearTimeout(shelfShowTimer);
  shelfShowTimer = setTimeout(revealShelf, 200);    // a renderer that never answers must not swallow it
}

function revealShelf() {
  if (shelfShowTimer) { clearTimeout(shelfShowTimer); shelfShowTimer = null; }
  if (!wantShelfShown) return;
  wantShelfShown = false;
  if (!shelfWin || shelfWin.isDestroyed() || !shelfOpen) return;
  if (hiddenForCapture || petHidden || hiddenForFullscreen) return;
  if (!shelfWin.isVisible()) shelfWin.showInactive();
  shelfWin.webContents.send('shelf:in');            // on screen: now play the slide
}

function hideShelf({ now = false } = {}) {
  if (shelfCloseTimer) { clearTimeout(shelfCloseTimer); shelfCloseTimer = null; }
  if (!shelfWin || shelfWin.isDestroyed()) { shelfOpen = false; return; }
  const close = () => {
    shelfCloseTimer = null;
    shelfOpen = false;
    wantShelfShown = false;
    if (!shelfWin || shelfWin.isDestroyed()) return;
    if (!shelfWin.isVisible()) return;
    shelfWin.webContents.send('shelf:out');         // slide away, then tell us (shelf:faded)
    if (shelfHideTimer) clearTimeout(shelfHideTimer);
    shelfHideTimer = setTimeout(dropShelf, SHELF_FADE_MS);
  };
  if (now) close(); else shelfCloseTimer = setTimeout(close, SHELF_CLOSE_MS);
}

function dropShelf() {
  if (shelfHideTimer) { clearTimeout(shelfHideTimer); shelfHideTimer = null; }
  if (shelfOpen) return;                            // the pointer came back mid-slide
  if (shelfWin && !shelfWin.isDestroyed() && shelfWin.isVisible()) shelfWin.hide();
}
ipcMain.on('shelf:painted', () => revealShelf());
ipcMain.on('shelf:faded', () => dropShelf());

/** The pointer entered or left the pet. Leaving starts a close that entering the panel cancels. */
function hoverPet(on) {
  if (on) { if (!shelfWin) createShelfWindow(); showShelf(); } else hideShelf();
}
function isShelfOpen() { return shelfOpen; }
function getShelfWindow() { return shelfWin; }
ipcMain.on('shelf:keep', () => { if (shelfCloseTimer) { clearTimeout(shelfCloseTimer); shelfCloseTimer = null; } });
ipcMain.on('shelf:leave', () => hideShelf());


function sendState() {
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('pet:state', { state, badge });
}

/**
 * @param {'idle'|'capturing'|'processing'|'recording'|'success'|'error'|'summary'} next
 * @param {{message?:string, badge?:boolean, sticky?:boolean, ms?:number}} [opts]
 */
function setPetState(next, opts = {}) {
  state = next;
  if (typeof opts.badge === 'boolean') badge = opts.badge;
  sendState();
  if (stateTimer) { clearTimeout(stateTimer); stateTimer = null; }
  const stickyDefault = next === 'processing' || next === 'recording';
  if (opts.message) {
    showBubble(opts.message, { sticky: opts.sticky !== undefined ? opts.sticky : stickyDefault, ms: opts.ms || TRANSIENT[next] || 4000 });
  } else if (next === 'idle') {
    hideBubble();
  }
  if (TRANSIENT[next]) {
    stateTimer = setTimeout(() => { if (state === next) setPetState('idle'); }, TRANSIENT[next]);
  }
}
function getState() { return state; }
function sendPetCommand(cmd, payload) {
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('pet:command', { cmd, ...payload });
}

/**
 * Windows 10 2004+ (build 19041) and macOS can mark a window as excluded from screen capture, so the pet
 * stays on screen and simply is not in the picture. Where that is unavailable the windows are hidden the
 * old way, which needs a moment to take effect and makes the pet blink.
 * @returns {boolean} true when the pet can stay visible during a capture
 */
function captureExclusionWorks() {
  if (process.platform === 'darwin') return true;
  if (process.platform !== 'win32') return false;
  const build = Number((require('os').release().split('.')[2] || '0'));
  return build >= 19041;
}
const EXCLUDE_FROM_CAPTURE = captureExclusionWorks();

/** @returns {number} how long the caller should wait after this before grabbing the screen */
// Windows and Linux have no equivalent of the macOS flag, so the screen itself is the signal: when a
// window goes full-screen the taskbar and the menu bar go with it, and the usable area grows to the
// whole display. Cheap to check, and wrong only in the moment a bar is auto-hidden for another reason.
function somethingIsFullscreen() {
  if (!petWin || petWin.isDestroyed()) return false;
  const [x, y] = petWin.getPosition();
  const d = screen.getDisplayMatching({ x, y, width: PET_W, height: PET_H });
  return d.workArea.width >= d.bounds.width && d.workArea.height >= d.bounds.height;
}

function watchFullscreen() {
  if (process.platform === 'darwin') return;      // the Space flag already handles it
  if (fullscreenTimer) clearInterval(fullscreenTimer);
  fullscreenTimer = setInterval(() => {
    const full = somethingIsFullscreen();
    if (full === hiddenForFullscreen) return;
    hiddenForFullscreen = full;
    if (full) hideShelf({ now: true });
    if (!petWin || petWin.isDestroyed()) return;
    if (full) { petWin.hide(); if (bubbleWin && bubbleWin.isVisible()) bubbleWin.hide(); }
    else if (!petHidden && !hiddenForCapture) petWin.showInactive();
  }, 2000);
}

async function hideForCapture() {
  hiddenForCapture = true;
  hideShelf({ now: true });
  if (EXCLUDE_FROM_CAPTURE) return 0;            // nothing to hide: the windows are not captured anyway
  if (bubbleWin && bubbleWin.isVisible()) bubbleWin.hide();
  if (petWin && petWin.isVisible()) petWin.hide();
  return 60;
}
function restoreAfterCapture() {
  hiddenForCapture = false;
  if (EXCLUDE_FROM_CAPTURE) return;
  if (petWin && !petHidden && !petWin.isVisible()) petWin.showInactive();
}

function setPetHidden(hidden) {
  if (hidden) hideShelf({ now: true });
  petHidden = !!hidden;
  store.updateSettings({ petHidden });
  if (petHidden) { hideBubble(); if (petWin) petWin.hide(); } else if (petWin) petWin.showInactive();
}
function isPetHidden() { return petHidden; }

function dragStart({ screenX, screenY }) {
  if (!petWin) return;
  const [x, y] = petWin.getPosition();
  drag = { ox: x - screenX, oy: y - screenY };
}
function dragMove({ screenX, screenY }) {
  if (!drag || !petWin) return;
  petWin.setPosition(Math.round(screenX + drag.ox), Math.round(screenY + drag.oy));
  if (bubbleWin && bubbleWin.isVisible()) positionBubble();
  if (shelfOpen) hideShelf({ now: true });          // the pet is being moved, not pointed at
}
function dragEnd() {
  if (!drag || !petWin) return;
  drag = null;
  const [x, y] = petWin.getPosition();
  const c = snapToEdge(x, y);      // 松手就吸到最近的那条屏幕边
  petWin.setPosition(c.x, c.y);
  store.updateSettings({ petPosition: c });
  positionBubble();
}

// ---------- first run ----------
// A window of its own rather than a page inside the workspace: on the first launch there is nothing in
// the workspace to look at, and the permission steps need the app to be the thing in front of you.
let obWin = null;
function openOnboarding() {
  if (obWin && !obWin.isDestroyed()) { obWin.show(); obWin.focus(); return obWin; }
  obWin = new BrowserWindow({
    width: 620, height: 720, minWidth: 520, minHeight: 620,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0f1115',
    show: false, title: 'briffy',
    webPreferences: { preload: preloadPath('onboarding.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  syncDock();
  obWin.loadFile(rendererPath('onboarding', 'index.html'));
  obWin.once('ready-to-show', () => { obWin.show(); obWin.focus(); });
  obWin.on('closed', () => { obWin = null; syncDock(); });
  obWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return obWin;
}
function closeOnboarding() { if (obWin && !obWin.isDestroyed()) obWin.close(); }
function broadcastToOnboarding(channel, payload) {
  if (obWin && !obWin.isDestroyed()) obWin.webContents.send(channel, payload);
}

// ---------- workspace ----------
// ---------- the Dock ----------
//
// briffy lives in the tray with a character on the desktop, so most of the time it has no business taking a
// slot in the Dock -- that is what a background app is for. But the workspace is an ordinary window
// you sit in front of, and while it is open the app should be a normal app: findable in the Dock,
// reachable with Cmd+Tab, clickable to come back to.
//
// macOS happens to do roughly this on its own (a normal window promotes the process), but nothing in
// the code said so, so the day anyone hides the Dock icon to make the character tidier, the workspace would
// silently lose its tile too. So it is stated: the Dock follows the windows a person actually looks at.
function wantsDock() {
  return !!(wsWin && !wsWin.isDestroyed()) || !!(obWin && !obWin.isDestroyed());
}

// The picture has to be put on the tile *after* the tile exists. Setting it while the app is hidden
// from the Dock does nothing that lasts: bringing the tile back makes macOS build a fresh one from the
// surrounding bundle, which in development is Electron's, so the atom comes back every time. Read once
// and kept, because this runs on every open.
let dockIcon = null;
function applyDockIcon() {
  if (!app.dock) return;
  try {
    if (!dockIcon) {
      // icon-mac.png, not icon.png: the Dock wants Apple's grid -- a rounded body inset inside a
      // transparent margin -- while icon.png stays the plain square that Windows and Linux want.
      const file = assetPath('icon-mac.png');
      dockIcon = nativeImage.createFromPath(file);
      if (dockIcon.isEmpty()) { console.warn('[dock] 读不出来:', file); dockIcon = null; return; }
    }
    app.dock.setIcon(dockIcon);
  } catch (e) { console.warn('[dock] setIcon', e.message); }
}

let dockShown = null;   // null = never decided, so the first call always applies
function syncDock() {
  if (process.platform !== 'darwin' || !app.dock) return;
  const want = wantsDock();
  if (want === dockShown) return;
  dockShown = want;
  try {
    if (!want) { app.dock.hide(); return; }
    // Showing the tile changes the activation policy, and a window shown before that can end up behind
    // whatever was in front. So the Dock goes first and the window is raised after.
    const shown = app.dock.show();
    if (shown && typeof shown.then === 'function') shown.then(applyDockIcon).catch(() => applyDockIcon());
    else applyDockIcon();
  } catch (e) { console.warn('[dock]', e.message); }
}

function openWorkspace(tab, arg) {
  if (state === 'summary') setPetState('idle', { badge: false });
  else if (badge) { badge = false; sendState(); }
  if (!wsWin) {
    wsWin = new BrowserWindow({
      width: 1160, height: 760, minWidth: 820, minHeight: 540, show: false,
      title: 'briffy',
      // 全直角是硬约束。macOS 只给「无边框」窗口关掉圆角，所以这扇窗自己画控件：
      // 顶栏那一条是拖拽区，右上角一个 ×（renderer 里的 .winbar）
      frame: false,
      roundedCorners: false,
      icon: process.platform === 'darwin' ? undefined : assetPath('icon.png'),
      autoHideMenuBar: true,
      backgroundColor: '#f6f3ee',
      webPreferences: {
        preload: preloadPath('workspace.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: false,
      },
    });
    pendingNavigate = tab ? { tab, arg } : null;
    syncDock();
    wsWin.loadFile(rendererPath('workspace', 'index.html'));
    wsWin.once('ready-to-show', () => { wsWin.show(); wsWin.focus(); });
    wsWin.on('closed', () => { wsWin = null; syncDock(); });
    wsWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    wsWin.webContents.on('did-finish-load', () => {
      if (pendingNavigate) { wsWin.webContents.send('ws:navigate', pendingNavigate); pendingNavigate = null; }
    });
  } else {
    syncDock();
    if (wsWin.isMinimized()) wsWin.restore();
    wsWin.show();
    wsWin.focus();
    if (tab) wsWin.webContents.send('ws:navigate', { tab, arg });
  }
  return wsWin;
}
function broadcastToWorkspace(channel, payload) {
  if (wsWin && !wsWin.isDestroyed()) wsWin.webContents.send(channel, payload);
}

function getPetWindow() { return petWin; }
function getWorkspaceWindow() { return wsWin; }

module.exports = {
  syncDock,
  EXCLUDE_FROM_CAPTURE,
  init, createPetWindow, createBubbleWindow, positionBubble, showBubble, hideBubble,
  openOnboarding, closeOnboarding, broadcastToOnboarding,
  setPetState, getState, sendPetCommand, hideForCapture, restoreAfterCapture, setPetHidden, isPetHidden,
  dragStart, dragMove, dragEnd, openWorkspace, broadcastToWorkspace, getPetWindow, getWorkspaceWindow,
  createShelfWindow, hoverPet, hideShelf, isShelfOpen, getShelfWindow,
};
