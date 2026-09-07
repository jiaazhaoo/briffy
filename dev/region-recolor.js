'use strict';
// 把框选截图里存歪的颜色掰回来。
//
//   npx electron dev/region-recolor.js            # 只看有哪些，不动文件
//   npx electron dev/region-recolor.js --write    # 真的改
//
// 起因见 src/main/region.js 里 toBGRA 的注释：node-screenshots 给的是 RGBA，
// nativeImage.createFromBitmap 要的是 BGRA，于是每个像素的红和蓝对调了。修好之后新截的都是对的，
// 但**在那之前存下来的 *-region.png 还是歪的**——原图不会自己回来，只能就地把两个通道换回去。
//
// 只碰文件名带 -region 的那些：整屏截图走的是 desktopCapturer，从来没歪过，不该被顺手改一遍。
// 改之前每个文件旁边留一份 .bak，原样不动——「不丢任何数据」。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app, nativeImage } = require('electron');

const WS = path.join(os.homedir(), 'Library/Application Support/briffy/workspace/screenshots');
const write = process.argv.includes('--write');

function swap(buf) {
  for (let i = 0; i + 3 < buf.length; i += 4) { const r = buf[i]; buf[i] = buf[i + 2]; buf[i + 2] = r; }
  return buf;
}

function walk(dir, out = []) {
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const d of names) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, out);
    else if (d.name.endsWith('-region.png')) out.push(p);
  }
  return out;
}

app.whenReady().then(() => {
  const files = walk(WS);
  console.log(`${files.length} 张框选截图${write ? '' : '（这次不动文件，加 --write 才真改）'}\n`);
  let done = 0;
  for (const f of files) {
    const img = nativeImage.createFromPath(f);
    if (img.isEmpty()) { console.log(`  跳过（读不出来） ${path.basename(f)}`); continue; }
    const { width, height } = img.getSize();
    console.log(`  ${path.basename(f)}  ${width}×${height}`);
    if (!write) continue;
    const bak = `${f}.bak`;
    if (!fs.existsSync(bak)) fs.copyFileSync(f, bak);       // 原件留着，一份就够，重复跑不会覆盖
    const fixed = nativeImage.createFromBitmap(swap(img.toBitmap()), { width, height });
    fs.writeFileSync(f, fixed.toPNG());
    done++;
  }
  if (write) console.log(`\n改了 ${done} 张，每张旁边留了一份 .bak`);
  app.quit();
}).catch((e) => { console.error('炸了:', e && e.stack || e); app.quit(); });
