'use strict';
// Draws the desktop pet with a top-tier image model, following
// .claude/skills/pet-as-character/SKILL.md (a desktop-pet fork of ip-as-logo).
//
//   node scripts/gen-pet.js identity                     6 centred candidates: A1 A2 B1 B2 C1 C2
//   node scripts/gen-pet.js identity --only B            just that direction
//   node scripts/gen-pet.js frames --from assets/pet/raw/B1.png    the 8 pose frames
//
// Provider is picked from whichever key is present, or forced with --provider:
//   OPENAI_API_KEY      gpt-image-2         real transparency, no key colour needed
//   GEMINI_API_KEY      gemini-3-pro-image  flat key colour, removed by pet-cutout.js
//   OPENROUTER_API_KEY  google/gemini-3-pro-image-preview
// Run it through Electron instead (`npm run pet:electron -- identity`) to reuse the
// OpenRouter key the app already stored in the system keychain.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RAW = path.join(ROOT, 'assets', 'pet', 'raw');
const BRIEF = path.join(__dirname, 'pet-brief.json');

// ---------------------------------------------------------------- arguments
function parseArgs(argv) {
  const out = { cmd: argv[0] || 'identity', flags: {} };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) out.flags[a.slice(2, eq)] = a.slice(eq + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out.flags[a.slice(2)] = argv[++i];
    else out.flags[a.slice(2)] = true;
  }
  return out;
}

// ---------------------------------------------------------------- prompts
// Both skeletons live in the skill; keep the two copies in sync when editing.
function identityPrompt(dir, keyColor, transparent) {
  const background = transparent
    ? 'Background: leave the entire background empty and transparent, with nothing behind the creature.'
    : `Background: fill the entire square with a completely flat, uniform ${keyColor}. Keep it perfectly even everywhere, with no gradient, texture, shadow, vignette or lighting variation. No colour in the creature may be ${keyColor} or a near shade of it.`;
  return [
    'Create one complete full-bleed 1:1 square image.',
    background,
    `Subject: place one extremely simplified, cute, endearing ${dir.subject} on the background, drawn as a complete standing body - head, torso, both front limbs, both feet and ${dir.feature} - reduced to one soft rounded continuous silhouette.`,
    'Placement: centre the creature horizontally, upright, facing the viewer. Fit the whole body inside the square with a clear even margin on all four sides so nothing is cropped and nothing touches an edge. The creature fills about 80% of the square height and rests on an invisible floor a little above the bottom edge.',
    'Complexity: use only 5-9 large basic shapes, at most two broad internal colour regions and one small accent. Use two simple eyes and one small mouth. Remove every nonessential line, outline, anatomical detail, texture and decoration. Keep the creature readable when it is only 110 pixels tall.',
    `Colour behaviour: give it ${dir.colors}. Organise the two base colours into broad purposeful masses and reuse them for the facial marks. Keep the creature clearly separated from the background. Do not make the body mostly white, mostly black or mostly grey.`,
    `Expression: ${dir.expression}.`,
    'Style: make simplification, cuteness and lovable baby-like appeal the strongest qualities. Use a large head, a compact body, short limbs, soft cheeks, widely spaced simple eyes, thick rounded contours and an ultra-clean graphic treatment. Prefer one clear shape over several explanatory details. Add an extremely, extremely subtle, almost imperceptible sense of depth.',
    `Finish: show only the creature${transparent ? '' : ' on the flat background'}, with clean surfaces and normal square outer corners.`,
    'Constraints: Use no text or watermark. Add no borders, frames, cards or presentation masks. Include one creature only, with no extra subjects, props, scenery, ground shadow, platform or pedestal. Use no fragile lines, sharp tips, unnecessary outlines, tiny details or decorative marks. Add no photorealistic material, dramatic bevel, glossy hotspot, deep occlusion, extrusion, strong three-dimensional rendering or external cast shadow.'
      + (transparent ? ' Put nothing at all behind the creature.' : ' Keep the background solid and uniform, with no texture, vignette or lighting variation.'),
  ].join('\n');
}

function framePrompt(frame, keyColor, transparent) {
  const background = transparent
    ? 'the same empty transparent background with nothing behind the creature'
    : `the same flat uniform ${keyColor} background filling the whole square`;
  return [
    'Redraw the creature in the attached image exactly as it is - identical species, silhouette, proportions, colours, level of simplification and drawing style - in one new pose.',
    `New pose: ${frame.pose}.`,
    `Keep everything else unchanged: the same two base colours and the same accent, the same head-to-body ratio, the same eye spacing and shape language, and ${background}.`,
    'Placement: centre the creature horizontally, upright, complete, with a clear even margin on all four sides so nothing is cropped and nothing touches an edge. Keep the creature the same size as in the reference, filling about 80% of the square height.',
    'Constraints: Change nothing except the pose and expression. Use no text or watermark, no props, no extra subjects, no scenery, no ground shadow, no platform, no borders or frames. Add no new colours, outlines, details or decorations.'
      + (transparent ? ' Put nothing at all behind the creature.' : ' Keep the background solid and uniform.'),
  ].join('\n');
}

// ---------------------------------------------------------------- providers
// Each returns a PNG Buffer. `ref` is an optional reference PNG Buffer.
const PROVIDERS = {
  openai: {
    env: 'OPENAI_API_KEY',
    secret: 'customKey',
    model: 'gpt-image-2',
    transparent: true,
    async draw(key, model, prompt, ref) {
      if (!ref) {
        const body = { model, prompt, n: 1, size: '1024x1024', output_format: 'png', background: 'transparent' };
        const json = await postJson('https://api.openai.com/v1/images/generations', body, { Authorization: `Bearer ${key}` });
        return b64(json.data[0].b64_json);
      }
      const form = multipart([
        ['model', model], ['prompt', prompt], ['n', '1'], ['size', '1024x1024'],
        ['output_format', 'png'], ['background', 'transparent'],
        ['image[]', ref, 'reference.png', 'image/png'],
      ]);
      const json = await post('https://api.openai.com/v1/images/edits', form.body, {
        Authorization: `Bearer ${key}`, 'Content-Type': form.contentType,
      });
      return b64(json.data[0].b64_json);
    },
  },
  gemini: {
    env: 'GEMINI_API_KEY',
    model: 'gemini-3-pro-image-preview',
    transparent: false,
    async draw(key, model, prompt, ref) {
      const parts = [{ text: prompt }];
      if (ref) parts.push({ inline_data: { mime_type: 'image/png', data: ref.toString('base64') } });
      const json = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        { contents: [{ parts }] },
        { 'x-goog-api-key': key },
      );
      for (const p of json.candidates?.[0]?.content?.parts || []) {
        const data = p.inlineData?.data || p.inline_data?.data;
        if (data) return b64(data);
      }
      throw new Error(`no image in response: ${JSON.stringify(json).slice(0, 400)}`);
    },
  },
  openrouter: {
    env: 'OPENROUTER_API_KEY',
    secret: 'openrouterKey',
    model: 'google/gemini-3-pro-image-preview',
    transparent: false,
    async draw(key, model, prompt, ref) {
      const content = [{ type: 'text', text: prompt }];
      if (ref) content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${ref.toString('base64')}` } });
      const json = await postJson('https://openrouter.ai/api/v1/chat/completions', {
        model, modalities: ['image', 'text'], messages: [{ role: 'user', content }],
      }, { Authorization: `Bearer ${key}`, 'HTTP-Referer': 'https://github.com/dailylogs', 'X-Title': 'DailyLogs pet' });
      const url = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      if (!url) throw new Error(`no image in response: ${JSON.stringify(json).slice(0, 400)}`);
      return b64(url.replace(/^data:image\/\w+;base64,/, ''));
    },
  },
};

function b64(s) { return Buffer.from(s, 'base64'); }

async function post(url, body, headers) {
  const res = await fetch(url, { method: 'POST', headers, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  try { return JSON.parse(text); } catch { throw new Error(`bad JSON: ${text.slice(0, 200)}`); }
}
function postJson(url, obj, headers) {
  return post(url, JSON.stringify(obj), { 'Content-Type': 'application/json', ...headers });
}
function multipart(fields) {
  const boundary = `----petform${Date.now().toString(16)}`;
  const chunks = [];
  for (const [name, value, filename, type] of fields) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${name}"`;
    if (filename) head += `; filename="${filename}"\r\nContent-Type: ${type}`;
    chunks.push(Buffer.from(`${head}\r\n\r\n`), Buffer.isBuffer(value) ? value : Buffer.from(String(value)), Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

// ---------------------------------------------------------------- key lookup
// Under Electron the app's own encrypted secrets are readable; under plain node
// only the environment (which is also what store.js falls back to).
function storedSecret(name) {
  if (!name || !process.versions.electron) return '';
  try {
    const { app, safeStorage } = require('electron');
    const file = path.join(app.getPath('userData'), 'settings.json');
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    const enc = s[`${name}Enc`];
    if (enc && safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    return s[`${name}Plain`] || '';
  } catch { return ''; }
}

function pickProvider(flags) {
  const names = flags.provider ? [flags.provider] : Object.keys(PROVIDERS);
  for (const name of names) {
    const p = PROVIDERS[name];
    if (!p) throw new Error(`unknown provider "${name}" (openai | gemini | openrouter)`);
    const key = flags.key || process.env[p.env] || storedSecret(p.secret);
    if (key) return { name, spec: p, key, model: flags.model || p.model };
  }
  throw new Error(
    'no image-model key found. Set one of OPENAI_API_KEY / GEMINI_API_KEY / OPENROUTER_API_KEY,\n' +
    'pass --key <key>, or run `npm run pet:electron -- identity` to reuse the key stored in the app.');
}

// ---------------------------------------------------------------- jobs
function buildJobs(cmd, brief, flags) {
  if (cmd === 'identity') {
    const only = flags.only ? String(flags.only).toUpperCase().split(',') : null;
    const dirs = brief.directions.filter((d) => !only || only.includes(d.id));
    if (!dirs.length) throw new Error(`--only ${flags.only} matched no direction in pet-brief.json`);
    const per = Number(flags.variants || 2);
    return dirs.flatMap((d) => Array.from({ length: per }, (_, i) => ({ label: `${d.id}${i + 1}`, dir: d })));
  }
  if (cmd === 'frames') {
    const only = flags.only ? String(flags.only).split(',') : null;
    const frames = brief.frames.filter((f) => !only || only.includes(f.id));
    if (!frames.length) throw new Error(`--only ${flags.only} matched no frame in pet-brief.json`);
    return frames.map((f) => ({ label: f.id, frame: f }));
  }
  throw new Error(`unknown command "${cmd}" (identity | frames)`);
}

async function main() {
  const { cmd, flags } = parseArgs(process.argv.slice(2));
  const brief = JSON.parse(fs.readFileSync(BRIEF, 'utf8'));
  const dry = !!flags['dry-run'];
  const { name, spec, key, model } = dry
    ? { name: 'dry-run', spec: PROVIDERS[flags.provider || 'openai'], key: '', model: flags.model || '-' }
    : pickProvider(flags);
  const transparent = spec.transparent && !flags['key-colour'];
  const keyColor = flags['key-colour'] || brief.keyColor;

  let ref = null;
  if (cmd === 'frames') {
    const from = flags.from;
    if (!from && !dry) throw new Error('frames needs --from <chosen candidate png>');
    if (from) ref = fs.readFileSync(path.resolve(ROOT, from));
  }

  const jobs = buildJobs(cmd, brief, flags);
  fs.mkdirSync(RAW, { recursive: true });
  console.log(`[pet] ${name} / ${model} / background: ${transparent ? 'transparent' : keyColor}`);
  console.log(`[pet] ${jobs.length} draw(s) -> ${path.relative(ROOT, RAW)}\n`);

  const failed = [];
  for (const job of jobs) {
    const prompt = job.dir ? identityPrompt(job.dir, keyColor, transparent) : framePrompt(job.frame, keyColor, transparent);
    process.stdout.write(`  ${job.label.padEnd(8)} ${job.dir ? job.dir.label : job.frame.id} ... `);
    if (dry) {
      fs.writeFileSync(path.join(RAW, `${job.label}.txt`), `${prompt}\n`);
      console.log(`prompt written (${prompt.length} chars)`);
      continue;
    }
    try {
      const png = await spec.draw(key, model, prompt, ref);
      fs.writeFileSync(path.join(RAW, `${job.label}.png`), png);
      fs.writeFileSync(path.join(RAW, `${job.label}.txt`), `${name} / ${model}\n\n${prompt}\n`);
      console.log(`ok (${(png.length / 1024).toFixed(0)} KB)`);
    } catch (err) {
      failed.push(job.label);
      console.log(`FAILED: ${err.message}`);
    }
  }

  console.log(`\n[pet] ${jobs.length - failed.length}/${jobs.length} drawn${failed.length ? `, failed: ${failed.join(', ')}` : ''}`);
  console.log('[pet] next: node scripts/pet-cutout.js');
  return failed.length ? 1 : 0;
}

function run() {
  main().then((code) => process.exit(code), (err) => { console.error(`[pet] ${err.message}`); process.exit(1); });
}
if (process.versions.electron) {
  const { app } = require('electron');
  app.whenReady().then(run);
} else {
  run();
}
