'use strict';
// Persistence: settings (userData/settings.json) and workspace entries (one JSON file per day).
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 内存里最多留几天的记录。40 天覆盖得住翻看和搜索的实际范围，再往前的重新读一次文件也就几毫秒。
const MAX_DAYS_CACHED = 40;
const EventEmitter = require('events');

const DEFAULT_SETTINGS = {
  languages: ['en', 'zh-Hans'],   // exactly two language packs; the first drives the interface and the daily summary
  // three shortcuts, one per action (Electron accelerator syntax)
  hotkeyRegion: process.platform === 'darwin' ? 'Cmd+Shift+A' : 'Ctrl+Alt+A',   // drag a box, like other screenshot tools
  hotkeyScreen: process.platform === 'darwin' ? 'Cmd+Shift+S' : 'Ctrl+Alt+S',   // whole screen
  hotkeyVoice: process.platform === 'darwin' ? 'Cmd+Shift+V' : 'Ctrl+Alt+V',    // start / stop recording
  captureToClipboard: true,       // a capture also lands on the system clipboard, ready to paste
  model: 'claude-opus-5',         // Claude model used for tagging + daily summaries
  sttModel: 'Xenova/whisper-tiny.en',  // English model bundled with the app; others download on demand
  // 'packs' = decide between the two chosen language packs, 'auto' = all 99 Whisper languages, or a
  // fixed code. Choosing between two is the reliable one, and two is what the user actually picked.
  sttLanguage: 'packs',
  summaryTime: '08:00',           // when the daily summary for yesterday is produced
  workspaceDir: '',               // '' => <userData>/workspace
  hfMirror: '',                   // e.g. https://hf-mirror.com/ when huggingface.co is unreachable
  petPosition: null,              // {x, y} remembered after dragging
  petHidden: false,
  theme: 'system',                // 'system' | 'light' | 'dark'
  petAvatar: '',                  // catalog key of the picked logo; '' => the bundled avatar
  ocrDroppedImages: true,
  ocrModel: '',                   // '' => decided by the machine probe + language pair
  ocrModelAuto: '',               // the model the app settled on for this machine
  setupDone: false,               // the one-click setup wizard has run at least once
  // Let a small local embedding model choose which of an entry's own words describe it. Off means the
  // words come from counting alone, which is faster but noisier.
  normalizeChineseScript: true,   // unify Whisper's random simplified/traditional output to the selected pack
  micDeviceId: '',                // '' => system default microphone
  micLabel: '',
  // Stamp every record with the app / window / page the user was on when they saved it. Read at save
  // time only -- briffy never watches what is in front of you, see foreground.js.
  recordContext: true,
  // Hold the microphone and file a recording whenever anyone talks. The one thing briffy does
  // without being asked, so it is off until it is turned on. See src/main/listen.js.
  autoRecord: false,
  // 24 小时占着麦克风的东西（系统语音服务、常驻录音器）不算「有人在用麦克风」，
  // 否则自动录音会退回成一直录——正是它要避免的那件事。名字可改。
  autoRecordIgnore: ['corespeechd', 'screenpipe'],
  // 只有这些开着麦克风，才跟着录。
  //
  //   null  没设置过 —— 用这台电脑上**真的装了**的会议软件，加上会议网站。见 src/main/apps.js
  //   []    自己清空了 —— 除了排除的以外都跟着录
  //   非空  就这些
  //
  // 默认不是一串写死的名字，因为那份名单是别人的：对着一台只装了 Zoom 和微信的电脑，Teams、Webex、
  // Slack、飞书、钉钉那十几项永远不会命中，打开设置看到的是一堆没见过的字符串。装了什么就列什么。
  autoRecordAllow: null,
  // 外部服务同步到哪儿了。每个服务一条：{ cursor, lastAt, count, error }。
  // 游标是服务自己的形状——Notion 是分页 cursor，Gmail 是 historyId——所以这里只当作不透明的字符串存。
  connectState: {},

  // Tell voices apart in a recording, and remember them between recordings. Off by default: it fetches
  // about 35 MB of models the first time. See src/main/diarize.js.
  // 默认开着：一段会议录音不分说话人就是一堵墙。它只在这一段录音里编号（说话人 1 / 2 / 3），
  // 不记名字、不跨录音认人。
  diarize: true,
  clipboardWatch: true,           // record everything copied to the clipboard
  clipboardMinChars: 12,          // ignore text shorter than this
  localApi: true,                 // local endpoint the browser extension talks to
  localApiPort: 47831,
  // ---- AI provider ----
  provider: 'anthropic',          // 'anthropic' | 'openrouter' | 'ollama' | 'custom'
  anthropicAuth: 'apiKey',        // 'apiKey' | 'account' (profile created by `ant auth login`)
  openrouterModel: 'anthropic/claude-opus-5',
  ollamaHost: 'http://127.0.0.1:11434',
  ollamaModel: '',                // '' => use the hardware recommendation
  // A pull that was cut off (the app quit, the machine slept). Ollama keeps the blobs it already has
  // and resumes, but nothing said so, and a half-downloaded model was simply invisible.
  pendingPull: null,              // { model, receivedBytes, totalBytes, at }
  customBaseUrl: 'http://127.0.0.1:1234/v1',   // LM Studio default
  customModel: '',
  // secrets: base64 of safeStorage-encrypted value, or plain text when safeStorage is unavailable
  apiKeyEnc: '', apiKeyPlain: '',                 // Anthropic API key
  openrouterKeyEnc: '', openrouterKeyPlain: '',
  customKeyEnc: '', customKeyPlain: '',
};

// secret name -> [encrypted field, plain field, environment variable fallback]
const SECRETS = {
  apiKey: ['apiKeyEnc', 'apiKeyPlain', 'ANTHROPIC_API_KEY'],
  openrouterKey: ['openrouterKeyEnc', 'openrouterKeyPlain', 'OPENROUTER_API_KEY'],
  customKey: ['customKeyEnc', 'customKeyPlain', 'OPENAI_API_KEY'],
  // 外部服务的凭据。和模型的 key 走同一条路：safeStorage 加密，明文字段只在系统钥匙串不可用时兜底。
  notionToken: ['notionTokenEnc', 'notionTokenPlain', 'NOTION_TOKEN'],
  gmailClient: ['gmailClientEnc', 'gmailClientPlain', 'GMAIL_CLIENT'],
  gmailRefresh: ['gmailRefreshEnc', 'gmailRefreshPlain', ''],
};

function pad(n) { return String(n).padStart(2, '0'); }
function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function timeStamp(d = new Date()) {
  return `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
function addDays(dateKey, n) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return localDateKey(dt);
}

// Which capture route an entry came in through. `type` alone cannot say it: a clipboard copy can be
// text, an image or files, and a page grab arrives as images too -- what differs is where it came from.
const SOURCES = ['screenshot', 'clipboard', 'bookmark', 'browser', 'voice', 'other'];
function entrySource(e) {
  if (!e) return 'other';
  if (e.origin === 'clipboard') return 'clipboard';
  if (e.origin === 'bookmark') return 'bookmark';
  if (e.origin === 'browser') return 'browser';
  if (e.origin === 'notion') return 'notion';
  if (e.origin === 'gmail') return 'gmail';
  if (e.type === 'screenshot') return 'screenshot';
  if (e.type === 'audio') return 'voice';
  return 'other';
}

// 站点名。域名本身当标签太长也太技术（space.bilibili.com），而这几个是中文用户天天用的，
// 名字对不上就等于没有这个筛选。表很小，认不出来的就用域名，够用。
const SITES = {
  'xiaohongshu.com': '小红书', 'bilibili.com': '哔哩哔哩', 'weibo.com': '微博', 'zhihu.com': '知乎',
  'douyin.com': '抖音', 'instagram.com': 'Instagram', 'x.com': 'X', 'twitter.com': 'X',
  'youtube.com': 'YouTube', 'github.com': 'GitHub', 'reddit.com': 'Reddit',
  'facebook.com': 'Facebook', 'zoom.us': 'Zoom', 'notion.so': 'Notion', 'claude.ai': 'Claude',
  'mail.google.com': 'Gmail', 'docs.google.com': 'Google Docs',
};
function siteOf(url) {
  try {
    const h = new URL(String(url)).hostname.replace(/^www\./, '');
    if (SITES[h]) return SITES[h];
    const base = h.split('.').slice(-2).join('.');
    return SITES[base] || h;
  } catch (_) { return ''; }
}

// 按**格式**分，不是按「怎么进来的」分。截图和从网页存下来的图都是图片；一条随手记和一封邮件
// 都是文字。「怎么进来的」是另一个维度（entryOrigin），两件事混在一格里就都说不清了。
// mime 是现成的，工作区里 213 条只有 4 条没有；没有的用扩展名兜底。
const FORMAT = [
  [/^image\//, 'image'], [/^audio\//, 'audio'], [/^video\//, 'video'],
  [/pdf/, 'pdf'],
  [/(msword|wordprocessingml|opendocument\.text|rtf)/, 'doc'],
  [/(excel|spreadsheetml|opendocument\.spreadsheet|csv)/, 'sheet'],
  [/(powerpoint|presentationml|opendocument\.presentation)/, 'slides'],
  [/(zip|x-tar|gzip|x-7z|x-rar)/, 'archive'],
  [/uri-list/, 'link'],
  [/^text\//, 'text'],
];
const EXT_FORMAT = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image', '.heic': 'image', '.svg': 'image',
  '.mp3': 'audio', '.wav': 'audio', '.m4a': 'audio', '.webm': 'audio', '.aac': 'audio', '.flac': 'audio',
  '.mp4': 'video', '.mov': 'video', '.mkv': 'video', '.avi': 'video',
  '.pdf': 'pdf', '.doc': 'doc', '.docx': 'doc', '.rtf': 'doc', '.pages': 'doc',
  '.xls': 'sheet', '.xlsx': 'sheet', '.csv': 'sheet', '.numbers': 'sheet',
  '.ppt': 'slides', '.pptx': 'slides', '.key': 'slides',
  '.zip': 'archive', '.tar': 'archive', '.gz': 'archive', '.7z': 'archive', '.rar': 'archive',
  '.txt': 'text', '.md': 'text', '.json': 'text', '.html': 'text',
};

// 浏览器把站名写在窗口标题里：「… - 小红书」「…_哔哩哔哩_bilibili」。没拿到网址的时候，
// 这是唯一还剩下的线索，而且它对 Safari、Firefox 也成立——扩展只在 Chrome 里跑。
// 只认**已知的站名**，不去猜标题的结构：「最后一段是站名」这种规则一遇到「- Google Chrome」
// 「– Audio playing」就会给出垃圾。实测这一条能救回 34 条浏览器记录里的 13 条。
const BROWSER_APP = /chrome|safari|firefox|edge|arc|brave|vivaldi|opera|comet/i;
const SITE_NAMES = [
  ['小红书', '小红书'], ['哔哩哔哩', '哔哩哔哩'], ['bilibili', '哔哩哔哩'], ['知乎', '知乎'], ['微博', '微博'],
  ['抖音', '抖音'], ['youtube', 'YouTube'], ['github', 'GitHub'], ['reddit', 'Reddit'],
  ['instagram', 'Instagram'], ['facebook', 'Facebook'], ['zoom', 'Zoom'], ['notion', 'Notion'],
  ['twitter', 'X'], ['wikipedia', 'Wikipedia'], ['gmail', 'Gmail'], ['淘宝', '淘宝'], ['京东', '京东'],
];
function siteInTitle(title) {
  const w = String(title || '').toLowerCase();
  if (!w) return '';
  for (const [needle, name] of SITE_NAMES) if (w.includes(needle)) return name;
  return '';
}

/** @returns {string} image / text / audio / video / pdf / doc / sheet / slides / archive / link / other */
function entryFormat(e) {
  if (!e) return 'other';
  const mime = String(e.mime || '').split(';')[0].toLowerCase();
  for (const [re, k] of FORMAT) if (re.test(mime)) return k;
  const p = String(e.path || e.originalPath || e.title || '').toLowerCase();
  const dot = p.lastIndexOf('.');
  if (dot > 0) { const k = EXT_FORMAT[p.slice(dot)]; if (k) return k; }
  if (e.type === 'note') return 'text';
  if (e.type === 'url') return 'link';
  return 'other';
}

/**
 * 这条记录**是从哪儿来的**，按能知道的最细一档答：
 *   站点   知道网址就用站点名（小红书、哔哩哔哩、GitHub）
 *   应用   知道当时在哪个应用就用应用名（Claude、Terminal、WeChat）
 *   方式   都不知道，就退回它是怎么进来的（截图、剪贴板、语音）
 *
 * 这和 entrySource 不是一回事：那个只答「怎么进来的」。实测这个工作区 211 条里有 94 条
 * 既没有网址也没有应用（没有前台上下文的笔记和图片），退到方式那一档它们才有归属，
 * 否则近一半的记录会掉进「没有来源」那个格子里，筛选就等于半瞎。
 */
function entryOrigin(e) {
  if (!e) return 'other';
  const c = e.context || {};
  const site = siteOf(e.url || c.url || '');
  if (site) return site;
  const app = String(c.app || '').trim();
  // 浏览器只说明「是个网页」，说不出是哪个站。网址没拿到的时候，窗口标题里往往还写着站名。
  if (BROWSER_APP.test(app)) {
    const named = siteInTitle(c.window);
    if (named) return named;
    return entrySource(e);                     // 连标题都没有，那「怎么进来的」比「某个浏览器」有用
  }
  if (app) return app;
  return entrySource(e);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

class Store extends EventEmitter {
  constructor() {
    super();
    this.settings = null;
    // dateKey -> entries[]。**有上限**：这里装的是整条记录，一天几百条，几年就是整个工作区。
    // 无上限的时候，只要有什么东西把每一天都读一遍（建索引、导出、统计），内存就等于把工作区
    // 复制了一份进来——20 万条实测 215MB，按真实长度外推到 185 万条约 7GB。
    // id -> dateKey 那张表（this.index）留着不动：它每条只有几十字节，而 getEntry 靠它。
    this.days = new Map();
    this.index = new Map();     // entryId -> dateKey
    this.saveTimers = new Map();
  }

  init() {
    this.settings = { ...DEFAULT_SETTINGS, ...readJson(this.settingsFile, {}) };
    if (!Array.isArray(this.settings.languages) || this.settings.languages.length !== 2) {
      this.settings.languages = [...DEFAULT_SETTINGS.languages];
    }
    for (const dir of Object.values(this.paths())) fs.mkdirSync(dir, { recursive: true });
    for (const key of this.listDates()) this.loadDay(key);
  }

  // ---------- paths ----------
  get userData() { return app.getPath('userData'); }
  get settingsFile() { return path.join(this.userData, 'settings.json'); }
  get workspaceDir() {
    return this.settings.workspaceDir || path.join(this.userData, 'workspace');
  }
  paths() {
    const w = this.workspaceDir;
    return {
      workspace: w,
      entries: path.join(w, 'entries'),
      screenshots: path.join(w, 'screenshots'),
      files: path.join(w, 'files'),
      audio: path.join(w, 'audio'),
      summaries: path.join(w, 'summaries'),
      ocr: path.join(w, 'ocr'),          // where each line of recognised text sits, one file per picture
      uptime: path.join(w, 'uptime'),    // which five-minute slots briffy was awake in, one file per day
      models: path.join(this.userData, 'models'),
      ocrModels: path.join(this.userData, 'ocr-models'),
    };
  }
  absPath(rel) { return path.isAbsolute(rel) ? rel : path.join(this.workspaceDir, rel); }
  relPath(abs) { return path.relative(this.workspaceDir, abs).split(path.sep).join('/'); }

  // ---------- settings ----------
  getSettings() { return { ...this.settings }; }

  // Public view for the renderer: never exposes the secrets themselves.
  getPublicSettings() {
    const s = { ...this.settings };
    for (const [name, [enc, plain]] of Object.entries(SECRETS)) {
      delete s[enc]; delete s[plain];
      const v = this.getSecret(name);
      const cap = name.charAt(0).toUpperCase() + name.slice(1);
      s[`has${cap}`] = !!v;
      s[`${name}Hint`] = v ? `${v.slice(0, 7)}…${v.slice(-4)}` : '';
    }
    return s;
  }

  getSecret(name) {
    const spec = SECRETS[name];
    if (!spec) return '';
    const [enc, plain, envVar] = spec;
    try {
      if (this.settings[enc] && safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(this.settings[enc], 'base64'));
      }
    } catch (e) { console.warn(`[store] cannot decrypt ${name}:`, e.message); }
    return this.settings[plain] || (envVar && process.env[envVar]) || '';
  }

  setSecret(name, value) {
    const spec = SECRETS[name];
    if (!spec) return;
    const [enc, plain] = spec;
    value = (value || '').trim();
    if (!value) { this.settings[enc] = ''; this.settings[plain] = ''; return; }
    if (safeStorage.isEncryptionAvailable()) {
      this.settings[enc] = safeStorage.encryptString(value).toString('base64');
      this.settings[plain] = '';
    } else {
      this.settings[plain] = value;
      this.settings[enc] = '';
    }
  }

  getApiKey() { return this.getSecret('apiKey'); }
  setApiKey(key) { this.setSecret('apiKey', key); }

  updateSettings(patch) {
    const before = { ...this.settings };
    const secretFields = new Set(Object.values(SECRETS).flatMap(([enc, plain]) => [enc, plain]));
    for (const [k, v] of Object.entries(patch || {})) {
      if (k in SECRETS) { if (typeof v === 'string') this.setSecret(k, v); continue; }
      if (k in DEFAULT_SETTINGS && !secretFields.has(k)) this.settings[k] = v;
    }
    if (Array.isArray(this.settings.languages)) {
      this.settings.languages = this.settings.languages.slice(0, 2);
      if (this.settings.languages.length < 2) this.settings.languages = [...DEFAULT_SETTINGS.languages];
    }
    writeJsonAtomic(this.settingsFile, this.settings);
    if (before.workspaceDir !== this.settings.workspaceDir) {
      this.days.clear(); this.index.clear();
      for (const dir of Object.values(this.paths())) fs.mkdirSync(dir, { recursive: true });
      for (const key of this.listDates()) this.loadDay(key);
    }
    this.emit('settings', this.settings, before);
    return this.getPublicSettings();
  }

  // ---------- entries ----------
  dayFile(dateKey) { return path.join(this.paths().entries, `${dateKey}.json`); }

  // Days on disk plus days only in memory. A new day's file is not written until the save debounce
  // fires, so reading the directory alone loses the first entries of every day -- including, for a
  // few hundred milliseconds, the one that was just added.
  listDates() {
    const keys = new Set(this.days.keys());
    try {
      for (const f of fs.readdirSync(this.paths().entries)) {
        if (/^\d{4}-\d{2}-\d{2}\.json$/.test(f)) keys.add(f.slice(0, 10));
      }
    } catch (_) { /* no workspace yet */ }
    return [...keys].sort().reverse();
  }

  loadDay(dateKey) {
    if (this.days.has(dateKey)) {
      const hit = this.days.get(dateKey);
      this.days.delete(dateKey); this.days.set(dateKey, hit);   // 用过的挪到末尾，淘汰最久没碰的
      return hit;
    }
    const arr = readJson(this.dayFile(dateKey), []);
    this.days.set(dateKey, arr);
    for (const e of arr) this.index.set(e.id, dateKey);
    this.trimDays();
    return arr;
  }

  /** 只留最近用过的那些天。还有改动没落盘的一天不能扔，扔了就是丢数据。 */
  trimDays() {
    while (this.days.size > MAX_DAYS_CACHED) {
      let dropped = false;
      for (const key of this.days.keys()) {
        if (this.saveTimers.has(key)) continue;       // 还没存，留着
        this.days.delete(key); dropped = true; break;
      }
      if (!dropped) break;                            // 全都在等着存，那就先都留着
    }
  }

  scheduleSave(dateKey) {
    if (this.saveTimers.has(dateKey)) return;
    this.saveTimers.set(dateKey, setTimeout(() => {
      this.saveTimers.delete(dateKey);
      this.saveDay(dateKey);
    }, 250));
  }
  saveDay(dateKey) {
    const arr = this.days.get(dateKey);
    if (!arr) return;
    try { writeJsonAtomic(this.dayFile(dateKey), arr); } catch (e) { console.error('[store] save failed', e); }
  }
  flushAll() {
    for (const [key, t] of this.saveTimers) { clearTimeout(t); this.saveDay(key); }
    this.saveTimers.clear();
  }

  addEntry(partial) {
    const now = new Date();
    const entry = {
      id: crypto.randomUUID(),
      createdAt: now.toISOString(),
      dateKey: localDateKey(now),
      type: 'file',
      title: '',
      path: '',
      mime: '',
      size: 0,
      text: '',
      tags: [],
      summary: '',
      status: 'processing',
      progress: '',
      error: '',
      tagsSource: '',
      ...partial,
    };
    const arr = this.loadDay(entry.dateKey);
    arr.unshift(entry);
    this.index.set(entry.id, entry.dateKey);
    this.scheduleSave(entry.dateKey);
    this.emit('entry', entry, 'add');
    return entry;
  }

  getEntry(id) {
    const key = this.index.get(id);
    if (!key) return null;
    return this.loadDay(key).find((e) => e.id === id) || null;
  }

  updateEntry(id, patch) {
    const entry = this.getEntry(id);
    if (!entry) return null;
    Object.assign(entry, patch, { updatedAt: new Date().toISOString() });
    this.scheduleSave(entry.dateKey);
    this.emit('entry', entry, 'update');
    return entry;
  }

  deleteEntry(id, { removeFile = true } = {}) {
    const entry = this.getEntry(id);
    if (!entry) return false;
    const arr = this.loadDay(entry.dateKey);
    const i = arr.findIndex((e) => e.id === id);
    if (i >= 0) arr.splice(i, 1);
    this.index.delete(id);
    this.scheduleSave(entry.dateKey);
    if (removeFile) {
      for (const rel of [entry.path, entry.wavPath]) {
        if (rel && !entry.linked) { try { fs.rmSync(this.absPath(rel), { force: true }); } catch (_) { /* ignore */ } }
      }
    }
    // The sidecar holding where each line of text sits goes with it, deleted or not.
    if (entry.ocrBoxes) {
      try { fs.rmSync(path.join(this.paths().ocr, entry.dateKey, `${entry.id}.json`), { force: true }); } catch (_) { /* ignore */ }
    }
    this.emit('entry', entry, 'delete');
    return true;
  }

  entriesForDate(dateKey) { return [...this.loadDay(dateKey)]; }

  listEntries({ query = '', dates = null, source = '', sources = null, exclude = null, pinned = false,
    type = '', origin = '', ids = null, limit = 500 } = {}) {
    // 三个维度是**叠**的，不是单选：「小红书上的图片」这种要求只有叠起来才成立。
    const only = Array.isArray(ids) && ids.length ? new Set(ids) : null;
    const want = Array.isArray(sources) && sources.length ? new Set(sources) : (source ? new Set([source]) : null);
    // `exclude` is how "everything" can still leave something out: the clipboard fills up on its own
    // all day, and a page that is nine parts clipboard is not "everything", it is the clipboard.
    const skip = Array.isArray(exclude) && exclude.length ? new Set(exclude) : null;
    const keys = dates || this.listDates();
    const q = query.trim().toLowerCase();
    const out = [];
    for (const key of keys) {
      for (const e of this.loadDay(key)) {
        // filter before the limit, so asking for one source cannot be crowded out by the others
        if (want && !want.has(entrySource(e))) continue;
        if (!want && skip && skip.has(entrySource(e))) continue;
        if (pinned && !e.pinned) continue;
        if (only && !only.has(e.id)) continue;
        if (type && entryFormat(e) !== type) continue;
        if (origin && entryOrigin(e) !== origin) continue;
        if (q) {
          const hay = `${e.title} ${e.tags.join(' ')} ${e.visionLabels || ''} ${e.text} ${e.summary} ${e.path} ${e.note || ''} ${e.context ? `${e.context.app || ''} ${e.context.window || ''} ${e.context.url || ''}` : ''}`.toLowerCase();
          if (!hay.includes(q)) continue;
        }
        out.push(e);
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  /** Everything the user has pinned, newest first. */
  pinnedEntries({ limit = 100 } = {}) {
    const out = [];
    for (const key of this.listDates()) {
      for (const e of this.loadDay(key)) { if (e.pinned) out.push(e); if (out.length >= limit) return out; }
    }
    return out;
  }

  stats() {
    let total = 0;
    let pinned = 0;
    const bySource = Object.fromEntries(SOURCES.map((s) => [s, 0]));
    const byType = {}; const byOrigin = {};
    for (const key of this.listDates()) {
      for (const e of this.loadDay(key)) {
        total++; if (e.pinned) pinned++;
        bySource[entrySource(e)]++;
        const t = entryFormat(e); byType[t] = (byType[t] || 0) + 1;
        const o = entryOrigin(e); byOrigin[o] = (byOrigin[o] || 0) + 1;
      }
    }
    return { days: this.listDates().length, entries: total, pinned, bySource, byType, byOrigin };
  }
}

module.exports = { Store, DEFAULT_SETTINGS, SOURCES, entrySource, entryOrigin, entryFormat, siteOf, siteInTitle, localDateKey, timeStamp, addDays, writeJsonAtomic, readJson };
