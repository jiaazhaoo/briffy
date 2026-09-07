'use strict';
// 自动双链在真实工作区上到底连出了什么。
//
//   node dev/links-bench.js
//
// 单元测试盯的是规则，这里盯的是**产出**：覆盖多少条记录、最大的节点有多大（一个外壳漏网
// 就会长出一个吃掉半个工作区的巨节点）、以及那个具体的 case——「Windsor Road, Egham TW20 0AE」
// 现在到底能不能说出它是从哪儿来的。向量那条路在这条记录上是 0.155，怎么调阈值都救不回来。
const fs = require('fs');
const path = require('path');
const os = require('os');
const links = require('../src/main/links');

const DIR = path.join(os.homedir(), 'Library/Application Support/briffy/workspace/entries');
const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const all = [];
for (const f of fs.readdirSync(DIR)) {
  if (!f.endsWith('.json')) continue;
  let e; try { e = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (_) { continue; }
  for (const x of (Array.isArray(e) ? e : e.entries || [])) all.push(x);
}
const byId = new Map(all.map((e) => [e.id, e]));
const getEntry = (id) => byId.get(id) || null;
const name = (id) => one((getEntry(id) || {}).title).slice(0, 40) || '（无标题）';

const t0 = Date.now();
const g = links.build(all);
const ms = Date.now() - t0;

const linked = new Set();
for (const p of g.pages.values()) { if (p.page) linked.add(p.page); for (const id of p.clips) linked.add(id); }
const sizes = [...g.pages.values()].map((p) => p.clips.length).sort((a, b) => b - a);

console.log(`${all.length} 条记录，${ms}ms\n`);
console.log(`同一处：${g.pages.size} 个页面节点，盖住 ${linked.size} 条记录（${Math.round(linked.size * 100 / all.length)}%）`);
console.log(`        最大的页面 ${sizes[0] || 0} 条，中位 ${sizes[Math.floor(sizes.length / 2)] || 0} 条`);
console.log(`        其中 ${[...g.pages.values()].filter((p) => p.page).length} 个页面你也把它本身存下来了（书签就是那个节点）`);
console.log(`同一程：${g.runs.length} 段，最长 ${Math.max(...g.runs.map((r) => r.length))} 条，中位 ${g.runs.map((r) => r.length).sort((a, b) => a - b)[Math.floor(g.runs.length / 2)]} 条`);

console.log('\n════ 最大的几个页面（外壳漏网的话会在这里现形）════');
for (const p of [...g.pages.values()].sort((a, b) => b.clips.length - a.clips.length).slice(0, 8)) {
  console.log(`  ${String(p.clips.length).padStart(3)} 条  ${p.page ? '（已存）' : '　　　　'}  ${one(p.name).slice(0, 56)}`);
}

console.log('\n════ 那个 case：向量连不上的那几条，现在说得出来处了吗 ════');
const WANT = [/^Windsor Road, Egham/i, /^停 Staines/, /^£10 接驳车/, /^Bishops Park/i,
  /^Runnymede Pleasure/i, /^Buckingham Court, Kingston/i, /^Parking space on Buckingham/i];
let got = 0;
for (const re of WANT) {
  const e = all.find((x) => re.test(one(x.title)));
  if (!e) { console.log(`  （这台机器上没有 ${re}）`); continue; }
  const l = links.linksOf(e.id, g);
  if (l.source) got++;
  console.log(`  ${one(e.title).slice(0, 30).padEnd(32)} ${l.source ? `摘自「${one(l.source.name).slice(0, 40)}」${l.source.page ? '  ← 那一页你也存了' : ''}` : '—— 还是没有来处'}`);
}
console.log(`  ${got} / ${WANT.length} 条现在有来处了（向量那条路是 0 / ${WANT.length}，而且降门槛也到不了）`);

console.log('\n════ 反过来：打开那一页，看得见从它上面摘了什么 ════');
for (const p of [...g.pages.values()].filter((x) => x.page && x.clips.length >= 2).slice(0, 4)) {
  console.log(`\n  【${one(p.name).slice(0, 46)}】`);
  for (const id of p.clips.slice(0, 6)) console.log(`     ${name(id)}`);
}

console.log('\n════ 同一程：那一晚是怎么串起来的 ════');
const anchor = all.find((x) => /^Windsor Road, Egham/i.test(one(x.title)));
if (anchor) {
  const run = g.runs.find((r) => r.includes(anchor.id)) || [];
  const chain = links.chainOf(run, g, getEntry);
  console.log(`  这一段共 ${run.length} 条记录，经过 ${chain.length} 页：`);
  for (const c of chain) console.log(`     ${String(c.at).slice(11, 16)}  ${one(c.name).slice(0, 52)}`);
}
