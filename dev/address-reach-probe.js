'use strict';
// 「素材库里明明有，为什么挖不出来」——把这一条记录单独拎出来看。
//
//   npx electron dev/address-reach-probe.js
//
// 盯住「Windsor Road, Egham TW20 0AE」这一条 28 个字符的剪贴板碎片。
// 它确实在索引里，而且语境也在：index-db.bodyOf 把 context.app / context.window 一起写进了 fts，
// 所以词面这一侧连「它是从一张 Google 地图路线页上抄的」都知道。所以问题不是「有没有进索引」，
// 是**拿什么词才够得着它**。量出来三件事：
//
//   一、它全部的词汇是五个：Windsor · Road · Egham · TW20 · 0AE。搜这五个里任何一个都是第 1 名，
//       搜「地址」一条也搜不到。**只有已经知道答案的人才搜得到它。**
//   二、能跨过这道坎的只有向量，而它只在你问得短的时候跨得过去：
//       「地址」第 3 名、「详细地址」第 3 名、「具体的开始和结束的地址是什么」第 9 名、
//       「我记下来了详细地址，你找一下」第 59 名。多出来的那些字是你的语气，对向量是稀释剂。
//   三、第 3 名也不安全。排在它前后的是「5381491216421114」「ipaslogo.com」和一行破折号——
//       噪声和答案在同一个距离带里，0.4 上下这个数没有绝对意义。
//
// 试过的、**不成立**的修法：把 context.window 也喂给向量（现在 chunk.textOf 只有 title。body，
// 完全不碰 context）。六个问法全线变差 −0.058 ~ −0.161，因为稀释是对称的：往查询里加字伤检索，
// 往文档里加字一样伤。向量对「多余的字」两头都没有免疫力。
//
// 成立的那个方向：别拿整句话去问向量，只拿实词去问。
//   「我记下来了详细地址，你找一下」前 40 名里一条地址记录都没有；换成「详细地址」→ 第 3、第 7。
//   「具体的开始和结束的地址是什么」第 9；换成「开始 结束 地址」→ 第 4、第 19、第 33。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const HOME = os.homedir();
const WS = path.join(HOME, 'Library/Application Support/briffy/workspace');
const DIR = path.join(WS, 'entries');
const CACHE = path.join(HOME, 'Library/Application Support/briffy/models');
const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const TARGET = /^Windsor Road, Egham/i;
const PROBES = ['地址', '详细地址', '具体的开始和结束的地址是什么', '我记下来了详细地址，你找一下',
  'Egham', 'TW20', '停车', 'parking', 'Windsor Road', '终点在哪', '走路活动的终点地址'];

async function main() {
  const index = require('../src/main/index-db');
  const vector = require('../src/main/vector');
  const { segment } = require('../src/main/segment');
  const embed = require('../src/main/embed');

  const all = [];
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.json')) continue;
    let e; try { e = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (_) { continue; }
    for (const x of (Array.isArray(e) ? e : e.entries || [])) all.push(x);
  }
  const byId = new Map(all.map((e) => [e.id, e]));
  const name = (id) => one((byId.get(id) || {}).title).slice(0, 34) || '（无标题）';
  const target = all.filter((e) => TARGET.test(one(e.title))).pop();
  console.log(`盯住：「${one(target.title)}」  ${target.id}`);
  console.log(`它全文就这些：${JSON.stringify(one(target.text))}`);
  console.log(`切出来的词：${segment(`${target.title} ${target.text}`, '').filter((t) => t.wordLike).map((t) => t.w).join(' · ')}\n`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-reach-'));
  index.open(tmp, WS); index.useVecModel(vector.MODEL);
  const loadDay = (k) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, `${k}.json`), 'utf8')); } catch (_) { return []; } };
  let r; do { r = index.sync({ dir: DIR, loadDay }, { budgetMs: 20000 }); } while (!r.done);
  let f; do { f = await vector.fill(index, loadDay, { budgetMs: 9000, batch: 20, cacheDir: CACHE }); if (f.error) break; } while (!f.done);
  console.log(f && f.error ? `向量：没有（${f.error}）\n` : '向量：齐了\n');

  console.log('   查询                              词面第几名   向量第几名   向量余弦');
  const tv = await embed.embed([`${target.title}\n${target.text}`], { cacheDir: CACHE }).catch(() => null);
  for (const q of PROBES) {
    const lex = index.search({ query: q, limit: 200 });
    const li = lex.ids.indexOf(target.id);
    const vec = await vector.search(index, q, { limit: 200, cacheDir: CACHE }).catch(() => []);
    const vi = vec.indexOf(target.id);
    let cos = '';
    if (tv) {
      const qv = await embed.embed([q], { cacheDir: CACHE }).catch(() => null);
      if (qv) { let s = 0; for (let i = 0; i < qv[0].length; i++) s += qv[0][i] * tv[0][i]; cos = s.toFixed(3); }
    }
    const cell = (i, n) => (i < 0 ? `没找到(${n})` : `第 ${i + 1} 名`);
    console.log(`   ${q.padEnd(32)} ${cell(li, lex.ids.length).padEnd(13)}${cell(vi, vec.length).padEnd(13)}${cos}`);
  }

  // 那八条赢家，向量上离问题多近
  console.log('\n════ 第 2 问「具体的开始和结束的地址是什么」向量前十 ════');
  const vec = await vector.search(index, '具体的开始和结束的地址是什么', { limit: 10, cacheDir: CACHE });
  vec.forEach((id, i) => console.log(`   ${String(i + 1).padStart(2)}  ${id === target.id ? '★' : ' '} ${name(id)}`));

  embed.dispose();
  fs.rmSync(tmp, { recursive: true, force: true });
  app.quit();
}
app.whenReady().then(() => main().catch((e) => { console.error('炸了:', e && e.stack || e); app.quit(); }));
