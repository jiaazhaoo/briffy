'use strict';
// 这台电脑上装了哪些「开麦克风就是在说话」的软件。
//
// 自动录音的白名单原本是一串写死的名字——Teams、Webex、Slack、飞书、钉钉……对着一台只装了 Zoom 和
// 微信的电脑，十八项里有十四项永远不会命中。打开设置看到的是一份别人的清单，而不是自己的。
//
// 所以名单从这里长出来：扫一遍应用目录，认出会议和通话软件，把**真的装了的**那几个作为默认白名单。
// 用户看到的就是自己电脑上的 Zoom、微信、FaceTime，不是一串没见过的字符串。
//
// 认的是 .app 的目录名，不是 bundle id。两者都稳定，但目录名不用为一百多个应用各读一次 Info.plist
// （只有命中的那几个才会去读 Contents/MacOS 拿可执行文件名，那才是 pmset 报上来的东西）。
//
// **浏览器不作为应用进名单。** 把 Chrome 整个放行等于放行它打开的每一个网页，网页里的语音输入和输入法
// 是同一类问题。浏览器带来的是它对应的**会议网站**——见 SITES，以及 micwatch.js 里按站点比对的那段。
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIRS = ['/Applications', '/System/Applications', '/Applications/Utilities',
  path.join(os.homedir(), 'Applications')];

// 会议与通话。names 是 .app 的目录名（不带 .app），大小写不敏感。
const MEETING = [
  { key: 'zoom', names: ['zoom.us'] },
  { key: 'teams', names: ['Microsoft Teams', 'Microsoft Teams (work or school)', 'Microsoft Teams classic'] },
  { key: 'tencentmeeting', names: ['腾讯会议', 'TencentMeeting', 'WeMeet'] },
  { key: 'webex', names: ['Webex', 'Cisco Webex Meetings', 'Webex Meetings'] },
  { key: 'facetime', names: ['FaceTime'] },
  { key: 'skype', names: ['Skype'] },
  { key: 'discord', names: ['Discord'] },
  { key: 'slack', names: ['Slack'] },
  { key: 'lark', names: ['Lark', 'Feishu', '飞书'] },
  { key: 'dingtalk', names: ['DingTalk', '钉钉'] },
  { key: 'gotomeeting', names: ['GoToMeeting'] },
  { key: 'bluejeans', names: ['BlueJeans'] },
  { key: 'whereby', names: ['Whereby'] },
];

// 浏览器：认出来是为了在设置里说清楚「它按站点放行」，不是为了把它整个放行。
const BROWSERS = [
  'Google Chrome', 'Google Chrome Canary', 'Chromium', 'Safari', 'Firefox',
  'Microsoft Edge', 'Brave Browser', 'Arc', 'Vivaldi', 'Opera', 'Comet',
];

// 会议网站。只在浏览器正停在这些站点时才算数。
const SITES = [
  'meet.google.com', 'zoom.us', 'teams.microsoft.com', 'teams.live.com',
  'meeting.tencent.com', 'webex.com', 'whereby.com', 'around.co', 'gather.town',
];

/** .app 里那个真正会出现在进程表里的可执行文件名。 */
function binaryOf(appPath) {
  try {
    const inside = fs.readdirSync(path.join(appPath, 'Contents', 'MacOS'));
    return inside.find((f) => !f.startsWith('.')) || '';
  } catch (_) { return ''; }
}

/** 应用目录里所有的 .app，一层。 */
function allApps() {
  const out = [];
  for (const dir of DIRS) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) { continue; }
    for (const n of names) {
      if (!n.endsWith('.app')) continue;
      out.push({ base: n.slice(0, -4), dir, full: path.join(dir, n) });
    }
  }
  return out;
}

/**
 * 装了哪些会议软件和浏览器。
 * @returns {{meeting:Array<{key,name,binary,path}>, browsers:Array<{name,binary,path}>}}
 */
function detect() {
  const apps = allApps();
  const has = new Map(apps.map((a) => [a.base.toLowerCase(), a]));
  const meeting = [];
  for (const m of MEETING) {
    for (const n of m.names) {
      const hit = has.get(n.toLowerCase());
      if (!hit) continue;
      meeting.push({ key: m.key, name: hit.base, binary: binaryOf(hit.full) || hit.base, path: hit.full });
      break;
    }
  }
  const browsers = [];
  for (const b of BROWSERS) {
    const hit = has.get(b.toLowerCase());
    if (hit) browsers.push({ name: hit.base, binary: binaryOf(hit.full) || hit.base, path: hit.full });
  }
  return { meeting, browsers };
}

/**
 * 没设置过白名单时用的那一份：装了的会议软件，加上会议网站。
 *
 * 写的是可执行文件名而不是应用名，因为白名单比对的是 pmset 报上来的进程——「腾讯会议.app」里跑的那个
 * 叫 TencentMeeting。设置页会把它再翻回你认识的名字。
 */
function defaultAllow() {
  const { meeting } = detect();
  const out = [];
  // zoom.us 既是进程名又是域名，两边都会给出来，去一次重
  for (const x of [...meeting.map((m) => m.binary), ...SITES]) {
    if (!out.some((y) => y.toLowerCase() === x.toLowerCase())) out.push(x);
  }
  return out;
}

/**
 * 把白名单里的一项翻成人看得懂的样子。
 *
 * 名单里存的是进程名（TencentMeeting），因为那才是 pmset 报上来的东西；但设置页要显示的是这台电脑上
 * 那个应用叫什么（腾讯会议）。装了的就用它的名字，没装的原样显示——一项对应的软件没装，说出来比
 * 假装它在那里有用。
 * @param {string[]} list
 * @returns {Array<{entry:string, label:string, kind:'app'|'site'|'unknown'}>}
 */
function describe(list) {
  const { meeting, browsers } = detect();
  const known = [...meeting, ...browsers];
  return (list || []).map((entry) => {
    const t = String(entry || '').trim();
    const hit = known.find((a) => a.binary.toLowerCase() === t.toLowerCase()
      || a.name.toLowerCase() === t.toLowerCase());
    if (hit) return { entry: t, label: hit.name, kind: 'app' };
    if (SITES.some((x) => x.toLowerCase() === t.toLowerCase()) || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(t)) {
      return { entry: t, label: t, kind: 'site' };
    }
    return { entry: t, label: t, kind: 'unknown' };
  });
}

module.exports = { detect, defaultAllow, describe, MEETING, BROWSERS, SITES, binaryOf };
