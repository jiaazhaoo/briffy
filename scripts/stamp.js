'use strict';
// 给这次构建盖一个戳：它是哪个 commit、什么时候打的、工作区干不干净。
//
// 2026-09-17 加的。起因：这台机器上同时躺着四个 briffy.app，版本号**全是 1.0.1**
// （09-10 那个发布版，和一天之内打的三个本地包）。用户按了六天截图快捷键没反应，
// 因为修复在源码里而他跑的是旧包——而**应用自己没有任何办法说出它是哪个构建**，
// `app.getVersion()` 对这四个返回同一个字符串。
//
// 戳写进 src/ 是因为 electron-builder 的 files 白名单里有 `src/**/*`，不用改白名单。
// 它不进版本库（.gitignore）——它是构建产物，跟着包走，不跟着源码走。
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'src', 'build-info.json');

function git(cmd, fallback = '') {
  try { return execSync(`git ${cmd}`, { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch (_) { return fallback; }
}

function stamp() {
  // dirty 要记下来：一个「带着未提交改动」打出来的包，它的 commit 号是**骗人的**——
  // 按那个号去 git 里看代码，看到的不是包里跑的东西。体检那边据此报警。
  const dirty = git('status --porcelain') !== '';
  const info = {
    commit: git('rev-parse HEAD', 'unknown'),
    short: git('rev-parse --short HEAD', 'unknown'),
    branch: git('rev-parse --abbrev-ref HEAD', 'unknown'),
    dirty,
    builtAt: new Date().toISOString(),
    version: require('../package.json').version,
  };
  fs.writeFileSync(OUT, JSON.stringify(info, null, 2) + '\n');
  return info;
}

if (require.main === module) {
  const i = stamp();
  console.log(`盖戳 ${i.short}${i.dirty ? '+dirty' : ''} · ${i.branch} · v${i.version}`);
}

module.exports = { stamp, OUT };
