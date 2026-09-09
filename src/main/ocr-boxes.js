'use strict';
// Where each line of recognised text sits on the picture.
//
// PP-OCR has always returned this and briffy always threw it away, keeping only the joined-up string.
// With the boxes kept, the detail view can point at the words: hover a line to see it outlined on the
// original, click it to copy just that line. Nothing is recomputed and nothing new is run -- these are
// the coordinates the same pass already produced.
//
// They live beside the workspace rather than inside the day file. A 4K screenshot yields ~42 lines,
// about 2 KB; the day file is read whole every time the grid draws, and paying 2 KB per picture there
// for something only the detail view reads would slow down the one screen that has to stay fast.
const fs = require('fs');
const path = require('path');

const MAX_LINES = 600;   // a dense page of text; beyond this the overlay is noise anyway

let store = null;
function init(deps) { store = deps.store; }

function dir(dateKey) { return path.join(store.paths().ocr, dateKey); }
function file(dateKey, id) { return path.join(dir(dateKey), `${id}.json`); }

/** Merges the words of one line into the rectangle that contains them. */
function lineBox(items) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const it of items) {
    const b = it && it.box;
    if (!b) continue;
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
  }
  if (!Number.isFinite(x0)) return null;
  return [Math.round(x0), Math.round(y0), Math.round(x1 - x0), Math.round(y1 - y0)];
}

/**
 * Turns one OCR result into the compact shape that is stored.
 * @param {Array<Array<{text:string, box:object, confidence:number}>>} lines from ppu-paddle-ocr
 * @returns {{w:number,h:number,lines:Array<[number,number,number,number,number,string]>}|null}
 */
function shape(lines, { width = 0, height = 0 } = {}) {
  if (!Array.isArray(lines) || !lines.length) return null;
  const out = [];
  for (const items of lines.slice(0, MAX_LINES)) {
    if (!Array.isArray(items) || !items.length) continue;
    const box = lineBox(items);
    if (!box) continue;
    const text = items.map((i) => String(i.text || '')).join(' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    let conf = 1;
    for (const i of items) conf = Math.min(conf, typeof i.confidence === 'number' ? i.confidence : 1);
    out.push([...box, Math.round(conf * 100), text]);
  }
  if (!out.length) return null;
  // The picture's own size, so the overlay can be positioned before the image has loaded. When the
  // caller does not know it, the widest box is a lower bound and the renderer falls back to naturalWidth.
  const w = width || out.reduce((m, l) => Math.max(m, l[0] + l[2]), 0);
  const h = height || out.reduce((m, l) => Math.max(m, l[1] + l[3]), 0);
  return { w, h, lines: out };
}

// 整屏截图最上面那一条是操作系统的，不是你的。
//
// 菜单栏「Chrome File Edit View History Bookmarks Profiles Tab Window Help」在每一张整屏截图的
// 第一行，每个词都大写，于是「File · Window · History」自己整理成了一件事，成员是三张毫不相干的
// 截图。以前拿一张词表挡（entity.js 的 CHROME，2026-09-09 删了）——但它不是词汇问题，是**位置**问题：
// 它在最上面那一条。boilerpipe 那一路的做法就是这样，看形状不看词。
//
// 正文先读辅助功能树之后（ax-text.js），走 OCR 的只剩树给不出的那些应用，它们的整屏截图里
// 系统性的家具就只有这一条。旧记录同样适用：字框（ocrBoxes）一直存着每一行的位置。
//
// 剥掉的只是「拿去理解」的那一份（索引、词表），存下的正文一个字不动——和 boilerplate.js 同一条规矩。
//
// 多高算最上面：macOS 的菜单栏 24–37 pt，按最高的算；截图是像素，视网膜屏是 2 倍——
// 宽过 2560 就当 2 倍。这台机器上三块屏都是 30 pt（2026-09-09 量的）。
const TOP_PT = 37;
const RETINA_FROM = 2560;
/**
 * 一条记录拿去理解的正文：整屏截图去掉最上面那一条系统家具，别的原样。
 * @param {object} entry
 * @returns {string}
 */
function bodyText(entry) {
  const e = entry || {};
  const text = String(e.text || '');
  if (e.type !== 'screenshot' || e.region || !e.ocrBoxes || !e.width || !text) return text;
  const data = load(e);
  if (!data || !Array.isArray(data.lines)) return text;
  const band = TOP_PT * (e.width >= RETINA_FROM ? 2 : 1);
  const top = new Set();
  for (const l of data.lines) if (Array.isArray(l) && l[1] + l[3] / 2 < band && l[5]) top.add(String(l[5]).trim());
  if (!top.size) return text;
  return text.split('\n').filter((line) => !top.has(line.trim())).join('\n');
}

/** @returns {number} how many lines were stored (0 when there was nothing worth storing). */
function save(entry, lines, size) {
  if (!store || !entry) return 0;
  const data = shape(lines, size || { width: entry.width, height: entry.height });
  if (!data) return 0;
  try {
    fs.mkdirSync(dir(entry.dateKey), { recursive: true });
    fs.writeFileSync(file(entry.dateKey, entry.id), JSON.stringify(data));
    return data.lines.length;
  } catch (e) {
    console.warn('[ocr-boxes] cannot save', e.message);
    return 0;
  }
}

function load(entry) {
  if (!store || !entry) return null;
  try { return JSON.parse(fs.readFileSync(file(entry.dateKey, entry.id), 'utf8')); } catch (_) { return null; }
}

function remove(entry) {
  if (!store || !entry) return;
  try { fs.rmSync(file(entry.dateKey, entry.id), { force: true }); } catch (_) { /* already gone */ }
}

module.exports = { init, save, load, remove, shape, lineBox, bodyText, MAX_LINES, TOP_PT, RETINA_FROM };
