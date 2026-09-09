'use strict';
// 拖进来的文件长什么样：一张缩略图。
//
// 图片和截图本来就有画面（渲染进程直接拿 fileUrl 画）。别的类型——PDF、视频、Office 文档、
// 压缩包——以前在网格里和详情里都只是一个图标加一行路径，看不出是哪一份。
//
// **不自己解析任何格式。** 用的是 Electron 自带的 `nativeImage.createThumbnailFromPath`，
// 它背后是操作系统那套缩略图服务（macOS 的 Quick Look、Windows 的 Shell），认得的类型
// 比我们自己写十个解析器还多，而且系统更新了它就跟着更新。2026-09-09 在这台机器上量的：
//   .pdf   92 ms      .png   54 ms      .jpg   83 ms      .txt  126 ms
// 一张 512 宽的 JPEG 存下来 20~60 KB。
//
// **和 ocr-boxes 一样是旁路文件**（workspace/thumbs/<日期>/<id>.jpg），不进天文件：
// 天文件每画一次网格就整个读一遍，往里塞几十 KB 的东西会拖慢那唯一必须快的一屏。
//
// 原件一个字节不动——这只是一张派生出来的图，删了随时能再生成。
const fs = require('fs');
const path = require('path');

const EDGE = 512;          // 网格格子约 150~200 px、详情里更大；512 够用又不占地方
// 一张满是小字的 PDF 首页在 512 px 上要 120~200 KB——**降质量省不下来多少**：
// 80 → 68 实测五张一共 852 KB → 732 KB，只小了 14%。文字页的开销在细节本身，不在质量档，
// 真要小就得缩边长（而那会让详情里的图糊）。记在这儿，省得下次再试一遍。
const QUALITY = 68;
const TIMEOUT_MS = 4000;   // 实测 50~130 ms；到这儿说明系统那套服务卡住了，别陪着等

let store = null;
function init(deps) { store = deps.store; }

function dir(dateKey) { return path.join(store.paths().thumbs, dateKey); }
function file(dateKey, id) { return path.join(dir(dateKey), `${id}.jpg`); }

/** 这一类记录要不要缩略图。图片自己就是画面，不用；没有本地文件的也不用。 */
function wants(entry) {
  const e = entry || {};
  if (!e.path || e.linkOnly) return false;
  if (e.type === 'screenshot' || e.type === 'image') return false;   // 它们有 fileUrl
  if (e.type === 'note' || e.type === 'url') return false;           // 没有一份「文件」可看
  // 录音也不要：网格里它是一条磁带（k-voice 在 tileMarkup 里提前返回，根本走不到缩略图那一支），
  // 详情里是一个播放器。系统给音频出的那张图是个通用图标，谁也不显示它——
  // 2026-09-09 第一版没排除，白生成了 7 张、700 KB。
  if (e.type === 'audio') return false;
  return true;
}

/** 已经有了吗。 */
function has(entry) {
  const e = entry || {};
  if (!store || !e.id || !e.dateKey) return false;
  try { return fs.statSync(file(e.dateKey, e.id)).size > 0; } catch (_) { return false; }
}

/** 存好的那张图在哪儿（相对工作区），没有就是空字符串。 */
function relPath(entry) {
  const e = entry || {};
  if (!has(e)) return '';
  return path.relative(store.workspaceDir, file(e.dateKey, e.id));
}

/**
 * 生成并存下一张。
 * @returns {Promise<string>} 相对工作区的路径；做不出来就是空字符串（**不报错**：
 *   一份 briffy 认不出的文件仍然是一条好记录，只是没有画面）
 */
async function make(entry) {
  const e = entry || {};
  if (!store || !wants(e)) return '';
  if (has(e)) return relPath(e);
  const abs = e.linked ? e.path : store.absPath(e.path);
  try { if (!fs.statSync(abs).isFile()) return ''; } catch (_) { return ''; }
  const { nativeImage } = require('electron');
  let img;
  try {
    img = await Promise.race([
      nativeImage.createThumbnailFromPath(abs, { width: EDGE, height: EDGE }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
    ]);
  } catch (err) {
    return '';    // 系统给不出缩略图（认不得这个类型、文件坏了、超时）——就没有画面，仅此而已
  }
  if (!img || img.isEmpty()) return '';
  try {
    fs.mkdirSync(dir(e.dateKey), { recursive: true });
    fs.writeFileSync(file(e.dateKey, e.id), img.toJPEG(QUALITY));
  } catch (err) {
    console.warn('[thumb] 存不下来', err.message);
    return '';
  }
  return relPath(e);
}

function remove(entry) {
  const e = entry || {};
  if (!store || !e.id || !e.dateKey) return;
  try { fs.rmSync(file(e.dateKey, e.id), { force: true }); } catch (_) { /* 本来就没有 */ }
}

/**
 * 把还没有缩略图的老记录补上。限时、可中断、下次接着做——和补向量、抽词那几处同一个形状，
 * 一件 O(n) 的活儿不能卡在启动那几秒里。
 * @returns {Promise<{done:boolean, made:number, left:number}>}
 */
async function backfill({ budgetMs = 800 } = {}) {
  if (!store) return { done: true, made: 0, left: 0 };
  const t0 = Date.now();
  let made = 0;
  let left = 0;
  for (const day of store.listDates()) {
    for (const e of store.loadDay(day) || []) {
      if (!wants(e) || has(e)) continue;
      if (Date.now() - t0 >= budgetMs) { left++; continue; }
      // eslint-disable-next-line no-await-in-loop
      const rel = await make(e);
      // 写回记录，为的是**顺带广播**：store.updateEntry 会发 'entry' 事件，主进程把它转成
      // ws:entry 送到界面，那一条卡片当场就换成带缩略图的。自己另开一个频道是多余的。
      if (rel) { made++; store.updateEntry(e.id, { thumb: rel }); }
    }
  }
  return { done: left === 0, made, left };
}

module.exports = { init, make, has, wants, relPath, remove, backfill, EDGE };
