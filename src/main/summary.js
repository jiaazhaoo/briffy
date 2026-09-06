'use strict';
// Daily recap: once a day (settings.summaryTime) the character writes a summary of yesterday's entries.
const fs = require('fs');
const path = require('path');
const llm = require('./llm');
const uptime = require('./uptime');
const dayStats = require('./day-stats');
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
  zh: { screenshot: '截图', image: '图片', audio: '语音', pdf: 'PDF', text: '文本', url: '链接', note: '笔记', file: '文件', video: '视频', media: '音视频' },
  en: { screenshot: 'Screenshots', image: 'Images', audio: 'Voice notes', pdf: 'PDFs', text: 'Text files', url: 'Links', note: 'Notes', file: 'Files', video: 'Video', media: 'Media' },
};

/** The headings the recap uses, so the counted version and the written version are one document. */
function headings() {
  return {
    overview: t('recapOverview'), themes: t('recapThemes'), moments: t('recapMoments'),
    open: t('recapOpen'), patterns: t('recapPatterns'), next: t('recapNext'),
  };
}

function typeLabel(type) {
  const ui = uiLanguage(store.getSettings().languages) === 'zh' ? 'zh' : 'en';
  return (TYPE_LABEL[ui] || TYPE_LABEL.en)[type] || type;
}

/**
 * The recap when no model writes it -- and the block of facts handed to the model when one does.
 * Everything in here is counted, so it is true whether or not an AI service is configured.
 */
function countedRecap(dateKey, entries, st, warning) {
  const lines = [`# ${t('recapTitle', { date: dateKey })}`, ''];
  if (warning) lines.push(`> ${t('recapNoAi', { err: warning })}`, '');
  if (st.status === 'off') { lines.push(t('recapNotRunning')); return lines.join('\n'); }
  if (st.status === 'idle') { lines.push(t('recapIdle', { min: st.uptimeMinutes })); return lines.join('\n'); }

  lines.push(`## ${t('recapOverview')}`, '');
  lines.push(t('recapCounts', { n: st.total, first: st.firstAt, last: st.lastAt }));
  lines.push('');

  lines.push(`## ${t('recapPatterns')}`, '');
  lines.push(`**${t('recapByKind')}** ${Object.entries(st.byType).map(([type, n]) => `${typeLabel(type)} ${n}`).join(' · ')}`);
  if (st.byApp.length) lines.push(`**${t('recapByApp')}** ${st.byApp.slice(0, 6).map((a) => `${a.app} ${a.n}`).join(' · ')}`);
  if (st.byHour.length) lines.push(`**${t('recapByHour')}** ${st.byHour.map((h) => `${String(h.hour).padStart(2, '0')}:00 ${h.n}`).join(' · ')}`);
  lines.push(t('recapChars', { n: st.chars }));
  lines.push('');

  lines.push(`## ${t('recapThemes')}`, '');
  const groups = new Map();
  for (const e of entries) { if (!groups.has(e.type)) groups.set(e.type, []); groups.get(e.type).push(e); }
  for (const [type, items] of groups) {
    lines.push(`**${typeLabel(type)}** (${items.length})`);
    for (const e of [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      const d = new Date(e.createdAt);
      const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const seen = e.visionLabels ? ` — ${e.visionLabels}` : '';
      const where = e.context && e.context.app ? ` · ${e.context.app}${e.context.window ? ` / ${e.context.window}` : ''}` : '';
      lines.push(`- ${hm} ${e.title || e.path || ''}${seen}${where}`);
    }
    lines.push('');
  }
  lines.push(`*${t('recapLocal')}*`);
  return lines.join('\n');
}

async function generate(dateKey, { force = false, quiet = false } = {}) {
  if (generating.has(dateKey)) return null;
  const entries = store.entriesForDate(dateKey).filter((e) => e.status !== 'error');
  if (!entries.length && !force) return null;
  generating.add(dateKey);
  try {
    const cfg = llm.config(store);
    const configured = llm.isConfigured(cfg);
    // Counted first, always. The numbers are the same whether or not anyone writes prose about them,
    // and a day with no entries can now say which kind of empty it was.
    const st = dayStats.stats(entries, { uptime: uptime.forDate(dateKey) });
    let text; let source = 'local'; let model = '';
    if (configured && entries.length) {
      try {
        const r = await llm.dailySummary(cfg, {
          dateKey, entries, headings: headings(), counts: dayStats.asLines(st, { dateKey }),
        });
        text = r.text; model = r.model; source = cfg.provider;
      } catch (e) {
        console.warn(`[summary] ${cfg.provider} failed, writing the counted recap instead:`, e.message);
        text = countedRecap(dateKey, entries, st, e.message);
      }
    } else {
      text = countedRecap(dateKey, entries, st, configured ? '' : t('noProvider'));
    }
    fs.mkdirSync(store.paths().summaries, { recursive: true });
    fs.writeFileSync(mdFile(dateKey), text, 'utf8');
    const meta = { dateKey, generatedAt: new Date().toISOString(), entryCount: entries.length, source, model, stats: st };
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
    // A day briffy never saw gets no recap; a day it watched and nothing happened gets one that says so.
    if (!store.entriesForDate(yesterday).length && !uptime.ran(yesterday)) return;
    await generate(yesterday, { force: true });
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
