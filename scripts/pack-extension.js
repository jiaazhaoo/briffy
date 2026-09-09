'use strict';
// 把 extension/ 打成一个能直接上传到 Chrome 应用商店的 zip，上传前先把商店会拒的东西全查一遍。
//
//   node scripts/pack-extension.js        →  release/briffy-extension-<版本>.zip
//
// 为什么要有这个脚本，而不是右键压缩：
//   ① **manifest.json 必须在 zip 的根上。** 在 Finder 里压 extension/ 这个文件夹，得到的是
//      extension/manifest.json，商店会告诉你「清单文件缺失或不可读」，而错在压缩的方式。
//   ② macOS 会往每个文件夹里塞 .DS_Store，往 zip 里塞 __MACOSX/ 和资源分支。审核看得见。
//   ③ 商店对几个字段有**长度上限**，超了在上传那一步才报错——但那时候版本号已经用掉了。
//
// 这个脚本不改 extension/ 里的任何东西，只读、只查、只压。
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'extension');
const OUT = path.join(ROOT, 'release');

// Chrome 应用商店的硬上限。清单里的 name / description 超了会在上传时被拒。
const MAX_NAME = 75;
const MAX_DESC = 132;

// 绝不能进 zip 的东西。审核会解开来看，一个 .DS_Store 不会被拒，但它说明包是手压的。
const JUNK = /(^|\/)(\.DS_Store|Thumbs\.db|\.git.*|.*\.map|.*\.zip)$/;

let problems = 0;
const bad = (m) => { problems++; console.log(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);

// ---------- 读清单 ----------
const manifestPath = path.join(SRC, 'manifest.json');
if (!fs.existsSync(manifestPath)) { console.error('extension/manifest.json 不存在'); process.exit(1); }
let m;
try { m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
catch (e) { console.error('manifest.json 不是合法 JSON:', e.message); process.exit(1); }

console.log(`briffy extension ${m.version}\n\n检查`);

// ---------- 商店会拒的 ----------
if (m.manifest_version === 3) ok('Manifest V3');
else bad(`manifest_version 是 ${m.manifest_version}，商店 2024 年起只收 V3`);

// 版本号：1–4 段十进制，每段 0–65535，且不能以 0 开头（"01" 会被拒）
if (/^\d{1,5}(\.\d{1,5}){0,3}$/.test(m.version || '')
  && m.version.split('.').every((p) => +p <= 65535 && !/^0\d/.test(p))) ok(`版本号 ${m.version}`);
else bad(`版本号 "${m.version}" 不合商店的格式（1–4 段，每段 0–65535，不能有前导零）`);

const nameLen = [...(m.name || '')].length;
if (m.name && nameLen <= MAX_NAME) ok(`name ${nameLen}/${MAX_NAME} 字`);
else bad(`name ${nameLen} 字，上限 ${MAX_NAME}`);

const descLen = [...(m.description || '')].length;
if (m.description && descLen <= MAX_DESC) ok(`description ${descLen}/${MAX_DESC} 字`);
else if (!m.description) bad('没有 description —— 商店必填');
else bad(`description ${descLen} 字，上限 ${MAX_DESC}（超了在上传那一步才报错）`);

// 128 是商店列表页用的那一张，缺了直接拒
for (const size of ['16', '32', '48', '128']) {
  const rel = (m.icons || {})[size];
  if (!rel) { bad(`icons.${size} 没写`); continue; }
  if (fs.existsSync(path.join(SRC, rel))) ok(`icons.${size} → ${rel}`);
  else bad(`icons.${size} 指向 ${rel}，文件不存在`);
}

// 上传自己的包时带 "key" 会和商店分配的 ID 打架；本地固定 ID 用的字段不该发出去
if (m.key) bad('清单里有 "key" —— 那是本地固定扩展 ID 用的，上传前必须删掉');
else ok('没有 "key" 字段');

// 用了 __MSG_ 就必须有 default_locale，否则商店报 "Default locale must be specified"
const usesMsg = JSON.stringify(m).includes('__MSG_');
if (usesMsg && !m.default_locale) bad('用了 __MSG_ 但没有 default_locale');
else if (usesMsg) ok(`default_locale ${m.default_locale}`);

// 清单里引用到的每个文件都得真的在
const referenced = new Set();
for (const cs of m.content_scripts || []) for (const f of cs.js || []) referenced.add(f);
if (m.background && m.background.service_worker) referenced.add(m.background.service_worker);
if (m.action && m.action.default_popup) referenced.add(m.action.default_popup);
const missing = [...referenced].filter((f) => !fs.existsSync(path.join(SRC, f)));
if (!missing.length) ok(`清单引用的 ${referenced.size} 个文件都在`);
else for (const f of missing) bad(`清单引用了 ${f}，文件不存在`);

// 远程代码是最常见的拒审理由。V3 不允许从网上取脚本执行。
for (const f of fs.readdirSync(SRC)) {
  if (!f.endsWith('.js')) continue;
  const src = fs.readFileSync(path.join(SRC, f), 'utf8');
  // 找的是「把远程内容当代码跑」，不是「往远程发东西」——后者这个扩展本来就要做（本机 127.0.0.1）
  if (/\beval\s*\(|new\s+Function\s*\(|import\s*\(\s*['"`]https?:/.test(src)) bad(`${f} 里有 eval / new Function / 远程 import —— V3 不允许远程代码`);
}
ok('没有远程代码（eval / new Function / 远程 import）');

// ---------- 要收进包里的文件 ----------
const files = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const rel = path.relative(SRC, full);
    if (fs.statSync(full).isDirectory()) { walk(full); continue; }
    if (JUNK.test(rel)) { console.log(`  · 跳过 ${rel}`); continue; }
    files.push(rel);
  }
}(SRC));

// ---------- 压 ----------
fs.mkdirSync(OUT, { recursive: true });
const zip = path.join(OUT, `briffy-extension-${m.version}.zip`);
fs.rmSync(zip, { force: true });

if (problems) {
  console.log(`\n✗ ${problems} 处要先改，没有打包`);
  process.exit(1);
}

// -X 不写 macOS 的额外属性和资源分支；从 SRC 里面执行，所以 manifest.json 落在 zip 的根上
execFileSync('zip', ['-q', '-X', '-9', zip, ...files], { cwd: SRC });

const kb = fs.statSync(zip).size / 1024;
console.log(`\n打包  ${files.length} 个文件  ${kb.toFixed(0)} KB`);
console.log(`      ${path.relative(ROOT, zip)}`);
// 商店的上限是 2 GB，这个扩展离得远，但一个突然变大的包通常意味着有不该进去的东西
if (kb > 5 * 1024) console.log('      ⚠️ 比预期大不少，检查一下有没有混进不该打包的东西');
console.log('\n提交材料见 docs/chrome-web-store.md');
