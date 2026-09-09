'use strict';
// Window management: the character on the desktop and the
// workspace window.
const { app, BrowserWindow, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');
const { entrySource } = require('./store');   // 哪种纸：剪贴板 / 收藏要靠它分
const { pathToFileURL } = require('url');
const petGround = require('./pet-ground');

// The pet window is larger than the 54px circle it shows (see pet.css --s / --d): the
// transparent margin is where the shadow, the recording ring and every gesture happen,
// so nothing is ever sliced off by the window's rectangular edge.
const PET_W = 80;
const PET_H = 80;
const SHELF_W = 300;             // the window; the panel inside it is 268 wide, the rest is its shadow
const SHELF_PAD = 32;            // that strip, in px -- the panel's left edge sits this far in
const SHELF_MIN_H = 200;
const SHELF_MAX_H = 640;
const SHELF_GAP = 10;            // clearance kept between the panel and the pet
const SHELF_CLOSE_MS = 420;      // 从头像挪到面板的路上够走完；短了会走到一半就关
const SHELF_FADE_MS = 300;       // the slide-out, if the renderer never reports it finished
const MARGIN = 12;
// 一个状态在脸上停多久。**存东西是一瞬间的事，动画就该是一瞬间**——
// capturing 原来 4000ms，等于按下快门之后那只回形针要瞪四秒钟眼睛，读起来像它在犯难。
// 这几个数现在都对着弹簧真正的时长来（briffy-anim.js 量过：点头 1.07s、摇头 1.14s、pop 0.42s）：
// 演一遍，停住，回到待机。出错留长一点——气泡删掉之后，那张脸是唯一的错误信号了。
const TRANSIENT = { capturing: 260, success: 1200, error: 3000, summary: 25000 };

let store;
let petWin = null;
let wsWin = null;
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
// 那枚回形针在 80×80 的窗口里占的位置（见 pet.css .body）：它是竖着的，两边留得多，
// 底下那 14px 留给 REC 和三个点。书架靠这几个数把自己对到它身上。
const PET_INSET = { left: 22, top: 2, right: 22, bottom: 14 };

// 贴边吸附去掉了（2026-09-06）：放哪儿是放的人说了算，松手就停在那儿。
// 只剩下「别掉出屏幕」这一条（clampToDisplays）。

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
  petWin.keepProtected = true;                          // ...and out of everyone else's, always
  // Not over full-screen apps. A film or a presentation is the one time the whole screen is the point,
  // and a character in the corner of it is in the way. On macOS a full-screen app gets a Space of its own and
  // this flag is all it takes to stay out of it.
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  petWin.loadFile(rendererPath('pet', 'index.html'));
  petWin.once('ready-to-show', () => { if (!petHidden) petWin.showInactive(); watchFullscreen(); watchPetGround(); });
  petWin.on('closed', () => { petWin = null; petGround.reset(); });
  screen.on('display-metrics-changed', () => petGroundChanged('换屏', true));
  petWin.webContents.on('did-finish-load', () => sendState());
  petWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return petWin;
}

// 对话气泡删了（2026-09-06）：桌面上那只自己会换表情，底下还有 REC 和三个点，
// 一个漂在旁边的框既遮它、又和书架抢地方。setPetState 仍然收 message，只是写进日志，
// 不再弹窗——**代价：那些只出现在气泡里的错误文案（麦克风被拒、截图失败、快捷键冲突）
// 现在只剩下一张出错的脸，没有字。**

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
  shelfWin.keepProtected = true;
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
  // 窗口的下沿**正好压在头像窗口的上沿**，不多一个像素。
  // 面板和头像之间那 10px 的空隙由 CSS 让出来（#panel 的 bottom），但那一段仍然属于这扇窗——
  // 指针从头像挪到面板的路上不经过「谁也不在」的地带，于是不会走到一半就把面板关掉。
  // **不能再往下探了**：这扇窗是 300px 宽、右边 262px 是不透明的面板，
  // 只要它盖到头像窗口上，那枚回形针就被压在下面了（2026-09-06 踩过）。
  const bottom = py;
  let h = Math.round(Math.max(SHELF_MIN_H, Math.min(SHELF_MAX_H, bottom - top)));
  let y = Math.round(bottom - h);
  if (bottom - top < SHELF_MIN_H) {                 // 头像贴在屏幕顶上，上面放不下，就落到它下面
    y = Math.round(py + PET_H + SHELF_GAP);
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
      source: entrySource(e),                          // 哪种纸要靠它分（剪贴板 / 收藏）
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
  if (opts.message) console.log('[pet]', next, opts.message);   // 气泡没了，话留在日志里
  if (TRANSIENT[next]) {
    stateTimer = setTimeout(() => { if (state === next) setPetState('idle'); }, TRANSIENT[next]);
  }
}
function getState() { return state; }
// 它站在什么颜色上——量脚下的真实像素，见 pet-ground.js
function watchPetGround() {
  petGround.watch(
    // 排除不了自己就不量：那样裁出来的正好是它自己，量到的是它自己的蓝
    () => (petWin && !petWin.isDestroyed() && !petHidden && EXCLUDE_FROM_CAPTURE ? petWin.getBounds() : null),
    (ground) => sendPetCommand('config', { ground }),
  );
}
/** 脚下那块底可能变了。force＝出生 / 拖走 / 换屏；不 force 的会被 pet-ground 的节流挡住 */
function petGroundChanged(why, force) { petGround.refresh({ force, why }); }

function sendPetCommand(cmd, payload) {
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('pet:command', { cmd, ...payload });
}

/**
 * Windows 10 2004+ (build 19041) and macOS can mark a window as excluded from screen capture, so the pet
 * stays on screen and simply is not in the picture. Where that is unavailable the windows are hidden the
 * old way, which needs a moment to take effect and makes the pet blink.
 * @returns {boolean} true when briffy's windows can stay visible during a capture
 */
function captureExclusionWorks() {
  if (process.platform === 'darwin') return true;
  if (process.platform !== 'win32') return false;
  const build = Number((require('os').release().split('.')[2] || '0'));
  return build >= 19041;
}
const EXCLUDE_FROM_CAPTURE = captureExclusionWorks();

// 采集的那一下，briffy 自己的每一扇窗都借这个标记消失——工作区、看图窗、录音窗，开着哪扇算哪扇。
// 不是常开的：这个标记对所有人生效，常开的话你自己按 Cmd+Shift+3 也拍不到 briffy 了。
// 2026-09-09 量过（scratchpad/protect-test.js，一扇洋红色的窗）：标上 50ms 之后，desktopCapturer、
// node-screenshots、系统的 screencapture 三条路里它都是 0%，撤掉 50ms 之后又都回到 15%。
// 于是「拍到自己」——工作区截到自己的清单、事件视图截到事件视图——在源头就没有了，
// 不用再靠词表认倒影（那个 mirror.js 已经删了）。
const VEIL_MS = 50;
let veiled = [];
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
    if (full) petWin.hide();
    else if (!petHidden && !hiddenForCapture) petWin.showInactive();
  }, 2000);
}

/** @returns {number} how long the caller should wait after this before grabbing the screen */
async function hideForCapture() {
  hiddenForCapture = true;
  hideShelf({ now: true });
  if (!EXCLUDE_FROM_CAPTURE) {
    if (petWin && petWin.isVisible()) petWin.hide();
    return 60;
  }
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed() || w.keepProtected || !w.isVisible()) continue;
    w.setContentProtection(true);
    veiled.push(w);
  }
  return veiled.length ? VEIL_MS : 0;
}
function restoreAfterCapture() {
  hiddenForCapture = false;
  for (const w of veiled.splice(0)) if (!w.isDestroyed()) w.setContentProtection(false);
  if (EXCLUDE_FROM_CAPTURE) return;
  if (petWin && !petHidden && !petWin.isVisible()) petWin.showInactive();
}

function setPetHidden(hidden) {
  if (hidden) hideShelf({ now: true });
  petHidden = !!hidden;
  store.updateSettings({ petHidden });
  if (petHidden) { if (petWin) petWin.hide(); } else if (petWin) { petWin.showInactive(); petGroundChanged('重新显示', true); }
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
  if (shelfOpen) hideShelf({ now: true });          // the pet is being moved, not pointed at
}
function dragEnd() {
  if (!drag || !petWin) return;
  drag = null;
  const [x, y] = petWin.getPosition();
  const c = clampToDisplays(x, y);   // 松手就停在原地，只保证它整个还在屏幕里
  petWin.setPosition(c.x, c.y);
  store.updateSettings({ petPosition: c });
  petGroundChanged('拖走', true);          // 换了地方，脚下那块底多半也换了
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
    // 渲染进程死在哪儿要说出来。它一旦在初始化时抛异常，静态 HTML 还在、动态的全没有，
    // 窗口就是一块白板——外面看不出任何线索，主进程日志也干干净净。
    // 2026-09-09 为了查一次「软件变成白板」补的：宁可多两行日志，也别再有一次哑掉的失败。
    wsWin.webContents.on('console-message', (_e, level, message, line, src) => {
      if (level >= 2) console.log(`[ws] ${message}  @${String(src).split('/').pop()}:${line}`);
    });
    wsWin.webContents.on('preload-error', (_e, file, err) => console.log('[ws] preload', file, err && err.message));
    wsWin.webContents.on('render-process-gone', (_e, d) => console.log('[ws] 渲染进程没了：', d && d.reason));
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
  init, createPetWindow,
  openOnboarding, closeOnboarding, broadcastToOnboarding,
  setPetState, getState, sendPetCommand, hideForCapture, restoreAfterCapture, setPetHidden, isPetHidden,
  dragStart, dragMove, dragEnd, petGroundChanged, openWorkspace, broadcastToWorkspace, getPetWindow, getWorkspaceWindow,
  createShelfWindow, hoverPet, hideShelf, isShelfOpen, getShelfWindow,
};
