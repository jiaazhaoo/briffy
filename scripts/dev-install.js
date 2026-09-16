'use strict';
// npm run dev:install —— 把当前这份源码变成这台机器上**唯一**那个 briffy。
//
// 2026-09-17 加的，为了让这一天的事不可能再发生。四条铁律，每一条都是当天踩出来的：
//
//   1. 只用 Developer ID 签，没有证书就**停下来报错**，绝不退回 ad-hoc。
//      ad-hoc 在 TCC 眼里是另一个 app（身份成了 `Electron`），屏幕录制、麦克风的授权
//      一个都不继承——而且每重打一次就又是一个新身份。用户看着系统设置里 briffy 的
//      开关明明是开的，按快捷键照样弹授权框，因为那个开关是给另一个 app 打的。
//   2. 装到 /Applications，路径和身份都和用户手动装的那个一样，所以**已经给过的授权直接继承**。
//   3. 装完把 release/ 里那个副本删掉。机器上同时存在两个可以双击的 briffy，
//      就一定会有一次「你以为在测新的，其实跑的是旧的」。
//   4. 先盖戳再打包，让这个包说得出自己是哪个 commit（npm run doctor 读它）。
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BUILT = path.join(ROOT, 'release', 'mac-arm64', 'briffy.app');
const DEST = '/Applications/briffy.app';
const BACKUP = '/Applications/briffy.app.prev';

const sh = (cmd, o = {}) => execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...o });
const out = (cmd) => { try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (_) { return ''; } };
const die = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };

function requireSigningIdentity() {
  const ids = out('security find-identity -v -p codesigning');
  const m = ids.match(/"(Developer ID Application: [^"]+)"/);
  if (!m) {
    die([
      '钥匙串里没有 Developer ID Application 证书，装不了。',
      '',
      '  不退回 ad-hoc 签名是**故意的**：ad-hoc 签出来的包在 macOS 眼里是另一个 app，',
      '  屏幕录制和麦克风的授权一个都不会继承，而且每重打一次就又换一个身份。',
      '  2026-09-17 就是这么浪费了一下午。',
      '',
      '  要么装上证书，要么用 npm run pack 打一个不签名的包自己手动试（但别指望权限能用）。',
    ].join('\n'));
  }
  return m[1];
}

function main() {
  console.log('\n— briffy dev:install —\n');

  const identity = requireSigningIdentity();
  console.log(`签名证书  ${identity}`);

  // 1. 盖戳
  const { stamp } = require('./stamp.js');
  const info = stamp();
  console.log(`构建戳    ${info.short}${info.dirty ? '+dirty' : ''} · ${info.branch}`);
  if (info.dirty) console.log('          ! 工作区有未提交改动，这个包的 commit 号对不上里面的代码');

  // 2. 打包（签名交给 electron-builder 自动发现证书；公证本机自用不需要）
  console.log('\n打包中…（约 2–3 分钟）');
  try {
    sh('npx electron-builder --dir --mac -c.mac.notarize=false', { stdio: ['ignore', 'ignore', 'inherit'] });
  } catch (_) { die('打包失败，上面是 electron-builder 的输出'); }
  if (!fs.existsSync(BUILT)) die(`打包完了却找不到 ${BUILT}`);

  // 3. 验签 —— 身份必须和用户已经授过权的那个一致，否则装了也白装
  const dv = out(`codesign -dv --verbose=2 "${BUILT}" 2>&1`);
  const id = (dv.match(/^Identifier=(.+)$/m) || [])[1];
  if (/Signature=adhoc/.test(dv)) die('打出来的是 ad-hoc 签名，不装（原因见本文件开头第 1 条）');
  if (id !== 'com.briffy.app') die(`bundle id 是 ${id}，不是 com.briffy.app —— 装了也继承不到授权`);
  if (spawnSync('codesign', ['--verify', '--deep', '--strict', BUILT]).status !== 0) die('签名校验不过，不装');
  console.log(`\n验签      ${id} · Developer ID ✓`);

  // 4. 换上去。先退干净——正在跑的那个占着旧的那份。
  out('osascript -e \'quit app "briffy"\'');
  execSync('pkill -f "briffy.app/Contents/MacOS/briffy" || true', { stdio: 'ignore' });
  execSync('sleep 2');

  try {
    fs.rmSync(BACKUP, { recursive: true, force: true });
    if (fs.existsSync(DEST)) fs.renameSync(DEST, BACKUP);
    execSync(`cp -R "${BUILT}" "${DEST}"`);
  } catch (e) {
    // 换失败就把旧的放回去，别让用户落到一台没有 briffy 的机器上
    if (!fs.existsSync(DEST) && fs.existsSync(BACKUP)) fs.renameSync(BACKUP, DEST);
    die(`装到 /Applications 失败：${e.message}`);
  }
  if (spawnSync('codesign', ['--verify', '--deep', '--strict', DEST]).status !== 0) {
    fs.rmSync(DEST, { recursive: true, force: true });
    if (fs.existsSync(BACKUP)) fs.renameSync(BACKUP, DEST);
    die('装过去之后签名校验不过，已回滚成原来那个');
  }
  fs.rmSync(BACKUP, { recursive: true, force: true });
  console.log(`装好      ${DEST}`);

  // 5. 只留一个可以双击的 briffy
  fs.rmSync(path.join(ROOT, 'release', 'mac-arm64'), { recursive: true, force: true });
  console.log('清理      删掉 release/ 里的副本，机器上只剩这一个 briffy');

  execSync(`open -a "${DEST}"`);
  console.log(`\n✓ 跑起来了 —— ${info.short} · 权限沿用你之前给过的，不用重新打勾\n`);
}

if (require.main === module) main();
