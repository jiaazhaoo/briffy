'use strict';
// Provider-independent "five words" tagging and daily recap. Dispatches to Anthropic, OpenRouter,
// a local Ollama model, or any OpenAI-compatible endpoint. Prompts enforce the no-translation rule.
const ai = require('./ai');
const oai = require('./openai-compat');
const ollama = require('./ollama');
const hardware = require('./hardware');
const { normalizeWords } = require('./keywords');
const { promptLanguageName } = require('./languages');

const PROVIDERS = ['anthropic', 'openrouter', 'ollama', 'custom'];
// How much item text each provider gets (characters). Local models have small context windows.
const TAG_LIMIT = { anthropic: 100000, openrouter: 60000, custom: 12000, ollama: 5000 };
const DIGEST_LIMIT = { anthropic: 80000, openrouter: 60000, custom: 12000, ollama: 8000 };

const TAG_SCHEMA = {
  type: 'object',
  properties: {
    words: { type: 'array', items: { type: 'string' }, description: 'Exactly five short words or phrases' },
    title: { type: 'string', description: 'Concise title, at most 12 words' },
    summary: { type: 'string', description: 'One or two sentences, at most 60 words' },
  },
  required: ['words', 'title', 'summary'],
  additionalProperties: false,
};

/**
 * Builds the effective provider configuration from the store (plus optional unsaved overrides from the settings form).
 */
function config(store, override = {}) {
  const s = { ...store.getSettings(), ...override };
  const secret = (name, overrideKey) => (typeof override[overrideKey] === 'string' && override[overrideKey] ? override[overrideKey] : store.getSecret(name));
  const rec = hardware.recommend(hardware.getCached());
  return {
    provider: PROVIDERS.includes(s.provider) ? s.provider : 'anthropic',
    languageName: promptLanguageName(s.languages),
    anthropic: { auth: s.anthropicAuth === 'account' ? 'account' : 'apiKey', apiKey: secret('apiKey', 'apiKey'), model: s.model || 'claude-opus-5' },
    openrouter: { apiKey: secret('openrouterKey', 'openrouterKey'), model: s.openrouterModel || 'anthropic/claude-opus-5' },
    ollama: { host: s.ollamaHost || ollama.DEFAULT_HOST, model: s.ollamaModel || rec.model, recommended: !s.ollamaModel },
    custom: { baseUrl: s.customBaseUrl || '', apiKey: secret('customKey', 'customKey'), model: s.customModel || '' },
  };
}

function isConfigured(cfg) {
  switch (cfg.provider) {
    case 'anthropic': return cfg.anthropic.auth === 'account' || !!cfg.anthropic.apiKey;
    case 'openrouter': return !!cfg.openrouter.apiKey;
    case 'ollama': return !!cfg.ollama.host && !!cfg.ollama.model;
    case 'custom': return !!cfg.custom.baseUrl && !!cfg.custom.model;
    default: return false;
  }
}

function label(cfg) {
  switch (cfg.provider) {
    case 'anthropic': return `${cfg.anthropic.model} (Anthropic${cfg.anthropic.auth === 'account' ? ', account' : ''})`;
    case 'openrouter': return `${cfg.openrouter.model} (OpenRouter)`;
    case 'ollama': return `${cfg.ollama.model} (Ollama)`;
    case 'custom': return `${cfg.custom.model} (${cfg.custom.baseUrl})`;
    default: return cfg.provider;
  }
}

function anthropicAuth(cfg) {
  return cfg.anthropic.auth === 'account' ? { account: true } : { apiKey: cfg.anthropic.apiKey };
}

// ---------- prompts ----------
function tagSystem(languageName, small) {
  const lines = [
    'You tag items that a person saved into their personal daily log (screenshots, files, links, voice notes).',
    'Return JSON with exactly these keys: "words" – an array of exactly five short words or phrases (1-3 words each) that together capture what the item is about;',
    '"title" – a concise title (max 12 words); "summary" – one or two sentences (max 60 words) describing the content.',
    'LANGUAGE RULE: write words, title and summary in the same language as the item\'s own content (its OCR text, transcript, page text or note).',
    'Never translate. If the content mixes languages, use the dominant one.',
    `If there is no readable content, follow the language of the file name or URL; if that is ambiguous, use ${languageName}.`,
    'Base everything strictly on the provided content. Prefer specific nouns (product, topic, person, place, project) over generic words.',
    'Do not use words like "screenshot", "image", "file" or "document" unless that is the actual subject.',
  ];
  if (small) lines.push('Output only the JSON object, nothing else.');
  return lines.join(' ');
}

function clip(text, limit) {
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit)}\n\n[... truncated, ${text.length} characters total]` : text;
}

function buildTagText(input, limit, { attachedPdf = false, attachedImage = false } = {}) {
  const notes = [];
  if (input.filename) notes.push(`File name: ${input.filename}`);
  if (input.url) notes.push(`URL: ${input.url}`);
  if (input.context) notes.push(input.context);
  if (input.kind === 'image') {
    if (input.text) notes.push(`OCR text extracted from the image:\n${clip(input.text, limit)}`);
    else if (!attachedImage) notes.push('(The image contains no readable text.)');
  } else if (input.kind === 'pdf') {
    if (!attachedPdf && input.pdfText) notes.push(`Text extracted from the PDF:\n${clip(input.pdfText, limit)}`);
    else if (!attachedPdf) notes.push('(PDF text could not be extracted; use the file name.)');
  } else if (input.text) {
    notes.push(`Content:\n${clip(input.text, limit)}`);
  }
  return `${notes.join('\n\n') || 'No content available beyond the metadata.'}\n\nTag this item.`;
}

function parseJsonLoose(text) {
  try { return JSON.parse(text); } catch (_) { /* fall through */ }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) { try { return JSON.parse(fence[1]); } catch (_) { /* ignore */ } }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) { /* ignore */ } }
  return null;
}

// ---------- five words ----------
/**
 * @param {object} cfg   from config()
 * @param {{kind:'image'|'pdf'|'text'|'meta', image?:Buffer|string, imageMime?:string, pdf?:Buffer|string,
 *          pdfText?:string, text?:string, context?:string, filename?:string, url?:string}} input
 */
async function fiveWords(cfg, input) {
  const limit = TAG_LIMIT[cfg.provider] || 12000;
  const image = input.kind === 'image' && input.image ? ai.prepareImage(input.image, input.imageMime) : null;
  const small = cfg.provider === 'ollama' || cfg.provider === 'custom';
  const system = tagSystem(cfg.languageName, small);
  let raw;
  switch (cfg.provider) {
    case 'anthropic': {
      const attachPdf = input.kind === 'pdf' && input.pdf;
      const text = buildTagText(input, limit, { attachedPdf: !!attachPdf, attachedImage: !!image });
      raw = await ai.complete(anthropicAuth(cfg), { model: cfg.anthropic.model, system, text, image, pdf: attachPdf ? input.pdf : null, schema: TAG_SCHEMA, maxTokens: 800, effort: 'low' });
      break;
    }
    case 'openrouter':
      raw = await oai.chat(oai.openrouterClient(cfg.openrouter.apiKey, cfg.openrouter.model), { system, text: buildTagText(input, limit, { attachedImage: !!image }), image, schema: TAG_SCHEMA, maxTokens: 800 });
      break;
    case 'custom':
      raw = await oai.chat({ baseUrl: cfg.custom.baseUrl, apiKey: cfg.custom.apiKey, model: cfg.custom.model }, { system, text: buildTagText(input, limit, { attachedImage: !!image }), image, schema: TAG_SCHEMA, maxTokens: 800 });
      break;
    case 'ollama':
      raw = await ollama.chat({ host: cfg.ollama.host, model: cfg.ollama.model }, { system, text: buildTagText(input, limit, { attachedImage: !!image }), image, schema: TAG_SCHEMA, maxTokens: 600, numCtx: 8192 });
      break;
    default:
      throw new Error(`Unknown provider ${cfg.provider}`);
  }
  const parsed = parseJsonLoose(raw.text) || {};
  const fallbackText = [input.text, input.pdfText, input.filename, input.url].filter(Boolean).join(' ');
  return {
    words: normalizeWords(parsed.words, fallbackText),
    title: String(parsed.title || '').trim(),
    summary: String(parsed.summary || '').trim(),
    model: raw.model ? `${raw.model} (${providerName(cfg.provider)})` : label(cfg),
  };
}

function providerName(p) {
  return { anthropic: 'Anthropic', openrouter: 'OpenRouter', ollama: 'Ollama', custom: 'custom' }[p] || p;
}

// ---------- daily recap ----------
function fmtTime(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function buildDigest(entries, maxChars) {
  const lines = [];
  let used = 0;
  const perItem = Math.max(150, Math.min(600, Math.floor(maxChars / Math.max(entries.length, 1))));
  const sorted = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const e of sorted) {
    const excerpt = (e.text || e.summary || '').replace(/\s+/g, ' ').slice(0, perItem);
    const line = `- [${fmtTime(e.createdAt)}] (${e.type}) ${e.title || e.path || ''}${e.tags && e.tags.length ? ` | tags: ${e.tags.join(', ')}` : ''}${excerpt ? ` | ${excerpt}` : ''}`;
    if (used + line.length > maxChars) { lines.push('- [... more items omitted]'); break; }
    lines.push(line); used += line.length;
  }
  return lines.join('\n');
}

function digestSystem(languageName, small) {
  const lines = [
    'You write the daily recap for a personal daily-log app. The user saved screenshots, files, links and voice notes during the day;',
    'each item comes with its time, type, title, five tags and an excerpt of its text.',
    `Write in ${languageName}, in Markdown, under 400 words. Structure: a short overview paragraph; a "Themes" section grouping related items with bullets;`,
    'a brief "Timeline" section (morning / afternoon / evening); and a "Follow-ups" section only if the items imply open tasks or decisions.',
    'Quote item titles, tags, names and terms exactly as they appear, in their original language – never translate them.',
    'Be concrete. Do not invent anything that is not in the items.',
  ];
  if (small) lines.push('Output only the Markdown recap.');
  return lines.join(' ');
}

async function dailySummary(cfg, { dateKey, entries }) {
  const limit = DIGEST_LIMIT[cfg.provider] || 12000;
  const small = cfg.provider === 'ollama' || cfg.provider === 'custom';
  const system = digestSystem(cfg.languageName, small);
  const text = `Date: ${dateKey}\nItems (${entries.length}):\n${buildDigest(entries, limit)}`;
  let raw;
  switch (cfg.provider) {
    case 'anthropic':
      raw = await ai.complete(anthropicAuth(cfg), { model: cfg.anthropic.model, system, text, maxTokens: 4096, effort: 'medium' });
      break;
    case 'openrouter':
      raw = await oai.chat(oai.openrouterClient(cfg.openrouter.apiKey, cfg.openrouter.model), { system, text, maxTokens: 2048 });
      break;
    case 'custom':
      raw = await oai.chat({ baseUrl: cfg.custom.baseUrl, apiKey: cfg.custom.apiKey, model: cfg.custom.model }, { system, text, maxTokens: 2048 });
      break;
    case 'ollama':
      raw = await ollama.chat({ host: cfg.ollama.host, model: cfg.ollama.model }, { system, text, maxTokens: 1500, numCtx: 12288 });
      break;
    default:
      throw new Error(`Unknown provider ${cfg.provider}`);
  }
  return { text: raw.text, model: raw.model ? `${raw.model} (${providerName(cfg.provider)})` : label(cfg) };
}

async function testProvider(cfg) {
  const probe = { system: 'Reply with the single word OK.', text: 'ping', maxTokens: 16 };
  switch (cfg.provider) {
    case 'anthropic': return ai.testAuth(anthropicAuth(cfg), cfg.anthropic.model);
    case 'openrouter': { const r = await oai.chat(oai.openrouterClient(cfg.openrouter.apiKey, cfg.openrouter.model), probe); return { ok: true, model: r.model, reply: r.text }; }
    case 'custom': { const r = await oai.chat({ baseUrl: cfg.custom.baseUrl, apiKey: cfg.custom.apiKey, model: cfg.custom.model }, probe); return { ok: true, model: r.model, reply: r.text }; }
    case 'ollama': { const r = await ollama.chat({ host: cfg.ollama.host, model: cfg.ollama.model }, { ...probe, numCtx: 2048 }); return { ok: true, model: r.model, reply: r.text }; }
    default: throw new Error(`Unknown provider ${cfg.provider}`);
  }
}

module.exports = { config, isConfigured, label, fiveWords, dailySummary, testProvider, PROVIDERS, TAG_SCHEMA };
