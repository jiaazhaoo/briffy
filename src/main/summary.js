'use strict';
// Daily recap: once a day (settings.summaryTime) the cat writes a summary of yesterday's entries.
const fs = require('fs');
const path = require('path');
const llm = require('./llm');
const { uiLanguage } = require('./languages');
const { localDateKey, addDays, writeJsonAtomic, readJson } = require('./store');
const { t } = require('./i18n');

let store; let windows; let notify;
let timer = null;
let generating = new Set();

function init(deps) { store = deps.store; windows = deps.windows; notify = deps.notify; }

function mdFile(dateKey) { return path.join(store.paths().summaries, `${dateKey}.md`); }
function metaFile(dateKey) { return path.join(store.paths().summaries, `${dateKey}.json`); }
function exists(dateKey) { return fs.existsSync(mdFile(dateKey)); }

function list() {
  let files = [];
  try { files = fs.readdirSync(store.paths().summaries); } catch (_) { return []; }
  return files
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .map((f) => f.slice(0, 10))
    .sort()
    .reverse()
    .map((dateKey) => ({ dateKey, ...readJson(metaFile(dateKey), {}) }));
}

function get(dateKey) {
  if (!exists(dateKey)) return null;
  return { dateKey, text: fs.readFileSync(mdFile(dateKey), 'utf8'), meta: readJson(metaFile(dateKey), {}) };
}

const TYPE_LABEL = {
  zh: { screenshot: '截图', image: '图片', audio: '语音', pdf: 'PDF', text: '文本', url: '链接', note: '笔记', file: '文件' },
  en: { screenshot: 'Screenshots', image: 'Images', audio: 'Voice notes', pdf: 'PDFs', text: 'Text files', url: 'Links', note: 'Notes', file: 'Files' },
};

function localSummary(dateKey, entries, warning) {
  const ui = uiLanguage(store.getSettings().languages);
  const zh = ui === 'zh';
  const lines = [];
  lines.push(zh ? `# ${dateKey} 摘要（本地生成）` : `# Summary for ${dateKey} (generated locally)`);
  lines.push('');
  if (warning) lines.push(zh ? `> AI 服务不可用：${warning}` : `> AI service unavailable: ${warning}`, '');
  if (!entries.length) { lines.push(zh ? '这一天没有记录。' : 'Nothing was recorded on this day.'); return lines.join('\n'); }
  lines.push(zh ? `共 ${entries.length} 条记录。` : `${entries.length} items recorded.`, '');
  const tagCount = new Map();
  for (const e of entries) for (const tag of e.tags || []) tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
  const topTags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w]) => w);
  if (topTags.length) lines.push(zh ? `**高频词：** ${topTags.join('、')}` : `**Frequent tags:** ${topTags.join(', ')}`, '');
  const groups = new Map();
  for (const e of entries) { if (!groups.has(e.type)) groups.set(e.type, []); groups.get(e.type).push(e); }
  for (const [type, items] of groups) {
    lines.push(`## ${(TYPE_LABEL[ui] || TYPE_LABEL.en)[type] || type} (${items.length})`);
    for (const e of [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      const d = new Date(e.createdAt);
      const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const tags = (e.tags || []).length ? ` — ${e.tags.join(' · ')}` : '';
      lines.push(`- ${hm} ${e.title || e.path || ''}${tags}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function generate(dateKey, { force = false, quiet = false } = {}) {
  if (generating.has(dateKey)) return null;
  const entries = store.entriesForDate(dateKey).filter((e) => e.status !== 'error' || e.tags.length);
  if (!entries.length && !force) return null;
  generating.add(dateKey);
  try {
    const cfg = llm.config(store);
    const configured = llm.isConfigured(cfg);
    let text; let source = 'local'; let model = '';
    if (configured && entries.length) {
      try {
        const r = await llm.dailySummary(cfg, { dateKey, entries });
        text = r.text; model = r.model; source = cfg.provider;
      } catch (e) {
        console.warn(`[summary] ${cfg.provider} failed, writing local summary:`, e.message);
        text = localSummary(dateKey, entries, e.message);
      }
    } else {
      text = localSummary(dateKey, entries, configured ? '' : t('noProvider'));
    }
    fs.mkdirSync(store.paths().summaries, { recursive: true });
    fs.writeFileSync(mdFile(dateKey), text, 'utf8');
    const meta = { dateKey, generatedAt: new Date().toISOString(), entryCount: entries.length, source, model };
    writeJsonAtomic(metaFile(dateKey), meta);
    windows.broadcastToWorkspace('ws:summary', meta);
    if (!quiet) {
      windows.setPetState('summary', { message: t('summaryReady', { date: dateKey }), badge: true });
      if (notify) notify(t('summaryTitle'), t('summaryBody', { date: dateKey, n: entries.length }), () => windows.openWorkspace('summaries', dateKey));
    }
    return { dateKey, text, meta };
  } finally {
    generating.delete(dateKey);
  }
}

function minutesOf(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : 8 * 60;
}

async function check() {
  try {
    const now = new Date();
    if (now.getHours() * 60 + now.getMinutes() < minutesOf(store.getSettings().summaryTime)) return;
    const yesterday = addDays(localDateKey(now), -1);
    if (exists(yesterday)) return;
    if (!store.entriesForDate(yesterday).length) return;
    await generate(yesterday);
  } catch (e) {
    console.error('[summary] scheduled generation failed', e);
  }
}

function start() {
  stop();
  setTimeout(check, 15000);
  timer = setInterval(check, 60 * 1000);
}
function stop() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { init, start, stop, generate, list, get, exists };
