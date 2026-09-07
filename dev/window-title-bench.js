'use strict';
// 复制的时候那个标签页叫什么，值不值得一起算进向量。
//
//   npx electron dev/window-title-bench.js
//
// 起因：「Windsor Road, Egham TW20 0AE」和「泰晤士河道超级马拉松」的相似度是 0.155——比瞎猜还低，
// 门槛怎么调都救不了（调到 0.2 才连上 3/8，代价是每条记录连到全工作区的一半）。
// 但那条记录**自己带着** context.window = "Your location to Staines Train Station"，
// 而另外三条停车记录带的是 "赛程分前后半程 - Claude"——和那条书签的标题一字不差。
//
// 也就是说：这条关系一直写在记录里，只是 chunk.textOf 不读它。textOf 现在是「标题。正文」，
// 而**标题和正文说的是你复制了什么，窗口标题说的是你当时在干什么**——后者才是把一个邮编
// 和一场徒步连起来的那一半。
const fs = require('fs'); const path = require('path'); const os = require('os');
const { app } = require('electron');

const HOME = os.homedir();
const WS = path.join(HOME, 'Library/Application Support/briffy/workspace');
const DIR = path.join(WS, 'entries');
const CACHE = path.join(HOME, 'Library/Application Support/briffy/models');
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const norm = (v) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return v.map((x) => x / n); };

async function main() {
  const embed = require('../src/main/embed');
  const chunk = require('../src/main/chunk');

  const all = new Map();
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.json')) continue;
    let e; try { e = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (_) { continue; }
    for (const x of (Array.isArray(e) ? e : e.entries || [])) all.set(x.id, x);
  }
  const day = [...all.values()].filter((e) => {
    const d = new Date(e.createdAt || 0);
    return d.getFullYear() === 2026 && d.getMonth() === 8 && d.getDate() === 6;
  });
  const byTitle = (re) => day.find((e) => re.test(one(e.title)));

  // 那一堆里真的说到这件事的两条，当锚点
  const anchors = [/^Ultra Challenge$/i, /^Thank you! Your registration/i].map(byTitle).filter(Boolean);
  // 停车那几条纯地址
  const parks = [/^Bishops Park/i, /^Runnymede Pleasure/i, /^停 Staines/, /^£10 接驳车/,
    /^Parking space on Buckingham/i, /^Buckingham Court, Kingston/i, /^Windsor Road, Egham/i].map(byTitle).filter(Boolean);
  if (!anchors.length || !parks.length) { console.log('这台机器上找不到那几条记录'); app.quit(); return; }

  // 现在的正文 vs 正文 + 窗口标题
  const withWin = (e) => {
    const w = one((e.context || {}).window);
    const t = chunk.textOf(e);
    return w ? `${t}。${w}` : t;
  };
  const texts = [...anchors, ...parks];
  const a0 = await embed.embed(texts.map((e) => chunk.textOf(e).slice(0, 400)), { cacheDir: CACHE });
  const a1 = await embed.embed(texts.map((e) => withWin(e).slice(0, 400)), { cacheDir: CACHE });
  const V0 = new Map(texts.map((e, i) => [e.id, norm([...a0[i]])]));
  const V1 = new Map(texts.map((e, i) => [e.id, norm([...a1[i]])]));

  console.log('锚点（那一堆里真的说到这件事的两条）：');
  for (const a of anchors) console.log(`   ${one(a.title).slice(0, 40)}   窗口「${one((a.context || {}).window).slice(0, 44)}」`);

  console.log('\n  现在   加上窗口标题   变化    记录 ← 它当时那个标签页');
  let up = 0; let over = 0;
  for (const p of parks) {
    const before = Math.max(...anchors.map((a) => dot(V0.get(p.id), V0.get(a.id))));
    const after = Math.max(...anchors.map((a) => dot(V1.get(p.id), V1.get(a.id))));
    if (after > before) up++;
    if (after >= 0.60) over++;
    const mark = after >= 0.60 ? '  ← 过 0.60，连上了' : '';
    console.log(`  ${before.toFixed(3)}      ${after.toFixed(3)}    ${(after - before >= 0 ? '+' : '')}${(after - before).toFixed(3)}   ${one(p.title).slice(0, 30).padEnd(32)} ← ${one((p.context || {}).window).slice(0, 40)}${mark}`);
  }
  console.log(`\n  ${parks.length} 条里 ${up} 条变近了，${over} 条过了双链的门槛 0.60（原来 0 条）`);

  // 反面：会不会把不相干的也拉近。拿当天别的记录当对照
  const others = day.filter((e) => !texts.includes(e) && chunk.textOf(e).length >= 24).slice(0, 40);
  if (others.length) {
    const b0 = await embed.embed(others.map((e) => chunk.textOf(e).slice(0, 400)), { cacheDir: CACHE });
    const b1 = await embed.embed(others.map((e) => withWin(e).slice(0, 400)), { cacheDir: CACHE });
    let n0 = 0; let n1 = 0;
    others.forEach((e, i) => {
      n0 += Math.max(...anchors.map((a) => dot(norm([...b0[i]]), V0.get(a.id)))) >= 0.60 ? 1 : 0;
      n1 += Math.max(...anchors.map((a) => dot(norm([...b1[i]]), V1.get(a.id)))) >= 0.60 ? 1 : 0;
    });
    console.log(`  代价：当天另外 ${others.length} 条不相干的记录，过 0.60 的从 ${n0} 条变成 ${n1} 条`);
  }
  embed.dispose();
  app.quit();
}
app.whenReady().then(() => main().catch((e) => { console.error('炸了:', e && e.stack || e); app.quit(); }));
