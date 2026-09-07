'use strict';
// Application entry point: lifecycle, tray, global shortcut and every IPC handler.
const {
  app, Tray, Menu, nativeImage, globalShortcut, ipcMain, dialog, shell, Notification, session, systemPreferences, clipboard, ClipboardItem, nativeTheme,
} = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { Store, entrySource, localDateKey, addDays } = require('./store');
const windows = require('./windows');
const petskin = require('./petskin');
const workspace = require('./workspace');
const summary = require('./summary');
const ask = require('./ask');
const ai = require('./ai');
const llm = require('./llm');
const hardware = require('./hardware');
const ollama = require('./ollama');
const ollamaLibrary = require('./ollama-library');
const modelQuality = require('./model-quality');
const ffmpegTool = require('./ffmpeg');
const oai = require('./openai-compat');
const orAuth = require('./openrouter-auth');
const clipboardWatch = require('./clipboard-watch');
const localApi = require('./local-api');
const foreground = require('./foreground');
const uptime = require('./uptime');
const deeplink = require('./deeplink');
const longshot = require('./longshot');
const apps = require('./apps');
const connect = require('./connect');
const importBulk = require('./import-bulk');
const trail = require('./trail');
const chats = require('./chats');
const listen = require('./listen');
const diarize = require('./diarize');
const dayStats = require('./day-stats');
const ocrBoxes = require('./ocr-boxes');
const region = require('./region');
const viewer = require('./viewer');
const setup = require('./setup');
const permissions = require('./permissions');
const { installPage } = require('./install-page');
const stt = require('./stt');
const ocr = require('./ocr');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');
const { LANGUAGES, uiLanguage } = require('./languages');
const { screenPermissionStatus } = require('./capture');
const i18n = require('./i18n');
const { t } = i18n;

const store = new Store();
let tray = null;
let registeredHotkeys = [];
let hotkeyError = '';
const assetPath = (name) => path.join(__dirname, '..', '..', 'assets', name);

// Electron names the settings folder after the app, and the app used to be called DailyLogs. Renaming
// it without moving the folder would leave every record, every setting and the whole workspace behind
// in a directory nothing reads any more -- the app would open looking brand new. So the old folder is
// moved once, before anything has had a chance to read or create the new one.
function migrateUserData() {
  const appData = app.getPath('appData');
  const from = path.join(appData, 'DailyLogs');
  const to = path.join(appData, 'briffy');
  if (!fs.existsSync(from) || fs.existsSync(to)) return;
  try {
    fs.renameSync(from, to);
    console.log(`[migrate] ${from} -> ${to}`);
  } catch (e) {
    // Cross-device, or no permission: keep reading the old folder rather than start empty.
    console.error('[migrate] could not move the settings folder, using the old one:', e.message);
    app.setPath('userData', from);
  }
}
migrateUserData();

// Set before anything else so app.getName() is right from the first line, and so Windows and Linux
// name their windows and taskbar entries properly.
//
// It does NOT change what macOS writes under the Dock tile or at the head of the menu bar. Measured:
// both of those read CFBundleName out of the surrounding app bundle, so during development -- where
// the code runs inside Electron's own Electron.app -- they say "Electron" whatever this is set to.
// A packaged build carries productName ("briffy") and gets both right. The one part of the Dock we
// can fix either way is the picture, via app.dock.setIcon below.
app.setName('briffy');

// macOS delivers a briffy:// link as an event, Windows and Linux as an argument to a second launch.
// Both can arrive before the app is ready, so deeplink.js holds the first one until it is.
app.on('open-url', (event, url) => { event.preventDefault(); deeplink.handle(url); });

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const link = deeplink.fromArgv(argv);
    if (link) deeplink.handle(link); else windows.openWorkspace();
  });
  app.whenReady().then(main).catch((e) => { console.error(e); dialog.showErrorBox('briffy', String(e && e.stack || e)); });
}

// Light or dark is Electron's own switch: setting themeSource flips `prefers-color-scheme` inside every
// window at once, so the workspace, the balloon, the shelf and the onboarding flow all follow without a
// line of CSS. 'system' hands it back to the OS.
function applyTheme(theme) {
  nativeTheme.themeSource = theme === 'light' || theme === 'dark' ? theme : 'system';
}

// Everything the app has to say goes through the pet's speech balloon (windows.setPetState
// with a message). The OS toast is only the fallback for when the pet is hidden and there is
// no balloon to speak from.
function notify(title, body, onClick) {
  if (!windows.isPetHidden() || !Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: petskin.file(store), silent: false });
  if (onClick) n.on('click', onClick);
  n.show();
}

function publicEntry(entry) {
  if (!entry) return null;
  const abs = entry.path ? store.absPath(entry.path) : '';
  const out = { ...entry, source: entrySource(entry), absPath: abs, fileUrl: abs ? pathToFileURL(abs).href : '' };
  if (entry.wavPath) out.wavUrl = pathToFileURL(store.absPath(entry.wavPath)).href;
  return out;
}

function mmss(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

async function main() {
  store.init();
  i18n.setLanguage(uiLanguage(store.getSettings().languages));
  applyTheme(store.getSettings().theme);
  windows.init({
    store,
    typeLabel: (type) => (i18n.t('types') || {})[type] || type,
    shelfStrings: () => ({ open: i18n.t('shelfOpen'), copied: i18n.t('shelfCopied'), empty: i18n.t('shelfEmpty') }),
  });
  workspace.init({ store, windows });
  uptime.init({ store });
  longshot.init();
  listen.init({
    store,
    workspace,
    onProblem: (kind) => windows.setPetState('error', { message: t(kind === 'denied' ? 'listenDenied' : 'listenFailed'), ms: 9000 }),
  });
  listen.register();
  deeplink.init({ windows });
  deeplink.register();
  { const link = deeplink.fromArgv(process.argv); if (link) deeplink.handle(link); }
  summary.init({ store, windows, notify });
  // Also on the way up, not only when the setting changes: the language may have been switched while
  // the app was closed, and records saved before this existed still carry their English labels.
  workspace.relabelVision(uiLanguage(store.getSettings().languages));
  ask.init({ store });
  connect.init({ store });
  trail.init({ store });
  chats.init({ store });
  trail.start();
  connect.onProgress((p) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('ws:connect-progress', p); });
  ask.warm();                      // 后台把磁盘索引追平，第一次提问就不用等
  // First launch: walk through languages, permissions and who reads the records, before the pet starts
  // silently asking the OS for things.
  if (!store.getSettings().setupDone && !process.env.DAILYLOGS_SMOKE) windows.openOnboarding();
  if (process.platform === 'win32') app.setAppUserModelId('com.briffy.app');
  // The Dock tile's picture is set in windows.syncDock, at the moment the tile appears -- setting it
  // here, while briffy is still hidden from the Dock, looked right in the log and changed nothing on
  // screen: macOS builds a fresh tile from the bundle each time it comes back.
  // Keep the default macOS application menu (Cmd+C/V/Q); Windows/Linux windows need no menu bar at all.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['media', 'audioCapture', 'notifications', 'clipboard-read', 'clipboard-sanitized-write'].includes(permission));
  });

  region.init();
  viewer.init({ store, llm, clipboardWatch, publicEntry });
  windows.createPetWindow();
  windows.createShelfWindow();     // hidden until the pointer rests on the pet
  createTray();
  registerHotkeys();
  setupIpc();
  windows.syncDock();   // the character alone stays out of the Dock; the workspace puts it back
  foreground.setEnabled(store.getSettings().recordContext);
  uptime.start();      // so a quiet day can say whether it was quiet or unattended
  listen.sync();       // automatic recording, if it was left on
  resolveAutoOcrModel(hardware.quickProfile());   // cheap probe, ready before the first capture
  hardware.detectCached().catch((e) => console.warn('[hardware]', e.message));
  syncClipboardWatch();
  syncLocalApi();
  autoSetup();
  // Build the capture overlay while the machine is idle, so the first capture is as fast as the rest.
  setTimeout(() => { try { region.warm(); } catch (e) { console.warn('[region] warm failed:', e.message); } }, 4000);

  store.on('entry', (entry, kind) => windows.broadcastToWorkspace('ws:entry', { entry: publicEntry(entry), kind }));
  store.on('settings', (after, before) => {
    const changed = Object.keys({ ...before, ...after }).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    if (!changed.length || changed.every((k) => k === 'petPosition')) return; // dragging the character is not a settings change
    i18n.setLanguage(uiLanguage(after.languages));
    if (changed.includes('theme')) applyTheme(after.theme);
    // The words on a picture are the app's, not the user's, so they follow the app's language.
    if (changed.includes('languages')) workspace.relabelVision(uiLanguage(after.languages));
    if (changed.some((k) => k.startsWith('hotkey'))) { registerHotkeys(); rebuildTray(); }
    if (changed.includes('micDeviceId')) windows.sendPetCommand('config', { micDeviceId: after.micDeviceId || '' });
    if (changed.includes('clipboardWatch')) { syncClipboardWatch(); rebuildTray(); }
    if (changed.includes('recordContext')) { foreground.setEnabled(after.recordContext); if (!after.recordContext) foreground.forgetTab(); }
    if (changed.includes('autoRecord') || (after.autoRecord && changed.includes('micDeviceId'))) { listen.sync(); rebuildTray(); }
    if (changed.includes('localApi') || changed.includes('localApiPort')) syncLocalApi();
    if (changed.some((k) => ['languages', 'petHidden'].includes(k))) rebuildTray();
    windows.broadcastToWorkspace('ws:settings', store.getPublicSettings());
  });

  app.on('window-all-closed', () => { /* stay alive in the tray */ });
  app.on('activate', () => { if (!windows.getPetWindow()) windows.createPetWindow(); windows.openWorkspace('entries'); });
  app.on('before-quit', () => { store.flushAll(); uptime.stop(); listen.stop(); globalShortcut.unregisterAll(); clipboardWatch.stop(); localApi.stop(); });
  app.on('will-quit', () => { ocr.terminate().catch(() => {}); stt.dispose().catch(() => {}); });

  if (process.platform === 'darwin' && screenPermissionStatus() !== 'granted') {
    setTimeout(() => windows.setPetState('error', { message: t('screenPermission'), ms: 9000 }), 2500);
  }

  if (process.env.DAILYLOGS_SMOKE) setTimeout(() => smokeTest().catch((e) => { console.log('SMOKE_ERROR', e && e.stack || e); app.quit(); }), 2500);
}

// Headless self-test used during development:
//   DAILYLOGS_SMOKE=1|audio|url|files [DAILYLOGS_SMOKE_WAV=<wav>] [DAILYLOGS_SMOKE_URL=<url>] [DAILYLOGS_SMOKE_FILES=a;b]
//   [DAILYLOGS_SMOKE_TAB=entries|summaries|settings] [DAILYLOGS_SMOKE_OUT=<png path>] npm start
async function smokeTest() {
  const fs = require('fs');
  const { captureDisplayUnderCursor } = require('./capture');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mode = process.env.DAILYLOGS_SMOKE;
  // The region overlays, the one for the primary display first (or DAILYLOGS_SMOKE_DISPLAY=<id>): a test
  // rectangle is given in that display's coordinates, and driving whichever overlay was created first
  // captured a different screen entirely.
  const pickOverlays = () => {
    const { BrowserWindow: BW, screen: scr } = require('electron');
    const want = String(process.env.DAILYLOGS_SMOKE_DISPLAY || scr.getPrimaryDisplay().id);
    const all = BW.getAllWindows().filter((w) => w.frozen);
    return [...all.filter((w) => w.displayInfo && String(w.displayInfo.id) === want), ...all.filter((w) => !w.displayInfo || String(w.displayInfo.id) !== want)];
  };
  windows.openWorkspace('entries');
  await sleep(3500);
  let entry;
  if (mode === 'audio') {
    let pcm;
    if (process.env.DAILYLOGS_SMOKE_WAV) pcm = workspace.readWav(process.env.DAILYLOGS_SMOKE_WAV);
    else { pcm = new Float32Array(16000 * 3); for (let i = 0; i < pcm.length; i++) pcm[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / 16000); }
    entry = await workspace.ingestAudio({ webm: null, pcm, sampleRate: 16000, durationSec: pcm.length / 16000 });
  } else if (mode === 'url') {
    entry = await workspace.ingestUrl(process.env.DAILYLOGS_SMOKE_URL || 'https://example.com/');
  } else if (mode === 'files') {
    entry = (await workspace.ingestFiles((process.env.DAILYLOGS_SMOKE_FILES || '').split(';').filter(Boolean)))[0];
  } else if (mode === 'bench-region') {
    console.log('SMOKE_BENCH region capture stages:');
    await require('../../dev/region-bench.js').bench();
    // Does setContentProtection keep the pet out of our own captures? If so the hide-and-wait can go.
    {
      const { desktopCapturer: dc, screen: sc } = require('electron');
      const pet = windows.getPetWindow();
      const d = sc.getPrimaryDisplay();
      const size = { width: Math.round(d.bounds.width * d.scaleFactor), height: Math.round(d.bounds.height * d.scaleFactor) };
      const petBounds = pet.getBounds();
      const cropAt = (img) => img.crop({
        x: Math.round((petBounds.x - d.bounds.x) * d.scaleFactor), y: Math.round((petBounds.y - d.bounds.y) * d.scaleFactor),
        width: Math.round(petBounds.width * d.scaleFactor), height: Math.round(petBounds.height * d.scaleFactor),
      }).toBitmap();
      const grab = async () => cropAt((await dc.getSources({ types: ['screen'], thumbnailSize: size }))[0].thumbnail);
      pet.setContentProtection(false); await sleep(400);
      const withPet = await grab();
      pet.setContentProtection(true); await sleep(400);
      const protectedShot = await grab();
      pet.hide(); await sleep(400);
      const hidden = await grab();
      pet.setContentProtection(false); pet.showInactive();
      const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 8) n++; return Math.round((n / (a.length / 4)) * 100); };
      console.log(`SMOKE_BENCH content protection: protected-vs-hidden differ ${diff(protectedShot, hidden)}% · visible-vs-hidden differ ${diff(withPet, hidden)}%`);
    }
    // end-to-end cost of opening the overlay, cold (windows not built yet) and warm (reused)
    const openOnce = async () => {
      const t0 = Date.now();
      const p = workspace.captureRegion();
      let shown = 0;
      const iv = setInterval(() => {
        const o = require('electron').BrowserWindow.getAllWindows().filter((w) => w.frozen && w.isVisible());
        if (o.length && !shown) { shown = Date.now() - t0; clearInterval(iv); }
      }, 5);
      await sleep(2500);
      clearInterval(iv);
      return { shown, p };
    };
    const cold = await openOnce();
    console.log(`SMOKE_BENCH overlay visible (cold) after ${cold.shown} ms`);
    require('./region').cancel(); await cold.p.catch(() => {});
    await sleep(600);
    const warm2 = await openOnce();
    console.log(`SMOKE_BENCH overlay visible (warm) after ${warm2.shown} ms`);
    const p = warm2.p;
    // measure how long the renderer takes to lay out + paint one drag frame
    const overlays = pickOverlays();
    if (overlays.length) {
      const r = await overlays[0].webContents.executeJavaScript(`(async () => {
        const fire = (type, x, y) => document.body.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
        fire('mousedown', 100, 100);
        // A real mouse reports 125-1000 times a second, i.e. several moves per displayed frame.
        // Fire 12 per frame, which is what an ordinary mouse actually delivers.
        const frames = [];
        let last = performance.now();
        for (let f = 0; f < 60; f++) {
          for (let k = 0; k < 12; k++) fire('mousemove', 100 + f * 12 + k, 100 + f * 8 + k);
          await new Promise((res) => requestAnimationFrame(res));
          const now = performance.now();
          frames.push(now - last);
          last = now;
        }
        fire('mouseup', 820, 580);
        frames.sort((a, b) => a - b);
        return { median: frames[30], p90: frames[54], worst: frames[59] };
      })()`);
      console.log(`SMOKE_BENCH drag frame ms: median ${r.median.toFixed(1)} · p90 ${r.p90.toFixed(1)} · worst ${r.worst.toFixed(1)}`);
    }
    require('./region').cancel();
    await p.catch(() => {});
  } else if (mode === 'region') {
    // Opens the overlay, drives a selection through the renderer, and reports what was captured.
    const rect = (process.env.DAILYLOGS_SMOKE_RECT || '200,150,700,420').split(',').map(Number);
    const p = workspace.captureRegion();
    await sleep(2500);
    const overlays = pickOverlays();
    console.log('SMOKE_REGION overlays:', overlays.length);
    if (overlays.length) {
      await overlays[0].webContents.executeJavaScript(`(() => {
        const fire = (type, x, y) => document.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
        fire('mousedown', ${rect[0]}, ${rect[1]});
        fire('mousemove', ${rect[0] + rect[2]}, ${rect[1] + rect[3]});
        fire('mouseup', ${rect[0] + rect[2]}, ${rect[1] + rect[3]});
        document.querySelector('#btnOk').click();
        'sent';
      })()`);
    }
    entry = await p;
    console.log('SMOKE_REGION entry:', entry ? `${entry.width}x${entry.height} ${entry.path}` : 'cancelled');
    await sleep(600);
    const { clipboard } = require('electron');
    const items = await clipboard.read();
    const types = items.flatMap((i) => i.types);
    console.log('SMOKE_REGION clipboard types:', JSON.stringify(types));
    const item = items.find((i) => i.types.includes('image/png'));
    if (item) {
      const blob = await item.getType('image/png');
      const bytes = Buffer.from(await blob.arrayBuffer());
      const saved = fs.readFileSync(store.absPath(entry.path));
      console.log(`SMOKE_REGION clipboard image ${bytes.length} bytes · same as saved file: ${bytes.equals(saved)}`);
    } else {
      console.log('SMOKE_REGION clipboard has NO image');
    }
  } else if (mode === 'shelf') {
    // Opens the shelf the way resting on the pet does, reads back what the panel actually shows, and
    // exercises both ways out of it: the clipboard, and a native drag of the file.
    const { BrowserWindow: BW, clipboard: cb } = require('electron');
    const { screen: scr2 } = require('electron');
    const pet = windows.getPetWindow();
    windows.hoverPet(true);
    await sleep(900);
    const shelf = windows.getShelfWindow();
    console.log('SMOKE_SHELF window:', shelf ? `visible=${shelf.isVisible()} ${JSON.stringify(shelf.getBounds())}` : 'missing');
    if (shelf && pet) {
      // the two must not share a single pixel, and the panel must still reach the screen's right edge
      const s0 = shelf.getBounds();
      const p0 = pet.getBounds();
      const overlap = s0.x < p0.x + p0.width && p0.x < s0.x + s0.width && s0.y < p0.y + p0.height && p0.y < s0.y + s0.height;
      const wa = scr2.getDisplayMatching(p0).workArea;
      console.log('SMOKE_SHELF pet:', JSON.stringify(p0), '| overlaps pet:', overlap, '| flush right:', s0.x + s0.width === wa.x + wa.width);
      const panelLeft = await shelf.webContents.executeJavaScript("Math.round(document.querySelector('#panel').getBoundingClientRect().left)");
      console.log('SMOKE_SHELF panel left in screen px:', s0.x + panelLeft, '| pet right edge:', p0.x + p0.width, '| panel clear of pet:', s0.x + panelLeft >= p0.x + p0.width || !overlap);
      const anim = await shelf.webContents.executeJavaScript(`(() => {
        const p = document.querySelector('#panel'); const cs = getComputedStyle(p);
        return JSON.stringify({ inClass: document.body.classList.contains('in'), opacity: cs.opacity, transform: cs.transform, transition: cs.transitionDuration });
      })()`);
      console.log('SMOKE_SHELF settled:', anim);
      // DAILYLOGS_SMOKE_HOLD=<ms> leaves the panel on screen, so it can be photographed from outside.
      // capturePage() is no use here: on a transparent window it returns the desktop behind it.
      const hold = Number(process.env.DAILYLOGS_SMOKE_HOLD || 0);
      if (hold > 0) { console.log('SMOKE_SHELF holding open for', hold, 'ms'); await sleep(hold); }
    }
    if (shelf) {
      const seen = await shelf.webContents.executeJavaScript(`(() => {
        const cards = [...document.querySelectorAll('.card')];
        return JSON.stringify({
          shown: document.body.classList.contains('in'),
          count: cards.length,
          draggable: cards.filter((c) => c.getAttribute('draggable') === 'true').length,
          withThumb: cards.filter((c) => c.querySelector('img')).length,
          openLabel: document.querySelector('#openLabel').textContent,
          first: cards.slice(0, 3).map((c) => c.querySelector('.t').textContent.trim().slice(0, 28) + ' | ' + c.querySelector('.m').textContent.trim()),
          panelRight: Math.round(document.querySelector('#panel').getBoundingClientRect().right),
        });
      })()`);
      console.log('SMOKE_SHELF panel:', seen);
      const ids = await shelf.webContents.executeJavaScript("JSON.stringify([...document.querySelectorAll('.card')].map((c) => c.dataset.id))");
      const list = JSON.parse(ids);
      // clipboard.readText is async in this Electron, like the rest of its clipboard API
      const readText = async () => { const v = await cb.readText(); return typeof v === 'string' ? v : ''; };
      const target = list.map((id) => store.getEntry(id)).find((e) => e && (e.text || '').trim());
      if (target) {
        cb.writeText('smoke-placeholder');
        const r = await shelf.webContents.executeJavaScript(`window.shelf.copy(${JSON.stringify(target.id)})`);
        await sleep(250);
        const now = await readText();
        console.log('SMOKE_SHELF copy text:', JSON.stringify(r), '| changed:', now !== 'smoke-placeholder', '| matches entry:', now.trim() === (target.url || target.text.trim()));
      }
      const pic0 = list.map((id) => store.getEntry(id)).find((e) => e && (e.type === 'image' || e.type === 'screenshot') && e.path);
      if (pic0) {
        cb.writeText('smoke-placeholder');
        const r = await shelf.webContents.executeJavaScript(`window.shelf.copy(${JSON.stringify(pic0.id)})`);
        await sleep(250);
        const items = await cb.read();
        console.log('SMOKE_SHELF copy image:', JSON.stringify(r), '| clipboard has png:', items.flatMap((i) => i.types).includes('image/png'));
      }
      const pic = list.map((id) => store.getEntry(id)).find((e) => e && (e.type === 'image' || e.type === 'screenshot') && e.path);
      console.log('SMOKE_SHELF draggable file:', pic ? `${pic.type} ${fs.existsSync(store.absPath(pic.path))}` : 'none');
    }
    windows.hideShelf({ now: true });
    await sleep(140);
    if (shelf) console.log('SMOKE_SHELF mid-slide, still on screen:', shelf.isVisible());
    await sleep(600);
    console.log('SMOKE_SHELF after hide, visible:', shelf ? shelf.isVisible() : 'n/a');
  } else if (mode === 'setup') {
    const r = await setup.run({ store, onProgress: (p) => { if (p.type === 'log') console.log('SMOKE_SETUP_LOG', p.line); else if (p.current) console.log('SMOKE_SETUP', p.percent + '%', p.current); } },
      { installOllama: process.env.DAILYLOGS_SMOKE_OLLAMA === '1' });
    console.log('SMOKE_SETUP_RESULT', JSON.stringify({ ok: r.ok, error: r.error, steps: r.steps.map((s) => `${s.id}:${s.state}${s.detail ? ` (${s.detail})` : ''}`), summary: r.summary }));
    windows.openWorkspace('settings');
  } else if (mode === 'clipboard') {
    // Reports what is on the clipboard right now and records it the same way the watcher would.
    clipboardWatch.stop();
    const snap = await clipboardWatch.snapshot();
    console.log('SMOKE_CLIPBOARD types', JSON.stringify(snap.types), 'files', JSON.stringify(snap.files), 'text', JSON.stringify((snap.text || '').slice(0, 60)), 'png', snap.png ? snap.png.length : 0);
    if (snap.files.length) entry = (await workspace.ingestFiles(snap.files, { origin: 'clipboard', quiet: true }))[0];
    else if (snap.text && snap.text.trim()) entry = (await workspace.ingestDrop({ text: snap.text.trim() }, { origin: 'clipboard', quiet: true }))[0];
    else if (snap.png) entry = await workspace.ingestClipboardImage(snap.png);
    console.log('SMOKE_CLIPBOARD ingested', entry ? `${entry.type} | ${entry.title} | ${entry.path}` : 'nothing');
  } else if (mode === 'summary') {
    const dateKey = process.env.DAILYLOGS_SMOKE_DATE || localDateKey();
    const r = await summary.generate(dateKey, { force: true });
    console.log('SMOKE_SUMMARY', JSON.stringify(r && { meta: r.meta, text: r.text.slice(0, 1200) }));
    windows.openWorkspace('summaries', dateKey);
  } else {
    entry = await workspace.captureScreenshot();
  }
  if (entry) {
    const started = Date.now();
    let cur = store.getEntry(entry.id);
    while (cur && cur.status === 'processing' && Date.now() - started < 600000) { await sleep(500); cur = store.getEntry(entry.id); }
    console.log('SMOKE_RESULT', JSON.stringify({ ...cur, text: (cur.text || '').slice(0, 600) }));
    const tab = process.env.DAILYLOGS_SMOKE_TAB;
    windows.openWorkspace(tab || 'entries', tab ? undefined : cur.id);
  } else if (!['summary', 'bench-region', 'shelf'].includes(mode)) {
    throw new Error('smoke: nothing ingested');
  }
  await sleep(2000);
  if (process.env.DAILYLOGS_SMOKE_OUT) {
    const shot = await captureDisplayUnderCursor();
    fs.writeFileSync(process.env.DAILYLOGS_SMOKE_OUT, shot.png);
    console.log('SMOKE_SHOT', process.env.DAILYLOGS_SMOKE_OUT);
  }
  store.flushAll();
  app.quit();
}

// ---------- clipboard recorder ----------
function syncClipboardWatch() {
  const on = store.getSettings().clipboardWatch !== false;
  if (on && !clipboardWatch.isRunning()) {
    // Nothing is announced. Copying happens dozens of times an hour without meaning to file anything,
    // and a balloon for each one turns the pet into a nuisance -- the same rule the end of the pipeline
    // already follows (see the clipboard exemption in workspace.js processEntry). The record still
    // lands, and the shelf under the pet is where it shows up.
    clipboardWatch.start({ store, workspace });
  } else if (!on && clipboardWatch.isRunning()) {
    clipboardWatch.stop();
  }
}

// Setup runs by itself: on first launch it prepares the local engines, and on later launches it quietly
// makes sure the models the current settings ask for are present. Nothing to click; the pet says what it
// is doing, and everything stays changeable in Settings afterwards.
let autoSetupRan = false;
async function autoSetup() {
  if (autoSetupRan) return;
  autoSetupRan = true;
  const first = !store.getSettings().setupDone;
  await new Promise((r) => setTimeout(r, first ? 1500 : 8000));   // let the window settle / stay out of the way
  let announced = false;
  try {
    const result = await setup.run({
      store,
      onProgress: (p) => {
        if (p.type === 'log') { console.log('[setup]', p.line); return; }
        windows.broadcastToWorkspace('ws:setup-progress', p);
        // Preparing the engines is background work like any other: the settings panel shows every step,
        // so the character only changes posture rather than narrating it.
        if (first && p.current && !announced) { announced = true; windows.setPetState('processing'); }
      },
    }, { installOllama: false });
    if (announced && result && result.ok) {
      // Worth one line: this is the app reporting it is ready, not a step along the way.
      windows.setPetState('success', { message: t('autoSetupDone', { summary: (result.summary || []).slice(1, 3).join(' · ') }), ms: 6000 });
    } else if (announced) {
      windows.setPetState('idle');
    }
  } catch (e) {
    console.warn('[setup] automatic run failed:', e.message);
    if (announced) windows.setPetState('idle');
  }
}

/** Which Chromium family is the default browser, so the guide shows the right chrome:// / edge:// address. */
function defaultBrowser() {
  if (process.platform !== 'win32') return 'chrome';
  try {
    const out = require('child_process').execSync(
      'powershell -NoProfile -NonInteractive -Command "(Get-ItemProperty \'HKCU:\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice\').ProgId"',
      { windowsHide: true, timeout: 5000 },
    ).toString();
    return /edge/i.test(out) ? 'edge' : 'chrome';
  } catch (_) { return 'chrome'; }
}

// Decides once per machine which bundled OCR model to run, after the hardware probe has finished.
// Kept in settings so the choice is stable across restarts and can be stepped down if it proves slow.
function resolveAutoOcrModel(info) {
  const s = store.getSettings();
  if (s.ocrModel) return;                                  // the user chose a model explicitly
  const pick = hardware.ocrModel(info);
  if (s.ocrModelAuto === pick.model) return;
  if (s.ocrModelAuto && pick.reason === 'unknown-machine') return;
  console.log(`[ocr] auto-selected ${pick.model} for this machine (${pick.reason}; ${pick.cores} cores, ${pick.ramGB} GB, probe ${pick.cpuProbeMs} ms)`);
  store.updateSettings({ ocrModelAuto: pick.model });
}

// The bundled extension folder (unpacked from the asar when packaged, so the browser can load it).
function extensionDir() {
  const dir = path.join(__dirname, '..', '..', 'extension');
  return dir.includes('app.asar') ? dir.replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked') : dir;
}

// ---------- local API for the browser extension ----------
function syncLocalApi() {
  const s = store.getSettings();
  localApi.stop();
  if (s.localApi === false) return;
  localApi.start({
    port: s.localApiPort || localApi.DEFAULT_PORT,
    version: app.getVersion(),
    lastExtension: s.lastExtension || null,
    // 只在换了一个扩展、或者距上次记下超过一小时时写盘：心跳是每 5 分钟一次，不该每次都落盘
    rememberExtension: (ext) => {
      const prev = store.getSettings().lastExtension;
      if (prev && prev.id === ext.id && ext.lastSeen - (prev.lastSeen || 0) < 3600e3) return;
      store.updateSettings({ lastExtension: ext });
    },
    workspace,
    installPage: () => installPage({ lang: i18n.getLanguage(), extensionDir: extensionDir(), browser: defaultBrowser() }),
    onExtension: (ext) => {
      console.log(`[extension] connected, version ${ext.version}`);
      windows.broadcastToWorkspace('ws:extension', localApi.extensionStatus());
    },
    onTab: (tab) => {
      foreground.noteTab(tab);
      // 正文只有开着那一层时才会被交上来，trail 自己按网址去重
      if (tab && tab.text) trail.notePage(tab);
    },
    wantsTab: () => foreground.isEnabled(),
    // 正文要不要：这是「不用动手存的那一层」，默认关着，见 src/main/trail.js
    wantsText: () => store.getSettings().recordTrail === true,
    onDone: (info) => {
      const n = Math.max(0, (info.count || 0) - (info.failed || 0));
      if (n) windows.setPetState('success', { message: t('mediaReceived', { n, title: (info.pageTitle || '').slice(0, 30) }), ms: 4000 });
    },
    onError: (e) => windows.setPetState('error', { message: t('apiPortFailed', { port: s.localApiPort || localApi.DEFAULT_PORT }) + ` (${e.code || e.message})`, ms: 8000 }),
  });
}

// ---------- tray ----------
function trayImage() {
  if (process.platform === 'darwin') {
    const img = nativeImage.createFromPath(assetPath('trayTemplate.png'));
    img.setTemplateImage(true);
    return img;
  }
  return nativeImage.createFromPath(assetPath('tray.png'));
}
function menuTemplate({ includePetToggle = true } = {}) {
  const s = store.getSettings();
  const items = [];
  if (includePetToggle) {
    items.push({ label: windows.isPetHidden() ? t('trayShowPet') : t('trayHidePet'), click: () => { windows.setPetHidden(!windows.isPetHidden()); rebuildTray(); } });
  }
  items.push(
    { label: t('trayOpenWorkspace'), click: () => windows.openWorkspace('entries') },
    { type: 'separator' },
    { label: `${t('trayRegion')}  (${s.hotkeyRegion || ''})`, click: () => workspace.captureRegion().catch(() => {}) },
    { label: `${t('trayCapture')}  (${s.hotkeyScreen || ''})`, click: () => workspace.captureScreenshot().catch(() => {}) },
    { label: `${t('trayRecord')}  (${s.hotkeyVoice || ''})`, click: () => windows.sendPetCommand('toggle-recording') },
    { label: t('trayClipboard'), type: 'checkbox', checked: store.getSettings().clipboardWatch !== false, click: (item) => store.updateSettings({ clipboardWatch: item.checked }) },
    // Reachable without opening the workspace: the one feature that runs on its own should be one
    // click from off, wherever you are.
    { label: t('trayAutoRecord'), type: 'checkbox', checked: store.getSettings().autoRecord === true, click: (item) => store.updateSettings({ autoRecord: item.checked }) },
    { label: t('menuAddFiles'), click: () => addFilesDialog() },
    { type: 'separator' },
    { label: t('traySettings'), click: () => windows.openWorkspace('settings') },
    { type: 'separator' },
    { label: t('trayQuit'), click: () => app.quit() },
  );
  return items;
}
function createTray() {
  try {
    tray = new Tray(trayImage());
    tray.setToolTip('briffy');
    rebuildTray();
    tray.on('click', () => { if (process.platform !== 'darwin') windows.openWorkspace('entries'); });
  } catch (e) {
    console.error('[tray] failed', e);
  }
}
function rebuildTray() {
  if (tray) tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()));
}

async function addFilesDialog() {
  const parent = windows.getWorkspaceWindow() || undefined;
  const r = await dialog.showOpenDialog(parent, { title: t('dialogAddFiles'), properties: ['openFile', 'multiSelections'] });
  if (r.canceled || !r.filePaths.length) return [];
  return (await workspace.ingestFiles(r.filePaths)).map(publicEntry);
}

// ---------- global shortcuts ----------
// Three actions, each its own shortcut. Region capture gets the shortcut people already have muscle
// memory for from other screenshot tools, so it is the one on Ctrl+Alt+A / Cmd+Shift+A.
const ACTIONS = {
  hotkeyRegion: () => { workspace.captureRegion().catch(() => {}); },
  hotkeyScreen: () => { workspace.captureScreenshot().catch(() => {}); },
  hotkeyVoice: () => windows.sendPetCommand('toggle-recording'),
};

function registerHotkeys() {
  for (const key of registeredHotkeys) { try { globalShortcut.unregister(key); } catch (_) { /* ignore */ } }
  registeredHotkeys = [];
  hotkeyError = '';
  const s = store.getSettings();
  const failed = [];
  for (const [setting, handler] of Object.entries(ACTIONS)) {
    const key = String(s[setting] || '').trim();
    if (!key) continue;
    try {
      if (globalShortcut.register(key, handler)) { registeredHotkeys.push(key); console.log('[hotkey] registered', key, '→', setting); }
      else failed.push(key);
    } catch (e) {
      failed.push(`${key} (${e.message})`);
    }
  }
  if (failed.length) {
    hotkeyError = t('hotkeyFailed', { key: failed.join(', ') });
    console.warn('[hotkey]', hotkeyError);
    windows.setPetState('error', { message: hotkeyError });
  }
}

// ---------- AI provider helpers ----------
function anthropicConfigDir() {
  if (process.env.ANTHROPIC_CONFIG_DIR) return process.env.ANTHROPIC_CONFIG_DIR;
  return process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Anthropic')
    : path.join(os.homedir(), '.config', 'anthropic');
}
function which(cmd) {
  return new Promise((resolve) => {
    execFile(process.platform === 'win32' ? 'where' : 'which', [cmd], { windowsHide: true, timeout: 5000 }, (err, out) => resolve(!err && String(out).trim() ? String(out).trim().split(/\r?\n/)[0] : ''));
  });
}
async function anthropicAccountStatus() {
  const dir = anthropicConfigDir();
  let profiles = [];
  try { profiles = fs.readdirSync(path.join(dir, 'credentials')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)); } catch (_) { /* none */ }
  const cli = await which('ant');
  return { configDir: dir, profiles, hasProfile: profiles.length > 0, envKey: !!process.env.ANTHROPIC_API_KEY, envToken: !!process.env.ANTHROPIC_AUTH_TOKEN, cliInstalled: !!cli, cliPath: cli };
}
// Opens a terminal running `ant auth login` (the CLI stores an OAuth profile the SDK picks up automatically).
async function launchAnthropicLogin() {
  const cli = await which('ant');
  const command = 'ant auth login';
  if (!cli) return { launched: false, cliInstalled: false, command };
  try {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '"briffy – ant auth login"', 'cmd', '/k', command], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    } else if (process.platform === 'darwin') {
      spawn('osascript', ['-e', `tell application "Terminal" to do script "${command}"`, '-e', 'tell application "Terminal" to activate'], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('sh', ['-c', `x-terminal-emulator -e '${command}' || gnome-terminal -- ${command} || xterm -e '${command}'`], { detached: true, stdio: 'ignore' }).unref();
    }
    return { launched: true, cliInstalled: true, command };
  } catch (e) {
    return { launched: false, cliInstalled: true, command, error: e.message };
  }
}

const OR_MODELS_TTL = 6 * 60 * 60 * 1000;
function orModelsFile() { return path.join(app.getPath('userData'), 'openrouter-models.json'); }
async function openrouterModels(refresh = false) {
  if (!refresh) {
    try {
      const cached = JSON.parse(fs.readFileSync(orModelsFile(), 'utf8'));
      if (cached && Date.now() - cached.fetchedAt < OR_MODELS_TTL && Array.isArray(cached.models)) return cached.models;
    } catch (_) { /* no cache */ }
  }
  const models = (await oai.listModels({ baseUrl: oai.OPENROUTER_BASE, headers: oai.OPENROUTER_HEADERS }))
    .filter((m) => !/:batch$/.test(m.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  try { fs.writeFileSync(orModelsFile(), JSON.stringify({ fetchedAt: Date.now(), models })); } catch (_) { /* ignore */ }
  return models;
}

// The five worth showing, out of the two hundred in Ollama's library. Live, cached for a day, and if
// the network is not there, whatever was cached last -- or the built-in list, so a fresh offline
// install still has something to choose from.
async function modelCatalogue(hw, refresh) {
  const dir = store.paths().models;
  // budgetGB is worked out by recommend(), not carried on the raw detection result. Passing `hw`
  // straight through silently fell back to an 8 GB default, so every machine was offered a small
  // machine's models while the line above it recommended a 27B.
  const withBudget = { ...hw, budgetGB: hardware.recommend(hw).budgetGB };
  try {
    const [lib, quality] = await Promise.all([
      ollamaLibrary.fetchLibrary(dir, { refresh }),
      modelQuality.fetchQuality(dir, { refresh }),
    ]);
    if (lib.models && lib.models.length) {
      return {
        tiers: ollamaLibrary.tiers(lib.models, withBudget, quality),
        live: !lib.stale, at: lib.at,
        scored: quality.scores.size, qualityStale: !!quality.stale,
      };
    }
  } catch (e) {
    console.warn('[library]', e.message);
  }
  // Offline on a fresh install: the built-in list, split the same three ways so the UI is unchanged.
  const fallback = hardware.catalogue(withBudget);
  const third = Math.ceil(fallback.length / 3) || 1;
  return {
    tiers: {
      easy: fallback.slice(0, third).map((m) => ({ ...m, tier: 'easy' })),
      medium: fallback.slice(third, third * 2).map((m) => ({ ...m, tier: 'medium', recommended: true })),
      stretch: fallback.slice(third * 2).map((m) => ({ ...m, tier: 'stretch' })),
    },
    live: false, at: 0, scored: 0,
  };
}

async function providerStatus(refresh = false) {
  const s = store.getSettings();
  const [hw, ol, anthropic] = await Promise.all([
    hardware.detectCached(refresh),
    ollama.status(s.ollamaHost),
    anthropicAccountStatus(),
  ]);
  const cfg = llm.config(store);
  return {
    hardware: hw,
    recommendation: hardware.recommend(hw),
    catalogue: await modelCatalogue(hw, refresh),
    pendingPull: s.pendingPull || null,
    ollama: { host: s.ollamaHost || ollama.DEFAULT_HOST, ...ol },
    anthropic,
    configured: llm.isConfigured(cfg),
    label: llm.label(cfg),
    provider: cfg.provider,
  };
}

// Request/response over the pet renderer (which owns the microphone): send a command, await the reply event.
const pending = new Map();
function askPet(key, cmd, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (pending.has(key)) pending.get(key).reject(new Error('superseded'));
    const timer = setTimeout(() => { pending.delete(key); reject(new Error('The briffy window did not answer in time')); }, timeoutMs);
    pending.set(key, { resolve: (v) => { clearTimeout(timer); pending.delete(key); resolve(v); }, reject: (e) => { clearTimeout(timer); pending.delete(key); reject(e); } });
    if (!windows.getPetWindow()) { pending.get(key).reject(new Error('The briffy window is not open')); return; }
    windows.sendPetCommand(cmd, payload);
  });
}
function resolvePending(key, value) { const p = pending.get(key); if (p) p.resolve(value); }

// ---------- IPC ----------
function setupIpc() {
  // --- pet ---
  ipcMain.on('pet:region', () => { workspace.captureRegion().catch(() => {}); });
  ipcMain.on('pet:hover', (_e, on) => windows.hoverPet(on));

  // ---------- the shelf ----------
  // Click copies. What lands on the clipboard is what a person would expect to paste: a picture as a
  // picture, a link as its address, anything with words as those words, and a file as its path.
  ipcMain.handle('shelf:copy', async (_e, id) => {
    const entry = store.getEntry(id);
    if (!entry) return { ok: false };
    const abs = entry.path ? store.absPath(entry.path) : '';
    if ((entry.type === 'screenshot' || entry.type === 'image') && abs && fs.existsSync(abs)) {
      const png = fs.readFileSync(abs);
      // the same async W3C-style clipboard the capture path uses; there is no writeImage() here
      clipboardWatch.ignoreNext(png);           // do not file what we just put on the clipboard
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
      return { ok: true };
    }
    const text = entry.url || (entry.text || '').trim() || abs;
    if (!text) return { ok: false };
    clipboard.writeText(text);
    return { ok: true };
  });

  // Drag pulls the file out of the app entirely -- to the desktop, a chat, a browser upload box. Only
  // the main process can start a drag that outlives the window, and it needs an icon or it throws.
  ipcMain.on('shelf:drag-out', (event, id) => {
    const entry = store.getEntry(id);
    const abs = entry && entry.path ? store.absPath(entry.path) : '';
    if (!abs || !fs.existsSync(abs)) return;
    let icon = null;
    if (entry.type === 'screenshot' || entry.type === 'image') {
      const img = nativeImage.createFromPath(abs);
      if (!img.isEmpty()) icon = img.resize({ width: 128, quality: 'good' });
    }
    if (!icon || icon.isEmpty()) icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'icon.png')).resize({ width: 64 });
    try { event.sender.startDrag({ file: abs, icon }); } catch (e) { console.warn('[shelf] drag failed:', e.message); }
  });

  ipcMain.on('shelf:open-workspace', () => { windows.hideShelf({ now: true }); windows.openWorkspace('entries'); });
  ipcMain.on('pet:click', () => { workspace.captureScreenshot().catch(() => {}); });
  ipcMain.on('pet:drag-start', (_e, p) => windows.dragStart(p));
  ipcMain.on('pet:drag-move', (_e, p) => windows.dragMove(p));
  ipcMain.on('pet:drag-end', () => windows.dragEnd());
  ipcMain.on('pet:context-menu', () => {
    const template = menuTemplate({ includePetToggle: false });
    template.splice(template.length - 1, 0, { label: t('trayHidePet'), click: () => { windows.setPetHidden(true); rebuildTray(); } });
    Menu.buildFromTemplate(template).popup({ window: windows.getPetWindow() });
  });
  ipcMain.handle('pet:drop', async (_e, payload) => {
    const p = payload || {};
    // 拖一包导出进来和拖一个文件进来是同一个动作，用户不该被要求先知道区别。整包的走
    // connect（同一套去重），剩下的照旧。只在拖拽这条路上分流：剪贴板里复制一个文件夹
    // 不该触发一次整包导入。
    const rest = [];
    let bulk = [];
    for (const src of (Array.isArray(p.paths) ? p.paths : [])) {
      const kind = await importBulk.sniff(src).catch(() => '');
      if (kind) bulk.push(src); else rest.push(src);
    }
    if (bulk.length) connect.importFiles(bulk).catch((e) => console.error('[import]', e.message || e));
    const out = await workspace.ingestDrop({ ...p, paths: rest });
    return out.map(publicEntry);
  });
  ipcMain.on('pet:recording-state', (_e, { recording, seconds, level = 0, peak = 0 } = {}) => {
    if (recording) {
      const bars = '▁▂▃▄▅▆▇█';
      const meter = bars[Math.min(bars.length - 1, Math.round(Math.sqrt(Math.max(0, level)) * 10))];
      const warn = seconds >= 3 && peak < 0.004 ? ` · ${t('noSound')}` : '';
      windows.setPetState('recording', { message: `${t('recording', { time: mmss(seconds) })} ${meter}${warn}`, sticky: true });
    } else if (windows.getState() === 'recording') {
      windows.setPetState('idle');
    }
  });
  ipcMain.handle('pet:audio', (_e, payload) => workspace.ingestAudio(payload).then(publicEntry));
  ipcMain.handle('pet:get-config', () => ({ micDeviceId: store.getSettings().micDeviceId || '', avatarUrl: petskin.url(store), avatarBuiltin: petskin.isBuiltin(store) }));
  ipcMain.on('pet:log', (_e, msg) => console.log('[pet]', msg));
  ipcMain.on('pet:mic-devices', (_e, devices) => resolvePending('mic-devices', devices));
  ipcMain.on('pet:mic-test-result', (_e, r) => resolvePending('mic-test', r));
  ipcMain.handle('pet:request-mic', async () => {
    if (process.platform !== 'darwin') return true;
    try { return await systemPreferences.askForMediaAccess('microphone'); } catch (_) { return false; }
  });
  ipcMain.on('pet:mic-denied', () => windows.setPetState('error', { message: t('micDenied') }));
  ipcMain.on('pet:open-workspace', () => windows.openWorkspace('entries'));

  // --- workspace ---
  ipcMain.handle('ws:get-settings', () => ({
    settings: store.getPublicSettings(),
    avatarUrl: petskin.url(store),
    languages: LANGUAGES,
    models: ai.MODELS,
    sttModels: stt.STT_MODELS,
    platform: process.platform,
    version: app.getVersion(),
    screenPermission: screenPermissionStatus(),
    hotkeyError,
    workspaceDir: store.workspaceDir,
    stats: store.stats(),
    localApi: localApi.status(),
    listen: listen.status(),
    // 白名单里的每一项此刻对应这台电脑上的哪个软件，以及装了哪些浏览器（它们按站点放行，见 apps.js）
    apps: {
      browsers: apps.detect().browsers.map((b) => b.name),
      allow: apps.describe(store.getSettings().autoRecordAllow ?? apps.defaultAllow()),
      suggested: apps.defaultAllow(),
    },
    extensionDir: extensionDir(),
    setup: setup.status(),
    ocrModels: Object.entries(ocr.PADDLE_MODELS).map(([id, m]) => ({ id, name: m.name, sizeMB: m.sizeMB, langs: m.langs, bundled: !!m.bundled })),
  }));
  ipcMain.handle('ws:save-settings', (_e, patch) => store.updateSettings(patch || {}));
  ipcMain.handle('ws:test-provider', async (_e, override) => {
    try { return await llm.testProvider(llm.config(store, override || {})); } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('ws:provider-status', (_e, opts) => providerStatus(!!(opts && opts.refresh)));
  ipcMain.handle('ws:forget-pending-pull', () => store.updateSettings({ pendingPull: null }));
  ipcMain.handle('ws:openrouter-models', async (_e, opts) => {
    try { return { ok: true, models: await openrouterModels(!!(opts && opts.refresh)) }; } catch (e) { return { ok: false, error: e.message, models: [] }; }
  });
  ipcMain.handle('ws:openrouter-login', async () => {
    const key = await orAuth.login({ strings: { successTitle: t('orLoginTitle'), successBody: t('orLoginBody'), failTitle: t('orLoginFail') } });
    return store.updateSettings({ openrouterKey: key, provider: 'openrouter' });
  });
  ipcMain.handle('ws:openrouter-cancel-login', () => orAuth.cancel());
  ipcMain.handle('ws:anthropic-login', () => launchAnthropicLogin());
  ipcMain.handle('ws:extension-status', () => ({ ...localApi.status(), extensionDir: extensionDir() }));
  ipcMain.handle('ws:open-extension-guide', async () => {
    const api = localApi.status();
    if (!api.running) return { ok: false, error: 'local-api-off' };
    await shell.openExternal(`http://127.0.0.1:${api.port}/install`);
    return { ok: true, url: `http://127.0.0.1:${api.port}/install` };
  });
  ipcMain.handle('ws:open-extension-dir', () => shell.openPath(extensionDir()));
  ipcMain.handle('ws:export-extension', async () => {
    const r = await dialog.showOpenDialog(windows.getWorkspaceWindow() || undefined, { title: t('dialogChooseDir'), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths.length) return null;
    const target = path.join(r.filePaths[0], 'briffy-extension');
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(extensionDir(), target, { recursive: true });
    shell.showItemInFolder(path.join(target, 'manifest.json'));
    return target;
  });
  ipcMain.handle('ws:run-setup', (_e, opts) => setup.run(
    { store, onProgress: (p) => windows.broadcastToWorkspace('ws:setup-progress', p) },
    opts || {},
  ));
  ipcMain.handle('ws:mic-devices', () => askPet('mic-devices', 'list-mics', {}, 10000));
  ipcMain.handle('ws:mic-test', (_e, deviceId) => askPet('mic-test', 'mic-test', { deviceId: deviceId || '', seconds: 2 }, 15000));
  ipcMain.handle('ws:ollama-remove', async (_e, model) => {
    const host = store.getSettings().ollamaHost || ollama.DEFAULT_HOST;
    await ollama.remove(host, model);
    return { ok: true, status: await ollama.status(host) };
  });
  ipcMain.handle('ws:ollama-pull', async (_e, model) => {
    const host = store.getSettings().ollamaHost || ollama.DEFAULT_HOST;
    try {
      // Remember an unfinished pull so a download that was cut off is still visible next launch.
      store.updateSettings({ pendingPull: { model, receivedBytes: 0, totalBytes: 0, at: Date.now() } });
      let lastWrite = 0;
      await ollama.pull(host, model, (p) => {
        windows.broadcastToWorkspace('ws:ollama-pull-progress', { model, ...p });
        const now = Date.now();
        if (p.totalBytes && now - lastWrite > 2000) {
          lastWrite = now;
          store.updateSettings({ pendingPull: { model, receivedBytes: p.receivedBytes, totalBytes: p.totalBytes, at: now } });
        }
      });
      store.updateSettings({ pendingPull: null });
      return { ok: true, status: await ollama.status(host) };
    } catch (e) {
      return { ok: false, code: e.code || '', error: e.message };
    }
  });
  ipcMain.handle('ws:ollama-install', async () => {
    const r = await ollama.install((p) => windows.broadcastToWorkspace('ws:ollama-install-progress', p));
    if (r.manual || !r.ok) return r;
    const host = store.getSettings().ollamaHost || ollama.DEFAULT_HOST;
    const started = await ollama.startServer(host);          // the Windows installer usually starts it already
    return { ...r, started: started.ok, status: await ollama.status(host) };
  });
  ipcMain.handle('ws:ollama-start', async () => {
    const host = store.getSettings().ollamaHost || ollama.DEFAULT_HOST;
    const r = await ollama.startServer(host);
    return { ...r, status: await ollama.status(host) };
  });
  // ffmpeg is what joins a segmented stream back into one file. Never bundled, never fetched as a loose
  // binary: found on the machine, or installed through the platform's own package manager.
  ipcMain.handle('ws:ffmpeg-status', async (_e, opts) => {
    const found = await ffmpegTool.find({ refresh: !!(opts && opts.refresh) });
    return { installed: !!found, ...(found || {}), url: ffmpegTool.DOWNLOAD_URL };
  });
  ipcMain.handle('ws:ffmpeg-install', () => ffmpegTool.install(
    (line) => windows.broadcastToWorkspace('ws:ffmpeg-install-progress', { line }),
  ));
  // ---------- first run ----------
  ipcMain.handle('ob:meta', () => {
    const s = store.getSettings();
    return {
      ui: uiLanguage(s.languages),
      languages: LANGUAGES,
      languages0: s.languages[0],
      languages1: s.languages[1],
    };
  });
  ipcMain.handle('ob:permissions', () => permissions.status());
  ipcMain.handle('ob:grant', (_e, which) => (which === 'mic' ? permissions.askMic() : permissions.askScreen()));
  ipcMain.handle('ob:save', (_e, patch) => store.updateSettings(patch || {}));
  ipcMain.handle('ob:run-setup', () => setup.run(
    { store, onProgress: (p) => windows.broadcastToOnboarding('ob:setup-progress', p) },
    {},
  ));
  ipcMain.handle('ob:summary', () => {
    const cfg = llm.config(store);
    return { configured: llm.isConfigured(cfg), label: llm.label(cfg) };
  });
  ipcMain.handle('ob:finish', (_e, provider) => {
    store.updateSettings({ setupDone: true });
    windows.closeOnboarding();
    // Land wherever the answer to "who reads these" still needs finishing.
    if (provider && provider !== 'ollama') windows.openWorkspace('settings');
    else if (provider === 'ollama') windows.openWorkspace('settings');
    return { ok: true };
  });

  ipcMain.handle('ws:choose-dir', async () => {
    const r = await dialog.showOpenDialog(windows.getWorkspaceWindow() || undefined, { title: t('dialogChooseDir'), properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('ws:list-dates', () => store.listDates());
  ipcMain.handle('ws:list-entries', (_e, opts) => store.listEntries(opts || {}).map(publicEntry));
  ipcMain.handle('ws:get-entry', (_e, id) => publicEntry(store.getEntry(id)));
  ipcMain.handle('ws:delete-entry', (_e, id) => store.deleteEntry(id));
  ipcMain.handle('ws:retry-entry', (_e, id) => workspace.retry(id));
  ipcMain.handle('ws:update-entry', (_e, id, patch) => {
    const allowed = {};
    for (const k of ['title', 'text', 'summary']) if (patch && k in patch) allowed[k] = patch[k];
    // Pinning and the one-line note are the user's own marks on a record: the only two fields nothing
    // else in the app ever writes, so a reprocess or a language change cannot overwrite them.
    if (patch && 'pinned' in patch) allowed.pinned = !!patch.pinned;
    if (patch && 'note' in patch) allowed.note = String(patch.note || '').slice(0, 500);
    return publicEntry(store.updateEntry(id, allowed));
  });
  ipcMain.handle('ws:open-entry', (_e, id) => { const e = store.getEntry(id); return e && e.path ? shell.openPath(store.absPath(e.path)) : ''; });
  ipcMain.handle('ws:reveal-entry', (_e, id) => { const e = store.getEntry(id); if (e && e.path) shell.showItemInFolder(store.absPath(e.path)); });
  ipcMain.handle('ws:open-external', (_e, url) => { if (/^https?:\/\//i.test(url || '')) return shell.openExternal(url); });
  ipcMain.handle('ws:open-workspace-dir', () => shell.openPath(store.workspaceDir));
  ipcMain.handle('ws:add-files', () => addFilesDialog());
  ipcMain.handle('ws:add-url', (_e, url) => workspace.ingestUrl(url).then(publicEntry));
  ipcMain.handle('ws:add-note', (_e, text) => workspace.ingestNote(text).then(publicEntry));
  ipcMain.handle('ws:capture', () => workspace.captureScreenshot().then(publicEntry));
  ipcMain.handle('ws:capture-region', () => workspace.captureRegion().then(publicEntry));
  ipcMain.handle('ws:list-summaries', () => summary.list());
  ipcMain.handle('ws:get-summary', (_e, dateKey) => summary.get(dateKey));
  ipcMain.handle('ws:generate-summary', (_e, dateKey) => summary.generate(dateKey, { force: true, quiet: true }));
  ipcMain.handle('ws:ask', async (_e, question) => {
    const r = await ask.run(question);
    return r ? { ...r, sources: r.sources.map(publicEntry) } : null;
  });
  // 接进来的东西：Notion、Gmail。凭据只往里走，list() 不会把它们带出来。
  ipcMain.handle('ws:connect-list', () => connect.list());
  ipcMain.handle('ws:connect-set', (_e, name, creds) => connect.connect(String(name || ''), creds || {}));
  ipcMain.handle('ws:connect-drop', (_e, name) => connect.disconnect(String(name || '')));
  ipcMain.handle('ws:connect-sync', async (_e, name, opts) => {
    try { return { ok: true, ...(await connect.sync(String(name || ''), opts || {})) }; }
    catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
  // 另一条路：不填任何凭据，直接把导出文件收进来。Notion 的 zip、Gmail Takeout 的 mbox、
  // 或者一个文件夹。macOS 允许一个对话框同时选文件和文件夹，所以这里只有一个按钮。
  ipcMain.handle('ws:import-pick', async () => {
    const parent = windows.getWorkspaceWindow() || undefined;
    const r = await dialog.showOpenDialog(parent, {
      title: t('dialogImport'),
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [{ name: 'Notion / Gmail', extensions: ['zip', 'mbox'] }],
    });
    if (r.canceled || !r.filePaths.length) return { ok: true, cancelled: true };
    try { return { ok: true, ...(await connect.importFiles(r.filePaths)) }; }
    catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
  // 搜索框里那些「意思相近」的。空手回来是正常的：模型没下好、这台机器跑不动、
  // 向量还没补齐——搜索框的精确匹配那一半不受任何影响。
  ipcMain.handle('ws:search-near', async (_e, q, exclude) => {
    try {
      const ids = await ask.near(String(q || ''), { exclude: Array.isArray(exclude) ? exclude : [] });
      return ids.map((id) => store.getEntry(id)).filter(Boolean).map(publicEntry);
    } catch (_) { return []; }
  });
  // 主题：讲同一件事的记录归成的堆。空手是正常的——向量还没补齐，或者这个工作区还没有成堆的东西。
  ipcMain.handle('ws:topics', () => ask.topicList());
  ipcMain.handle('ws:topic-entries', (_e, id) => ask.topicEntries(id).map((i) => store.getEntry(i)).filter(Boolean).map(publicEntry));
  // 不用动手存的那一层：一天的痕迹和各应用待了多久。空手是正常的——这个功能默认关着。
  ipcMain.handle('ws:trail', (_e, day) => trail.read(String(day || require('./store').localDateKey())));
  ipcMain.handle('ws:trail-days', () => trail.days());
  // 和这一条讲同一件事的那几条。当场算，不存图——存下来只会多一个会过期的东西。
  // 问过的那些对话。一条一个文件，和天文件同一个做法——追加一轮只重写那一个。
  ipcMain.handle('ws:chats', () => chats.list());
  ipcMain.handle('ws:chat', (_e, id) => chats.read(id));
  ipcMain.handle('ws:chat-append', (_e, id, turn) => chats.append(String(id || ''), turn || {}));
  ipcMain.handle('ws:chat-rename', (_e, id, title) => chats.rename(String(id || ''), String(title || '')));
  ipcMain.handle('ws:chat-remove', (_e, id) => chats.remove(String(id || '')));
  ipcMain.handle('ws:related', (_e, id) => ask.relatedTo(id).map((i) => store.getEntry(i)).filter(Boolean).map(publicEntry));
  // 这一条身上挂着的全部边。三种边分开给，各自带着自己的来路——绝不合成一个「相关度」。
  ipcMain.handle('ws:links', (_e, id) => {
    const l = ask.linksOf(id);
    const many = (ids) => ids.map((i) => store.getEntry(i)).filter(Boolean).map(publicEntry);
    return {
      source: l.source ? { ...l.source, entry: l.source.page ? publicEntry(store.getEntry(l.source.page)) : null } : null,
      clips: many(l.clips),
      run: many(l.run),
      near: many(l.near),
    };
  });
  // 一条记录周围两跳的图。节点连同记录本身一起给，省得渲染层再问一遍。
  ipcMain.handle('ws:graph', (_e, id) => {
    const g = ask.graphOf(id);
    return {
      edges: g.edges,
      nodes: g.nodes.map((n) => {
        const e = store.getEntry(n.id);
        return e ? { ...publicEntry(e), hop: n.hop } : null;
      }).filter(Boolean),
    };
  });
  ipcMain.handle('ws:trail-sessions', (_e, day) => trail.sessions(String(day || require('./store').localDateKey())));
  ipcMain.handle('ws:trail-spans', (_e, day) => trail.spans(String(day || require('./store').localDateKey())));
  ipcMain.handle('ws:stats', () => store.stats());
  // Where each line of recognised text sits on a picture; read only when a detail view opens.
  ipcMain.handle('ws:open-viewer', (_e, id) => { viewer.open(id); return true; });
  ipcMain.handle('ws:entry-boxes', (_e, id) => ocrBoxes.load(store.getEntry(id)));
  // What one day holds, by counting. Also says whether briffy was even running that day.
  ipcMain.handle('ws:day-stats', (_e, dateKey) => {
    const key = dateKey || require('./store').localDateKey();
    return dayStats.stats(store.entriesForDate(key), { uptime: uptime.forDate(key) });
  });
  ipcMain.handle('ws:context-probe', () => foreground.probe());
  ipcMain.handle('ws:entry-link', (_e, id) => (store.getEntry(id) ? deeplink.linkTo.entry(id) : ''));
}
