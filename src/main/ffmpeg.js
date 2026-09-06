'use strict';
// Finding, installing and running ffmpeg. Streamed video arrives as a playlist plus a few hundred
// segments, and on DASH sites the picture and the sound are separate tracks -- turning that back into
// one playable file is muxing, and ffmpeg is the tool for it.
//
// It is never bundled and never downloaded as a loose binary: the installer stays small, and the only
// way it gets onto the machine is the platform's own package manager, the same route ollama.js takes.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const DOWNLOAD_URL = 'https://ffmpeg.org/download.html';
// Package managers put it in places a GUI app's PATH often does not include.
const EXTRA_DIRS = process.platform === 'win32'
  ? [String.raw`C:\Program Files\ffmpeg\bin`, String.raw`C:\ffmpeg\bin`]
  : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/opt/local/bin', '/snap/bin'];

let cached = null;   // { ffmpeg, ffprobe, version } once found

function run(file, args, { timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: `${stdout || ''}${stderr || ''}` });
    });
  });
}

async function which(cmd) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const r = await run(finder, [cmd], { timeout: 4000 });
  if (!r.ok) return '';
  const first = r.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
  return first || '';
}

function exeName(name) { return process.platform === 'win32' ? `${name}.exe` : name; }

/** @returns {Promise<{ffmpeg:string, ffprobe:string, version:string}|null>} */
async function find({ refresh = false } = {}) {
  if (cached && !refresh) return cached;
  const candidates = [];
  const onPath = await which(exeName('ffmpeg'));
  if (onPath) candidates.push(onPath);
  for (const dir of EXTRA_DIRS) {
    const p = path.join(dir, exeName('ffmpeg'));
    try { if (fs.existsSync(p)) candidates.push(p); } catch (_) { /* ignore */ }
  }
  for (const bin of candidates) {
    const r = await run(bin, ['-version'], { timeout: 8000 });
    if (!r.ok) continue;
    const version = (r.out.match(/ffmpeg version (\S+)/) || [])[1] || 'unknown';
    const probe = path.join(path.dirname(bin), exeName('ffprobe'));
    cached = { ffmpeg: bin, ffprobe: fs.existsSync(probe) ? probe : '', version };
    return cached;
  }
  cached = null;
  return null;
}

/** Installs through the platform's package manager, streaming its output back line by line. */
async function install(onLine) {
  const say = (s) => { if (onLine && s) onLine(String(s).replace(/\r/g, '').trim()); };
  let cmd = null;
  if (process.platform === 'win32' && await which('winget')) {
    cmd = { file: 'winget', args: ['install', '--id', 'Gyan.FFmpeg', '-e', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'], method: 'winget' };
  } else if (process.platform === 'darwin' && await which('brew')) {
    cmd = { file: 'brew', args: ['install', 'ffmpeg'], method: 'homebrew' };
  } else if (process.platform === 'linux' && await which('apt-get')) {
    cmd = { file: 'sh', args: ['-c', 'apt-get install -y ffmpeg'], method: 'apt' };
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
  const found = await find({ refresh: true });
  return { ok: !!found, method: cmd.method, ...(found || {}) };
}

// ffmpeg reports progress on stderr as "time=00:01:23.45"; against a known duration that is a percentage.
function parseTime(line) {
  const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
function parseDuration(text) {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * Runs ffmpeg and reports progress. Rejects with the tail of stderr, which is where ffmpeg says what
 * actually went wrong (a 403 from the CDN, a codec it cannot copy, and so on).
 * @param {string[]} args
 * @param {{onProgress?:(p:{seconds:number,duration:number,percent:number})=>void, signal?:AbortSignal}} [opts]
 */
async function exec(args, { onProgress, signal } = {}) {
  const found = await find();
  if (!found) { const e = new Error('ffmpeg not installed'); e.code = 'ENOFFMPEG'; throw e; }
  return new Promise((resolve, reject) => {
    const child = spawn(found.ffmpeg, args, { windowsHide: true });
    let duration = 0;
    let tail = '';
    const onAbort = () => { try { child.kill('SIGKILL'); } catch (_) { /* already gone */ } };
    if (signal) { if (signal.aborted) return onAbort(); signal.addEventListener('abort', onAbort, { once: true }); }
    child.stderr.on('data', (d) => {
      const text = d.toString();
      tail = (tail + text).slice(-4000);
      if (!duration) duration = parseDuration(text);
      const t = parseTime(text);
      if (t !== null && onProgress) {
        onProgress({ seconds: t, duration, percent: duration ? Math.min(99, Math.round((t / duration) * 100)) : 0 });
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (code === 0) resolve({ ok: true, stderr: tail });
      else reject(new Error(tail.split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 300) || `ffmpeg exited ${code}`));
    });
  });
}

module.exports = { find, install, exec, parseTime, parseDuration, DOWNLOAD_URL };
