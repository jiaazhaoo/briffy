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
  // 每天问四次 GitHub「最新的 tag 是几」。**这是 briffy 唯一一个自己发起的对外请求**——
  // 其余的联网都是你按了什么才发生的。问的时候只拿回一行版本号，下不下载是你点的（516MB，
  // 不替你决定）。关掉之后设置页里那个「检查更新」按钮还在，手动仍然能查。
  autoUpdate: true,
  // Let a small local embedding model choose which of an entry's own words describe it. Off means the
  // words come from counting alone, which is faster but noisier.
  normalizeChineseScript: true,   // unify Whisper's random simplified/traditional output to the selected pack
  micDeviceId: '',                // '' => system default microphone
  micLabel: '',
  // Stamp every record with the app / window / page the user was on when they saved it. Read at save
  // time only -- briffy never watches what is in front of you, see foreground.js.
  recordContext: true,
  // 不用你动手存的那一层：你在哪个应用、哪个窗口、哪个网页，以及网页的正文。
  // **默认关着。** 它记的是你路过的东西，不是你决定留下的东西——briffy 的其余部分是后者，
  // 这一样是另一个承诺，得你自己点开。见 src/main/trail.js。
  recordTrail: false,
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
  // 「全部」那一屏里含不含剪贴板。默认**不含**：它一天到晚自己往里掉，这台机器上 331 条里
  // 262 条是剪贴板（79%），一屏九成是它就不叫「全部」了。要看它就点筛选行上的「剪贴板」那一格。
  // 这条以前是写死在界面里的一句 if，现在是一个开关——关掉它，「全部」就真是全部。
  clipboardInAll: false,
  localApi: true,                 // local endpoint the browser extension talks to
  localApiPort: 47831,
  // ---- AI provider ----
  provider: 'openrouter',         // 'openrouter' | 'ollama'（2026-09-09 从四家收成两家，见 llm.js 顶上）
  // 发给 AI 之前把秘密盖掉（src/main/redact.js）。存下来的记录一个字不动，改的只有发出去的那一份。
  // 'off' 不动 · 'secrets' 密钥·卡号·身份证·写着名字的密码（默认）· 'all' 再加邮箱和手机号
  redact: 'secrets',
  openrouterModel: 'anthropic/claude-opus-5',
  ollamaHost: 'http://127.0.0.1:11434',
  ollamaModel: '',                // '' => use the hardware recommendation
  // 常驻模型：**每一边最多三个**（2026-09-09 用户定的）。输入框旁边那只托盘列的就是它们，
  // 一边一组。「在用的是哪一个」仍然是 provider + ollamaModel / openrouterModel 那一对，
  // 而它必须是自己这一边常驻里的一个——架子上没有的东西不能正在用。
  // 空数组 = 从没设过：界面把「在用的那一个」当作架子上唯一的一件，老设置升上来不会看见一个空架子。
  ollamaResident: [],
  openrouterResident: [],
  // A pull that was cut off (the app quit, the machine slept). Ollama keeps the blobs it already has
  // and resumes, but nothing said so, and a half-downloaded model was simply invisible.
  pendingPull: null,              // { model, receivedBytes, totalBytes, at }
  // secrets: base64 of safeStorage-encrypted value, or plain text when safeStorage is unavailable
  openrouterKeyEnc: '', openrouterKeyPlain: '',
};

// secret name -> [encrypted field, plain field, environment variable fallback]
const SECRETS = {
  openrouterKey: ['openrouterKeyEnc', 'openrouterKeyPlain', 'OPENROUTER_API_KEY'],
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

// 一条记录是什么（怎么进来的 / 什么格式 / 从哪儿来 / 落在哪一格纸上）**搬去了 classify.js**。
// 搬的理由：mcp/briffy-mcp.js 要用同一套判据，而它跑在纯 node 里（这个文件的 paths() 会问
// electron 要 userData，它 require 不动）。判据抄第二份就会漂，今天刚为这件事修过一次。
// 这儿照原样再导出一遍，所以别的地方 require('./store') 拿它们的写法都不用改。
const {
  SOURCES, BUCKETS, UNKNOWN,
  entrySource, entryFormat, entryOrigin, entryBucket, entrySub, fileKind,
  siteOf, baseHost, siteInTitle,
} = require('./classify');
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
      thumbs: path.join(w, 'thumbs'),    // 拖进来的文件长什么样，一份文件一张（thumb.js）
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
      try { fs.rmSync(path.join(this.paths().thumbs, entry.dateKey, `${entry.id}.jpg`), { force: true }); } catch (_) { /* ignore */ }
    }
    this.emit('entry', entry, 'delete');
    return true;
  }

  entriesForDate(dateKey) { return [...this.loadDay(dateKey)]; }

  /**
   * 一条记录过不过这套条件。
   *
   * **listEntries 和 stats 用的是同一个它**，这不是省几行，是这个筛选器唯一的正确性保证：
   * 「筛出什么」和「数出几条」一旦分成两段代码，就一定会各走各的。2026-09-09 之前正是这样——
   * 界面上「全部」偷偷扣掉了剪贴板（329 条里 260 条是剪贴板），而数数那一路（stats）不知道
   * 有这回事，它数的是全库：筛选行上写着「文字 203」，屏幕上摆着 19 条。
   * 一个筛选器的全部本事就是「点下去之后屏上剩什么」，数错了它就什么都不是。
   *
   * @param {object} e
   * @param {{q?:string, want?:Set|null, skip?:Set|null, pinned?:boolean, only?:Set|null,
   *          type?:string, origin?:string, bucket?:string, sub?:string, hideInAll?:Set|null}} f
   *   都已经预处理成 Set / 小写，逐条调不再重算
   */
  entryMatches(e, { q = '', want = null, skip = null, pinned = false, only = null,
    type = '', origin = '', bucket = '', sub = '', hideInAll = null } = {}) {
    if (want && !want.has(entrySource(e))) return false;
    if (!want && skip && skip.has(entrySource(e))) return false;
    if (pinned && !e.pinned) return false;
    if (only && !only.has(e.id)) return false;
    // 一级：选了哪一格就只看哪一格；**没选**（＝「全部」）的时候，hideInAll 里那几格不算进来。
    // 它只能是有条件的：点了「剪贴板」那一格就必须看得见剪贴板，一条无条件的排除做不到这件事。
    if (bucket) { if (entryBucket(e) !== bucket) return false; } else if (hideInAll && hideInAll.has(entryBucket(e))) return false;
    if (sub && entrySub(e) !== sub) return false;
    if (type && entryFormat(e) !== type) return false;
    if (origin && entryOrigin(e) !== origin) return false;
    if (q) {
      const hay = `${e.title} ${e.tags.join(' ')} ${e.visionLabels || ''} ${e.text} ${e.summary} ${e.path} ${e.note || ''} ${e.context ? `${e.context.app || ''} ${e.context.window || ''} ${e.context.url || ''}` : ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  listEntries({ query = '', dates = null, source = '', sources = null, exclude = null, pinned = false,
    type = '', origin = '', bucket = '', sub = '', hideInAll = null, ids = null, limit = 500 } = {}) {
    // 三个维度是**叠**的，不是单选：「小红书上的图片」这种要求只有叠起来才成立。
    const only = Array.isArray(ids) && ids.length ? new Set(ids) : null;
    const want = Array.isArray(sources) && sources.length ? new Set(sources) : (source ? new Set([source]) : null);
    // `exclude` is how "everything" can still leave something out: the clipboard fills up on its own
    // all day, and a page that is nine parts clipboard is not "everything", it is the clipboard.
    const skip = Array.isArray(exclude) && exclude.length ? new Set(exclude) : null;
    const keys = dates || this.listDates();
    const f = { q: query.trim().toLowerCase(), want, skip, pinned, only, type, origin, bucket, sub,
      hideInAll: Array.isArray(hideInAll) && hideInAll.length ? new Set(hideInAll) : null };
    const out = [];
    for (const key of keys) {
      for (const e of this.loadDay(key)) {
        // filter before the limit, so asking for one source cannot be crowded out by the others
        if (!this.entryMatches(e, f)) continue;
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

  /**
   * 数数。**给它和 listEntries 同一套条件，它数的就是屏幕上会有几条。**
   *
   * 每一档都**放开自己那一维、照筛另外两维**——所以筛选行上每个词后面那个数，
   * 就是「点它之后屏上真会剩几条」，不是「全库里有几条」。这两个数在这个工作区里
   * 差了十倍（文字：全库 203，默认那一屏 19），而用户读的是前一个、看的是后一个。
   *
   * 不给条件就是全库，和以前一字不差——main.js 里那处 `store.stats()` 不用改。
   *
   * @param {{query?:string, dates?:string[]|null, type?:string, origin?:string,
   *          bucket?:string, sub?:string, exclude?:string[]|null}} f
   * @returns {object} 除了原来那几项，多四样：
   *   byDay    放开日期：每一天在别的条件下还剩几条（时间那一排的数从这儿加出来）
   *   byBucket 放开一级（连带二级、也连带 hideInAll——那条规矩本身就属于一级这一维）：
   *            一级那一排上每一格的数。点「剪贴板」会出来 262 条，那一格就得写 262
   *   allCount 「全部」那一格的数。**它不等于 byBucket 之和**——点「全部」等于回到「没选一级」，
   *            hideInAll 那条规矩就又生效了，差的正好是被挡住的那些。这个差本身是有用的：
   *            「全部 69 · 剪贴板 262」一眼就说明了「全部」里没有剪贴板
   *   bySub    放开二级、按住一级：二级那一排的数。**没选一级时是空的**，
   *            跨格去数二级没有意义（「文字」在剪贴板里是内容、在文件里是格式）
   *   shown    每一条都上，也就是屏幕上那几条
   */
  stats({ query = '', dates = null, type = '', origin = '', bucket = '', sub = '',
    hideInAll = null, exclude = null } = {}) {
    const f = { q: String(query || '').trim().toLowerCase() };
    const skip = Array.isArray(exclude) && exclude.length ? new Set(exclude) : null;
    const inDates = Array.isArray(dates) ? new Set(dates) : null;   // 空数组是「一天都不要」，不是「不限」
    let total = 0; let pinned = 0; let shown = 0;
    const bySource = Object.fromEntries(SOURCES.map((s) => [s, 0]));
    const byType = {}; const byOrigin = {}; const byDay = {};
    const byBucket = Object.fromEntries(BUCKETS.map((b) => [b, 0])); const bySub = {};
    const hide = Array.isArray(hideInAll) && hideInAll.length ? new Set(hideInAll) : null;
    let allCount = 0;
    for (const key of this.listDates()) {
      for (const e of this.loadDay(key)) {
        total++; if (e.pinned) pinned++;
        if (!this.entryMatches(e, f)) continue;      // 搜索是所有维度共同的前提，不放开
        const okDate = !inDates || inDates.has(e.dateKey);
        const okType = !type || entryFormat(e) === type;
        const okOrigin = !origin || entryOrigin(e) === origin;
        const okSkip = !skip || !skip.has(entrySource(e));
        const okInAll = !hide || !hide.has(entryBucket(e));   // 「没选一级」时才用得上
        const okBucket = bucket ? entryBucket(e) === bucket : okInAll;
        const okSub = !sub || entrySub(e) === sub;
        const rest = okType && okOrigin && okSkip;      // 三个「别的调用方还在用」的老维度
        if (rest && okBucket && okSub) byDay[e.dateKey] = (byDay[e.dateKey] || 0) + 1;
        if (okDate && okBucket && okSub) {
          if (okOrigin && okSkip) { const t = entryFormat(e); byType[t] = (byType[t] || 0) + 1; }
          if (okType && okSkip) { const o = entryOrigin(e); byOrigin[o] = (byOrigin[o] || 0) + 1; }
          if (okType && okOrigin) bySource[entrySource(e)]++;
        }
        // 一级：放开一级、二级**和那条规矩**——点另一格的时候二级本来就得清掉，
        // 而那条规矩只在「没选一级」时生效，所以它也不该压住这一排上的数
        if (okDate && rest) byBucket[entryBucket(e)]++;
        // 「全部」那一格：点它就回到「没选一级」，规矩又生效
        if (okDate && rest && okInAll) allCount++;
        // 二级：放开二级、按住一级。没选一级就不数（跨格的二级值不是同一种东西）
        if (okDate && rest && bucket && okBucket) { const s = entrySub(e); bySub[s] = (bySub[s] || 0) + 1; }
        if (okDate && rest && okBucket && okSub) shown++;
      }
    }
    return { days: this.listDates().length, entries: total, pinned, bySource, byType, byOrigin, byDay, byBucket, bySub, allCount, shown };
  }
}

module.exports = { Store, DEFAULT_SETTINGS, SOURCES, BUCKETS, entrySource, entryOrigin, entryFormat, entryBucket, entrySub, siteOf, baseHost, siteInTitle, localDateKey, timeStamp, addDays, writeJsonAtomic, readJson };
