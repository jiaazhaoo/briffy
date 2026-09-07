'use strict';
// 「我记下来了详细地址，你找一下」——为什么找不到。
//
//   npx electron dev/ask-address-probe.js
//
// 一场真实的三问对话，原样跑一遍真实工作区：词面挑出什么、向量挑出什么、融合之后进模型的
// 是哪八条、那七条真的写着地址的记录排在第几，以及自动链从这八条还能不能够到它们。
//
// 量出来四条，按伤害排：
//   一、回声。工作区里有五条记录是 briffy 自己答案的剪贴板拷贝（问题原文 + 上一次的回答）。
//       同一个问题再问一遍，它们是词面上最完美的命中，于是模型读的是自己上次的话——
//       而那份话里从来没有门牌号，只有「Bishops Park → Runnymede」。
//   二、每一问都从零。ws:ask 只交给 ask.run 一个字符串；对话历史 chats.js 存着、界面上也画着，
//       但既不进检索也不进模型。第 2、3 问的主语在上一问里，检索看不见。
//   三、词撞了义。「地址」在这个工作区里最强的命中是「Ollama 地址」，一个 IP。
//       而真正的地址记录里一个「地址」字都没有，全是英文门牌号。
//   四、融合把对的那条挤掉了。第 2 问向量确实把「Windsor Road, Egham TW20 0AE」排在第 8，
//       但 RRF 里向量第 8 名是 1/(60+9)=0.0145，词面最差的第 16 名是 1/(20+16)=0.0278——
//       十六条词面命中全部压过它，八个格子一个没剩。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const HOME = os.homedir();
const WS = path.join(HOME, 'Library/Application Support/briffy/workspace');
const DIR = path.join(WS, 'entries');
const CACHE = path.join(HOME, 'Library/Application Support/briffy/models');
const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// 真的写着地址的那几条
const ADDR = [/^Windsor Road, Egham/i, /^Buckingham Court, Kingston/i, /^Parking space on Buckingham/i,
  /^Runnymede Pleasure Ground/i, /^Bishops Park, Fulham/i, /^Find parking/i, /^停 Staines/];

const QS = ['你看看我最近要去一个走路的活动你帮我做个行程单',
  '具体的开始和结束的地址是什么',
  '我记下来了详细地址，你找一下'];

async function main() {
  const index = require('../src/main/index-db');
  const retrieve = require('../src/main/retrieve');
  const vector = require('../src/main/vector');
  const links = require('../src/main/links');
  const story = require('../src/main/story');
  const bp = require('../src/main/boilerplate');

  const all = [];
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.json')) continue;
    let e; try { e = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (_) { continue; }
    for (const x of (Array.isArray(e) ? e : e.entries || [])) all.push(x);
  }
  const byId = new Map(all.map((e) => [e.id, e]));
  const name = (id) => one((byId.get(id) || {}).title).slice(0, 34) || '（无标题）';
  const addrIds = new Set(ADDR.map((re) => (all.filter((e) => re.test(one(e.title))).pop() || {}).id).filter(Boolean));
  console.log(`${all.length} 条记录，其中真的写着地址的 ${addrIds.size} 条`);
  // 回声：正文里同时有问题原文和「N 条记录 · 模型名」的，是 briffy 自己答案的拷贝
  const echo = all.filter((e) => /·\s*\d+\s*条记录\s*·/.test(String(e.text || '')));
  console.log(`其中 ${echo.length} 条是 briffy 自己答案的剪贴板拷贝：`);
  for (const e of echo) console.log(`   ${one(e.title).slice(0, 40)}`);
  console.log('');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-addr-'));
  index.open(tmp, WS); index.useVecModel(vector.MODEL);
  const loadDay = (k) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, `${k}.json`), 'utf8'), null); } catch (_) { return []; } };
  let r; do { r = index.sync({ dir: DIR, loadDay }, { budgetMs: 20000 }); } while (!r.done);
  let f; do { f = await vector.fill(index, loadDay, { budgetMs: 9000, batch: 20, cacheDir: CACHE }); if (f.error) break; } while (!f.done);
  console.log(f && f.error ? `向量：没有（${f.error}）` : '向量：齐了');

  const fur = bp.learn(all.map((e) => String(e.text || '')));
  const g = links.build(all);
  const ev = links.evidenceIndex(all, (e) => bp.strip(String(e.text || ''), fur));
  const ctx = { g, ev, ids: all.map((e) => e.id), near: (id) => { try { return vector.related(index, id, { limit: 4 }); } catch (_) { return []; } } };

  for (const q of QS) {
    console.log(`\n════════ 「${q}」 ════════`);
    const pick = retrieve.select(index, q, { today: '2026-09-07', limit: 40, getEntry: (id) => byId.get(id) });
    console.log(`词面切出来的词：${(pick.terms || []).join(' · ') || '（没有）'}`);
    const pos = (list) => [...addrIds].map((i) => [name(i), list.indexOf(i)]).filter(([, k]) => k >= 0);
    console.log(`词面命中 ${pick.ids.length} 条，地址条排在：${JSON.stringify(pos(pick.ids)) || '无'}`);
    const near = await vector.search(index, q, { limit: 40, cacheDir: CACHE, from: pick.range ? pick.range.from : '' }).catch(() => []);
    console.log(`向量命中 ${near.length} 条，地址条排在：${JSON.stringify(pos(near)) || '无'}`);
    const ids = pick.ids.length ? retrieve.fuse(pick.ids, near, 8) : pick.ids.slice(0, 8);
    console.log('→ 真正进模型的八条：');
    for (const id of ids) console.log(`   ${addrIds.has(id) ? '★' : ' '} ${name(id)}`);
    // 从这八条出发，自动链够不够得到地址
    const reach = new Map();
    for (const seed of ids) for (const m of story.grow(seed, ctx, { max: 24 }).members) {
      if ((reach.get(m.id) || 0) < m.score) reach.set(m.id, m.score);
    }
    const got = [...addrIds].filter((i) => reach.has(i) && !ids.includes(i));
    console.log(`   自动链从这八条能再够到 ${reach.size} 条，其中地址条 ${got.length} 条：${got.map(name).join(' / ') || '无'}`);
  }

  require('../src/main/embed').dispose();
  fs.rmSync(tmp, { recursive: true, force: true });
  app.quit();
}
app.whenReady().then(() => main().catch((e) => { console.error('炸了:', e && e.stack || e); app.quit(); }));
