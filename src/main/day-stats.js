'use strict';
// What a day actually holds, worked out by counting.
//
// Everything here is arithmetic: no model is asked, nothing is inferred. That is the point. The daily
// recap used to be a language model or nothing at all, so with no provider configured the page fell
// back to a bare list, and with one configured there was no way to tell a real observation from a
// fluent guess. Counting first fixes both: the numbers are always there and always true, and the model
// is handed them instead of being left to invent them.
//
// It also settles the question a count alone cannot answer -- whether a quiet day was quiet or simply
// unattended. See uptime.js.
const { entrySource } = require('./store');

/** Ordered so the recap always lists types in the same order, whatever the day contained. */
const TYPES = ['screenshot', 'image', 'audio', 'url', 'note', 'text', 'pdf', 'video', 'media', 'file'];

function hourOf(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? -1 : d.getHours();
}
function clockOf(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Words the user actually captured: OCR text, transcripts, notes. Never what the app wrote. */
function capturedLength(e) {
  return String(e.text || '').trim().length;
}

/**
 * @param {object[]} entries one day's entries
 * @param {{uptime?:{slots:number[],minutes:number,firstSlot:number,lastSlot:number}}} opts
 */
function stats(entries, { uptime = null } = {}) {
  const kept = (entries || []).filter((e) => e && e.status !== 'error');
  const failed = (entries || []).length - kept.length;

  const byType = {};
  const bySource = {};
  const byApp = new Map();
  const byHour = new Array(24).fill(0);
  let chars = 0;
  let first = ''; let last = '';

  for (const e of kept) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    const src = entrySource(e);
    bySource[src] = (bySource[src] || 0) + 1;
    const h = hourOf(e.createdAt);
    if (h >= 0) byHour[h]++;
    chars += capturedLength(e);
    const app = e.context && e.context.app;
    if (app) {
      const cur = byApp.get(app) || { app, n: 0, windows: new Set() };
      cur.n++;
      if (e.context.window) cur.windows.add(e.context.window);
      byApp.set(app, cur);
    }
    if (!first || e.createdAt < first) first = e.createdAt;
    if (!last || e.createdAt > last) last = e.createdAt;
  }

  const ran = !!(uptime && uptime.slots && uptime.slots.length);
  const status = kept.length ? 'ok' : (ran ? 'idle' : 'off');

  return {
    total: kept.length,
    failed,
    status,                                   // 'ok' | 'idle' (running, nothing kept) | 'off' (never ran)
    byType: Object.fromEntries(TYPES.filter((t) => byType[t]).map((t) => [t, byType[t]])
      .concat(Object.entries(byType).filter(([t]) => !TYPES.includes(t)))),
    bySource,
    byApp: [...byApp.values()].sort((a, b) => b.n - a.n)
      .map(({ app, n, windows }) => ({ app, n, windows: [...windows].slice(0, 3) })),
    byHour: byHour.map((n, hour) => ({ hour, n })).filter((x) => x.n),
    busiestHour: byHour.reduce((best, n, hour) => (n > byHour[best] ? hour : best), 0),
    chars,
    firstAt: first ? clockOf(first) : '',
    lastAt: last ? clockOf(last) : '',
    uptimeMinutes: uptime ? uptime.minutes : 0,
    ranFrom: uptime && uptime.firstSlot >= 0 ? uptime.firstSlot : -1,
    ranTo: uptime && uptime.lastSlot >= 0 ? uptime.lastSlot : -1,
  };
}

/**
 * The same numbers as a few plain lines, handed to the model so it never has to count -- and printed
 * verbatim at the top of a recap written without one.
 */
function asLines(s, { dateKey = '' } = {}) {
  const out = [];
  if (dateKey) out.push(`Date: ${dateKey}`);
  if (s.status === 'off') { out.push('briffy was not running on this day, so nothing could be saved.'); return out.join('\n'); }
  if (s.status === 'idle') { out.push(`briffy was running for about ${s.uptimeMinutes} minutes but nothing was saved.`); return out.join('\n'); }
  out.push(`Kept: ${s.total} items${s.failed ? ` (${s.failed} failed to process)` : ''}, first at ${s.firstAt}, last at ${s.lastAt}.`);
  out.push(`By kind: ${Object.entries(s.byType).map(([t, n]) => `${t} ${n}`).join(', ')}.`);
  if (s.byApp.length) {
    out.push(`Saved while these apps were in front: ${s.byApp.slice(0, 6).map((a) => `${a.app} ${a.n}`).join(', ')}.`);
    const windows = s.byApp.flatMap((a) => a.windows).slice(0, 8);
    if (windows.length) out.push(`Windows seen: ${windows.join(' · ')}.`);
  }
  if (s.byHour.length) out.push(`By hour: ${s.byHour.map((h) => `${String(h.hour).padStart(2, '0')}:00 ${h.n}`).join(', ')}.`);
  out.push(`Captured text: ${s.chars} characters. briffy itself ran for about ${s.uptimeMinutes} minutes.`);
  return out.join('\n');
}

module.exports = { stats, asLines, TYPES };
