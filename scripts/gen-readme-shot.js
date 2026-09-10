'use strict';
// README 首图：工作区那一屏，英文界面、假数据。
//
//   npm run readme:shot        →  docs/screenshot.png（1280×800）
//
// 为什么要有这个脚本：**一个桌面应用的 README 不能没有图。** 2026-09-10 量过五个同类项目
// （screenpipe / ollama / zed / logseq / memos），每一个都在前五行里放图，而 briffy 的 README
// 一张都没有。
//
// 为什么不直接截真的应用：那一屏上是用户自己的记录。首图要发到公开仓库上，不能拿真东西去发。
// 预览页（dev/preview/serve.js）跑的是**真的 CSS 和真的渲染代码**，只把 Electron 的 IPC 换成
// 假数据，所以截出来就是应用本来的样子，只是内容是编的。
//
// 为什么在 Electron 里截而不是别的无头浏览器：和 gen-store-assets.js 同一个理由——
// 界面用的 Source Sans 3 是 woff2，Chromium 认得，别的画布库不认，出来会是一张用 Helvetica
// 写着 briffy 的图。这里开一扇看不见的窗，用真字体渲染，再 capturePage。
const { app, BrowserWindow, nativeTheme } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshot.png');
const PORT = 5273;                       // 不用 5173：开发时那个多半正开着
const URL = `http://127.0.0.1:${PORT}/?lang=en`;
const W = 1280;
// 高度是**照内容量定的**，不是随手一个 800：这批假数据是 11 条，800 高的话下面三分之一是空的，
// 一张首图上一大片空地读起来是「这软件里没东西」。680 刚好让最后一行落在托盘上面。
const H = 680;

function waitForServer(tries = 60) {
  return new Promise((resolve, reject) => {
    const hit = () => http.get(URL, (r) => { r.resume(); resolve(); })
      .on('error', () => (tries-- > 0 ? setTimeout(hit, 100) : reject(new Error('预览服务器没起来'))));
    hit();
  });
}

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'dev', 'preview', 'serve.js')], {
    env: { ...process.env, PORT: String(PORT), ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'ignore',
  });
  const done = (code) => { try { server.kill(); } catch (_) { /* 已经没了 */ } app.exit(code); };

  try {
    await waitForServer();
    await app.whenReady();
    nativeTheme.themeSource = 'light';    // 首图用亮色：暖灰底纸是这套设计的主张
    const win = new BrowserWindow({
      width: W, height: H, show: false, frame: false,
      webPreferences: { offscreen: false },
    });
    await win.loadURL(URL);
    // 等到真的有卡片画出来为止。固定 sleep 会在慢机器上截到一张空屏——
    // 那正是这种脚本最常见的坏法，而且它不报错，只是悄悄出一张废图。
    await win.webContents.executeJavaScript(`new Promise((ok, no) => {
      const t0 = Date.now();
      const tick = () => {
        if (document.querySelectorAll('#jgScroll .jg-tile').length >= 8) return ok(true);
        if (Date.now() - t0 > 15000) return no(new Error('等不到卡片'));
        setTimeout(tick, 100);
      };
      tick();
    })`);
    await new Promise((r) => setTimeout(r, 400));      // 让影子和字体落定
    const img = await win.capturePage();
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, img.toPNG());
    const kb = Math.round(fs.statSync(OUT).size / 1024);
    console.log(`${path.relative(ROOT, OUT)}  ${img.getSize().width}×${img.getSize().height}  ${kb} KB`);
    done(0);
  } catch (err) {
    console.error('出图失败：', err.message);
    done(1);
  }
})();
