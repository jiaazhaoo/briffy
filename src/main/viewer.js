'use strict';
// The picture, on its own.
//
// Clicking a picture in the workspace opens it here rather than growing the detail panel: a picture is
// looked at, and looking at one is a different job from reading about one. It is the same move a chat
// app makes when you tap a photo — a window of its own, the picture as big as it will go, and a strip
// of tools underneath.
//
// Everything that draws happens in the renderer on a canvas over the picture; this file only opens the
// window, hands over the file urls, and does the four things a renderer cannot do for itself:
// put a picture on the system clipboard, keep the window above everything else, translate some text,
// and save a crop.
const { BrowserWindow, ipcMain, clipboard, ClipboardItem, screen, shell } = require('electron');
const path = require('path');

let deps = null;      // { store, llm, clipboardWatch, publicEntry, t }
let win = null;

function preloadPath() { return path.join(__dirname, '..', 'preload', 'viewer.js'); }
function pagePath() { return path.join(__dirname, '..', 'renderer', 'viewer', 'index.html'); }

/** Every picture in the workspace, newest first — the strip that opens down the right-hand side. */
function pictures(limit = 400) {
  const out = [];
  for (const e of deps.store.listEntries({ limit: 2000 })) {
    if ((e.type === 'screenshot' || e.type === 'image') && e.path) out.push(deps.publicEntry(e));
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * @param {string} id the entry to show
 */
function open(id) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('viewer:show', payload(id));
    win.show();
    win.focus();
    return win;
  }
  // Big, but never bigger than the screen it opens on: a 6000px screenshot would otherwise open a
  // window taller than the display and land with its own tools off the bottom edge.
  const area = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1180, Math.round(area.width * 0.86)),
    height: Math.min(860, Math.round(area.height * 0.88)),
    minWidth: 620,
    minHeight: 480,
    frame: false,
    roundedCorners: false,           // 全直角是硬约束；macOS 只给无边框窗口关掉圆角
    backgroundColor: '#00000000',
    transparent: false,
    show: false,
    title: 'briffy',
    webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.loadFile(pagePath());
  win.once('ready-to-show', () => {
    win.webContents.send('viewer:show', payload(id));
    win.show();
    win.focus();
  });
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  return win;
}

function payload(id) {
  return { entry: deps.publicEntry(deps.store.getEntry(id)) || null, pictures: pictures() };
}

function close() { if (win && !win.isDestroyed()) win.close(); }

function init(d) {
  deps = d;

  ipcMain.handle('viewer:list', () => pictures());
  ipcMain.handle('viewer:entry', (_e, id) => deps.publicEntry(deps.store.getEntry(id)));
  ipcMain.on('viewer:close', () => close());
  ipcMain.on('viewer:minimize', () => { if (win && !win.isDestroyed()) win.minimize(); });

  // 图钉：钉在所有东西上面。'screen-saver' 才真的压得住全屏应用，普通的 'floating' 压不住。
  ipcMain.handle('viewer:pin', (_e, on) => {
    if (!win || win.isDestroyed()) return false;
    win.setAlwaysOnTop(!!on, 'screen-saver');
    win.setVisibleOnAllWorkspaces(!!on, { visibleOnFullScreen: true });
    return !!on;
  });

  // 复制：连同画上去的东西一起。渲染进程把画布导出成 png data url 交过来——
  // 「截图」那个工具框出来的一块也走这里，它只是导出前先裁一刀。
  ipcMain.handle('viewer:copy-png', async (_e, dataUrl) => {
    try {
      const b64 = String(dataUrl || '').split(',')[1] || '';
      if (!b64) return { ok: false };
      const png = Buffer.from(b64, 'base64');
      if (deps.clipboardWatch) deps.clipboardWatch.ignoreNext(png);   // 别把自己刚放上去的再存一遍
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // 一键翻译：把这张图上认出来的字翻成界面语言。图片本身从不外传（见 workspace 的规矩），
  // 走的是已经识别好的文字。
  ipcMain.handle('viewer:translate', async (_e, text) => {
    const cfg = deps.llm.config(deps.store);
    if (!deps.llm.isConfigured(cfg)) return { ok: false, reason: 'noProvider' };
    const body = String(text || '').trim();
    if (!body) return { ok: false, reason: 'noText' };
    try {
      const out = await deps.llm.translate(cfg, { text: body });
      return { ok: true, text: out.text, model: out.model };
    } catch (err) { return { ok: false, error: err.message }; }
  });
}

module.exports = { init, open, close, pictures };
