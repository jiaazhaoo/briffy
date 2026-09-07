'use strict';
// 框选截图那张「冻住的桌面」颜色对不对。
//
//   npx electron dev/region-color-check.js
//
// region.js 走的是 node-screenshots 的 toRaw() 再交给 nativeImage.createFromBitmap()。
// 两边对通道顺序的约定不一定一样：createFromBitmap 要的是平台原生序（macOS 上是 BGRA），
// 而 toRaw 给的可能是 RGBA。真要是反的，红蓝互换——整屏色相就是歪的，而且歪得很均匀，
// 一眼看不出是「反了」，只觉得不对劲。
//
// 判法不靠文档：同一次抓屏，一路走 toPng()（真 PNG，通道序没有歧义），另一路走
// toRaw()+createFromBitmap()+toPNG()，同一个像素比一比。
const { app, nativeImage } = require('electron');

const px = (img, x, y) => {
  const { width } = img.getSize();
  const b = img.toBitmap();            // 平台原生序，macOS 上 BGRA
  const i = (y * width + x) * 4;
  return { r: b[i + 2], g: b[i + 1], b: b[i] };
};

app.whenReady().then(async () => {
  const lib = require('node-screenshots');
  const mon = lib.Monitor.all().find((m) => m.isPrimary()) || lib.Monitor.all()[0];
  const shot = await mon.captureImage();

  const viaPng = nativeImage.createFromBuffer(await shot.toPng());
  // region.js 走的正是这一条，连同它那一步通道翻转
  const region = require('../src/main/region');
  const raw = await shot.toRaw();
  const t0 = Date.now();
  region.toBGRA(raw);
  const flipMs = Date.now() - t0;
  const t1 = Date.now();
  const viaRaw = nativeImage.createFromBitmap(raw, { width: shot.width, height: shot.height });
  const makeMs = Date.now() - t1;

  // 只挑红蓝差得开的像素来比——中性灰上 R===B，红蓝反了也看不出来，拿它当证据是骗自己
  const ref = viaPng.toBitmap();
  const { width, height } = viaPng.getSize();
  const spots = [];
  for (let n = 0; n < 4000 && spots.length < 6; n++) {
    const x = ((n * 7919) % width); const y = ((n * 104729) % height);
    const i = (y * width + x) * 4;
    if (Math.abs(ref[i + 2] - ref[i]) >= 24) spots.push([x, y]);
  }
  const px = (img, x, y) => {
    const b = img.toBitmap();            // 平台原生序，macOS 上 BGRA
    const i = (y * img.getSize().width + x) * 4;
    return { r: b[i + 2], g: b[i + 1], b: b[i] };
  };

  console.log(`屏幕 ${shot.width}×${shot.height}，挑了 ${spots.length} 个红蓝差得开的点（中性灰证明不了什么）`);
  console.log('   点位        toPng（基准）          toRaw+createFromBitmap（现在这条路）');
  let swapped = 0; let same = 0;
  for (const [x, y] of spots) {
    const a = px(viaPng, x, y); const b = px(viaRaw, x, y);
    const eq = a.r === b.r && a.g === b.g && a.b === b.b;
    const sw = a.r === b.b && a.g === b.g && a.b === b.r;
    if (eq) same++; else if (sw) swapped++;
    console.log(`  ${String(x).padStart(5)},${String(y).padStart(5)}   rgb(${a.r},${a.g},${a.b})`.padEnd(46)
      + `rgb(${b.r},${b.g},${b.b})   ${eq ? '一样' : sw ? '← 红蓝反了' : '不一样'}`);
  }
  if (!spots.length) console.log('  这一屏全是灰的，换个有颜色的画面再跑一次');
  console.log(`\n结论：${swapped ? `红蓝互换（${swapped} 个点对上了）——冻住的桌面色相是歪的`
    : same === spots.length && spots.length ? '一致，通道序没问题' : '两边不一致，但不是简单的红蓝互换'}`);
  console.log(`翻通道 ${flipMs}ms + createFromBitmap ${makeMs}ms（${(shot.width * shot.height / 1e6).toFixed(1)}M 像素）`);
  app.quit();
}).catch((e) => { console.error('炸了:', e && e.stack || e); app.quit(); });
