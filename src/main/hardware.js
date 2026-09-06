'use strict';
// Detects CPU / RAM / GPU and recommends a local model that fits the machine (for Ollama).
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { t } = require('./i18n');

// Qwen 3.5 open weights (multimodal, strong Chinese + English). Sizes are the default q4 tags on ollama.com.
const QWEN = [
  { model: 'qwen3.5:0.8b', sizeGB: 1.0, needGB: 2.0 },
  { model: 'qwen3.5:2b', sizeGB: 2.7, needGB: 4.0 },
  { model: 'qwen3.5:4b', sizeGB: 3.4, needGB: 5.0 },
  { model: 'qwen3.5:9b', sizeGB: 6.6, needGB: 9.0 },
  { model: 'qwen3.5:27b', sizeGB: 17, needGB: 20 },
];
const GEMMA_ALT = { model: 'gemma3:4b', sizeGB: 3.3, needGB: 5.0 };

let cached = null;
let detecting = null;

// A fixed float workload used as a rough single-core speed probe. It is not a benchmark suite: it only has
// to separate "this machine can afford the larger OCR model" from "it cannot". Lower is faster.
// Measured reference: AMD Ryzen 5 5600X ≈ 60 ms. Runs three times and keeps the best, ignoring JIT warm-up.
function cpuProbe() {
  const N = 384;
  const a = new Float64Array(N * N);
  const b = new Float64Array(N * N);
  for (let i = 0; i < a.length; i++) { a[i] = (i % 97) / 97; b[i] = (i % 89) / 89; }
  const once = () => {
    const c = new Float64Array(N * N);
    const t0 = Date.now();
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < N; k++) {
        const av = a[i * N + k];
        for (let j = 0; j < N; j++) c[i * N + j] += av * b[k * N + j];
      }
    }
    return Date.now() - t0;
  };
  return Math.min(once(), once(), once());
}

function run(cmd, args, { timeout = 8000, shell = false } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, shell, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

// Vulkan is what makes non-ROCm AMD / Intel GPUs usable for local models, so report whether it is present.
async function vulkanInfo() {
  const info = { available: false, device: '', api: '', driverDate: '' };
  if (process.platform === 'darwin') return { available: true, device: 'Metal', api: '', driverDate: '' }; // Metal, no Vulkan needed
  try {
    const out = await run('vulkaninfo', ['--summary'], { timeout: 12000 });
    const device = /deviceName\s*=\s*(.+)/.exec(out);
    const api = /apiVersion\s*=\s*.*\(([\d.]+)\)/.exec(out);
    if (device) { info.available = true; info.device = device[1].trim(); info.api = api ? api[1] : ''; return info; }
  } catch (_) { /* vulkaninfo is part of the SDK and usually absent */ }
  // fall back to the loader library, which ships with every GPU driver that supports Vulkan
  const loader = process.platform === 'win32'
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'vulkan-1.dll')
    : '/usr/lib/x86_64-linux-gnu/libvulkan.so.1';
  try { info.available = fs.existsSync(loader); } catch (_) { /* ignore */ }
  return info;
}

async function gpusWindows() {
  const out = [];
  const nv = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']);
  for (const line of nv.split(/\r?\n/)) {
    const m = /^(.+?),\s*(\d+)\s*$/.exec(line.trim());
    if (m) out.push({ name: m[1].trim(), vramGB: Math.round(Number(m[2]) / 1024 * 10) / 10, vendor: 'nvidia' });
  }
  if (out.length) return out;
  const script = [
    '$ErrorActionPreference="SilentlyContinue";',
    '$reg = Get-ChildItem "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}" | ForEach-Object {',
    '  $p = Get-ItemProperty $_.PSPath; if ($p.DriverDesc) { [pscustomobject]@{ name = [string]$p.DriverDesc; vram = [int64]$p."HardwareInformation.qwMemorySize" } } };',
    '$cim = Get-CimInstance Win32_VideoController | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; vram = [int64]$_.AdapterRAM } };',
    '@{ reg = @($reg); cim = @($cim) } | ConvertTo-Json -Compress -Depth 3',
  ].join(' ');
  const json = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 15000 });
  try {
    const data = JSON.parse(json);
    const seen = new Map();
    for (const src of ['reg', 'cim']) {
      for (const g of (Array.isArray(data[src]) ? data[src] : [data[src]]).filter(Boolean)) {
        if (!g.name) continue;
        const gb = Math.round(Number(g.vram || 0) / 2 ** 30 * 10) / 10;
        const cur = seen.get(g.name) || { name: g.name, vramGB: 0 };
        cur.vramGB = Math.max(cur.vramGB, gb);
        seen.set(g.name, cur);
      }
    }
    return [...seen.values()];
  } catch (_) { return []; }
}

async function gpusMac(info) {
  if (info.arch === 'arm64') {
    const chip = (await run('sysctl', ['-n', 'machdep.cpu.brand_string'])).trim() || 'Apple Silicon';
    return [{ name: chip, vramGB: info.ramGB, vendor: 'apple', unified: true }];
  }
  const json = await run('system_profiler', ['SPDisplaysDataType', '-json'], { timeout: 15000 });
  try {
    const list = JSON.parse(json).SPDisplaysDataType || [];
    return list.map((g) => {
      const vram = String(g.spdisplays_vram || g.spdisplays_vram_shared || '');
      const m = /(\d+(?:\.\d+)?)\s*(GB|MB)/i.exec(vram);
      const gb = m ? (m[2].toUpperCase() === 'GB' ? Number(m[1]) : Number(m[1]) / 1024) : 0;
      return { name: g.sppci_model || g._name, vramGB: Math.round(gb * 10) / 10 };
    });
  } catch (_) { return []; }
}

async function gpusLinux() {
  const nv = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']);
  const out = [];
  for (const line of nv.split(/\r?\n/)) {
    const m = /^(.+?),\s*(\d+)\s*$/.exec(line.trim());
    if (m) out.push({ name: m[1].trim(), vramGB: Math.round(Number(m[2]) / 1024 * 10) / 10, vendor: 'nvidia' });
  }
  if (out.length) return out;
  const pci = await run('sh', ['-c', 'lspci 2>/dev/null | grep -i -E "vga|3d|display"']);
  return pci.split('\n').filter(Boolean).map((l) => ({ name: l.replace(/^[^:]*:[^:]*:\s*/, '').trim(), vramGB: 0 }));
}

async function detect() {
  const cpus = os.cpus();
  const info = {
    platform: process.platform,
    arch: process.arch,
    cpu: (cpus[0] && cpus[0].model.trim()) || 'unknown',
    cores: cpus.length,
    ramGB: Math.round(os.totalmem() / 2 ** 30 * 10) / 10,
    gpus: [],
    appleSilicon: process.platform === 'darwin' && process.arch === 'arm64',
    detectedAt: new Date().toISOString(),
  };
  try {
    if (process.platform === 'win32') info.gpus = await gpusWindows();
    else if (process.platform === 'darwin') info.gpus = await gpusMac(info);
    else info.gpus = await gpusLinux();
  } catch (e) {
    console.warn('[hardware] gpu detection failed', e.message);
  }
  try { info.cpuProbeMs = cpuProbe(); } catch (_) { info.cpuProbeMs = null; }
  try { info.vulkan = await vulkanInfo(); } catch (_) { info.vulkan = { available: false }; }
  if (process.platform === 'win32') {
    try {
      const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        '(Get-CimInstance Win32_VideoController | Sort-Object AdapterRAM -Descending | Select-Object -First 1).DriverDate'], { timeout: 12000 });
      const d = Date.parse(out.trim());
      if (!Number.isNaN(d)) info.driverDate = new Date(d).toISOString().slice(0, 10);
    } catch (_) { /* ignore */ }
  }
  for (const g of info.gpus) {
    if (!g.vendor) g.vendor = /nvidia|geforce|rtx|gtx|quadro/i.test(g.name) ? 'nvidia' : /amd|radeon/i.test(g.name) ? 'amd' : /intel/i.test(g.name) ? 'intel' : /apple/i.test(g.name) ? 'apple' : 'other';
  }
  cached = info;
  return info;
}

async function detectCached(force = false) {
  if (cached && !force) return cached;
  if (!detecting) detecting = detect().finally(() => { detecting = null; });
  return detecting;
}
function getCached() { return cached; }

// Both OCR model sets ship with the app; this decides which one a given machine should run by default.
// Measured cost per screenshot with the tuned runtime: v6-tiny ≈ 420 MB / 0.8 s, v6-small ≈ 650 MB / 2.7 s
// on a Ryzen 5 5600X (cpuProbe ≈ 52 ms). The larger model is only chosen where there is clear headroom.
const OCR_SMALL_MIN_RAM_GB = 8;
const OCR_SMALL_MIN_CORES = 4;
const OCR_SMALL_MAX_PROBE_MS = 160;   // ~3× slower than a Ryzen 5 5600X / M1 still qualifies

/**
 * Cores, RAM and CPU speed only — no GPU queries, so it returns in ~200 ms and can run before the first
 * capture. Full detect() shells out to PowerShell / system_profiler and takes seconds.
 */
let quick = null;
function quickProfile() {
  if (quick) return quick;
  const cpus = os.cpus();
  quick = {
    cpu: (cpus[0] && cpus[0].model.trim()) || 'unknown',
    cores: cpus.length,
    ramGB: Math.round((os.totalmem() / 2 ** 30) * 10) / 10,
    cpuProbeMs: (() => { try { return cpuProbe(); } catch (_) { return null; } })(),
    platform: process.platform,
    arch: process.arch,
  };
  return quick;
}

function ocrModel(info) {
  info = info || cached || quickProfile();
  if (!info) return { model: 'v6-tiny', reason: 'unknown-machine' };
  const { ramGB = 0, cores = 0, cpuProbeMs } = info;
  const slow = typeof cpuProbeMs === 'number' && cpuProbeMs > OCR_SMALL_MAX_PROBE_MS;
  const reasons = [];
  if (ramGB < OCR_SMALL_MIN_RAM_GB) reasons.push('ram');
  if (cores < OCR_SMALL_MIN_CORES) reasons.push('cores');
  if (slow) reasons.push('cpu');
  return reasons.length
    ? { model: 'v6-tiny', reason: reasons.join('+'), ramGB, cores, cpuProbeMs }
    : { model: 'v6-small', reason: 'headroom', ramGB, cores, cpuProbeMs };
}

/**
 * Every model we offer, each with the one judgement that decides whether to download six gigabytes:
 * will it run on this machine. `needGB` is working memory, which is what actually runs out -- the
 * download size only decides how long the wait is.
 * @returns {Array<{model:string, sizeGB:number, needGB:number, fit:'easy'|'ok'|'tight'|'no', recommended:boolean, vision:boolean}>}
 */
function catalogue(info) {
  const rec = recommend(info);
  const ram = (info || cached || {}).ramGB || os.totalmem() / 2 ** 30;
  const budget = rec.budgetGB || 0;
  const verdict = (needGB) => {
    if (needGB <= budget * 0.7) return 'easy';
    if (needGB <= budget) return 'ok';
    if (needGB <= ram) return 'tight';
    return 'no';
  };
  return [...QWEN, GEMMA_ALT].map((m) => ({
    ...m,
    fit: verdict(m.needGB),
    recommended: m.model === rec.model,
    vision: /gemma/.test(m.model),
  }));
}

function pickByBudget(gb) {
  let best = QWEN[0];
  for (const m of QWEN) if (m.needGB <= gb) best = m;
  return best;
}

/** @returns {{model:string, sizeGB:number, reason:string, notes:string[], alternatives:Array<{model:string,sizeGB:number,note:string}>, accelerator:string}} */
function recommend(info) {
  info = info || cached || { ramGB: os.totalmem() / 2 ** 30, gpus: [], appleSilicon: false, cpu: '', platform: process.platform };
  const notes = [];
  let accelerator = 'cpu';
  let budget = 0;
  let reason;
  const discrete = info.gpus.filter((g) => g.vramGB >= 3 && g.vendor !== 'intel');
  const best = discrete.sort((a, b) => b.vramGB - a.vramGB)[0];
  if (info.appleSilicon) {
    accelerator = 'apple';
    budget = info.ramGB * 0.7;
    reason = t('hwReasonApple', { chip: (best && best.name) || 'Apple Silicon', ram: info.ramGB });
  } else if (best) {
    accelerator = best.vendor === 'nvidia' ? 'nvidia' : best.vendor;
    budget = best.vramGB;
    reason = t('hwReasonGpu', { gpu: best.name, vram: best.vramGB });
    if ((best.vendor === 'amd' || best.vendor === 'intel') && info.platform !== 'darwin') {
      notes.push(t('hwAmdNote'));
      const vk = info.vulkan || {};
      if (vk.available) {
        notes.push(t('hwVulkanOk', { device: vk.device || best.name }));
        // drivers older than ~2 years usually predate the Vulkan features the runtimes want
        if (info.driverDate && Date.now() - Date.parse(info.driverDate) > 2 * 365 * 24 * 3600 * 1000) {
          notes.push(t('hwVulkanOld', { date: info.driverDate }));
        }
      } else {
        notes.push(t('hwVulkanNone'));
      }
    }
  } else {
    budget = Math.min(info.ramGB * 0.5, 9); // CPU-only: keep it responsive
    reason = t('hwReasonCpu', { ram: info.ramGB });
    notes.push(t('hwCpuNote'));
  }
  let chosen = pickByBudget(budget);
  // Never recommend something that does not fit in system RAM either.
  while (chosen.needGB > info.ramGB * 0.8 && QWEN.indexOf(chosen) > 0) chosen = QWEN[QWEN.indexOf(chosen) - 1];
  const idx = QWEN.indexOf(chosen);
  const alternatives = [];
  if (idx > 0) alternatives.push({ ...QWEN[idx - 1], note: t('hwAltFaster') });
  if (idx < QWEN.length - 1 && QWEN[idx + 1].needGB <= info.ramGB) alternatives.push({ ...QWEN[idx + 1], note: t('hwAltBetter') });
  alternatives.push({ ...GEMMA_ALT, note: t('hwAltGemma') });
  return {
    model: chosen.model,
    sizeGB: chosen.sizeGB,
    reason: `${reason}${t('hwFits', { model: chosen.model, size: chosen.sizeGB })}`,
    notes,
    alternatives,
    accelerator,
    budgetGB: Math.round(budget * 10) / 10,
  };
}

module.exports = {
  catalogue, detect, detectCached, getCached, recommend, ocrModel, quickProfile, cpuProbe, QWEN };
