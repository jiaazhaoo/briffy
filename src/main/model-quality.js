'use strict';
// How good a model actually is, from a public leaderboard rather than from a guess about its name.
//
// Two benchmarks, chosen for what this app asks a model to do -- read a screenshot's text and return a
// title and one sentence as JSON:
//   ifeval    instruction following and structured output. This is the job, almost exactly.
//   mmlu-pro  broad knowledge, as a check that it knows anything at all.
// Both are fetched once a day and cached; with no network the last copy stands, and with no copy the
// caller falls back to ordering by size and recency alone.
const fs = require('fs');
const path = require('path');

const API = 'https://api.zeroeval.com/leaderboard';
const BENCHMARKS = [
  { id: 'ifeval', weight: 0.65 },      // doing as it is told, in the shape asked for
  { id: 'mmlu-pro', weight: 0.35 },    // knowing things
];
const CACHE_HOURS = 24;

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'briffy' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/**
 * Leaderboard ids and Ollama tags name the same model differently: "gemma-3-4b-it" is "gemma3:4b",
 * "qwen3.5-27b" is "qwen3.5:27b". Reduce both to family + parameter count and match on that.
 * @returns {{family:string, params:number}|null}
 */
function normalizeId(id) {
  let s = String(id || '').toLowerCase();
  s = s.replace(/[-_](it|instruct|chat|thinking|preview|latest|v\d+(\.\d+)?)$/g, '');
  s = s.replace(/[-_]a\d+(\.\d+)?b$/, '');                  // MoE active-parameter suffix
  const m = s.match(/[-_:]?(\d+(?:\.\d+)?)b$/);
  if (!m) return null;
  const params = Number(m[1]);
  let family = s.slice(0, m.index).replace(/[-_:]+$/, '');
  family = family.replace(/^(nvidia|google|meta|alibaba|microsoft)[-_]/, '');
  family = family.replace(/(?<=[a-z])[-_](?=\d)/g, '');      // gemma-3 -> gemma3, llama-3.2 -> llama3.2
  return { family, params };
}

/** @returns {Promise<{scores:Map<string,number>, families:Map<string,number>, at:number, stale?:boolean}>} */
async function fetchQuality(cacheDir, { refresh = false, maxAgeHours = CACHE_HOURS } = {}) {
  const file = path.join(cacheDir, 'model-quality.json');
  const load = () => {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { scores: new Map(c.scores), families: new Map(c.families), at: c.at };
  };
  if (!refresh) {
    try {
      const c = load();
      if (Date.now() - c.at < maxAgeHours * 3600 * 1000 && c.scores.size) return c;
    } catch (_) { /* no cache yet */ }
  }
  try {
    const models = await getJson(`${API}/models`);
    const open = new Set(models.filter((m) => m.is_open).map((m) => m.model_id));
    const scores = new Map();          // "family:params" -> 0..1
    const families = new Map();        // family -> best score seen
    for (const b of BENCHMARKS) {
      let data;
      try { data = await getJson(`${API}/benchmarks/${b.id}`); } catch (_) { continue; }
      for (const e of data.entries || []) {
        if (!open.has(e.model_id)) continue;                // only what can be run locally
        const n = normalizeId(e.model_id);
        if (!n) continue;
        const s = Number(e.normalized_score);
        if (!Number.isFinite(s)) continue;
        // A weighted average over the benchmarks a model actually appears in. Summing the weighted
        // terms would punish a model for being absent from one list, which is a fact about the list.
        const key = `${n.family}:${n.params}`;
        const acc = scores.get(key) || { sum: 0, weight: 0 };
        acc.sum += s * b.weight;
        acc.weight += b.weight;
        scores.set(key, acc);
        families.set(n.family, Math.max(families.get(n.family) || 0, s));
      }
    }
    if (!scores.size) throw new Error('no open models scored');
    const flat = new Map([...scores].map(([k, v]) => [k, v.sum / v.weight]));
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ at: Date.now(), scores: [...flat], families: [...families] }));
    } catch (_) { /* read-only */ }
    return { scores: flat, families, at: Date.now() };
  } catch (e) {
    try { return { ...load(), stale: true, error: e.message }; } catch (_) {
      return { scores: new Map(), families: new Map(), at: 0, error: e.message };
    }
  }
}

/**
 * A score for one Ollama tag. An exact leaderboard entry wins; otherwise the family's best result is
 * carried across and discounted for being smaller, because a 2B sibling of a good 27B is still a 2B.
 */
function scoreFor(family, params, quality) {
  const exact = quality.scores.get(`${family}:${params}`);
  if (exact !== undefined) return { score: exact, measured: true };
  const fam = quality.families.get(family);
  if (fam === undefined) return { score: 0, measured: false };
  // a rough, monotonic discount: 27b keeps it all, 9b most, 2b noticeably less
  const discount = Math.min(1, 0.55 + 0.45 * Math.log10(1 + params) / Math.log10(28));
  return { score: fam * discount, measured: false };
}

module.exports = { fetchQuality, normalizeId, scoreFor, BENCHMARKS, API };
