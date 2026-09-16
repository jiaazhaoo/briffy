'use strict';
// npm run doctor —— 这台开发机上的 briffy 到底是个什么状况。
//
// 2026-09-17 加的。这一天里踩的每一个坑，这个脚本都能一眼看出来：
//   · 机器上同时躺着两个 briffy.app，跑的是这个、给权限的是那个
//   · 其中一个是 ad-hoc 签名，在 TCC 眼里是**另一个 app**，权限一个都不继承
//   · 四个包版本号全是 1.0.1，没有任何办法分辨
//   · 源码里修好了，但在跑的那个包是修复之前打的
//
// 纯 node，不需要 electron，所以随时能跑。
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const sh = (cmd, fallback = '') => {
  try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (_) { return fallback; }
};
const git = (args, fallback = '') => sh(`git -C "${ROOT}" ${args}`, fallback);

/** 从 app.asar 里把构建戳捞出来。不解析 asar 格式——直接找那段 JSON，形状是固定的。 */
function stampOf(appPath) {
  const asar = path.join(appPath, 'Contents', 'Resources', 'app.asar');
  if (!fs.existsSync(asar)) return null;
  const buf = fs.readFileSync(asar);
  const m = buf.toString('latin1').match(/\{\s*"commit":\s*"[0-9a-f]{7,40}"[\s\S]{0,300}?\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (_) { return null; }
}

function signOf(appPath) {
  const out = sh(`codesign -dv --verbose=2 "${appPath}" 2>&1`, '');
  const id = (out.match(/^Identifier=(.+)$/m) || [])[1] || '?';
  const adhoc = /Signature=adhoc/.test(out);
  const auth = (out.match(/^Authority=(.+)$/m) || [])[1] || (adhoc ? 'ad-hoc（无证书）' : '未签名');
  return { id, adhoc, auth };
}

function findApps() {
  const dirs = ['/Applications', path.join(os.homedir(), 'Applications'), path.join(ROOT, 'release', 'mac-arm64')];
  const found = [];
  for (const d of dirs) {
    const p = path.join(d, 'briffy.app');
    if (fs.existsSync(p)) found.push(p);
  }
  return found;
}

function running() {
  const pids = sh('pgrep -f "briffy.app/Contents/MacOS/briffy"', '').split('\n').filter(Boolean);
  const paths = new Set();
  for (const pid of pids) {
    const c = sh(`ps -p ${pid} -o comm=`, '');
    const m = c.match(/^(.*\/briffy\.app)\//);
    if (m) paths.add(m[1]);
  }
  return [...paths];
}

const ok = (s) => `  ✓ ${s}`;
const bad = (s) => `  ✗ ${s}`;
const warn = (s) => `  ! ${s}`;

function main() {
  const problems = [];
  const apps = findApps();
  const live = running();
  const head = git('rev-parse HEAD', '');
  const headShort = git('rev-parse --short HEAD', '?');
  const dirty = git('status --porcelain') !== '';

  console.log(`\n源码  ${headShort}${dirty ? ' +未提交改动' : ''} · ${git('rev-parse --abbrev-ref HEAD', '?')}\n`);

  if (!apps.length) { console.log(bad('这台机器上没有装 briffy.app —— npm run dev:install')); process.exit(1); }

  console.log(`装着的 briffy（${apps.length} 个）`);
  for (const a of apps) {
    const st = stampOf(a);
    const sg = signOf(a);
    const isLive = live.includes(a);
    const where = a.startsWith(ROOT) ? 'release/（构建产物）' : a;
    console.log(`\n  ${isLive ? '▶ 在跑' : '  '} ${where}`);
    if (st) {
      const behind = head && st.commit !== head ? git(`rev-list --count ${st.commit}..HEAD`, '') : '0';
      console.log(`      构建 ${st.short}${st.dirty ? '+dirty' : ''} · ${new Date(st.builtAt).toLocaleString()} · v${st.version}`);
      if (st.commit === head) console.log(ok('    和当前源码一致'));
      else if (behind && behind !== '') {
        console.log(warn(`    比源码旧 ${behind} 个提交 —— 你刚改的东西不在这个包里`));
        if (isLive) problems.push(`在跑的那个包比源码旧 ${behind} 个提交：npm run dev:install`);
      }
      if (st.dirty) console.log(warn('    打包时工作区有未提交改动 —— 它的 commit 号对不上里面的代码'));
    } else {
      console.log(`      构建 未知（没有戳，是 2026-09-17 之前打的包）`);
      if (isLive) problems.push('在跑的那个包没有构建戳，说不出自己是哪个版本：npm run dev:install');
    }
    console.log(`      签名 ${sg.id} · ${sg.auth}`);
    if (sg.adhoc) {
      console.log(bad('    ad-hoc 签名 —— 在系统眼里这是另一个 app，屏幕录制/麦克风权限一个都不继承'));
      problems.push('有 ad-hoc 签名的包，它的权限永远要单独再给一次：删掉它，用 npm run dev:install');
    }
  }

  console.log('');
  if (apps.length > 1) {
    console.log(warn(`机器上有 ${apps.length} 个 briffy.app —— 你以为在测的那个，未必是在跑的那个`));
    problems.push('机器上不止一个 briffy.app：npm run dev:install 会只留一个');
  }
  if (!live.length) console.log('  briffy 没在跑');
  else if (live.length > 1) { console.log(bad(`同时跑着 ${live.length} 个 briffy`)); problems.push('同时跑着多个 briffy：先全退掉'); }

  console.log('');
  if (!problems.length) { console.log('干净。\n'); return; }
  console.log('要处理的：');
  [...new Set(problems)].forEach((p) => console.log(`  · ${p}`));
  console.log('');
  process.exitCode = 1;
}

if (require.main === module) main();
