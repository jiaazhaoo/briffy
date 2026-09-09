'use strict';
// Chrome 应用商店那张 440×280 的小宣传磁贴。
//
//   npm run store:assets        →  assets/store/promo-440x280.png
//
// 为什么要在 Electron 里画，而不是用 @napi-rs/canvas：站点和应用用的是 Source Sans 3，而它在
// assets/fonts/ 里是 woff2 —— @napi-rs/canvas 注册不了 woff2，只能拿系统字画，画出来是一张
// 用 Helvetica 写着 briffy 的磁贴，那是错的品牌资产。Chromium 认 woff2，所以这里开一扇看不见的窗，
// 用真的 tokens.css 和真的字面渲染，再截下来 —— 磁贴上的字和站点上的是同一副面孔。
//
// 回形针照抄 assets/brand/briffy.svg 的路径数据，一个数都没动（那份文件顶上写了为什么）。
// 排版守 paper-ui：全直角、没有边框和分隔线、没有影子（磁贴是印刷品，不是躺在纸上的东西）、
// 一屏一个彩色（只有回形针是蓝的）。
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'assets', 'store');

const W = 440;
const H = 280;
const SS = 2;          // 先按两倍渲染再缩回去：440px 宽的位图上，1x 的字会发虚

/** file:// 绝对地址。fonts.css 里的 url(./files/…) 靠它自己所在的位置解析，所以直接指过去就行。 */
const fileUrl = (rel) => `file://${path.join(ROOT, rel).split(path.sep).join('/')}`;

const HTML = `<!doctype html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8" />
<link rel="stylesheet" href="${fileUrl('assets/fonts/fonts.css')}" />
<link rel="stylesheet" href="${fileUrl('assets/paper/tokens.css')}" />
<style>
  html, body { margin: 0; padding: 0; width: ${W * SS}px; height: ${H * SS}px; overflow: hidden; }
  /* 两倍渲染：版面照 440×280 写，整块放大两倍，截完再缩回去 */
  .scale { width: ${W}px; height: ${H}px; transform: scale(${SS}); transform-origin: top left; }
  .tile {
    width: ${W}px; height: ${H}px; box-sizing: border-box;
    background: var(--ground);
    display: flex; align-items: center; gap: 28px;
    padding: 0 38px;
    font-family: var(--sans);
    -webkit-font-smoothing: antialiased;
    text-autospace: normal; text-spacing-trim: space-first;
  }
  .mark { flex: none; width: 124px; height: 124px; }
  .words { min-width: 0; }
  .name { margin: 0; font: 600 40px/1 var(--sans); letter-spacing: -.02em; color: var(--ink); }
  .what { margin: 10px 0 0; font: 600 17px/1.35 var(--sans); color: var(--ink); }
  .line { margin: 8px 0 0; font: 400 14px/1.5 var(--sans); color: var(--ink-2); }
</style>
</head>
<body>
<div class="scale"><div class="tile">
  <!-- assets/brand/briffy.svg，逐字符照抄；viewBox 收掉白底那一层 -->
  <svg class="mark" viewBox="0 0 638 638" xmlns="http://www.w3.org/2000/svg">
    <g fill="none" stroke="#2A6CF0" stroke-linecap="round">
      <path d="M156.5 638 V283.75 A161.75 161.75 0 0 1 480 283.75 V638" stroke-width="46"/>
      <path d="M245.5 638 V493.5 A73 73 0 0 1 391.5 493.5 V638" stroke-width="45"/>
      <path d="M291.5 320 A27.6 27.6 0 0 0 345.5 320" stroke-width="20"/>
    </g>
    <g fill="#2A6CF0">
      <circle cx="238" cy="281" r="27"/>
      <circle cx="399" cy="281" r="27"/>
    </g>
  </svg>
  <div class="words">
    <p class="name">briffy</p>
    <p class="what">网页媒体采集</p>
    <p class="line">这一页的图片、视频、音频，<br />一键存进本机的 briffy。</p>
  </div>
</div></div>
</body>
</html>
`;

async function run() {
  // 磁贴是印在商店列表页上的，那一页永远是亮的。不锁死的话，这台机器是暗色系统时会渲出一张深色的图。
  nativeTheme.themeSource = 'light';

  const win = new BrowserWindow({
    width: W * SS,
    height: H * SS,
    useContentSize: true,
    show: false,
    webPreferences: { offscreen: false, backgroundThrottling: false },
  });

  const tmp = path.join(app.getPath('temp'), `briffy-promo-${process.pid}.html`);
  fs.writeFileSync(tmp, HTML);
  await win.loadFile(tmp);

  // 字体是 font-display: block，第一帧可能还没上字。等排版稳定再截。
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
  await new Promise((r) => setTimeout(r, 250));

  const shot = await win.webContents.capturePage();
  const png = shot.resize({ width: W, height: H, quality: 'best' }).toPNG();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, 'promo-440x280.png');
  fs.writeFileSync(out, png);

  const { width, height } = shot.getSize();
  console.log(`渲染 ${width}×${height} → 缩到 ${W}×${H}`);
  console.log(`${(png.length / 1024).toFixed(0)} KB  ${path.relative(ROOT, out)}`);

  fs.rmSync(tmp, { force: true });
  win.destroy();
  app.quit();
}

app.whenReady().then(run).catch((e) => { console.error(e); app.exit(1); });
