'use strict';
// 把随手截的图垫成 Chrome 应用商店要的 1280×800。
//
//   npm run store:shots -- ~/Desktop/shot1.png ~/Desktop/shot2.png …
//   npm run store:shots -- ~/Desktop/briffy-shots/        # 或者给一个目录
//
// 出到 assets/store/screenshots/01.png、02.png…（按你给的顺序，那也是商店里的展示顺序）
//
// 为什么不直接用原图：商店只收 1280×800 或 640×400，而屏幕截图永远不是这两个尺寸。
// 后台会**替你拉伸**，一张界面截图被拉伸之后字就歪了——那是最容易让人一眼觉得"这东西不专业"的地方。
//
// 所以这里**只缩放不变形**（等比缩到能装下），剩下的地方垫底纸色。垫的是 paper-ui 的 --page
// (#f3f1f0)，不是白也不是黑：商店页面本身是白底，一张纯白留边的图会和页面糊在一起、看不出边界；
// 而底纸色正好是应用自己的颜色，那一圈留白读起来是"这就是它的样子"，不是"这张图没填满"。
//
// 截的时候不用管尺寸，但**别截整个屏幕**：连着桌面壁纸和别的窗口一起交上去，
// 审核和用户都得先找一遍"我该看哪儿"。截那个面板，连着它所在的网页一起，就够了。
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'store', 'screenshots');

const W = 1280;
const H = 800;
const GROUND = '#f3f1f0';        // = --page，assets/paper/tokens.css
const MARGIN = 0.94;             // 图最多占到边框的 94%，四周留一点气

// ---------- 收集输入 ----------
const args = process.argv.slice(2);
if (!args.length) {
  console.error('用法：npm run store:shots -- <图或目录> …\n\n给几张就出几张，顺序就是商店里的展示顺序。');
  process.exit(1);
}
const inputs = [];
for (const a of args) {
  const p = path.resolve(a);
  if (!fs.existsSync(p)) { console.error(`找不到 ${a}`); process.exit(1); }
  if (fs.statSync(p).isDirectory()) {
    for (const f of fs.readdirSync(p).sort()) if (/\.(png|jpe?g)$/i.test(f)) inputs.push(path.join(p, f));
  } else inputs.push(p);
}
if (!inputs.length) { console.error('那个目录里没有 png / jpg'); process.exit(1); }
if (inputs.length > 5) console.log(`⚠️  商店最多收 5 张，你给了 ${inputs.length} 张——多的会出但传不上去\n`);

// ---------- 一张一张垫 ----------
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  let n = 0;
  for (const src of inputs) {
    const img = await loadImage(src);
    // 等比缩放：装得下就不放大（放大一张截图只会更糊），装不下就缩到边框里
    const fit = Math.min((W * MARGIN) / img.width, (H * MARGIN) / img.height, 1);
    const w = Math.round(img.width * fit);
    const h = Math.round(img.height * fit);

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, Math.round((W - w) / 2), Math.round((H - h) / 2), w, h);

    n += 1;
    const out = path.join(OUT, `${String(n).padStart(2, '0')}.png`);
    fs.writeFileSync(out, canvas.toBuffer('image/png'));
    const note = fit === 1 ? '原尺寸' : `缩到 ${(fit * 100).toFixed(0)}%`;
    console.log(`  ${String(n).padStart(2, '0')}.png  ${img.width}×${img.height} → ${w}×${h}（${note}）垫进 ${W}×${H}`);
  }
  console.log(`\n${n} 张，出到 ${path.relative(ROOT, OUT)}/`);
  console.log('提交材料见 docs/chrome-web-store.md §6');
})().catch((e) => { console.error(e.message); process.exit(1); });
