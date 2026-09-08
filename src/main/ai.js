'use strict';
// Anthropic (Claude) provider: request mechanics only – prompts live in llm.js.
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const { nativeImage } = require('electron');

const MODELS = [
  { id: 'claude-opus-5', name: 'Claude Opus 5 (default)' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5 (fastest)' },
  { id: 'claude-fable-5-1', name: 'Claude Fable 5.1' },
];

const MAX_IMAGE_EDGE = 1568;
const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;
const MAX_PDF_BYTES = 30 * 1024 * 1024;

function supportsFallbacks(model) { return /^claude-(opus-5|fable|mythos)/.test(model); }
function supportsEffort(model) { return !/haiku|sonnet-4-5/.test(model); }

/**
 * @param {{apiKey?:string, account?:boolean}} auth  `apiKey` for a static key; `account: true` lets the SDK
 *        resolve the account signed in via `claude auth login` (or ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN).
 */
function makeClient(auth = {}) {
  const opts = { timeout: 120000, maxRetries: 2 };
  if (auth.apiKey) opts.apiKey = auth.apiKey;
  return new Anthropic(opts);
}

async function request(client, { model, system, content, schema, maxTokens = 1024, effort = 'low' }) {
  const params = { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] };
  const output_config = {};
  if (schema) output_config.format = { type: 'json_schema', schema };
  if (effort && supportsEffort(model)) output_config.effort = effort;
  if (Object.keys(output_config).length) params.output_config = output_config;

  const send = async (p) => (supportsFallbacks(model)
    ? client.beta.messages.create({ ...p, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
    : client.messages.create(p));

  let res;
  try {
    res = await send(params);
  } catch (e) {
    // Older models may reject structured outputs / effort: retry once with a plain request.
    if (e instanceof Anthropic.BadRequestError && params.output_config) {
      const { output_config: _drop, ...plain } = params;
      res = await send(plain);
    } else {
      throw e;
    }
  }
  if (res.stop_reason === 'refusal') {
    const why = res.stop_details && res.stop_details.explanation ? `: ${res.stop_details.explanation}` : '';
    throw new Error(`The model declined this request${why}`);
  }
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  return { text, model: res.model, usage: res.usage };
}

// ---------- content preparation (shared with the other providers) ----------
/** @returns {{data:string, media_type:string}|null} JPEG (or raw gif/webp) base64 sized for vision models */
function prepareImage(source, mime) {
  let img = Buffer.isBuffer(source) ? nativeImage.createFromBuffer(source) : nativeImage.createFromPath(source);
  if (img.isEmpty()) {
    if (mime === 'image/gif' || mime === 'image/webp') {
      const raw = Buffer.isBuffer(source) ? source : fs.readFileSync(source);
      if (raw.length <= MAX_IMAGE_BYTES) return { data: raw.toString('base64'), media_type: mime };
    }
    return null;
  }
  const { width, height } = img.getSize();
  if (Math.max(width, height) > MAX_IMAGE_EDGE) {
    img = width >= height ? img.resize({ width: MAX_IMAGE_EDGE }) : img.resize({ height: MAX_IMAGE_EDGE });
  }
  let quality = 85;
  let buf = img.toJPEG(quality);
  while (buf.length > MAX_IMAGE_BYTES && quality > 30) { quality -= 15; buf = img.toJPEG(quality); }
  return { data: buf.toString('base64'), media_type: 'image/jpeg' };
}

function pdfBlock(source) {
  const buf = Buffer.isBuffer(source) ? source : fs.readFileSync(source);
  if (buf.length > MAX_PDF_BYTES) return null;
  return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } };
}

/**
 * One tagging/summary request. `image` is a prepared image ({data, media_type}); `pdf` a Buffer or path that
 * is attached natively as a document block.
 */
async function complete(auth, { model, system, text, image = null, pdf = null, schema = null, maxTokens = 1024, effort = 'low' }) {
  const client = makeClient(auth);
  const content = [];
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.media_type, data: image.data } });
  if (pdf) { const block = pdfBlock(pdf); if (block) content.push(block); }
  content.push({ type: 'text', text });
  return request(client, { model, system, content, schema, maxTokens, effort });
}

async function testAuth(auth, model) {
  const client = makeClient(auth);
  const { text, model: used } = await request(client, {
    model: model || 'claude-opus-5',
    system: 'Reply with the single word OK.',
    content: [{ type: 'text', text: 'ping' }],
    maxTokens: 16,
    effort: 'low',
  });
  return { ok: true, model: used, reply: text };
}

module.exports = { complete, testAuth, prepareImage, MODELS, makeClient };
