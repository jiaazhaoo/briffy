'use strict';
// 剥掉网页家具，在真实工作区上剥掉了多少、剥对了没有。
//
//   node dev/boilerplate-bench.js
//
// 要盯两头。剥得不够，证据词里还是 rent / airports / payment；剥过头，把内容也铲了——
// 后者更危险，因为它不吭声。所以这里既报「剥掉多少」，也把那几条关键记录**剥完之后剩什么**
// 整段打出来，以及那几个桥词（egham / runnymede / thames / tw20）还在不在。
const fs = require('fs');
const path = require('path');
const os = require('os');
const bp = require('../src/main/boilerplate');

const DIR = path.join(os.homedir(), 'Library/Application Support/briffy/workspace/entries');
const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const all = [];
for (const f of fs.readdirSync(DIR)) {
  if (!f.endsWith('.json')) continue;
  let e; try { e = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (_) { continue; }
  for (const x of (Array.isArray(e) ? e : e.entries || [])) all.push(x);
}
const texts = all.map((e) => String(e.text || ''));
const chars = (a) => a.reduce((s, t) => s + t.length, 0);

console.log(`${all.length} 条记录，正文合计 ${chars(texts).toLocaleString()} 字\n`);
console.log('  一行出现在几条里算家具   学到几行   剥掉多少字   受影响的记录');
for (const across of [2, 3, 4, 6]) {
  const t0 = Date.now();
  const fur = bp.learn(texts, { across });
  const after = texts.map((t) => bp.strip(t, fur));
  const ms = Date.now() - t0;
  const hit = texts.filter((t, i) => after[i].length < t.length).length;
  const cut = chars(texts) - chars(after);
  console.log(`  ${String(across).padStart(4)}                    ${String(fur.size).padStart(6)}     ${String(cut).padStart(7)} (${Math.round(cut * 100 / chars(texts))}%)   ${hit} / ${all.length}   ${ms}ms`);
}

const fur = bp.learn(texts);
console.log(`\n════ 学到的家具行，出现次数最多的 ════`);
const df = new Map();
for (const t of texts) { const seen = new Set(); for (const l of t.split('\n')) { const k = bp.key(l); if (k && fur.has(k)) seen.add(k); } for (const k of seen) df.set(k, (df.get(k) || 0) + 1); }
for (const [k, n] of [...df].sort((a, b) => b[1] - a[1]).slice(0, 16)) console.log(`  ${String(n).padStart(3)} 条  ${k.slice(0, 60)}`);

console.log('\n════ 关键记录：剥完之后剩什么 ════');
for (const re of [/^Find parking/i, /^赛程分前后半程/, /^English \(Great Britain\)$/]) {
  const e = all.find((x) => re.test(one(x.title)));
  if (!e) continue;
  const raw = String(e.text || '');
  const cut = bp.strip(raw, fur);
  console.log(`\n  【${one(e.title).slice(0, 40)}】  ${raw.length} → ${cut.length} 字（去掉 ${Math.round((1 - cut.length / (raw.length || 1)) * 100)}%）`);
  console.log(cut.split('\n').slice(0, 12).map((l) => `     ${l.slice(0, 76)}`).join('\n') || '     （全被剥光了 ← 要是这样就是剥过头了）');
}

console.log('\n════ 桥词还在不在（剥过头的话它们会一起没）════');
const WORDS = ['egham', 'runnymede', 'thames', 'tw20', 'tw18', 'staines', '泰晤士河', 'ultra', 'challenge', '赛程'];
const before = new Map(WORDS.map((w) => [w, 0]));
const after = new Map(WORDS.map((w) => [w, 0]));
for (const e of all) {
  const raw = `${e.title || ''}\n${e.text || ''}\n${(e.context || {}).window || ''}`.toLowerCase();
  const cut = `${e.title || ''}\n${bp.strip(String(e.text || ''), fur)}\n${(e.context || {}).window || ''}`.toLowerCase();
  for (const w of WORDS) { if (raw.includes(w)) before.set(w, before.get(w) + 1); if (cut.includes(w)) after.set(w, after.get(w) + 1); }
}
console.log('  桥词         剥之前  剥之后');
for (const w of WORDS) {
  const b = before.get(w); const a = after.get(w);
  console.log(`  ${w.padEnd(12)}${String(b).padStart(5)}${String(a).padStart(8)}   ${a < b ? `← 少了 ${b - a} 条` : ''}`);
}
