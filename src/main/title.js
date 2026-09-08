'use strict';
// 一条记录该叫什么。
//
// 「截图 22:46」不是标题，是时间戳。这个工作区里 255 条记录，83 条（33%）的标题就是
// 「类型 + 时间」——你看着它根本不知道那是什么。
//
// 为什么不抽关键词。试过了：拿 entity.js（专名、邮编、日期、数量、地名，加 df 罕见度）
// 去跑那 83 条截图的 OCR，抽出来是「剩下 · Project · 剪切 · 改成 · 几个」这种东西，
// 还有几条一个词都抽不出来。不是算法差——**一张全屏截图本身就不是「关于一件事」的**，
// 它的 OCR 里有菜单栏、有 briffy 自己的界面、有好几个窗口，没有主题可抽。
// （业内也没有现成的轮子：CleanShot、Shottr、Raycast 都做 OCR，但只用来搜，没有一个做自动标题。）
//
// 真正说得清那张图是什么的，是**那一刻屏幕上那个窗口叫什么**。所以这件事的难点不在算法，
// 在采集——见 foreground.js 里 APP_TITLE 那段账。
//
// 纯函数，node 直接跑得起来（dev/title-test.js）。不 require electron，也不 require store：
// 放在这儿而不是留在 workspace.js 里，就是为了它能被测——retrieve.js 当初也是为这个搬出来的。

// 太短说明不了什么，太长就不是标题是正文了
const MIN = 2;
const MAX = 90;

/**
 * 语境到了之后，这条记录能不能有个更好的名字。
 *
 * **只换占位标题。** 第一行是内容的那些记录不动：你复制的那段话就是你复制的那段话，
 * 窗口标题没资格盖过它——实测过一条反例，「Is it okay if I arrive at your place around nine?」
 * 的窗口标题是「Google Translate」，换过去就把内容换成了工具名。
 * 用户自己改过标题的也不动（改的时候 titleAuto 会被抹掉，见 main.js 的 ws:update-entry）。
 *
 * @param {object} entry 已经存下的那条
 * @param {object} ctx   foreground.read 读回来的语境
 * @returns {string} 空字符串表示「没有更好的」
 */
function fromContext(entry, ctx) {
  const e = entry || {};
  if (!e.titleAuto || !ctx) return '';
  const w = String(ctx.window || '').replace(/\s+/g, ' ').trim();
  if (w.length < MIN || w.length > MAX) return '';
  // 和应用同名的窗口标题等于没说（Claude 桌面版的窗口就叫「Claude」，这个工作区里
  // 它那 70 条只有 1 条带得上窗口标题）。foreground.trimWindowTitle 已经会把它剪成空，
  // 这里再挡一道，因为语境也可能是别处塞进来的。
  if (w.toLowerCase() === String(ctx.app || '').toLowerCase()) return '';
  return w;
}

module.exports = { fromContext, MIN, MAX };
