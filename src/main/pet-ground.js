'use strict';
// 桌面上那只回形针站在什么颜色上——**量它脚下的真实像素**，不看系统的亮/暗开关。
//
// 它贴的是别人的桌面：底可能是纯白的文档，也可能是纯黑的终端，而它自己只有一个蓝
// （`#2a6cf0` 压在纯黑上只有 4.1:1，闷）。先试过给它镶一圈描边，被否了——一根干净的蓝铁丝
// 镶上白边就成了贴纸，SKILL.md 里「墨线描边＝海报，不是纸」本来也在拦这个方向。
// 也试过跟系统外观走，但那个开关说的是「别的应用窗口该画成什么色」，
// 跟壁纸、跟这一刻压在它底下的那个窗口都没关系——用户要的是后者。
//
// **为什么是事件触发，不是定时轮询。** 三条路都量过（briffy-screen-capture-paths）：
//   · `desktopCapturer.getSources`      190–330 ms 一次，代价在调用本身，不在尺寸
//   · 常驻 getUserMedia 流               每帧 0.1 ms，但挂着 2.4% 的一个核，
//                                        还会在菜单栏点亮一颗永不熄灭的录屏指示灯
//   · `screencapture` CLI 抓一块         191 ms + 读文件，更差
// 而 pet.css 顶上那笔账是硬约束：那扇窗一个 `infinite` 都不许有（三个待机循环 11.4% 的一个核）。
// 为了给一枚回形针挑颜色反手挂上 2.4% 常驻 + 一颗录屏灯，是把那条约束卖掉了。
// 所以只在**脚下那块底真的可能变了**的时候量一次：出生 / 被拖走 / 屏幕布局变了 /
// 前台窗口换了（这一条白蹭 trail.js 已经在跑的那个 2 秒轮询，本身不额外花钱）。
const { desktopCapturer, screen } = require('electron');

const THUMB_W = 1024;      // 缩略图取多宽。1024 时一枚 80px 的回形针还占得到 ~15px，够算平均亮度
const DARK_BELOW = 0.42;   // sRGB 相对亮度的分界。偏低一点：蓝墨压在黑上比压在白上更吃亏
const MIN_GAP_MS = 8000;   // 非强制的触发（换前台窗口）之间至少隔这么久

let last = '';
let lastAt = 0;
let busy = false;
let send = null;
let getBounds = null;

/** sRGB 相对亮度（WCAG 那条），入参 0–255 */
function luma(r, g, b) {
  const f = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/**
 * 量一次脚下那块底。
 * @param {Electron.Rectangle} bounds 回形针的窗口位置（全局屏幕坐标）
 * @returns {Promise<{ground:'light'|'dark', L:number}|null>} null＝这次没量成，调用方保持原样
 */
async function sample(bounds) {
  if (!bounds || !bounds.width || !bounds.height) return null;
  const display = screen.getDisplayMatching(bounds);
  const dw = display.bounds.width;
  const dh = display.bounds.height;
  if (!dw || !dh) return null;
  const size = { width: THUMB_W, height: Math.round((THUMB_W * dh) / dw) };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
  if (!src || src.thumbnail.isEmpty()) return null;

  // 窗口坐标 → 这块屏幕自己的坐标 → 缩略图坐标
  const shot = src.thumbnail.getSize();
  const kx = shot.width / dw;
  const ky = shot.height / dh;
  const rect = {
    x: Math.round((bounds.x - display.bounds.x) * kx),
    y: Math.round((bounds.y - display.bounds.y) * ky),
    width: Math.max(2, Math.round(bounds.width * kx)),
    height: Math.max(2, Math.round(bounds.height * ky)),
  };
  // 贴着屏幕边的时候会算出界，裁出界 Electron 会直接抛
  rect.x = Math.min(Math.max(0, rect.x), Math.max(0, shot.width - rect.width));
  rect.y = Math.min(Math.max(0, rect.y), Math.max(0, shot.height - rect.height));
  if (rect.x + rect.width > shot.width || rect.y + rect.height > shot.height) return null;

  const bmp = src.thumbnail.crop(rect).toBitmap();   // BGRA
  if (!bmp.length) return null;
  let sum = 0;
  let n = 0;
  for (let i = 0; i + 3 < bmp.length; i += 4) {
    if (bmp[i + 3] < 8) continue;                    // 透明的地方不算
    sum += luma(bmp[i + 2], bmp[i + 1], bmp[i]);
    n += 1;
  }
  if (!n) return null;
  const L = sum / n;
  return { ground: L < DARK_BELOW ? 'dark' : 'light', L };
}

/**
 * 量一次，变了才回报。
 * @param {{force?: boolean, why?: string}} [opts] force＝一定要量（出生 / 拖走 / 换屏）；
 *   不 force 的（换前台窗口）会被 MIN_GAP_MS 挡住
 */
async function refresh(opts = {}) {
  if (busy || !send || !getBounds) return;
  if (!opts.force && Date.now() - lastAt < MIN_GAP_MS) return;
  const bounds = getBounds();
  if (!bounds) return;
  busy = true;
  try {
    const r = await sample(bounds);
    if (!r) return;
    lastAt = Date.now();
    if (r.ground === last) return;
    last = r.ground;
    console.log(`[pet-ground] ${r.ground} (luma ${r.L.toFixed(2)}${opts.why ? ` · ${opts.why}` : ''})`);
    send(r.ground);
  } catch (e) {
    console.warn('[pet-ground] 量不了脚下这块底：', e.message);
  } finally {
    busy = false;
  }
}

/**
 * @param {() => (Electron.Rectangle|null)} boundsFn 回形针现在在哪儿（拿不到就返回 null）
 * @param {(ground: 'light'|'dark') => void} fn 结论变了就交给它
 */
function watch(boundsFn, fn) {
  getBounds = boundsFn;
  send = fn;
  last = '';        // 换了一扇新的头像窗口，之前发过的那次它没收到
  lastAt = 0;
  refresh({ force: true, why: '出生' });
}

function reset() { last = ''; lastAt = 0; }

module.exports = { watch, refresh, reset, sample };
