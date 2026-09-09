'use strict';
// 给 dmg 这个壳签名、公证、把票 staple 上去。
//
//   npm run notarize:dmg                     # release/ 里那个 dmg
//   npm run notarize:dmg -- path/to.dmg
//
// **electron-builder 不做这一步。** 它的顺序是 签 app → 公证 app → staple 到 app → 然后打 dmg，
// 所以票落在 app 上，壳上一无所有。而用户下载的是壳：Gatekeeper 拿它去查，
// 找不到签名就判 `rejected — no usable signature`，双击挂载那一下会被拦一次。
//
// 三件在这里被钉住的事，每一件都踩过：
//
// ① **顺序不能反。** 签名会改变文件的字节，而没签名的 dmg 拿到的票是按文件哈希发的——
//    先 staple 再签，票当场失效（实测：hash 一变，stapler validate 就说没有票）。
//    所以只有 签 → 公证 → staple 这一个顺序是对的。
// ② **证书不能按 CSC_NAME 指。** 这台机器上「jia zhao (TEAMID)」同时匹配
//    `Developer ID Application` 和 `Apple Distribution` 两张，codesign 是子串匹配、会报歧义拒签。
//    electron-builder 能按目标类型自己挑，codesign 不会。所以这里从钥匙串里
//    **只认 Developer ID Application 那一张**，并用它的哈希去签——名字不进仓库，也不会歧义。
// ③ **票 staple 不到 zip 上。** zip 分发靠里面那个 app 自己带票，那是正确做法，不用也不能补。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NEED_ENV = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'];

function run(file, args, opts = {}) {
  const r = spawnSync(file, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: opts.inherit ? 'inherit' : 'pipe' });
  return { code: r.status === null ? -1 : r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}
function die(msg) { console.error(`\n✗ ${msg}`); process.exit(1); }

// ---------- 要签的那个文件 ----------
let dmg = process.argv[2];
if (!dmg) {
  const dir = path.join(ROOT, 'release');
  const found = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.dmg')) : [];
  if (found.length !== 1) die(found.length ? `release/ 里有 ${found.length} 个 dmg，指明是哪一个：\n  ${found.join('\n  ')}` : 'release/ 里没有 dmg，先跑 npm run release:mac');
  dmg = path.join(dir, found[0]);
}
if (!fs.existsSync(dmg)) die(`找不到 ${dmg}`);

// ---------- 凭据 ----------
const missing = NEED_ENV.filter((k) => !process.env[k]);
if (missing.length) die(`缺环境变量：${missing.join(', ')} —— 见 docs/RELEASE.md`);

// ---------- 证书：只认 Developer ID Application 那一张，用哈希 ----------
const ids = run('security', ['find-identity', '-v', '-p', 'codesigning']).out
  .split('\n')
  .map((l) => /^\s*\d+\)\s+([0-9A-F]{40})\s+"(.+)"\s*$/.exec(l))
  .filter(Boolean)
  .map((m) => ({ hash: m[1], name: m[2] }))
  .filter((c) => c.name.startsWith('Developer ID Application:'));
if (!ids.length) die('钥匙串里没有 Developer ID Application 证书');
if (ids.length > 1) die(`钥匙串里有 ${ids.length} 张 Developer ID Application 证书，不知道该用哪一张：\n  ${ids.map((c) => c.name).join('\n  ')}`);
const cert = ids[0];

console.log(`${path.relative(ROOT, dmg)}  ${(fs.statSync(dmg).size / 1048576).toFixed(0)} MB`);
console.log(`证书  ${cert.name}\n`);

// ---------- 1 · 签 ----------
process.stdout.write('1/3  签名… ');
const sign = run('codesign', ['--sign', cert.hash, '--timestamp', '--force', dmg]);
if (sign.code !== 0) die(`codesign 失败：\n${sign.out.trim()}`);
console.log('好');

// ---------- 2 · 公证 ----------
// --wait 会一直挂着直到 Apple 给出结论，通常几分钟。输出直接透传，好让人看见进度。
console.log('2/3  提交公证（等 Apple，通常 2–15 分钟）…');
const sub = run('xcrun', ['notarytool', 'submit', dmg,
  '--apple-id', process.env.APPLE_ID,
  '--password', process.env.APPLE_APP_SPECIFIC_PASSWORD,
  '--team-id', process.env.APPLE_TEAM_ID,
  '--wait'], { inherit: true });
if (sub.code !== 0) die('公证失败。上面那段里有 id，用 `xcrun notarytool log <id> --apple-id … --team-id …` 看具体原因');

// ---------- 3 · staple ----------
process.stdout.write('3/3  staple… ');
const staple = run('xcrun', ['stapler', 'staple', dmg]);
if (staple.code !== 0) die(`stapler 失败：\n${staple.out.trim()}`);
console.log('好\n');

// ---------- 复验：就用 Gatekeeper 自己那套 ----------
const checks = [
  ['签名', run('codesign', ['--verify', '--strict', dmg]).code === 0],
  ['票', run('xcrun', ['stapler', 'validate', dmg]).code === 0],
];
const g = run('spctl', ['-a', '-vvv', '-t', 'open', '--context', 'context:primary-signature', dmg]);
checks.push([`Gatekeeper${/accepted/.test(g.out) ? `（${(g.out.match(/source=(.+)/) || [])[1] || ''}）` : ''}`, g.code === 0 && /accepted/.test(g.out)]);

let bad = 0;
for (const [label, pass] of checks) { console.log(`  ${pass ? '✓' : '✗'} ${label}`); if (!pass) bad++; }
if (bad) die(`${bad} 项没过`);
console.log('\n✓ 这个 dmg 现在在没见过它的机器上也能直接打开');
console.log(`  别忘了换掉已经发出去的那个：gh release upload <tag> ${path.relative(ROOT, dmg)} --clobber`);
