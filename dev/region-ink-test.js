'use strict';
// 框选截图上画的那一层，叠回原图之后对不对。
//
//   npx electron dev/region-ink-test.js
//
// 这一段只能在主进程量：渲染层交出来的是一张「底下透明」的标注层，底图那一半从没离开过主进程
// （送过去的桌面是 JPEG，拿它当底图存出去等于凭空掉一次画质）。而主进程没有 canvas，
// 叠加是手算的，所以三件事必须钉死：透明的地方不动、不透明的地方照抄、半透明的地方按 alpha 混。
//
// 最容易错的是最后一件：Electron 的位图是**预乘**的（rgba(255,0,0,128) 读回来 r=128,a=128），
// 公式里再乘一遍 alpha，所有半透明边缘都会发暗——笔画看着像镶了一圈黑边，而且只在斜边上显形，
// 截图里几乎看不出来。所以这里拿数值验，不靠眼睛。
const zlib = require('zlib');
const { app, nativeImage } = require('electron');

let pass = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { console.log(`  FAIL ${name} — ${e.message}`); process.exitCode = 1; }
};

function crc32(buf) {
  let c; const t = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  let r = 0xffffffff;
  for (const b of buf) r = t[(r ^ b) & 0xff] ^ (r >>> 8);
  return (r ^ 0xffffffff) >>> 0;
}
/** 一张手写的 RGBA PNG。不引库：这个测试要验的就是解码之后的字节，中间少一层更好说清楚 */
function pngOf(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; raw[o++] = rgba[i]; raw[o++] = rgba[i + 1]; raw[o++] = rgba[i + 2]; raw[o++] = rgba[i + 3]; }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const dataUrl = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
const px = (img, i) => { const b = img.toBitmap(); return { b: b[i * 4], g: b[i * 4 + 1], r: b[i * 4 + 2], a: b[i * 4 + 3] }; };

app.whenReady().then(() => {
  const region = require('../src/main/region');

  // 底图三个像素，都是灰 (100,100,100)
  const base = nativeImage.createFromBuffer(pngOf(3, 1, [100, 100, 100, 255, 100, 100, 100, 255, 100, 100, 100, 255]));
  // 标注层：全透明 · 纯红不透明 · 纯红半透明
  const ink = dataUrl(pngOf(3, 1, [0, 0, 0, 0, 255, 0, 0, 255, 255, 0, 0, 128]));
  const out = region.overlay(base, ink);

  ok('没画到的地方原样不动', () => {
    const p = px(out, 0);
    if (p.r !== 100 || p.g !== 100 || p.b !== 100) throw new Error(`rgb(${p.r},${p.g},${p.b})，本该还是 100,100,100`);
  });
  ok('画满的地方就是画上去的颜色', () => {
    const p = px(out, 1);
    if (p.r !== 255 || p.g !== 0 || p.b !== 0) throw new Error(`rgb(${p.r},${p.g},${p.b})，本该是 255,0,0`);
  });
  ok('半透明的边缘按 alpha 混，不发暗（预乘那一条）', () => {
    const p = px(out, 2);
    // 128/255 的红盖在 100 灰上：红 = 100·(1−.502) + 255·.502 ≈ 178，绿蓝 = 100·.498 ≈ 50
    const near = (got, want) => Math.abs(got - want) <= 2;
    if (!near(p.r, 178)) throw new Error(`红 ${p.r}，本该 ≈178`);
    if (!near(p.g, 50) || !near(p.b, 50)) throw new Error(`绿蓝 ${p.g},${p.b}，本该 ≈50 —— 偏小就是又乘了一遍 alpha`);
  });
  ok('尺寸对不上就整层不叠，宁可没有标注也不要错位的标注', () => {
    const wrong = dataUrl(pngOf(2, 1, [255, 0, 0, 255, 255, 0, 0, 255]));
    const r = region.overlay(base, wrong);
    const p = px(r, 1);
    if (p.r !== 100) throw new Error(`rgb(${p.r},${p.g},${p.b})，尺寸不符本该原样返回`);
  });
  ok('没画东西的时候原样返回', () => {
    if (region.overlay(base, '') !== base) throw new Error('空的标注层不该新建一张图');
  });
  ok('坏的 data URL 不炸，退回原图', () => {
    const r = region.overlay(base, 'data:image/png;base64,!!!not-a-png!!!');
    if (px(r, 0).r !== 100) throw new Error('该原样返回');
  });

  console.log(`\nregion ink: ${pass} passed`);
  app.quit();
}).catch((e) => { console.error('炸了:', e && e.stack || e); app.quit(); });
