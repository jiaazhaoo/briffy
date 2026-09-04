'use strict';
// Window management: the floating cat, its speech bubble (a click-through window) and the workspace window.
const { BrowserWindow, screen } = require('electron');
const path = require('path');

// The pet window is larger than the 54px circle it shows (see pet.css --s / --d): the
// transparent margin is where the shadow, the recording ring and every gesture happen,
// so nothing is ever sliced off by the window's rectangular edge.
const PET_W = 80;
const PET_H = 80;
const PET_CIRCLE = 54;
const BUBBLE_W = 320;
const BUBBLE_H = 100;
const MARGIN = 12;
const TRANSIENT = { capturing: 4000, success: 4500, error: 7000, summary: 25000 };

let store;
let petWin = null;
let bubbleWin = null;
let wsWin = null;
let bubbleTimer = null;
let stateTimer = null;
let state = 'idle';
let badge = false;
let hiddenForCapture = false;
let petHidden = false;
let drag = null;
let pendingNavigate = null;

function init(deps) {
  store = deps.store;
  petHidden = !!store.getSettings().petHidden;
}

const rendererPath = (...p) => path.join(__dirname, '..', 'renderer', ...p);
const preloadPath = (name) => path.join(__dirname, '..', 'preload', name);
const assetPath = (name) => path.join(__dirname, '..', '..', 'assets', name);

function defaultPetPosition() {
  const { workArea } = screen.getPrimaryDisplay();
  return { x: workArea.x + workArea.width - PET_W - MARGIN, y: workArea.y + workArea.height - PET_H - MARGIN };
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
    title: 'DailyLogs Pet',
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
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWin.loadFile(rendererPath('pet', 'index.html'));
  petWin.once('ready-to-show', () => { if (!petHidden) petWin.showInactive(); });
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
    title: 'DailyLogs Bubble',
    webPreferences: { preload: preloadPath('bubble.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  bubbleWin.setIgnoreMouseEvents(true);
  bubbleWin.setContentProtection(EXCLUDE_FROM_CAPTURE);
  bubbleWin.setAlwaysOnTop(true, 'floating', 2);
  bubbleWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  bubbleWin.loadFile(rendererPath('bubble', 'index.html'));
  bubbleWin.on('closed', () => { bubbleWin = null; });
  return bubbleWin;
}

function positionBubble() {
  if (!petWin || !bubbleWin) return;
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
  bubbleWin.setPosition(Math.round(x), Math.round(y));
  const tail = Math.round(px + PET_W * 0.5 - x); // px from the balloon window's left edge to the pet's centre
  bubbleWin.webContents.send('bubble:layout', { below, tail: Math.min(Math.max(tail, 24), BUBBLE_W - 24) });
}

function showBubble(text, { ms = 4000, sticky = false } = {}) {
  if (!bubbleWin || !petWin) return;
  bubbleWin.webContents.send('bubble:text', { text, state });
  positionBubble();
  if (!hiddenForCapture && !petHidden && !bubbleWin.isVisible()) bubbleWin.showInactive();
  if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
  if (!sticky) bubbleTimer = setTimeout(hideBubble, ms);
}
function hideBubble() {
  if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
  if (bubbleWin && bubbleWin.isVisible()) bubbleWin.hide();
}

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
async function hideForCapture() {
  hiddenForCapture = true;
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
}
function dragEnd() {
  if (!drag || !petWin) return;
  drag = null;
  const [x, y] = petWin.getPosition();
  const c = clampToDisplays(x, y);
  petWin.setPosition(c.x, c.y);
  store.updateSettings({ petPosition: c });
  positionBubble();
}

// ---------- workspace ----------
function openWorkspace(tab, arg) {
  if (state === 'summary') setPetState('idle', { badge: false });
  else if (badge) { badge = false; sendState(); }
  if (!wsWin) {
    wsWin = new BrowserWindow({
      width: 1160, height: 760, minWidth: 820, minHeight: 540, show: false,
      title: 'DailyLogs',
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
    wsWin.loadFile(rendererPath('workspace', 'index.html'));
    wsWin.once('ready-to-show', () => wsWin.show());
    wsWin.on('closed', () => { wsWin = null; });
    wsWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    wsWin.webContents.on('did-finish-load', () => {
      if (pendingNavigate) { wsWin.webContents.send('ws:navigate', pendingNavigate); pendingNavigate = null; }
    });
  } else {
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
  EXCLUDE_FROM_CAPTURE,
  init, createPetWindow, createBubbleWindow, positionBubble, showBubble, hideBubble,
  setPetState, getState, sendPetCommand, hideForCapture, restoreAfterCapture, setPetHidden, isPetHidden,
  dragStart, dragMove, dragEnd, openWorkspace, broadcastToWorkspace, getPetWindow, getWorkspaceWindow,
};
