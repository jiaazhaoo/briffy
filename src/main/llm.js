'use strict';
// Provider-independent titling and daily recap. Dispatches to OpenRouter,
// a local Ollama model, or any OpenAI-compatible endpoint. Prompts enforce the no-translation rule.
const fs = require('fs');
const os = require('os');
const path = require('path');
const oai = require('./openai-compat');
const ollama = require('./ollama');
const hardware = require('./hardware');
const { promptLanguageName } = require('./languages');

const redact = require('./redact');

// 2026-09-09 从四家收成两家。去掉的是 Claude 直连和自定义 OpenAI 兼容接口——它们都要求用户
// 离开 briffy 去别处干活（去控制台建一把 key 粘回来，或者装一个叫 ant 的命令行工具再登录一次），
// 而那正是「登录一直不通」的真正原因。留下的两家各有一条真正走得通的路：
// OpenRouter 有给第三方应用用的 OAuth（一次点击换一把属于用户自己的 key，同时通向 Claude 和 GPT），
// Ollama 在本机，什么都不用登录。
const PROVIDERS = ['openrouter', 'ollama'];
// How much item text each provider gets (characters). Local models have small context windows.
const TAG_LIMIT = { openrouter: 60000, ollama: 5000 };
// ollama 那一档以前是 8000 字。numCtx 是 12288 token，8000 字的中英混排大约用掉一半，
// 剩下的额度本来就空着。抬到 10000，同时把回答的 maxTokens 从 1200 抬到 1800——
// 实测一份行程单答到「需跟随穿荧光背心的」就断在半句上，那是被 1200 卡掉的。
const DIGEST_LIMIT = { openrouter: 60000, ollama: 10000 };

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

// 改写这一步的三个上限。带太多轮上文会把主语稀释掉（正是这一层要治的病），
// 查询太长向量就钝（同一个稀释效应），条数太多则每条只能取一两个名额。
const PLAN_TURNS = 3;      // 最多带几轮上文
const PLAN_ANSWER = 400;   // 每轮答案截到这么长
const PLAN_MAX = 8;        // 最多几条查询
const PLAN_MAXLEN = 40;
const PLAN_SEEDS = 24;        // 最多给它看几个已经在手上的名字
// 分类词。小模型对「不要输出 X」这种否定指令是不听的——实测原样给了
// activity / route / schedule / plan / itinerary / event / trip 七个。所以在代码里滤，不在提示里求。
// 这张表是**有限的**：它是「问句里指代事物的那一类词」，不是英语或中文的全部名词。
const PLAN_BANNED = new Set(('activity activities event events schedule plan plans itinerary route routes '
  + 'address addresses location locations place places detail details info information record records note notes '
  + 'trip journey thing things item items data content summary list overview '
  + '活动 行程 路线 地址 地点 位置 详情 信息 记录 内容 安排 计划 清单 概况 东西').split(/\s+/));    // 一条查询最长这么多字符——超过就不是「几个实词」了

const ASK_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', description: 'The answer in Markdown, citing items as [1], [2]' },
    used: { type: 'array', items: { type: 'integer' }, description: 'Numbers of the items the answer actually relies on' },
  },
  required: ['answer', 'used'],
  additionalProperties: false,
};

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    queries: { type: 'array', items: { type: 'string' }, description: 'Independent search queries, 1-3 content words each' },
  },
  required: ['queries'],
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
    provider: PROVIDERS.includes(s.provider) ? s.provider : 'openrouter',
    languageName: promptLanguageName(s.languages),
    openrouter: { apiKey: secret('openrouterKey', 'openrouterKey'), model: s.openrouterModel || 'anthropic/claude-opus-5' },
    ollama: { host: s.ollamaHost || ollama.DEFAULT_HOST, model: s.ollamaModel || rec.model, recommended: !s.ollamaModel },
    redactLevel: redact.levelOf(s),
  };
}

/**
 * 出门那一下。**每一段发给模型的正文都从这儿过**——这个文件里有五条出去的路
 * （起标题、每日摘要、问、改写查询、一键翻译），一条也不能绕开它。
 *
 * 盖的只是发出去的那一份，磁盘上的记录一个字不动（见 redact.js 顶上）。
 * 盖了什么写进日志：默默改掉用户的正文而不吭声，比不盖还糟——答案对不上时他得能查出为什么。
 * @param {object} cfg
 * @param {string} text
 * @param {string} what 日志里说这是哪条路
 */
function outbound(cfg, text, what) {
  const r = redact.mask(text, { level: (cfg || {}).redactLevel });
  if (r.n) console.log(`[redact] ${what}：出门前隐去 ${r.n} 处（${redact.summary(r.hits)}）`);
  return r.text;
}

function isConfigured(cfg) {
  switch (cfg.provider) {
    case 'openrouter': return !!cfg.openrouter.apiKey;
    case 'ollama': return !!cfg.ollama.host && !!cfg.ollama.model;
    default: return false;
  }
}

/**
 * 差什么才能用。界面上「还没配」三个字说明不了任何事——缺 baseUrl 还是缺模型名，
 * 是两个完全不同的下一步。
 * @returns {string} 空字符串 = 现在就能用
 */
function missing(cfg) {
  switch (cfg.provider) {
    case 'openrouter': return cfg.openrouter.apiKey ? '' : 'apiKey';
    case 'ollama': return cfg.ollama.host ? (cfg.ollama.model ? '' : 'model') : 'host';
    default: return 'provider';
  }
}

function label(cfg) {
  switch (cfg.provider) {
    case 'openrouter': return `${cfg.openrouter.model} (OpenRouter)`;
    case 'ollama': return `${cfg.ollama.model} (Ollama)`;
    default: return cfg.provider;
  }
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
/**
 * 一键翻译：把一段已经认出来的字翻成界面语言。
 *
 * 走的是文字，不是图片——图片从不出这台电脑（workspace.js 里那条规矩），
 * 而 OCR 早就把字读出来了，再把原图发一遍既慢又多余。
 */
async function translate(cfg, { text }) {
  const limit = TAG_LIMIT[cfg.provider] || 12000;
  const body = outbound(cfg, String(text || '').slice(0, limit), '一键翻译');
  const system = [
    `Translate the user's text into ${cfg.languageName}.`,
    'Return only the translation: no preface, no notes, no quotes around it.',
    'Keep the line breaks and the order of the lines as they are.',
    'Leave names, products, places, code, urls and technical terms in their original form.',
    `If a line is already in ${cfg.languageName}, repeat it unchanged.`,
  ].join(' ');
  let raw;
  switch (cfg.provider) {
    case 'openrouter':
      raw = await oai.chat(oai.openrouterClient(cfg.openrouter.apiKey, cfg.openrouter.model), { system, text: body, maxTokens: 2000 });
      break;
    case 'ollama':
      raw = await ollama.chat({ host: cfg.ollama.host, model: cfg.ollama.model }, { system, text: body, maxTokens: 1600, numCtx: 8192 });
      break;
    default:
      throw new Error(`Unknown provider ${cfg.provider}`);
  }
  return {
    text: String(raw.text || '').trim(),
    model: raw.model ? `${raw.model} (${providerName(cfg.provider)})` : label(cfg),
  };
}

async function describe(cfg, input) {
  const limit = TAG_LIMIT[cfg.provider] || 12000;
  const image = input.kind === 'image' && input.image ? oai.prepareImage(input.image, input.imageMime) : null;
  const small = cfg.provider === 'ollama';
  const system = tagSystem(cfg.languageName, small);
  // PDF 一律只带抽出来的字，不带原件——原来只有 Anthropic 那一档会附 PDF，那一家 2026-09-09 去掉了。
  const text = outbound(cfg, buildTagText(input, limit, { attachedImage: !!image }), '起标题');
  let raw;
  switch (cfg.provider) {
    case 'openrouter':
      raw = await oai.chat(oai.openrouterClient(cfg.openrouter.apiKey, cfg.openrouter.model), { system, text, image, schema: TAG_SCHEMA, maxTokens: 800 });
      break;
    case 'ollama':
      raw = await ollama.chat({ host: cfg.ollama.host, model: cfg.ollama.model }, { system, text, image, schema: TAG_SCHEMA, maxTokens: 600, numCtx: 8192 });
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
  return { openrouter: 'OpenRouter', ollama: 'Ollama' }[p] || p;
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
  const small = cfg.provider === 'ollama';
  const system = digestSystem(cfg.languageName, small, headings);
  // The counts come first and are already true, so the model never has to work out how many of
  // anything there were -- the one thing it is reliably bad at and the one thing that is cheap to know.
  const text = outbound(cfg, `${counts ? `Counts for this day (these are correct, use them as given):\n${counts}\n\n` : ''}Date: ${dateKey}\nItems (${entries.length}):\n${buildDigest(entries, limit)}`, '每日摘要');
  let raw;
  switch (cfg.provider) {
    case 'openrouter':
      raw = await oai.chat(oai.openrouterClient(cfg.openrouter.apiKey, cfg.openrouter.model), { system, text, maxTokens: 2048 });
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
    'Be short and concrete: a direct answer first, then only the detail that supports it.',
    // 同一条记录里常常既写着「所有可选项」，也写着「这个人选了哪一个」。两次实测都栽在这儿：
    // 第一次把报名页上的 10/25/50/100km 全列成他的项目，第二次把普通组的出发时段安到了他头上，
    // 而正确的那半句就在同一行里。所以明说：先认人选了哪个，别的选项不是他的。
    'When the items list options, tiers or categories, work out which one this person actually chose or booked, and answer for that one. Do not present the other options as theirs, and do not repeat a detail that the items attach to a different option.',
  ];
  if (small) lines.push('Output only the JSON object, nothing else.');
  return lines.join(' ');
}

/**
 * @param {object} cfg   from config()
 * @param {{question:string, entries:Array}} input  entries in ranked order; the tail is dropped when the context is full
 */
/**
 * 这一问该拿什么去检索。**问之前先问一次模型。**
 *
 * ask.js 顶上那条「挑记录完全不经过模型」是为了三件事：断网还能定位、没配 AI 还有一份正确的
 * 清单、延迟确定。这一层不破那三条——它是**加在上面**的：模型不在就退回原句，退回去就是从前那套。
 *
 * 为什么非要它不可，是量出来的（dev/ask-address-probe.js）：
 *   「我记下来了详细地址，你找一下」——递给模型的八条里 0 条写着地址。
 *   地址那几条记录全部的词汇是 Windsor / Road / Egham / TW20 / 0AE，里头没有「地址」二字；
 *   而主语（那场徒步）在上一问里，这一句自己没有。词面和向量都够不着，因为**要找的东西和
 *   问的话不共用任何一个词，而补上那个词需要读懂上文**。这件事只有模型做得了。
 *
 * 输出的是**几条互相独立的查询**，不是一句话。这一条是今天最贵的一个发现：同样几个词，
 * 揉成一句「Bishops Park Fulham Runnymede Staines…」只捞回 1/7，拆成五条分开的查询捞回 3/7。
 * 向量对多余的字没有免疫力——一个查询装不下一个问题的几个面，塞进去就成了一团谁也不像的云。
 *
 * 还有一条也是量出来的：中文概念要再出一条英文的。「停车」在这个工作区里搜出 0 条，
 * 因为那几条记录上写的是 parking / Parking space。
 *
 * @param {object} cfg
 * @param {{question:string, history:{question:string,answer:string}[]}} args
 * @returns {Promise<string[]>} 几条查询；拿不到就是空数组，调用方退回原句
 */
async function searchPlan(cfg, { question, history = [], seeds = [] }) {
  const q = String(question || '').trim();
  if (!q) return [];
  const sys = [
    'Turn the user\'s latest message into a few INDEPENDENT search queries for their own capture library',
    '(screenshots, clipboard text, voice notes they saved themselves).',
    'Rules:',
    '- Each query is 1-3 content words. Never a sentence. No question words, no politeness.',
    '- Keep the user\'s OWN distinctive words as queries, in their own language, verbatim.',
    '- The latest message usually omits its subject; take it from the conversation above.',
    '  Every place name, event name or product name mentioned earlier becomes its OWN query.',
    '- Their notes are often in another language than the question, so emit the English form',
    '  of each concept as a separate query too (停车 -> parking, 车站 -> station).',
    '- Prefer names, numbers and proper nouns over abstractions.',
    '- "Names already in hand" were pulled out of their own notes on this subject. These exact',
    '  strings are in the library. Pick the ones this question is about and copy them VERBATIM,',
    '  one per query. Prefer them over anything you invent.',
    'Return JSON: {"queries": ["...", "..."]} with 4 to 8 entries.',
  ].join(' ');
  // 只带最近几轮：更早的轮次会把主语稀释掉，而稀释正是这一层要治的病
  const talk = history.slice(-PLAN_TURNS).map((t) => {
    const a = String((t && t.answer) || '').replace(/\s+/g, ' ').slice(0, PLAN_ANSWER);
    return `Q: ${String((t && t.question) || '').replace(/\s+/g, ' ')}\nA: ${a}`;
  }).join('\n');
  // 给的是**从手上那几条记录里抽出来的名字**，不是正文。
  //
  // 给正文试过，不成：上一轮用上的那条是「赛程分前后半程 - Claude」，剥完家具的头 300 字仍然是
  // claude.ai 的宣传语（"Claude is Anthropic's AI, built for problem solvers…"），而终点 Runnymede
  // 在更后面。截多长都是赌。而名字这一份是 entity.js 已经算好的：Bishops · Fulham · Runnymede ·
  // 接驳 · 车站 · 50km——正是要它抄的东西，而且不用截。
  const hand = [...new Set(seeds)].slice(0, PLAN_SEEDS).map((x) => `- ${x}`).join('\n');
  const text = outbound(cfg, `${talk ? `[conversation so far]\n${talk}\n\n` : ''}`
    + `${hand ? `[names already in hand]\n${hand}\n\n` : ''}[latest message]\n${q}`, '改写查询');
  let raw;
  try {
    switch (cfg.provider) {
      case 'openrouter':
        raw = await oai.chat(oai.openrouterClient(cfg.openrouter.apiKey, cfg.openrouter.model), { system: sys, text, schema: PLAN_SCHEMA, maxTokens: 300 });
        break;
      case 'ollama':
        raw = await ollama.chat({ host: cfg.ollama.host, model: cfg.ollama.model }, { system: sys, text, schema: PLAN_SCHEMA, maxTokens: 300, numCtx: 8192 });
        break;
      default:
        return [];
    }
  } catch (_) { return []; }        // 改写不了就退回原句，问答这条路不能因为它断掉
  const parsed = parseJsonLoose(raw && raw.text);
  const list = parsed && Array.isArray(parsed.queries) ? parsed.queries : [];
  const out = [];
  for (const x of list) {
    const s2 = String(x || '').replace(/\s+/g, ' ').trim();
    if (!s2 || s2.length > PLAN_MAXLEN || out.includes(s2)) continue;
    // 整条都是分类词的丢掉：「行程」「address」谁的记录里都不写，占一格就少一个真名字的位子
    const parts = s2.toLowerCase().split(/[\s·,，、]+/).filter(Boolean);
    if (parts.length && parts.every((w) => PLAN_BANNED.has(w))) continue;
    out.push(s2);
    if (out.length >= PLAN_MAX) break;
  }
  return out;
}

async function answerQuestion(cfg, { question, entries, terms = [], history = [] }) {
  const limit = DIGEST_LIMIT[cfg.provider] || 12000;
  const small = cfg.provider === 'ollama';
  const system = askSystem(cfg.languageName, small);
  // 上文要给，否则「详细地址」这种省略了主语的追问，模型手上有对的记录也说不清是哪儿的地址。
  // 只给最近几轮、答案截短：多给会把这一问的主语淹掉，和 searchPlan 那边同一个道理。
  const talk = history.slice(-PLAN_TURNS).map((t) => `Q: ${String((t && t.question) || '').replace(/\s+/g, ' ')}\nA: ${String((t && t.answer) || '').replace(/\s+/g, ' ').slice(0, PLAN_ANSWER)}`).join('\n');
  const text = outbound(cfg, `${talk ? `Conversation so far:\n${talk}\n\n` : ''}Question: ${question}\n\nItems (${entries.length}), most relevant first:\n${buildNumbered(entries, limit, terms)}`, '问');
  let raw;
  switch (cfg.provider) {
    case 'openrouter':
      raw = await oai.chat(oai.openrouterClient(cfg.openrouter.apiKey, cfg.openrouter.model), { system, text, schema: ASK_SCHEMA, maxTokens: 1600 });
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
    case 'openrouter': { const r = await oai.chat(oai.openrouterClient(cfg.openrouter.apiKey, cfg.openrouter.model), probe); return { ok: true, model: r.model, reply: r.text }; }
    case 'ollama': { const r = await ollama.chat({ host: cfg.ollama.host, model: cfg.ollama.model }, { ...probe, numCtx: 2048 }); return { ok: true, model: r.model, reply: r.text }; }
    default: throw new Error(`Unknown provider ${cfg.provider}`);
  }
}

module.exports = { config, isConfigured, missing, label, describe, translate, dailySummary, answerQuestion, searchPlan, testProvider, PROVIDERS, TAG_SCHEMA, ASK_SCHEMA, PLAN_SCHEMA, PLAN_MAX, _windowAround: windowAround, _buildNumbered: buildNumbered };
