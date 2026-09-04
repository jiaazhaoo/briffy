'use strict';
// Application entry point: lifecycle, tray, global shortcut and every IPC handler.
const {
  app, Tray, Menu, nativeImage, globalShortcut, ipcMain, dialog, shell, Notification, session, systemPreferences,
} = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { Store, localDateKey, addDays } = require('./store');
const windows = require('./windows');
const petskin = require('./petskin');
const workspace = require('./workspace');
const summary = require('./summary');
const ai = require('./ai');
const llm = require('./llm');
const hardware = require('./hardware');
const ollama = require('./ollama');
const oai = require('./openai-compat');
const orAuth = require('./openrouter-auth');
const clipboardWatch = require('./clipboard-watch');
const localApi = require('./local-api');
const region = require('./region');
const setup = require('./setup');
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

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => windows.openWorkspace());
  app.whenReady().then(main).catch((e) => { console.error(e); dialog.showErrorBox('DailyLogs', String(e && e.stack || e)); });
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
  const out = { ...entry, absPath: abs, fileUrl: abs ? pathToFileURL(abs).href : '' };
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
  windows.init({ store });
  workspace.init({ store, windows });
  summary.init({ store, windows, notify });
  if (process.platform === 'win32') app.setAppUserModelId('com.dailylogs.app');
  // Keep the default macOS application menu (Cmd+C/V/Q); Windows/Linux windows need no menu bar at all.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['media', 'audioCapture', 'notifications', 'clipboard-read', 'clipboard-sanitized-write'].includes(permission));
  });

  region.init();
  windows.createBubbleWindow();
  windows.createPetWindow();
  createTray();
  registerHotkeys();
  setupIpc();
  summary.start();
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
    if (!changed.length || changed.every((k) => k === 'petPosition')) return; // dragging the cat is not a settings change
    i18n.setLanguage(uiLanguage(after.languages));
    if (changed.some((k) => k.startsWith('hotkey'))) { registerHotkeys(); rebuildTray(); }
    if (changed.includes('micDeviceId')) windows.sendPetCommand('config', { micDeviceId: after.micDeviceId || '' });
    if (changed.includes('clipboardWatch')) { syncClipboardWatch(); rebuildTray(); }
    if (changed.includes('localApi') || changed.includes('localApiPort')) syncLocalApi();
    if (changed.some((k) => ['languages', 'petHidden'].includes(k))) rebuildTray();
    windows.broadcastToWorkspace('ws:settings', store.getPublicSettings());
  });

  app.on('window-all-closed', () => { /* stay alive in the tray */ });
  app.on('activate', () => { if (!windows.getPetWindow()) windows.createPetWindow(); windows.openWorkspace('entries'); });
  app.on('before-quit', () => { store.flushAll(); globalShortcut.unregisterAll(); clipboardWatch.stop(); localApi.stop(); });
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
    const overlays = require('electron').BrowserWindow.getAllWindows().filter((w) => w.frozen);
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
    const overlays = require('electron').BrowserWindow.getAllWindows().filter((w) => w.frozen);
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
  } else if (!['summary', 'bench-region'].includes(mode)) {
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
    clipboardWatch.start({
      store, workspace,
      onCapture: (kind, payload) => {
        if (kind === 'text') windows.setPetState('success', { message: t('clipSavedText', { text: String(payload).replace(/\s+/g, ' ').slice(0, 40) }), ms: 2500 });
        else if (kind === 'image') windows.setPetState('success', { message: t('clipSavedImage'), ms: 2500 });
        else if (kind === 'files') windows.setPetState('success', { message: t('clipSavedFiles', { n: payload.length }), ms: 2500 });
      },
    });
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
        // only speak up when there is real work (a download), not for an already-ready machine
        if (first && p.current && !announced) { announced = true; windows.setPetState('processing', { message: t('autoSetupRunning'), sticky: true }); }
      },
    }, { installOllama: false });
    if (announced && result && result.ok) {
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
    workspace,
    installPage: () => installPage({ lang: i18n.getLanguage(), extensionDir: extensionDir(), browser: defaultBrowser() }),
    onExtension: (ext) => {
      console.log(`[extension] connected, version ${ext.version}`);
      windows.broadcastToWorkspace('ws:extension', localApi.extensionStatus());
    },
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
    { label: t('menuAddFiles'), click: () => addFilesDialog() },
    { label: t('traySummary'), click: () => summary.generate(addDays(localDateKey(), -1), { force: true }).then((r) => { if (r) windows.openWorkspace('summaries', r.dateKey); }).catch(() => {}) },
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
    tray.setToolTip('DailyLogs');
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
      spawn('cmd.exe', ['/c', 'start', '"DailyLogs – ant auth login"', 'cmd', '/k', command], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
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
    const timer = setTimeout(() => { pending.delete(key); reject(new Error('The cat window did not answer in time')); }, timeoutMs);
    pending.set(key, { resolve: (v) => { clearTimeout(timer); pending.delete(key); resolve(v); }, reject: (e) => { clearTimeout(timer); pending.delete(key); reject(e); } });
    if (!windows.getPetWindow()) { pending.get(key).reject(new Error('The cat window is not open')); return; }
    windows.sendPetCommand(cmd, payload);
  });
}
function resolvePending(key, value) { const p = pending.get(key); if (p) p.resolve(value); }

// ---------- IPC ----------
function setupIpc() {
  // --- pet ---
  ipcMain.on('pet:region', () => { workspace.captureRegion().catch(() => {}); });
  ipcMain.on('pet:click', () => {
    if (windows.getState() === 'summary') windows.openWorkspace('summaries', addDays(localDateKey(), -1));
    else workspace.captureScreenshot().catch(() => {});
  });
  ipcMain.on('pet:drag-start', (_e, p) => windows.dragStart(p));
  ipcMain.on('pet:drag-move', (_e, p) => windows.dragMove(p));
  ipcMain.on('pet:drag-end', () => windows.dragEnd());
  ipcMain.on('pet:context-menu', () => {
    const template = menuTemplate({ includePetToggle: false });
    template.splice(template.length - 1, 0, { label: t('trayHidePet'), click: () => { windows.setPetHidden(true); rebuildTray(); } });
    Menu.buildFromTemplate(template).popup({ window: windows.getPetWindow() });
  });
  ipcMain.handle('pet:drop', (_e, payload) => workspace.ingestDrop(payload || {}).then((r) => r.map(publicEntry)));
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
  ipcMain.handle('pet:get-config', () => ({ micDeviceId: store.getSettings().micDeviceId || '', avatarUrl: petskin.url(store) }));
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
    extensionDir: extensionDir(),
    setup: setup.status(),
    ocrModels: Object.entries(ocr.PADDLE_MODELS).map(([id, m]) => ({ id, name: m.name, sizeMB: m.sizeMB, langs: m.langs, bundled: !!m.bundled })),
  }));
  ipcMain.handle('ws:save-settings', (_e, patch) => store.updateSettings(patch || {}));
  ipcMain.handle('ws:pet-catalog', () => petskin.catalogue(store));
  ipcMain.handle('ws:pet-set-avatar', async (_e, key) => {
    try {
      const picked = key ? await petskin.apply(store, key) : (petskin.reset(store), { key: '' });
      const avatarUrl = petskin.url(store);
      windows.sendPetCommand('config', { avatarUrl });
      return { ok: true, avatarUrl, ...picked };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('ws:test-provider', async (_e, override) => {
    try { return await llm.testProvider(llm.config(store, override || {})); } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('ws:provider-status', (_e, opts) => providerStatus(!!(opts && opts.refresh)));
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
    const target = path.join(r.filePaths[0], 'dailylogs-extension');
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
  ipcMain.handle('ws:ollama-pull', async (_e, model) => {
    const host = store.getSettings().ollamaHost || ollama.DEFAULT_HOST;
    try {
      await ollama.pull(host, model, (p) => windows.broadcastToWorkspace('ws:ollama-pull-progress', { model, ...p }));
      return { ok: true, status: await ollama.status(host) };
    } catch (e) {
      return { ok: false, code: e.code || '', error: e.message };
    }
  });
  ipcMain.handle('ws:ollama-install', async () => {
    const r = await ollama.install((line) => windows.broadcastToWorkspace('ws:ollama-install-progress', { line }));
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
    for (const k of ['title', 'tags', 'text', 'summary']) if (patch && k in patch) allowed[k] = patch[k];
    if (Array.isArray(allowed.tags)) allowed.tags = allowed.tags.map((x) => String(x).trim()).filter(Boolean).slice(0, 5);
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
  ipcMain.handle('ws:stats', () => store.stats());
}
