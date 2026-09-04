// Lists the largest packages inside a packed app.asar, so the build config can target real weight.
const { execSync } = require('child_process');
const path = require('path');

const asar = process.argv[2] || 'release/win-unpacked/resources/app.asar';
const out = execSync(`npx asar list "${asar}"`, { maxBuffer: 64 * 1024 * 1024 }).toString()
  .split('\n').map((s) => s.split(path.win32.sep).join('/'));

const counts = {};
for (const line of out) {
  const parts = line.split('/').filter(Boolean);
  if (parts[0] !== 'node_modules' || parts.length < 2) continue;
  const key = parts[1].startsWith('@') && parts[2] ? `${parts[1]}/${parts[2]}` : parts[1];
  counts[key] = (counts[key] || 0) + 1;
}
console.log('files per package inside the asar:');
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${k}: ${v}`);
console.log('total entries:', out.length);
