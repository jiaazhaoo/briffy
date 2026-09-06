'use strict';
// The models you could actually download, read from Ollama's own library rather than a list baked in
// here that goes stale the week after it is written.
//
// The listing page carries everything the ranking needs -- name, description, capability pills, the
// parameter sizes offered, when it was last updated -- so one request covers it; no crawling the two
// hundred model pages behind it. The result is cached, because this should not need the network to
// show you what you already have.
const fs = require('fs');
const { scoreFor } = require('./model-quality');
const path = require('path');

const LIBRARY_URL = 'https://ollama.com/library';
const CACHE_HOURS = 24;

function parseLibrary(html) {
  const out = [];
  // Each entry is an <a href="/library/NAME"> block; everything about it lives until the next one.
  const parts = String(html).split('href="/library/');
  for (let i = 1; i < parts.length; i++) {
    const blk = parts[i];
    const name = (blk.match(/^([a-z0-9._-]+)"/i) || [])[1];
    if (!name) continue;
    const body = blk;   // the split already ends this entry where the next one begins
    const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const description = (text.match(new RegExp(`${name}\\s+(.{10,200}?)\\s+(?:vision|tools|thinking|cloud|embedding|\\d+(?:\\.\\d+)?[bm]\\b)`, 'i')) || [])[1] || '';
    const caps = [...new Set((body.match(/text-indigo-600[^>]*>([a-z]+)</g) || [])
      .map((m) => (m.match(/>([a-z]+)</) || [])[1]).filter(Boolean))];
    const sizes = [...new Set((body.match(/>(\d+(?:\.\d+)?[bm])</g) || [])
      .map((m) => (m.match(/>(.+)</) || [])[1]))];
    const updated = (body.match(/title="([A-Z][a-z]{2} \d{1,2}, \d{4}[^"]*)"/) || [])[1] || '';
    if (!sizes.length) continue;                       // embedding-only or cloud-only entries
    out.push({ name, description: description.trim(), caps, sizes, updated, rank: out.length });
  }
  return out;
}

/** params in billions, from a tag like "4b" or "270m" */
function paramsOf(tag) {
  const m = String(tag).match(/^(\d+(?:\.\d+)?)([bm])$/i);
  if (!m) return 0;
  return m[2].toLowerCase() === 'm' ? Number(m[1]) / 1000 : Number(m[1]);
}
// Working memory for a 4-bit build, which is what `ollama pull <name>:<size>` gives you.
function needGB(params) { return Math.round((params * 0.8 + 1.2) * 10) / 10; }
function sizeGB(params) { return Math.round(params * 0.62 * 10) / 10; }

/**
 * Sorts everything that could run here into three shelves, and puts the three best on each.
 *
 *   轻松  comfortable: leaves most of the machine free, answers quickly
 *   适中  a fair share of it, noticeably better answers
 *   勉强  the biggest that will load at all -- it will be slow, and it is the user's call
 *
 * "Best" is a leaderboard score, not a guess from the name: ifeval for doing as it is told in the shape
 * asked for, which is what this app needs, plus mmlu-pro for general knowledge. A model with no score
 * of its own inherits its family's, discounted for size. Nothing here is fixed: the shelves move with
 * the machine, and what sits on them moves as the leaderboard does.
 *
 * @param {Array} models  parsed library entries
 * @param {{budgetGB:number, ramGB:number}} hw
 * @param {{scores:Map, families:Map}} quality
 */
function tiers(models, hw, quality = { scores: new Map(), families: new Map() }, { perTier = 3 } = {}) {
  const budget = hw.budgetGB || 8;
  const ceiling = Math.min(budget, (hw.ramGB || 8) * 0.8);
  const SPECIALIST = /coder|code|math|sql|embed|guard|moderation|rerank|uncensored|abliterated/i;
  const REASONING_FIRST = /^(deepseek-r1|qwq|marco-o1|openthinker|reflection|magistral|phi4-reasoning)/i;
  const now = Date.now();

  const rows = [];
  for (const m of models) {
    if (SPECIALIST.test(`${m.name} ${m.description}`)) continue;
    if (REASONING_FIRST.test(m.name)) continue;
    for (const tag of m.sizes) {
      const p = paramsOf(tag);
      if (!p || p < 1) continue;
      const need = needGB(p);
      if (need > ceiling) continue;
      const q = scoreFor(m.name.replace(/-vl$/, ''), p, quality);
      const age = m.updated ? (now - Date.parse(m.updated)) / (365 * 24 * 3600 * 1000) : 3;
      const fresh = 1 / (1 + Math.max(0, age) * 0.5);
      const vision = m.caps.includes('vision') ? 1.15 : 1;   // the main input here is a screenshot
      // A measured score leads; with none, recency and being known carry the model instead.
      const base = q.score > 0 ? q.score : 0.45 * fresh * (1 / (1 + m.rank / 80));
      rows.push({
        model: `${m.name}:${tag}`, family: m.name, params: p,
        needGB: need, sizeGB: sizeGB(p), caps: m.caps, vision: m.caps.includes('vision'),
        description: m.description, updated: m.updated,
        quality: Math.round(q.score * 1000) / 1000, measured: q.measured,
        score: base * vision * (0.75 + 0.25 * fresh),
      });
    }
  }
  rows.sort((a, b) => b.score - a.score);

  // Shelves are cut against the biggest model that will actually load here, not against the machine's
  // memory: on 64 GB nothing under thirty billion parameters is a stretch by any measure, and a shelf
  // labelled 勉强 that is either empty or holding something comfortable would be a lie either way.
  // Shelves are cut across what will actually load here, in thirds, rather than at fixed fractions of
  // the machine's memory. Fractions leave a shelf empty at both extremes -- on 64 GB nothing is small
  // enough to count as a stretch, on 8 GB nothing is large enough to count as comfortable -- and an
  // empty shelf is worse than an honest one. In thirds the labels stay true: the lightest of what runs
  // here, the middle of it, the heaviest of it.
  const needs = [...new Set(rows.map((r) => r.needGB))].sort((a, b) => a - b);
  const at = (f) => (needs.length ? needs[Math.min(needs.length - 1, Math.floor(needs.length * f))] : ceiling);
  const shelves = [
    { id: 'easy', max: at(1 / 3) },
    { id: 'medium', max: at(2 / 3) },
    { id: 'stretch', max: needs.length ? needs[needs.length - 1] : ceiling },
  ];
  const used = new Set();
  const out = {};
  let floor = 0;
  for (const shelf of shelves) {
    const picks = [];
    const families = new Set();
    for (const r of rows) {
      if (picks.length >= perTier) break;
      if (used.has(r.model)) continue;
      if (r.needGB <= floor || r.needGB > shelf.max) continue;
      if (families.has(r.family)) continue;                 // three flavours of one model is not a choice
      families.add(r.family);
      used.add(r.model);
      picks.push(r);
    }
    out[shelf.id] = picks.map((r, i) => ({ ...r, tier: shelf.id, recommended: shelf.id === 'medium' && i === 0 }));
    floor = shelf.max;
  }
  // Nothing recommended (an empty middle shelf): fall back to the best thing on any shelf.
  if (!Object.values(out).flat().some((r) => r.recommended)) {
    const first = Object.values(out).flat()[0];
    if (first) first.recommended = true;
  }
  return out;
}

async function fetchLibrary(cacheDir, { maxAgeHours = CACHE_HOURS, refresh = false } = {}) {
  const file = path.join(cacheDir, 'ollama-library.json');
  if (!refresh) {
    try {
      const c = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Date.now() - c.at < maxAgeHours * 3600 * 1000 && Array.isArray(c.models) && c.models.length) {
        return { models: c.models, at: c.at, cached: true };
      }
    } catch (_) { /* no cache yet */ }
  }
  try {
    const res = await fetch(LIBRARY_URL, { headers: { 'user-agent': 'briffy' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const models = parseLibrary(await res.text());
    if (!models.length) throw new Error('nothing parsed');
    try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify({ at: Date.now(), models })); } catch (_) { /* read-only */ }
    return { models, at: Date.now(), cached: false };
  } catch (e) {
    // Offline, or the page changed shape: fall back to whatever was cached, however old.
    try {
      const c = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { models: c.models, at: c.at, cached: true, stale: true, error: e.message };
    } catch (_) { return { models: [], at: 0, cached: false, error: e.message }; }
  }
}

module.exports = { fetchLibrary, parseLibrary, tiers, paramsOf, needGB, sizeGB, LIBRARY_URL };
