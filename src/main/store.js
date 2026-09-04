'use strict';
// Persistence: settings (userData/settings.json) and workspace entries (one JSON file per day).
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const DEFAULT_SETTINGS = {
  languages: ['zh-Hans', 'en'],   // exactly two language packs, first one drives the UI language
  // three shortcuts, one per action (Electron accelerator syntax)
  hotkeyRegion: process.platform === 'darwin' ? 'Cmd+Shift+A' : 'Ctrl+Alt+A',   // drag a box, like other screenshot tools
  hotkeyScreen: process.platform === 'darwin' ? 'Cmd+Shift+S' : 'Ctrl+Alt+S',   // whole screen
  hotkeyVoice: process.platform === 'darwin' ? 'Cmd+Shift+V' : 'Ctrl+Alt+V',    // start / stop recording
  captureToClipboard: true,       // a capture also lands on the system clipboard, ready to paste
  model: 'claude-opus-5',         // Claude model used for tagging + daily summaries
  sttModel: 'Xenova/whisper-tiny.en',  // English model bundled with the app; others download on demand
  sttLanguage: 'auto',            // 'auto' | a language code from settings.languages
  summaryTime: '08:00',           // when the daily summary for yesterday is produced
  workspaceDir: '',               // '' => <userData>/workspace
  hfMirror: '',                   // e.g. https://hf-mirror.com/ when huggingface.co is unreachable
  petPosition: null,              // {x, y} remembered after dragging
  petHidden: false,
  petAvatar: '',                  // catalog key of the picked logo; '' => the bundled avatar
  ocrDroppedImages: true,
  ocrModel: '',                   // '' => decided by the machine probe + language pair
  ocrModelAuto: '',               // the model the app settled on for this machine
  setupDone: false,               // the one-click setup wizard has run at least once
  normalizeChineseScript: true,   // unify Whisper's random simplified/traditional output to the selected pack
  micDeviceId: '',                // '' => system default microphone
  micLabel: '',
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
    this.days = new Map();      // dateKey -> entries[]
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

  listDates() {
    try {
      return fs.readdirSync(this.paths().entries)
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .map((f) => f.slice(0, 10))
        .sort()
        .reverse();
    } catch (_) { return []; }
  }

  loadDay(dateKey) {
    if (this.days.has(dateKey)) return this.days.get(dateKey);
    const arr = readJson(this.dayFile(dateKey), []);
    this.days.set(dateKey, arr);
    for (const e of arr) this.index.set(e.id, dateKey);
    return arr;
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
    this.emit('entry', entry, 'delete');
    return true;
  }

  entriesForDate(dateKey) { return [...this.loadDay(dateKey)]; }

  listEntries({ query = '', dates = null, limit = 500 } = {}) {
    const keys = dates || this.listDates();
    const q = query.trim().toLowerCase();
    const out = [];
    for (const key of keys) {
      for (const e of this.loadDay(key)) {
        if (q) {
          const hay = `${e.title} ${e.tags.join(' ')} ${e.text} ${e.summary} ${e.path}`.toLowerCase();
          if (!hay.includes(q)) continue;
        }
        out.push(e);
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  stats() {
    let total = 0;
    for (const key of this.listDates()) total += this.loadDay(key).length;
    return { days: this.listDates().length, entries: total };
  }
}

module.exports = { Store, DEFAULT_SETTINGS, localDateKey, timeStamp, addDays, writeJsonAtomic, readJson };
