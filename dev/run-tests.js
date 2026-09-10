'use strict';
// 一条命令把台子跑一遍：`npm test`。
//
// dev/ 里有八十多个文件，这之前没有任何办法知道改完一处该跑哪几个——凭记忆挑，
// 于是坏了也没人发现（写这个 runner 的时候当场翻出两个：autopick-test 和 bundled-test
// 用了 path 却没 require，从来没跑通过）。
//
// **不写死清单**：清单会烂。它自己去认 dev/*-test.js，然后按两条规矩分流——
//   · `require('electron')` 的 → 不在这儿跑（要 `npx electron dev/xxx.js`），列出来
//   · 要传参数的手动工具 → 在下面的 NEEDS_ARG 里写明白，连理由一起
// 剩下的全跑。加一个新的 *-test.js 不用改这个文件。
//
// 判成功看退出码。台子的收尾约定不统一（45 个打印 `passed`、24 个用 assert），
// 但**它们都靠退出码说话**，所以按退出码判是唯一对所有台子都成立的判据。
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEV = __dirname;
// 要传参数的：它们是手动工具，不是无人值守的台子。不跑，但要说出来——
// 一个静悄悄被跳过的台子和一个不存在的台子没区别。
const NEEDS_ARG = {
  'ocr-test.js': '要一张图片：node dev/ocr-test.js <图片>',
  'autopick-test.js': '要一张图片：node dev/autopick-test.js <图片>',
  'bundled-test.js': '要一张图片和一段 wav：node dev/bundled-test.js <图片> <wav>',
};
const TIMEOUT_MS = 120000;

function classify() {
  const run = []; const electron = []; const manual = [];
  for (const f of fs.readdirSync(DEV).filter((f) => f.endsWith('-test.js')).sort()) {
    if (NEEDS_ARG[f]) { manual.push(f); continue; }
    const src = fs.readFileSync(path.join(DEV, f), 'utf8');
    if (src.includes("require('electron')")) electron.push(f);
    else run.push(f);
  }
  return { run, electron, manual };
}

function one(file) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    execFile(process.execPath, [path.join(DEV, file)], { timeout: TIMEOUT_MS, maxBuffer: 1 << 26 },
      (err, stdout, stderr) => resolve({
        file, ms: Date.now() - t0, ok: !err,
        tail: String(stderr || stdout || '').trim().split('\n').slice(-3).join('\n'),
      }));
  });
}

(async () => {
  const { run, electron, manual } = classify();
  const bad = [];
  let ms = 0;
  for (const f of run) {
    // eslint-disable-next-line no-await-in-loop
    const r = await one(f);
    ms += r.ms;
    process.stdout.write(`${r.ok ? '  ok  ' : '  ✗   '}${f.padEnd(26)}${String(r.ms).padStart(6)}ms\n`);
    if (!r.ok) bad.push(r);
  }
  if (electron.length) {
    process.stdout.write(`\n要 electron，这儿不跑（${electron.length} 个）：\n`);
    process.stdout.write(`  npx electron dev/${electron.join('\n  npx electron dev/')}\n`);
  }
  if (manual.length) {
    process.stdout.write(`\n要传参数的手动工具（${manual.length} 个）：\n`);
    for (const f of manual) process.stdout.write(`  ${f.padEnd(22)}${NEEDS_ARG[f]}\n`);
  }
  if (bad.length) {
    process.stdout.write(`\n没过的：\n`);
    for (const r of bad) process.stdout.write(`\n── ${r.file}\n${r.tail}\n`);
  }
  process.stdout.write(`\n${run.length} 个台子 · ${(ms / 1000).toFixed(1)}s · 没过的 ${bad.length} 个\n`);
  process.exit(bad.length ? 1 : 0);
})();
