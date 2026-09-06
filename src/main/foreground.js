'use strict';
// Who was in front when this was saved.
//
// briffy records what you chose to keep, not everything that crossed the screen. But a record with no
// idea where it came from loses half of what it meant: a screenshot is "from which chat", a copied
// passage is "from which article". So at the moment of a save the app asks three cheap questions --
// which app is frontmost, what its window is called, and which page a browser is showing.
//
// The costs are measured on this machine, and they decide the design:
//
//   app name + bundle id   `lsappinfo`        ~11 ms   no permission of any kind
//   window title           System Events     ~490 ms   needs Accessibility
//   browser URL            AppleScript         never   opens a permission dialog and BLOCKS until it
//                                                      is answered -- measured: the call never
//                                                      returned. A capture must never wait on that.
//
// Hence: the app name is read inline; the window title is read off the hot path (the entry is filed
// first and patched when the answer arrives, so a save is never slower); and the URL is not asked for
// at all -- the browser extension pushes it, because it already talks to the local API and knows the
// answer for free. `noteTab` is that inbox, a single slot held in memory and never written to disk
// except as part of a record the user chose to keep.
const { execFile } = require('child_process');

const MAC = process.platform === 'darwin';
const TITLE_TIMEOUT_MS = 1500;    // long enough for a cold osascript, short enough to never be felt
const TAB_FRESH_MS = 30 * 1000;   // a tab older than this is not evidence of what is on screen now
const BACKOFF_MS = 10 * 60 * 1000; // after repeated failures (usually a refused permission), stop asking
const FAILURES_BEFORE_BACKOFF = 3;

// Our own windows are not a source. Electron is what the app is called in development.
const SELF = new Set(['briffy', 'DailyLogs', 'Electron']);
const SELF_BUNDLES = new Set(['com.jiazhao.briffy', 'com.github.Electron']);

// Browsers put the page title in the window title and the real address is only known to the extension.
const BROWSER_BUNDLES = new Set([
  'com.google.Chrome', 'com.google.Chrome.canary', 'com.google.Chrome.beta',
  'com.apple.Safari', 'com.apple.SafariTechnologyPreview',
  'com.microsoft.edgemac', 'com.brave.Browser', 'com.vivaldi.Vivaldi', 'com.operasoftware.Opera',
  'company.thebrowser.Browser', 'org.mozilla.firefox', 'ai.perplexity.comet',
]);

let enabled = true;           // settings.recordContext
let titleFailures = 0;
let quietUntil = 0;
let lastTab = null;           // { url, title, at } -- memory only, replaced each time
let cached = null;            // { at, value } -- one read serves a burst of ingests

function setEnabled(on) { enabled = on !== false; }
function isEnabled() { return enabled; }

/** The extension reports the tab it is showing. Kept in memory only; one slot, no history. */
function noteTab(tab) {
  const url = String((tab && tab.url) || '').trim();
  if (!/^https?:\/\//i.test(url)) return;
  lastTab = { url, title: String((tab && tab.title) || '').trim().slice(0, 300), at: Date.now() };
}
function forgetTab() { lastTab = null; }
/** 扩展最近报上来的那个标签页，够新才算数。自动录音的白名单用它按站点放行浏览器。 */
function currentTab() {
  return (lastTab && Date.now() - lastTab.at < TAB_FRESH_MS) ? { ...lastTab } : null;
}

function run(cmd, args, timeout) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, killSignal: 'SIGKILL', maxBuffer: 1 << 20 }, (err, stdout) => {
      resolve(err ? null : String(stdout || ''));
    });
  });
}

/** `lsappinfo` speaks in quoted key=value pairs: "LSDisplayName"="Google Chrome". */
function lsValue(out, key) {
  const m = new RegExp(`"${key}"\\s*=\\s*"([^"]*)"`).exec(out || '');
  return m ? m[1] : '';
}

async function frontApp() {
  if (!MAC) return null;
  const asn = (await run('lsappinfo', ['front'], 600) || '').trim();
  if (!asn) return null;
  const info = await run('lsappinfo', ['info', '-only', 'name,bundleID', asn], 600);
  if (!info) return null;
  const app = lsValue(info, 'LSDisplayName');
  const bundleId = lsValue(info, 'CFBundleIdentifier');
  return app ? { app, bundleId } : null;
}

// One AppleScript for the frontmost process and its window, so a title costs one round trip. It fails
// -- silently, by design -- when Accessibility has not been granted; three failures and it stops asking
// for ten minutes, because a refused permission would otherwise cost 1.5 s on every single save.
const TITLE_SCRIPT = `tell application "System Events"
  set p to first application process whose frontmost is true
  set out to name of p
  try
    set out to out & linefeed & (name of front window of p)
  end try
  return out
end tell`;

async function frontWindow() {
  if (!MAC || Date.now() < quietUntil) return '';
  const out = await run('osascript', ['-e', TITLE_SCRIPT], TITLE_TIMEOUT_MS);
  if (out === null) {
    if (++titleFailures >= FAILURES_BEFORE_BACKOFF) { quietUntil = Date.now() + BACKOFF_MS; titleFailures = 0; }
    return '';
  }
  titleFailures = 0;
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length > 1 ? lines.slice(1).join(' ') : '';
}

/**
 * A browser writes its own name into the window title ("bilibili - Google Chrome"); the page is the
 * part in front of it. Firefox uses an em dash, Safari uses nothing at all.
 */
function trimWindowTitle(title, app) {
  let s = String(title || '').trim();
  if (!s || !app) return s;
  const tail = new RegExp(`\\s*[-–—―|]\\s*${app.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
  s = s.replace(tail, '').trim();
  // A window called only "Google Chrome" is a browser with nothing open worth naming. The app field
  // already says that, so repeating it as the window would be noise on every record.
  if (s.toLowerCase() === app.toLowerCase()) return '';
  return s;
}

/**
 * Where the user was when they saved something.
 * @param {{title?:boolean, maxAgeMs?:number}} opts
 * @returns {Promise<{app:string, bundleId?:string, window?:string, url?:string}|null>} null when the
 *   answer is briffy itself, when the feature is off, or when the platform cannot say.
 */
async function read({ title = true, maxAgeMs = 700 } = {}) {
  if (!enabled || !MAC) return null;
  if (cached && Date.now() - cached.at < maxAgeMs) return cached.value;

  const front = await frontApp();
  if (!front) return null;
  if (SELF.has(front.app) || SELF_BUNDLES.has(front.bundleId)) { cached = { at: Date.now(), value: null }; return null; }

  const ctx = { app: front.app };
  if (front.bundleId) ctx.bundleId = front.bundleId;

  if (BROWSER_BUNDLES.has(front.bundleId) && lastTab && Date.now() - lastTab.at < TAB_FRESH_MS) {
    ctx.url = lastTab.url;
    if (lastTab.title) ctx.window = lastTab.title;
  }
  if (title && !ctx.window) {
    const w = trimWindowTitle(await frontWindow(), front.app);
    if (w) ctx.window = w.slice(0, 300);
  }
  cached = { at: Date.now(), value: ctx };
  return ctx;
}

/**
 * Reads the context without blocking the caller, then hands it over. Ingestion uses this so that a
 * save is never slower than it was: the record is filed at once and gains its context a moment later.
 * @param {(ctx:object)=>void} then
 */
function readInto(then, opts) {
  if (!enabled || !MAC) return;
  read(opts).then((ctx) => { if (ctx && ctx.app) { try { then(ctx); } catch (_) { /* the entry may be gone */ } } })
    .catch(() => { /* context is a bonus, never a failure */ });
}

/** For the settings page: says what this machine can actually answer, and triggers the permission ask. */
async function probe() {
  if (!MAC) return { ok: false, app: '', window: '', reason: 'platform' };
  quietUntil = 0; titleFailures = 0; cached = null;
  const front = await frontApp();
  if (!front) return { ok: false, app: '', window: '', reason: 'lsappinfo' };
  const window = trimWindowTitle(await frontWindow(), front.app);
  return { ok: true, app: front.app, window, tab: lastTab ? lastTab.url : '', reason: window ? '' : 'accessibility' };
}

module.exports = { read, readInto, noteTab, forgetTab, currentTab, setEnabled, isEnabled, probe, trimWindowTitle, BROWSER_BUNDLES };
