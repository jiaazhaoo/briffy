'use strict';
// 一条记录是从哪一页来的——页面的身份。
//
// 这几个函数原来住在 links.js（自动双链）里。双链 2026-09-09 整个撤了，它们留下来是因为
// 页面图（vocab.pageGraph）还在用：搜索框那条「同一页」的腿——搜到一页上的一条，同一页上
// 另外几条跟着来——走的是它。这是 join，不是相似度：url 相等、标题相等，精确、便宜、可解释。
//
// 纯函数，node 直接跑得起来。
// 窗口标题里会动的那些东西（Terminal 的转圈、窗口尺寸、未读数）。这套归一化是「路过」那边
// 为同一个毛病写的，直接借过来——不借的话，同一个终端窗口会因为一个转圈字符裂成四个「页面」
// （实测：✳ ◑ ◐ 三种转圈把一个窗口拆成 10 + 8 + 5 + 4 条）。
const { tidyTitle } = require('./trail');

const RUN_GAP_MS = 15 * 60 * 1000;   // 隔这么久没动，就是另一段操作了
const MIN_KEY = 4;                   // 短于这么多字的标题不算页面身份
const MAX_CLIPS = 60;                // 一个 key 底下这么多条，它就不是一页，是一个应用外壳

// 浏览器往标题上加的前缀。真实数据里出现过 “Find in page 2026年泰晤士河步道超级马拉松挑战赛”，
// 它和 “2026年泰晤士河步道超级马拉松挑战赛” 是同一页。
const TITLE_NOISE = /^(find in page|在页面中查找)\s+/i;

// 这些是应用外壳的名字，不是某一页。等于当前应用名的也一样（Chrome 的窗口标题偶尔就是 “Google Chrome”）。
const SHELLS = new Set([
  'google chrome', 'chrome', 'safari', 'firefox', 'arc', 'microsoft edge',
  'claude', 'chatgpt', 'wechat', '微信', 'terminal', 'iterm2', 'finder',
  'new tab', '新标签页', 'untitled', '无标题',
  // 网页版应用的外壳名：一个标题底下是无数个不同的页面。有 url 的时候这一条不需要，
  // 每张地图、每封邮件的网址都是不同的——这几个是标题这条降级路上的补丁。
  'google maps', '谷歌地图', 'google translate', 'gmail', 'notion', 'youtube', 'x', 'facebook',
]);

const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** 同一页的两个网址应该算同一个 key：去掉锚点和末尾斜杠，其余照留（查询串常常就是这一页的身份）。 */
function normUrl(u) {
  const s = one(u);
  if (!/^https?:\/\//i.test(s)) return '';
  return s.split('#')[0].replace(/\/+$/, '');
}

/** 标题这一路要过三道：不是浏览器加的噪声前缀、不是外壳名、够长。@returns {string} */
function titleKey(raw, app) {
  const title = one(tidyTitle(raw)).replace(TITLE_NOISE, '');
  if (title.length < MIN_KEY) return '';
  const low = title.toLowerCase();
  if (SHELLS.has(low)) return '';
  if (app && low === one(app).toLowerCase()) return '';
  return title;
}

/**
 * 这条记录是从哪一页拿下来的——**两个身份都要**。
 *
 * url 才是身份，标题只是 url 缺席时的降级方案（标题会变，同一页在真实数据里出现过两个版本）。
 * 但两个都收着还有第二个用处：一条同时带着网址和标题的记录，就是一份「这个网址等于这个标题」
 * 的证词。没有它，同一页会裂成两个节点——书签按网址挂一个，剪贴板按标题挂另一个。
 * @returns {string[]} 拿不准就是空数组——**宁可没有边，也不要一条错的边**
 */
function pageKeysOf(entry) {
  const c = (entry || {}).context || {};
  return [normUrl(c.url), titleKey(c.window, c.app)].filter(Boolean);
}

/** 这条记录**本身**就是某一页（你收藏了它）。同样两个身份都给。 @returns {string[]} */
function pageIdentityOf(entry) {
  const e = entry || {};
  return [normUrl(e.url), titleKey(e.title, '')].filter(Boolean);
}

module.exports = { pageKeysOf, pageIdentityOf, normUrl, titleKey, MAX_CLIPS, RUN_GAP_MS, MIN_KEY };
