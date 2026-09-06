'use strict';
// 谁在用麦克风。
//
// 自动录音不该是"一直听着房间"——那会把手机上的游戏、屋里另一个人说话、电视，全都切成记录存起来
// （2026-09-05 就是这么录进 170 条游戏语音的）。它该是："别的东西打开了麦克风，我才跟着录"。
// 换句话说：麦克风的开关不归 briffy 管，归你正在用的那个软件管。
//
// macOS 上不用写原生模块也能问到这件事：每有一个进程在采集音频，coreaudiod 就会持有一条
// 防休眠断言，而那条断言带着**是谁**开的：
//
//   pid 591(coreaudiod): [0x000b...] 05:22:21 PreventUserIdleSystemSleep named: "com.apple.audio...."
//     Created for PID: 38745.
//     Resources: audio-in 9270A4B4-151B-477F-B6ED-85B36278491A
//
// 实测 `pmset -g assertions` 一次 10 ms，每 5 秒问一次的开销可以忽略，而且不需要任何权限。
//
// 两类要排除的：
//   自己          ——— 我们一开麦，自己也会出现在这张表里，不排除就永远停不下来
//   常驻录音器    ——— corespeechd（macOS 的语音服务）和 screenpipe 这类东西 24 小时占着麦克风，
//                     把它们算进来，这个功能就退回成"一直录"，正是要避免的那件事。
//                     名单可以改（设置 autoRecordIgnore），而且设置页会把当前占用者列出来，
//                     所以这不是一份藏起来的判断。
const { execFile } = require('child_process');
const path = require('path');

const POLL_MS = 5000;
const DEFAULT_IGNORE = ['corespeechd', 'screenpipe'];

let timer = null;
let deps = null;
let holders = [];        // [{ pid, name }] 现在开着麦克风的（已排除自己和忽略名单）
let inUse = false;

const run = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 4000 }, (err, out) => resolve(err ? '' : String(out || '')));
});

/** pmset 的输出里，哪些 PID 正在采集音频。 */
function pidsFrom(text) {
  const pids = new Set();
  let cur = 0;
  for (const line of text.split('\n')) {
    if (/^\s*pid \d+\(/.test(line)) cur = 0;                       // 新的一条断言，重新找它的归属
    const m = line.match(/Created for PID:\s*(\d+)/);
    if (m) cur = Number(m[1]);
    if (cur && /Resources:.*\baudio-in\b/.test(line)) pids.add(cur);
  }
  return [...pids];
}

/** PID → 可执行文件路径。一次问完，不要一个个来。 */
async function namesOf(pids) {
  if (!pids.length) return new Map();
  const out = await run('/bin/ps', ['-o', 'pid=,comm=', '-p', pids.join(',')]);
  const map = new Map();
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    if (m) map.set(Number(m[1]), m[2].trim());
  }
  return map;
}

// 我们自己的进程都住在同一个目录下（主进程、渲染进程、各种 helper）
const ownDir = path.dirname(process.execPath);
const isOwn = (exe) => exe.startsWith(ownDir);

async function poll() {
  if (!deps) return;
  const ignore = deps.store.getSettings().autoRecordIgnore || DEFAULT_IGNORE;
  const pids = pidsFrom(await run('/usr/bin/pmset', ['-g', 'assertions']));
  const names = await namesOf(pids);
  const next = [];
  for (const pid of pids) {
    const exe = names.get(pid) || '';
    if (!exe || isOwn(exe)) continue;
    const base = exe.split('/').pop();
    if (ignore.some((n) => base.toLowerCase().includes(String(n).toLowerCase()))) continue;
    next.push({ pid, name: base });
  }
  const was = inUse;
  holders = next;
  inUse = next.length > 0;
  if (inUse !== was && deps.onChange) deps.onChange(inUse, holders.slice());
}

function start(d) {
  deps = d || deps;
  if (process.platform !== 'darwin') return;      // 这条断言是 macOS 的，别的平台先不管
  if (timer) return;
  poll().catch(() => {});
  timer = setInterval(() => poll().catch(() => {}), POLL_MS);
  if (timer.unref) timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  holders = [];
  inUse = false;
}

/** 给设置页看的：现在是谁开着麦克风。 */
function status() { return { inUse, holders: holders.slice() }; }

module.exports = { start, stop, status, DEFAULT_IGNORE, _pidsFrom: pidsFrom };
