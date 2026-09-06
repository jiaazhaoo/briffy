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
// 三类要排除的：
//   自己          ——— 我们一开麦，自己也会出现在这张表里，不排除就永远停不下来
//   常驻录音器    ——— corespeechd（macOS 的语音服务）和 screenpipe 这类东西 24 小时占着麦克风，
//                     把它们算进来，这个功能就退回成"一直录"，正是要避免的那件事。
//                     名单可以改（设置 autoRecordIgnore），而且设置页会把当前占用者列出来，
//                     所以这不是一份藏起来的判断。
//   输入法        ——— 按**路径**排除，不是靠名字。微信输入法（/Library/Input Methods/WeType.app）
//                     一按语音输入就占麦克风，于是用它口述的每一句话都被存成了录音。这不是漏了一个
//                     名字，是类别错了：输入法采集麦克风的产物是**文字**，它会直接打进你正在写的
//                     地方，再存一份音频既没用又是你没打算留下的东西。macOS 的输入法只会装在
//                     /Library/Input Methods 或 /System/Library/Input Methods 下，所以这条按目录判断，
//                     对没见过的输入法同样成立。
//
// 白名单（设置 autoRecordAllow）：留空时按上面三条排除，其余都跟着录；一旦填了，就只跟着名单里的
// 应用录。想要"只录会议"的人填上会议软件即可，其余一律不碰——这比不断往排除名单里补名字可靠。
//
// **浏览器按站点放行，不按应用放行。** 把 Chrome 整个写进白名单，等于把刚关上的那个口子重新打开：
// 网页里的语音输入、语音搜索、网页版聊天的语音消息，全都会被录，和输入法那件事一模一样。所以名单里
// 的一项，除了比对进程名和路径，还会比对**浏览器当前停在哪个站点**（扩展报上来的，见 foreground.js）。
// 于是 meet.google.com 只在你真的在开会那一页时才算数；同一个 Chrome 打开别的网站不算。
// 不需要区分"这一项是应用还是站点"——zoom.us 恰好两者都是，两条都比对即可。
const { execFile } = require('child_process');
const path = require('path');
const foreground = require('./foreground');
const apps = require('./apps');

const POLL_MS = 5000;
const DEFAULT_IGNORE = ['corespeechd', 'screenpipe'];
// macOS 只在这两处装输入法，第三方的也一样（微信输入法、搜狗、微软拼音都在 /Library/Input Methods）
const INPUT_METHOD_DIRS = ['/Library/Input Methods/', '/System/Library/Input Methods/'];
// 谁算浏览器——只影响"要不要拿站点去比对"，认错了最多是少放行一次
const BROWSERS = ['chrome', 'chromium', 'safari', 'firefox', 'edge', 'brave', 'vivaldi', 'opera', 'arc', 'comet'];

let timer = null;
let deps = null;
let holders = [];        // [{ pid, name, exe, app }] 现在开着麦克风、且 briffy 会跟着录的
let seen = [];           // 同上，但**不过白名单**——设置页要能列出可以加进白名单的应用
// 最近用过麦克风的应用（不过白名单），设置页拿它当候选。只记当前占用者是不够的：会开完了才想起来去
// 填白名单，打开设置一看空空如也，就只能靠手打进程名——而进程名恰恰是用户不知道的那个东西。
const recent = new Map();   // exe -> { name, exe, app, at }
const RECENT_MAX = 12;
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

// 我们自己的进程。**要认到整个 .app，不能只认 Contents/MacOS。**
//
// 采集麦克风的从来不是主进程：Chromium 把音频放在一个辅助进程里，于是 pmset 上那条断言写的是
//   <briffy.app>/Contents/Frameworks/briffy Helper.app/Contents/MacOS/briffy Helper
// 而 process.execPath 的目录是
//   <briffy.app>/Contents/MacOS
// 前者不以后者开头，所以 briffy 一直没认出那是自己。后果正是这一行原本的注释所担心的那件事：
// 一开麦，自己就出现在「谁在用麦克风」里，于是它认为「别的软件开着麦」，于是继续录——闭环，永不停止。
// 真实后果是 2026-09-06 21:34 那两条：房间里在放一个 B 站视频，整段视频旁白被当成会议录了进去。
function ownRootOf(execPath, platform = process.platform) {
  const inBundle = /\/Contents\/MacOS\/[^/]+$/;
  return platform === 'darwin' && inBundle.test(execPath)
    ? execPath.replace(inBundle, '')
    : path.dirname(execPath);
}
const ownRoot = ownRootOf(process.execPath);
const isOwn = (exe) => exe.startsWith(ownRoot);
const isInputMethod = (exe) => INPUT_METHOD_DIRS.some((d) => exe.startsWith(d));

// 进程名不是给人看的东西。占着麦克风的那个叫 WeType，而你在系统里、在这台电脑上看到的名字是
// 「微信输入法」——要人从一列 unix 进程名里挑出该录哪个，等于没给他判断的依据。
// Info.plist 里只有 WeType（CFBundleDisplayName 根本没有），本地化的名字要问 Spotlight。
const appNames = new Map();
async function appNameOf(exe) {
  if (!exe) return '';
  const at = exe.lastIndexOf('.app/');
  if (at < 0) return '';
  const bundle = exe.slice(0, at + 4);
  if (appNames.has(bundle)) return appNames.get(bundle);
  const name = (await run('/usr/bin/mdls', ['-name', 'kMDItemDisplayName', '-raw', bundle])).trim();
  const clean = (!name || name === '(null)') ? '' : name.replace(/\.app$/, '');
  appNames.set(bundle, clean);
  return clean;
}

const isBrowser = (base) => BROWSERS.some((b) => base.toLowerCase().includes(b));

/** 网址里的主机名，取不出来就是空串。 */
function hostOf(url) {
  try { return new URL(String(url || '')).hostname.toLowerCase(); } catch (_) { return ''; }
}

/**
 * 名单项可以写进程名（WeType）、路径的一段（/Applications/zoom.us.app），或者一个站点
 * （meet.google.com）——站点只在占着麦克风的是浏览器时才比对。
 */
function listed(list, exe, base, host) {
  const browser = isBrowser(base);
  return (list || []).some((n) => {
    const t = String(n || '').trim().toLowerCase();
    if (!t) return false;
    if (base.toLowerCase().includes(t) || exe.toLowerCase().includes(t)) return true;
    return !!(browser && host && (host === t || host.endsWith(`.${t}`)));
  });
}

/**
 * 这一批占着麦克风的进程里，哪些该让 briffy 跟着录。
 *
 * 单独拎出来是因为这是整个自动录音里唯一"决定录什么"的判断，其余都是管道。
 * @param {Array<{pid:number, exe:string}>} found
 * @param {{allow?:string[], ignore?:string[]}} rules
 */
function follow(found, { allow = [], ignore = DEFAULT_IGNORE, tabUrl = '' } = {}) {
  const host = hostOf(tabUrl);
  const out = [];
  for (const { pid, exe } of found) {
    if (!exe || isOwn(exe) || isInputMethod(exe)) continue;
    const base = exe.split('/').pop();
    // 排除名单不看站点：它挡的是"这个东西一直占着麦克风"，和它此刻在哪一页无关
    if (listed(ignore, exe, base, '')) continue;
    if ((allow || []).length && !listed(allow, exe, base, host)) continue;
    out.push({ pid, name: base, exe, site: isBrowser(base) ? host : '' });
  }
  return out;
}

async function poll() {
  if (!deps) return;
  const s = deps.store.getSettings();
  const pids = pidsFrom(await run('/usr/bin/pmset', ['-g', 'assertions']));
  const names = await namesOf(pids);
  const found = pids.map((pid) => ({ pid, exe: names.get(pid) || '' }));
  const ignore = s.autoRecordIgnore || DEFAULT_IGNORE;
  // 两份：一份是会跟着录的，一份是**不看白名单**时会跟着录的。后者是设置页列出来给你挑的候选——
  // 只报前者的话，白名单一填，别的应用就再也不出现，你也就没办法把它加进名单，这个设置项等于一次性的。
  const tab = foreground.currentTab();
  const tabUrl = (tab && tab.url) || '';
  // 没设置过（null / 没有这个键）就用这台电脑上装了的会议软件。
  //
  // 空名单是「什么都不自动录」，不是「什么都录」。后者曾经是这里的规则，而它是个陷阱：把名单里的词
  // 一个个点掉，本以为是录得更少，结果是录得更多。名单叫白名单，那它就该照字面意思来——
  // 空的就是没有人在名单上。真要「谁开麦都跟着录」，那是另一件事，不该由「清空」来表达。
  const set = s.autoRecordAllow;
  const allow = (set === null || set === undefined) ? apps.defaultAllow() : set;
  const candidates = follow(found, { ignore, allow: [], tabUrl });
  const next = allow.length ? follow(found, { ignore, allow, tabUrl }) : [];
  for (const h of candidates) h.app = await appNameOf(h.exe);
  const byPid = new Map(candidates.map((h) => [h.pid, h]));
  for (const h of next) h.app = (byPid.get(h.pid) || {}).app || '';
  for (const h of candidates) {
    recent.set(h.exe, { name: h.name, exe: h.exe, app: h.app, at: Date.now() });
  }
  while (recent.size > RECENT_MAX) recent.delete(recent.keys().next().value);
  const was = inUse;
  seen = candidates;
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
  seen = [];
  inUse = false;
}

/**
 * 给设置页看的。
 * @returns {{inUse:boolean, holders:Array, seen:Array, recent:Array}} holders 是会跟着录的，
 *   seen 是此刻占着麦克风、不看白名单的话会被录的，recent 是这次运行里用过麦克风的（新的在前）。
 */
function status() {
  return {
    inUse,
    holders: holders.slice(),
    seen: seen.slice(),
    recent: [...recent.values()].sort((a, b) => b.at - a.at),
  };
}

module.exports = { start, stop, status, follow, appNameOf, ownRootOf, DEFAULT_IGNORE, INPUT_METHOD_DIRS, BROWSERS, _pidsFrom: pidsFrom };
