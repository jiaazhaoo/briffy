'use strict';
// Ollama client: status, installed models, pulling with progress, and chat (native /api/chat).
// Also knows how to find, start and install the Ollama binary, because "connection refused" is the most
// common failure and users should not have to guess what it means.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { stripThinking } = require('./openai-compat');

const DEFAULT_HOST = 'http://127.0.0.1:11434';
const DOWNLOAD_URL = 'https://ollama.com/download';
const THINKING_MODELS = /^(qwen3|deepseek-r1|gpt-oss|magistral|phi4-reasoning|nemotron)/i;
const VISION_MODELS = /(vl|vision|llava|gemma3|gemma4|qwen3\.5|qwen3\.6|qwen3\.8|minicpm-v|moondream|granite3\.2-vision|mistral-small3|llama4)/i;

function normHost(host) { return String(host || DEFAULT_HOST).replace(/\/+$/, ''); }

async function request(host, path, { method = 'GET', body, timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${normHost(host)}${path}`, {
      method, signal: ctrl.signal,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const raw = await res.text();
    let json = null;
    try { json = JSON.parse(raw); } catch (_) { /* not json */ }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}: ${(json && json.error) || raw.slice(0, 200) || res.statusText}`);
      err.status = res.status;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- finding / starting / installing the binary ----------
function which(cmd) {
  return new Promise((resolve) => {
    execFile(process.platform === 'win32' ? 'where' : 'which', [cmd], { windowsHide: true, timeout: 5000 },
      (err, out) => resolve(!err && String(out).trim() ? String(out).trim().split(/\r?\n/)[0].trim() : ''));
  });
}

/** Locates the ollama executable on PATH or in the places its installers use. */
async function findBinary() {
  const onPath = await which('ollama');
  if (onPath) return onPath;
  const home = os.homedir();
  const candidates = process.platform === 'win32'
    ? [path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs', 'Ollama', 'ollama.exe'),
       path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Ollama', 'ollama.exe')]
    : process.platform === 'darwin'
      ? ['/usr/local/bin/ollama', '/opt/homebrew/bin/ollama', '/Applications/Ollama.app/Contents/Resources/ollama']
      : ['/usr/local/bin/ollama', '/usr/bin/ollama', path.join(home, '.local', 'bin', 'ollama')];
  for (const p of candidates) { try { if (fs.existsSync(p)) return p; } catch (_) { /* ignore */ } }
  return '';
}

/** Starts `ollama serve` in the background and waits until the API answers. */
async function startServer(host, { timeoutMs = 25000 } = {}) {
  const bin = await findBinary();
  if (!bin) return { ok: false, installed: false, error: 'not installed' };
  try {
    const child = spawn(bin, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
  } catch (e) {
    return { ok: false, installed: true, error: e.message };
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    try { await request(host, '/api/version', { timeoutMs: 2500 }); return { ok: true, installed: true }; } catch (_) { /* keep waiting */ }
  }
  return { ok: false, installed: true, error: 'server did not answer in time' };
}

/**
 * Installs Ollama with the platform's package manager. Progress lines are streamed to `onLine`.
 * Returns { ok, method } or { ok: false, manual: true, url } when no package manager is available.
 */
async function install(onLine) {
  const say = (s) => { if (onLine && s) onLine(String(s).replace(/\r/g, '').trim()); };
  let cmd = null;
  if (process.platform === 'win32' && await which('winget')) {
    cmd = { file: 'winget', args: ['install', '--id', 'Ollama.Ollama', '-e', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'], method: 'winget' };
  } else if (process.platform === 'darwin' && await which('brew')) {
    cmd = { file: 'brew', args: ['install', '--cask', 'ollama'], method: 'homebrew' };
  } else if (process.platform === 'linux' && await which('sh')) {
    cmd = { file: 'sh', args: ['-c', 'curl -fsSL https://ollama.com/install.sh | sh'], method: 'install.sh' };
  }
  if (!cmd) return { ok: false, manual: true, url: DOWNLOAD_URL };
  say(`$ ${cmd.file} ${cmd.args.join(' ')}`);
  const code = await new Promise((resolve) => {
    const child = spawn(cmd.file, cmd.args, { windowsHide: true });
    child.stdout.on('data', (d) => say(d.toString()));
    child.stderr.on('data', (d) => say(d.toString()));
    child.on('error', (e) => { say(e.message); resolve(-1); });
    child.on('close', resolve);
  });
  if (code !== 0) return { ok: false, method: cmd.method, exitCode: code, url: DOWNLOAD_URL };
  return { ok: true, method: cmd.method, binary: await findBinary() };
}

/**
 * @returns {Promise<{running:boolean, version?:string, models:Array, installed:boolean, binary:string, error?:string, reason?:string}>}
 *   reason: 'not-installed' | 'not-running' | 'error'
 */
async function status(host) {
  try {
    const v = await request(host, '/api/version', { timeoutMs: 4000 });
    const tags = await request(host, '/api/tags', { timeoutMs: 8000 });
    const models = (tags.models || []).map((m) => ({
      name: m.name,
      size: m.size,
      family: m.details && m.details.family,
      parameterSize: m.details && m.details.parameter_size,
      quantization: m.details && m.details.quantization_level,
      vision: VISION_MODELS.test(m.name) || /(clip|mllama|vision)/i.test((m.details && (m.details.families || []).join(',')) || ''),
    }));
    return { running: true, version: v.version, models, installed: true, binary: await findBinary() };
  } catch (e) {
    const binary = await findBinary();
    return {
      running: false, models: [], installed: !!binary, binary,
      reason: binary ? 'not-running' : 'not-installed',
      error: e.message,
    };
  }
}

/**
 * Pulls a model, streaming progress. Resolves when complete.
 * @param {(p:{status:string, completed?:number, total?:number, percent?:number})=>void} [onProgress]
 */
async function pull(host, model, onProgress, { signal } = {}) {
  let res;
  try {
    res = await fetch(`${normHost(host)}/api/pull`, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
    });
  } catch (e) {
    // "fetch failed" means nothing to a user: say whether Ollama is missing or just not running.
    const st = await status(host);
    const err = new Error(st.installed ? 'ollama-not-running' : 'ollama-not-installed');
    err.code = err.message;
    err.cause = e;
    throw err;
  }
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let last = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let j;
      try { j = JSON.parse(line); } catch (_) { continue; }
      if (j.error) throw new Error(j.error);
      last = j;
      if (onProgress) onProgress({ status: j.status || '', completed: j.completed, total: j.total, percent: j.total ? Math.round((j.completed || 0) / j.total * 100) : undefined });
    }
  }
  return last;
}

/**
 * @param {{host:string, model:string}} client
 * @param {{system?:string, text:string, image?:{data:string, media_type:string}|null, schema?:object|null, maxTokens?:number, numCtx?:number}} req
 */
async function chat(client, req) {
  const host = client.host || DEFAULT_HOST;
  const model = client.model;
  if (!model) throw new Error('No Ollama model selected');
  try { await request(host, '/api/version', { timeoutMs: 3000 }); } catch (_) {
    const st = await status(host);
    throw new Error(st.installed ? 'Ollama is installed but not running – start it and try again' : 'Ollama is not installed');
  }
  const canSeeImages = VISION_MODELS.test(model);
  let state = {
    think: THINKING_MODELS.test(model),
    image: !!(req.image && canSeeImages),
    format: req.schema ? 'schema' : null,
  };
  for (let attempt = 0; attempt < 6; attempt++) {
    const messages = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    const user = { role: 'user', content: req.text };
    if (state.image) user.images = [req.image.data];
    messages.push(user);
    const body = {
      model, messages, stream: false,
      options: { temperature: 0.2, num_ctx: req.numCtx || 8192, num_predict: req.maxTokens || 700 },
      keep_alive: '10m',
    };
    if (state.think) body.think = false;
    if (state.format === 'schema') body.format = req.schema;
    else if (state.format === 'json') body.format = 'json';
    try {
      const json = await request(host, '/api/chat', { method: 'POST', body, timeoutMs: 10 * 60 * 1000 });
      const content = json && json.message ? json.message.content : '';
      return { text: stripThinking(content), model: json.model || model };
    } catch (e) {
      if (e.status !== 400 && e.status !== 404 && e.status !== 500) throw e;
      const msg = String(e.message).toLowerCase();
      if (e.status === 404 || /not found|pull/.test(msg)) throw new Error(`Model "${model}" is not installed in Ollama (${e.message})`);
      // degrade one capability per retry
      if (state.think && /think/.test(msg)) state.think = false;
      else if (state.image && /image|vision|multimodal/.test(msg)) state.image = false;
      else if (state.format === 'schema') state.format = 'json';
      else if (state.format === 'json') state.format = null;
      else if (state.think) state.think = false;
      else if (state.image) state.image = false;
      else throw e;
    }
  }
  throw new Error('Ollama request failed after retries');
}

module.exports = { status, pull, chat, findBinary, startServer, install, DEFAULT_HOST, DOWNLOAD_URL, VISION_MODELS };
