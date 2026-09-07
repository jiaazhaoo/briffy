'use strict';
// Provider-independent titling and daily recap. Dispatches to Anthropic, OpenRouter,
// a local Ollama model, or any OpenAI-compatible endpoint. Prompts enforce the no-translation rule.
const ai = require('./ai');
const oai = require('./openai-compat');
const ollama = require('./ollama');
const hardware = require('./hardware');
const { promptLanguageName } = require('./languages');

const PROVIDERS = ['anthropic', 'openrouter', 'ollama', 'custom'];
// How much item text each provider gets (characters). Local models have small context windows.
const TAG_LIMIT = { anthropic: 100000, openrouter: 60000, custom: 12000, ollama: 5000 };
// ollama 那一档以前是 8000 字。numCtx 是 12288 token，8000 字的中英混排大约用掉一半，
// 剩下的额度本来就空着。抬到 10000，同时把回答的 maxTokens 从 1200 抬到 1800——
// 实测一份行程单答到「需跟随穿荧光背心的」就断在半句上，那是被 1200 卡掉的。
const DIGEST_LIMIT = { anthropic: 80000, openrouter: 60000, custom: 12000, ollama: 10000 };

// The model is asked for a title and a sentence, and nothing else. The words that index an entry are
// extracted locally from its own text (see workspace.js): they should not change, or cost anything, or
// stop working offline, because someone switched provider.
const TAG_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Concise title, at most 12 words' },
    summary: { type: 'string', description: 'One or two sentences, at most 60 words' },
  },
  required: ['title', 'summary'],
  additionalProperties: false,
};

const ASK_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', description: 'The answer in Markdown, citing items as [1], [2]' },
    used: { type: 'array', items: { type: 'integer' }, description: 'Numbers of the items the answer actually relies on' },
  },
  required: ['answer', 'used'],
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
    'You title items that a person saved into their personal daily log (screenshots, files, links, voice notes).',
    'Return JSON with exactly these keys: "title" – a concise title (max 12 words); "summary" – one or two sentences (max 60 words) describing the content.',
    `LANGUAGE RULE: write the title and the summary in ${languageName}, whatever language the item itself is in — they are the app's own words about the item, not a copy of it.`,
    'Quote names, products, people, places and technical terms exactly as they appear in the content, in their original language; do not translate those.',
    'The content itself is never rewritten or translated elsewhere: only this title and summary are in the app\'s language.',
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
    else if (input.labels) notes.push(`The image has no readable text. A local image classifier recognised: ${input.labels}`);
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

// ---------- title and summary ----------
/**
 * @param {object} cfg   from config()
 * Writes a title and a one-line summary for one saved item.
 * Pictures arrive as words, never as pixels: `text` when OCR read some, `labels` when a local
 * classifier named what is in the frame (see vision.js). `image` is still honoured for callers that
 * genuinely want a picture attached, but the ingestion pipeline does not set it.
 * @param {{kind:'image'|'pdf'|'text'|'meta', image?:Buffer|string, imageMime?:string, labels?:string,
 *          pdf?:Buffer|string, pdfText?:string, text?:string, context?:string, filename?:string,
 *          url?:string}} input
 */
async function describe(cfg, input) {
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
  return {
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
    const where = e.context && e.context.app
      ? ` | from ${e.context.app}${e.context.window ? `: ${e.context.window}` : ''}${e.context.url ? ` <${e.context.url}>` : ''}`
      : '';
    const line = `- [${fmtTime(e.createdAt)}] (${e.type}) ${e.title || e.path || ''}${where}${e.visionLabels ? ` | in the picture: ${e.visionLabels}` : ''}${excerpt ? ` | ${excerpt}` : ''}`;
    if (used + line.length > maxChars) { lines.push('- [... more items omitted]'); break; }
    lines.push(line); used += line.length;
  }
  return lines.join('\n');
}

function digestSystem(languageName, small, headings) {
  const h = headings || {};
  const lines = [
    'You write the daily recap for briffy, a personal log of things the user deliberately chose to keep:',
    'screenshots, copied passages, links, files and voice notes. Each item comes with its time, kind, title,',
    'an excerpt of its text, the app and window it was saved from, and -- for a picture with no words in it --',
    'what a local classifier saw. A block of counts is given first; those numbers are already correct.',
    '',
    'Rules, in order of importance:',
    '1. Report only what the items actually show. If something is not in them, leave it out and say so plainly.',
    '   Seeing a task discussed is not evidence the user did it.',
    '2. Never invent an item, a time, a name or a number. Use the counts as given; do not recompute or estimate them.',
    '3. Quote titles, names, code and terms exactly as they appear, in their original language. Never translate them.',
    '4. Attach a time (HH:MM) to every concrete claim.',
    '',
    `Write in ${languageName}, in Markdown, under 400 words, using exactly these headings in this order:`,
    `## ${h.overview || 'Overview'} -- one sentence: what this day was mostly about.`,
    `## ${h.themes || 'What you were doing'} -- 2-5 bullets grouping related items, each with a time and the specific name, file or page.`,
    `## ${h.moments || 'Worth remembering'} -- bullets for the few items that carry real information. Skip the section if there are none.`,
    `## ${h.open || 'Unfinished'} -- open questions, half-read pages, undone tasks the items imply. Skip the section if there are none.`,
    `## ${h.patterns || 'Patterns'} -- which apps and kinds dominated, and when. Use the given counts.`,
    `End with a single line: **${h.next || 'Next step'}:** the one thing most worth picking up.`,
  ];
  if (small) lines.push('Output only the Markdown recap, nothing before or after it.');
  return lines.join('\n');
}

async function dailySummary(cfg, { dateKey, entries, counts = '', headings = null }) {
  const limit = DIGEST_LIMIT[cfg.provider] || 12000;
  const small = cfg.provider === 'ollama' || cfg.provider === 'custom';
  const system = digestSystem(cfg.languageName, small, headings);
  // The counts come first and are already true, so the model never has to work out how many of
  // anything there were -- the one thing it is reliably bad at and the one thing that is cheap to know.
  const text = `${counts ? `Counts for this day (these are correct, use them as given):\n${counts}\n\n` : ''}Date: ${dateKey}\nItems (${entries.length}):\n${buildDigest(entries, limit)}`;
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

// ---------- asking the log a question ----------
/**
 * 从一条记录里截出给模型看的那一段。
 *
 * 以前这里是 slice(0, perItem)——取开头。开头往往是网页的导航条、cookie 提示、语言选择，
 * 而真正被问到的那句话在中间。实测：一条报名记录 1285 字，「12 Sep 2026」在第 329 字、
 * 「Walking Only」在第 380 字，而当时每条只给 200 字，模型看到的是「Select category /
 * Complete form / Checkout / 闲置 15 分钟会掉线」——然后它只能去猜日期。
 *
 * 所以截命中的那一段。找不到任何词才退回开头。
 */
function windowAround(text, needles, width) {
  if (text.length <= width) return text;
  const hay = text.toLowerCase();
  let at = -1;
  for (const n of (needles || [])) {
    const i = hay.indexOf(String(n).toLowerCase());
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0 || at < width / 2) return text.slice(0, width);
  // 命中前面留三分之一：要的东西常常在命中词的**前面**（「Sat 12 Sep 2026 … Walking Only」，
  // 问的是 walking，日期在它前头 45 个字）。再往回退到最近的空格，别把词切成半个。
  let start = Math.max(0, at - Math.floor(width / 3));
  const back = text.lastIndexOf(' ', start);
  if (back >= 0 && start - back <= 24) start = back + 1;
  return `…${text.slice(start, start + width)}`;
}

function buildNumbered(entries, maxChars, needles) {
  const lines = [];
  let used = 0;
  // 预算不平均分。答案几乎总在最前面那几条里，平均分等于把额度摊薄给了本来就不重要的尾巴——
  // 实测一次：排第三的那条记录 5555 字，答案在它的末尾，而平均分只给了它 1000 字。
  // 上限也从 900 抬到 2500：900 是「一次给四十条」时代的数字，现在通常只留八条。
  const weight = (i) => (i < 3 ? 2 : 1);
  const totalW = entries.reduce((n, _, i) => n + weight(i), 0) || 1;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const perItem = Math.max(200, Math.min(2500, Math.floor((maxChars * weight(i)) / totalW)));
    const excerpt = windowAround((e.text || e.summary || '').replace(/\s+/g, ' '), needles, perItem);

    const line = `[${i + 1}] ${e.dateKey} ${fmtTime(e.createdAt)} (${e.type}) ${e.title || e.path || e.url || ''}`
      + `${e.visionLabels ? ` | in the picture: ${e.visionLabels}` : ''}`
      + `${e.summary ? ` | ${e.summary}` : ''}`
      + `${excerpt ? ` | ${excerpt}` : ''}`;
    if (used + line.length > maxChars) { lines.push(`[... ${entries.length - i} lower-ranked items omitted]`); break; }
    lines.push(line); used += line.length;
  }
  return lines.join('\n');
}

function askSystem(languageName, small) {
  const lines = [
    'You answer questions about a person\'s own daily log. They saved screenshots, files, links and voice notes;',
    'the items below were retrieved for this question and are numbered, each with its date, time, type, title and an excerpt.',
    'Return JSON with these keys: "answer" \u2014 the answer in Markdown; "used" \u2014 the numbers of the items the answer actually relies on.',
    'Cite items inline as [1], [2] right where you use them.',
    `LANGUAGE RULE: answer in the same language as the question. If that is unclear, use ${languageName}.`,
    'Quote titles, names and terms exactly as they appear in the items, in their original language \u2014 never translate them.',
    'Answer only from the items. If they do not contain the answer, say so plainly and describe what is there instead; never invent an item, a date or a detail.',

  ];
  if (small) lines.push('Output only the JSON object, nothing else.');
  return lines.join(' ');
}

/**
 * @param {object} cfg   from config()
 * @param {{question:string, entries:Array}} input  entries in ranked order; the tail is dropped when the context is full
 */
async function answerQuestion(cfg, { question, entries, terms = [] }) {
  const limit = DIGEST_LIMIT[cfg.provider] || 12000;
  const small = cfg.provider === 'ollama' || cfg.provider === 'custom';
  const system = askSystem(cfg.languageName, small);
  const text = `Question: ${question}\n\nItems (${entries.length}), most relevant first:\n${buildNumbered(entries, limit, terms)}`;
  let raw;
  switch (cfg.provider) {
    case 'anthropic':
      raw = await ai.complete(anthropicAuth(cfg), { model: cfg.anthropic.model, system, text, schema: ASK_SCHEMA, maxTokens: 2048, effort: 'medium' });
      break;
    case 'openrouter':
      raw = await oai.chat(oai.openrouterClient(cfg.openrouter.apiKey, cfg.openrouter.model), { system, text, schema: ASK_SCHEMA, maxTokens: 1600 });
      break;
    case 'custom':
      raw = await oai.chat({ baseUrl: cfg.custom.baseUrl, apiKey: cfg.custom.apiKey, model: cfg.custom.model }, { system, text, schema: ASK_SCHEMA, maxTokens: 1600 });
      break;
    case 'ollama':
      raw = await ollama.chat({ host: cfg.ollama.host, model: cfg.ollama.model }, { system, text, schema: ASK_SCHEMA, maxTokens: 1800, numCtx: 12288 });
      break;
    default:
      throw new Error(`Unknown provider ${cfg.provider}`);
  }
  const parsed = parseJsonLoose(raw.text);
  // A small local model that ignores the schema still said something useful; take it as the answer.
  const answer = String((parsed && parsed.answer) || (parsed ? '' : raw.text) || '').trim();
  const used = parsed && Array.isArray(parsed.used)
    ? [...new Set(parsed.used.map(Number))].filter((n) => Number.isInteger(n) && n >= 1 && n <= entries.length)
    : [];
  return { answer, used, model: raw.model ? `${raw.model} (${providerName(cfg.provider)})` : label(cfg) };
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

module.exports = { config, isConfigured, label, describe, dailySummary, answerQuestion, testProvider, PROVIDERS, TAG_SCHEMA, ASK_SCHEMA, _windowAround: windowAround, _buildNumbered: buildNumbered };
