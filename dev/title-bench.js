'use strict';
// 自动标题在真实工作区上到底能覆盖多少、长什么样。
//
//   node dev/title-bench.js [--all]
//
// 只看一个数：**还剩几条是「类型 + 时间」**——那是「我看着根本不知道这是什么」的那一类。
const fs = require('fs');
const path = require('path');
const os = require('os');
const title = require('../src/main/title');

const WS = path.join(os.homedir(), 'Library/Application Support/briffy/workspace');
const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const BARE = /^(截图|Screenshot|剪贴板图片|Clipboard image|语音|Voice|录音)\s*\d{1,2}:\d{2}$/;

const rows = [];
for (const f of fs.readdirSync(path.join(WS, 'entries'))) {
  if (!f.endsWith('.json')) continue;
  let e; try { e = JSON.parse(fs.readFileSync(path.join(WS, 'entries', f), 'utf8')); } catch (_) { continue; }
  for (const x of (Array.isArray(e) ? e : e.entries || [])) rows.push(x);
}
// OCR 的行
const boxes = new Map();
const ocrDir = path.join(WS, 'ocr');
if (fs.existsSync(ocrDir)) {
  for (const d of fs.readdirSync(ocrDir)) {
    const dd = path.join(ocrDir, d);
    if (!fs.statSync(dd).isDirectory()) continue;
    for (const f of fs.readdirSync(dd)) {
      if (!f.endsWith('.json')) continue;
      try { boxes.set(f.slice(0, -5), JSON.parse(fs.readFileSync(path.join(dd, f), 'utf8')).lines || []); } catch (_) { /* skip */ }
    }
  }
}
// 界面词：一个词在多少张图里出现过
const df = new Map();
for (const [, lines] of boxes) {
  const seen = new Set();
  for (const l of lines) for (const w of title.words(l[5])) seen.add(w);
  for (const w of seen) df.set(w, (df.get(w) || 0) + 1);
}
const chrome = (w) => df.get(w) || 0;

let before = 0; let after = 0;
const changed = [];
for (const x of rows) {
  const old = one(x.title);
  if (BARE.test(old)) before++;
  const useChrome = !process.argv.includes('--no-chrome');
  const now = title.of(x, { lines: boxes.get(x.id), chrome: useChrome ? chrome : null, shots: useChrome ? boxes.size : 0, fallback: old });
  if (BARE.test(now)) after++;
  if (now && now !== old) changed.push([old, now, x.type]);
}
console.log(`${rows.length} 条记录，其中 ${boxes.size} 条有 OCR 的行\n`);
console.log(`  「类型+时间」那种看不懂的：   改前 ${before} 条 (${(before / rows.length * 100).toFixed(0)}%)  →  改后 ${after} 条 (${(after / rows.length * 100).toFixed(0)}%)`);
console.log(`  标题会变的：                 ${changed.length} 条\n`);
const n = process.argv.includes('--all') ? changed.length : 24;
for (const [a, b, t] of changed.slice(0, n)) console.log(`  [${t.padEnd(10)}] ${a.slice(0, 30).padEnd(32)} → ${b}`);
if (changed.length > n) console.log(`  … 还有 ${changed.length - n} 条（--all 看全部）`);
