'use strict';
// 滚动驱动必须会自己走掉。
//
//   node dev/scroll-exit-test.js
//
// 这个文件的存在有一个具体理由：2026-09-06 那天，一个驱动进程在用户机器上空转了四个半小时，
// 占满一个核，风扇一直响。原因是 JXA 桥把 NSData 的 length 变成了**字符串**，于是
//
//   d.length === 0        // "0" === 0 -> false，永远不成立
//
// 退出条件形同虚设。父进程还在时它确实阻塞着，什么都看不出来；父进程一死、管道一关，
// availableData 就不停返回空数据，而循环永远不退——只有在那之后才会烧起来，所以之前每一次测试都是绿的。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn, execSync, execFileSync } = require('child_process');

let pass = 0; let fail = 0;
const ok = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name} — ${e.message}`); }
};
// 必须是异步的等待。第一版用同步的 sleep 把事件循环堵死了，于是 child.stdin.end() 压根没真的关掉
// 管道，测试就看见「关了还活着」——那是测试自己的毛病，不是被测代码的。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 直接从源文件里取那段脚本，免得测试和实现各写一份
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'scroll.js'), 'utf8');
const DRIVER = src.match(/const DRIVER = `([\s\S]*?)`;/)[1].replace(/\$\{IDLE_EXIT_MS\}/, '600000');

const run = async () => {
await ok('JXA 里 NSData 的 length 是字符串——这就是当初那个 bug', () => {
  const out = execFileSync('osascript', ['-l', 'JavaScript', '-e',
    'ObjC.import("Foundation"); const e = $.NSData.data;'
    + 'JSON.stringify({ t: typeof e.length, strict: e.length === 0, numbered: Number(e.length) === 0 })'],
  { encoding: 'utf8' });
  const r = JSON.parse(out.trim());
  assert.strictEqual(r.t, 'string', `length 的类型是 ${r.t}`);
  assert.strictEqual(r.strict, false, '=== 0 居然成立了，那这个测试就没意义了');
  assert.strictEqual(r.numbered, true, 'Number() 之后也不成立，那修法就是错的');
});

await ok('代码里没有留下 === 0 这种写法（注释里说这段历史不算）', () => {
  const code = DRIVER.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/\.length === 0/.test(code), 'DRIVER 里还有 .length === 0');
  assert.ok(/Number\([^)]*\.length\) === 0/.test(code), '没看到 Number() 之后的比较');
});

await ok('管道一关，驱动进程就走——不是空转', async () => {
  const child = spawn('osascript', ['-l', 'JavaScript', '-e', DRIVER], { stdio: ['pipe', 'pipe', 'ignore'] });
  const alive = () => { try { execSync(`ps -p ${child.pid} > /dev/null 2>&1`); return true; } catch (_) { return false; } };
  const cpuOf = () => { try { return execSync(`ps -o pcpu= -p ${child.pid}`).toString().trim(); } catch (_) { return '0'; } };

  await sleep(1200);                             // 让它进到循环里
  assert.ok(Number(cpuOf()) < 25, `父进程还在时就已经在烧 CPU：${cpuOf()}%`);

  child.stdin.end();                             // 父进程死掉的等价情形
  let gone = false;
  for (let i = 0; i < 30 && !gone; i++) { await sleep(100); gone = !alive(); }
  if (!gone) {
    const cpu = cpuOf();
    try { child.kill('SIGKILL'); } catch (_) { /* 没了 */ }
    throw new Error(`管道关了 3 秒还活着，CPU ${cpu}%——就是当初那个空转`);
  }
});

await ok('驱动脚本自己带一个活命上限，不指望别人来收尸', () => {
  assert.ok(/DEADLINE/.test(DRIVER), '没有 DEADLINE');
  assert.ok(/Date\.now\(\) > DEADLINE/.test(DRIVER), '有 DEADLINE 但没检查');
});

await ok('主进程退出时会把它带走', () => {
  assert.ok(/process\.once\('exit'[\s\S]{0,120}kill/.test(src), 'scroll.js 里没有 exit 时的清理');
});

};
run().then(() => {
  console.log(`\nscroll-exit: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
