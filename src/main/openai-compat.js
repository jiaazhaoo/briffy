'use strict';
// Minimal chat client for OpenAI-compatible endpoints: OpenRouter, LM Studio, llama.cpp server, vLLM, DeepSeek, ...
// Uses the global fetch of Electron's Node; no SDK needed.

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const OPENROUTER_HEADERS = { 'HTTP-Referer': 'https://github.com/jiaazhaoo/briffy', 'X-Title': 'briffy' };

function stripThinking(s) {
  return String(s || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

async function postJson(url, { apiKey, headers = {}, body, timeoutMs = 120000 }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), ...headers },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    let json = null;
    try { json = JSON.parse(raw); } catch (_) { /* not json */ }
    if (!res.ok) {
      const msg = (json && json.error && (json.error.message || JSON.stringify(json.error))) || raw.slice(0, 300) || res.statusText;
      const err = new Error(`HTTP ${res.status}: ${msg}`);
      err.status = res.status;
      throw err;
    }
    if (json && json.error) throw new Error(json.error.message || JSON.stringify(json.error));
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{baseUrl:string, apiKey?:string, model:string, headers?:object, timeoutMs?:number}} client
 * @param {{system?:string, text:string, image?:{data:string, media_type:string}|null, schema?:object|null, maxTokens?:number, temperature?:number}} req
 * @returns {Promise<{text:string, model:string, usage?:object}>}
 */
async function chat(client, req) {
  const base = String(client.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('No base URL configured');
  if (!client.model) throw new Error('No model configured');
  const buildBody = ({ withImage, withSchema }) => {
    const messages = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    if (withImage && req.image) {
      messages.push({
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${req.image.media_type};base64,${req.image.data}` } },
          { type: 'text', text: req.text },
        ],
      });
    } else {
      messages.push({ role: 'user', content: req.text });
    }
    const body = { model: client.model, messages, max_tokens: req.maxTokens || 1024, temperature: req.temperature ?? 0.2 };
    if (withSchema && req.schema) body.response_format = { type: 'json_schema', json_schema: { name: 'result', strict: false, schema: req.schema } };
    return body;
  };

  // Retry ladder for servers/models that reject structured output or images.
  const attempts = [{ withImage: !!req.image, withSchema: !!req.schema }];
  if (req.schema) attempts.push({ withImage: !!req.image, withSchema: false });
  if (req.image) attempts.push({ withImage: false, withSchema: false });
  let lastErr = null;
  for (const attempt of attempts) {
    try {
      const json = await postJson(`${base}/chat/completions`, { apiKey: client.apiKey, headers: client.headers, body: buildBody(attempt), timeoutMs: client.timeoutMs });
      const choice = json && json.choices && json.choices[0];
      const msg = choice && choice.message;
      let out = '';
      if (msg) {
        if (typeof msg.content === 'string') out = msg.content;
        else if (Array.isArray(msg.content)) out = msg.content.map((p) => (p && p.text) || '').join('');
      }
      return { text: stripThinking(out), model: (json && json.model) || client.model, usage: json && json.usage };
    } catch (e) {
      lastErr = e;
      const retryable = e.status === 400 || e.status === 422 || e.status === 415;
      if (!retryable) throw e;
    }
  }
  throw lastErr;
}

/** Lists models of an OpenAI-compatible endpoint (GET /models). */
async function listModels(client) {
  const base = String(client.baseUrl || '').replace(/\/+$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), client.timeoutMs || 20000);
  try {
    const res = await fetch(`${base}/models`, {
      signal: ctrl.signal,
      headers: { ...(client.apiKey ? { authorization: `Bearer ${client.apiKey}` } : {}), ...(client.headers || {}) },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const data = Array.isArray(json.data) ? json.data : [];
    return data.map((m) => ({
      id: m.id,
      name: m.name || m.id,
      context: m.context_length || null,
      vision: !!(m.architecture && Array.isArray(m.architecture.input_modalities) && m.architecture.input_modalities.includes('image')),
      pricing: m.pricing ? { prompt: Number(m.pricing.prompt), completion: Number(m.pricing.completion) } : null,
    }));
  } finally {
    clearTimeout(timer);
  }
}

function openrouterClient(apiKey, model) {
  return { baseUrl: OPENROUTER_BASE, apiKey, model, headers: OPENROUTER_HEADERS };
}

module.exports = { chat, listModels, openrouterClient, OPENROUTER_BASE, OPENROUTER_HEADERS, stripThinking };
