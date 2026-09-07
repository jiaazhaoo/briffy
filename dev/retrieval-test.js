'use strict';
// 答案有没有进到给模型的那份材料里。
//
//   node dev/retrieval-test.js            手造语料，规模和真实工作区一个量级
//   node dev/retrieval-test.js --live     拿本机真实工作区再跑一遍同样的问题
//
// 这个文件补的是一个空洞：以前所有检索测试断言的都是 `search(...).ids`，也就是「挑对了没有」。
// 但真实那次失败里，**id 对了也没用**——正确的记录被取回来了，而给模型看的是它的前 200 个字符，
// 也就是网页的语言选择和 Cookie 提示，日期在第 329 字。检索报告成功，答案却从没进过 prompt。
//
// 所以这里断言的是最终那根字符串：llm 拼给模型的那份编号清单里，有没有那句话。
// 中间层怎么改都行，这条不许坏。
//
// 语料是手造的，但形状是照着真实工作区量出来的：网页存下来前面三百多字全是导航壳；
// 一句话里大半是问话本身的词；一个问题问完，回答会被复制回工作区，成为它自己的完美匹配。
// 规模也照着来——两百多条，于是每条摊到的字数就是真实的那个 200，而不是宽松的 900。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const index = require('../src/main/index-db');
const retrieve = require('../src/main/retrieve');
const llm = require('../src/main/llm');

const LIVE = process.argv.includes('--live');
const OLLAMA_BUDGET = 8000;    // 本地模型那一档，最紧的一档；宽的档掩盖不了问题
const LIMIT = 40;              // ask.js 的 MAX_ITEMS
const KEEP = 8;                // ask.js 的 KEEP

let pass = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { console.log(`  FAIL ${name} — ${e.message}`); process.exitCode = 1; }
};

// ---------- 语料 ----------

// 存下来的网页长这样：正文之前先有三百多字的壳。这不是夸张，是量出来的。
const CHROME = 'English (Great Britain) Select category Complete form Checkout '
  + 'You may lose your registration spot if your browser session is idle for more than 15 minutes. '
  + 'See our Privacy Statement for information on how we process your personal data. '
  + 'Account Information Hello Change account Registration ';
const MEAT = 'Sat・12 Sep 2026 Ultra March 1st Half Challenge (~50km) Walking Only - Self Funding Adult £ 139.00 ';
const TAIL = 'Waivers & Agreements Please read the following waivers and agreements carefully. '
  + 'They include releases of liability and a waiver of legal rights. '.repeat(4);

const FILLER = [
  ['扩展弹窗的样式', 'popup 改成一行页脚，图标换成回形针'],
  ['长截图拼接的接缝', '按请求的步长锚定，不要用上一次的测量值'],
  ['麦克风白名单', '输入法不该算，按路径排除整个 app bundle'],
  ['每日摘要', '先给计数再让模型写，数数这件事它做不好'],
  ['索引落盘', 'node:sqlite 带 FTS5，Electron 里验过'],
  ['生成三个词', '本地抽词，不走模型，换服务不影响'],
  ['行程表的排版', '一行一件事，不要框'],
  ['看看这个配色', '暖灰底纸配白便签'],
  ['录音的分段', '静音超过两秒就切一段'],
  ['OCR 的框', '每行字在图上的位置，开详情才读'],
];

function buildCorpus(dir) {
  const days = {};
  const push = (day, e) => { (days[day] = days[day] || []).push({ ...e, dateKey: day, createdAt: `${day}T${e.hh || '12:00'}:00.000Z` }); };

  // 那一周的背景噪音，两百条。有些单独含着 生成 / 行程 / 看看 / 记录，
  // 好让「稀有词共现」这一级真的被为难，而不是在一个干净的房间里通过。
  for (let i = 0; i < 200; i++) {
    const [title, text] = FILLER[i % FILLER.length];
    const day = `2026-09-0${(i % 6) + 1}`;
    push(day, { id: `f${i}`, type: 'note', title: `${title} ${i}`, text: `${text} 第 ${i} 条`, hh: `0${(i % 9) + 1}:0${i % 10}` });
  }

  // 报名当天的那几条，按真实的顺序和形状
  push('2026-09-06', { id: 'landing', type: 'url', hh: '20:50', title: 'Ultra Challenge',
    text: 'UK’s #1 Trek & Trail Run Challenges for ALL Experience Levels. Walk, Jog or Run - 18 Great Events. '
      + 'FULL CHALLENGE ~100km 3/4 CHALLENGE ~75km 1/2 CHALLENGE ~50km 1/4 CHALLENGE ~25km 10km CHALLENGE. '.repeat(30) });
  push('2026-09-06', { id: 'regpage', type: 'note', hh: '20:50', title: 'English (Great Britain)', text: CHROME + MEAT + TAIL });
  push('2026-09-06', { id: 'regnote', type: 'note', hh: '20:38', title: 'Sat・12 Sep 2026',
    text: MEAT + '上半程挑战（约50公里）自费成人 无需筹款 4% 平台费 ' + TAIL });
  push('2026-09-06', { id: 'thanks', type: 'note', hh: '20:56', title: 'Thank you! Your registration is complete.',
    text: 'Thank you! Your registration is complete. Order summary Order Number C-5R4ZBFQG Sold by Ultra Challenge Ltd '
      + 'Payment method Credit card Amount paid £139.00 Thank you for registering for the Thames Path Ultra Challenge 2026!' });

  // 只占着「看看」「生成」这种问话的词的记录。它们在这个工作区里也很稀有，所以光看稀有度
  // 分不出来——真实工作区里 16 条材料有 8 条是这么挤进来的，全是 briffy 自己的开发笔记。
  push('2026-09-06', { id: 'noise1', type: 'note', hh: '23:42', title: '还剩第 4 步：词表扩展', text: '模型离线跑一遍生成同义表，之后卸掉' });
  push('2026-09-06', { id: 'noise2', type: 'note', hh: '23:39', title: 'app 占用 1.8g', text: '你看看怎么优化成 500-1000' });
  push('2026-09-05', { id: 'noise3', type: 'note', hh: '05:24', title: '得有时间戳的概念', text: '你看看蛛丝马迹能不能抄一下别人的设计' });

  // 问完把回答复制回工作区：这条记录含着问题的每一个词，是它自己的完美匹配。
  push('2026-09-07', { id: 'self', type: 'note', hh: '00:47', title: '我最近有个 walking 挑战，你帮我看看记录帮我生成行程单',
    text: '我最近有个 walking 挑战，你帮我看看记录帮我生成行程单 这段时间的全部记录 40 条记录 '
      + '根据记录，您已完成 Ultra Challenge 的报名。该赛事提供多种距离选择，包括 10km、25km、50km 和 100km。' });

  for (const [k, list] of Object.entries(days)) fs.writeFileSync(path.join(dir, `${k}.json`), JSON.stringify(list));
  return Object.values(days).reduce((n, l) => n + l.length, 0);
}

// ---------- 跑一次真实的挑选，拿到模型真正会读到的那份字符串 ----------

function promptFor(question, all, today) {
  const pick = retrieve.select(index, question, { today, limit: LIMIT, keep: KEEP, getEntry: (id) => all.get(id) || null });
  const entries = pick.ids.map((id) => all.get(id)).filter(Boolean);
  const text = entries.length ? llm._buildNumbered(entries, OLLAMA_BUDGET, pick.terms) : '';
  return { ...pick, entries, text };
}

function loadAll(dir) {
  const all = new Map();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    let e; try { e = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { continue; }
    for (const x of (Array.isArray(e) ? e : e.entries || [])) all.set(x.id, x);
  }
  return all;
}

// ---------- 手造语料上的断言 ----------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-ret-'));
const WS = path.join(TMP, 'ws');
fs.mkdirSync(WS, { recursive: true });
const n = buildCorpus(WS);
index.open(TMP, WS);
const src = { dir: WS, loadDay: (k) => JSON.parse(fs.readFileSync(path.join(WS, `${k}.json`), 'utf8')) };
let r; do { r = index.sync(src, { budgetMs: 20000 }); } while (!r.done);
const ALL = loadAll(WS);
const TODAY = '2026-09-07';

console.log(`语料 ${n} 条 · 每条摊到 ${Math.max(200, Math.min(900, Math.floor(OLLAMA_BUDGET / LIMIT)))} 字\n`);

ok('一句话问出来的事，日期和项目名要进到给模型的那份材料里', () => {
  const p = promptFor('我最近有个 walking 挑战，你帮我看看记录帮我生成行程单', ALL, TODAY);
  assert.ok(p.scored, '退回成了时间范围，说明检索没看懂这个问题');
  assert.ok(p.ids.includes('regnote') || p.ids.includes('regpage'), '报名记录一条都没取到: ' + JSON.stringify(p.ids.slice(0, 6)));
  assert.ok(p.text.includes('12 Sep 2026'), '日期没进 prompt');
  assert.ok(p.text.includes('Walking Only'), '项目名没进 prompt');
});

ok('换个说法问同一件事，一样要进得去', () => {
  const p = promptFor('我报名的那个 walking 是哪天，多少钱', ALL, TODAY);
  assert.ok(p.text.includes('12 Sep 2026'), '日期没进 prompt');
  assert.ok(/139/.test(p.text), '价钱没进 prompt');
});

ok('把答案复制回工作区的那条，是回声不是证据，不许排在前面', () => {
  // 记录里原样写着你的问题，这件事本身就说明它不是这个问题的答案。而且它往往带着上一次的
  // 回答——实测那次，模型引用了它四次，把上一次那个错日期原样抄了一遍。
  const p = promptFor('我最近有个 walking 挑战，你帮我看看记录帮我生成行程单', ALL, TODAY);
  assert.ok(p.ids.length > 1, '只剩下问题自己那一条: ' + JSON.stringify(p.ids));
  assert.notStrictEqual(p.ids[0], 'self', '回声排在了第一');
  assert.ok(p.ids.indexOf('self') === -1 || p.ids.indexOf('self') >= p.ids.length - 1,
    '回声没被排到最后: ' + JSON.stringify(p.ids));
  assert.ok(p.text.includes('12 Sep 2026'), '被自我记录挤掉了');
});

ok('只占着问话的词的记录，不许压过真正说这件事的记录', () => {
  // 「看看」「生成」在这个工作区里也很稀有，光看稀有度分不出来。分得出来的是：
  // 清了门槛的那些记录共同占着的词，才是这件事的词。
  const p = promptFor('我最近有个 walking 挑战，你帮我看看记录帮我生成行程单', ALL, TODAY);
  const noise = ['noise1', 'noise2', 'noise3'].filter((id) => p.ids.includes(id));
  for (const n of noise) {
    for (const good of ['regnote', 'regpage']) {
      if (!p.ids.includes(good)) continue;
      assert.ok(p.ids.indexOf(good) < p.ids.indexOf(n), `${n} 排在了 ${good} 前面: ` + JSON.stringify(p.ids));
    }
  }
});

ok('正文里的位置不影响——第 300 多字的东西也得进得去', () => {
  // regpage 的日期在第 329 字、项目名在第 380 字，而 40 条挤 8000 字时每条只有 200 字的位置。
  // 取开头就必然错过；取命中那一段才不会。这里就按那个最紧的形状摆一遍。
  const forty = Array.from({ length: LIMIT }, () => ALL.get('regpage'));
  const out = llm._buildNumbered(forty, OLLAMA_BUDGET, ['walking']);
  const lines = out.split('\n').filter((l) => l.startsWith('[') && !l.includes('omitted'));
  assert.ok(lines.length >= 20, `只排下了 ${lines.length} 条`);
  for (const l of lines) assert.ok(l.includes('12 Sep 2026'), '有一条还是给了开头: ' + l.slice(0, 140));
});

ok('几个关键词照旧', () => {
  const p = promptFor('Ultra March', ALL, TODAY);
  assert.ok(p.scored && p.ids.length, JSON.stringify(p.ids));
  assert.ok(p.text.includes('Ultra March'), p.text.slice(0, 120));
});

ok('问一整段时间，仍然退回那段时间，并且知道自己只给了一部分', () => {
  const p = promptFor('今天做了什么', ALL, TODAY);
  assert.strictEqual(p.scored, false, '不该当成有词的查询');
  assert.ok(p.ids.length <= LIMIT, p.ids.length);
  assert.ok(p.inRange >= p.ids.length, `inRange=${p.inRange} ids=${p.ids.length}`);
});

ok('工作区里没有的事，不要凑一堆记录出来装作有', () => {
  const p = promptFor('我那台冰箱的保修单在哪', ALL, TODAY);
  assert.ok(!p.scored || !p.ids.length, '凭空给出了 ' + p.ids.length + ' 条: ' + JSON.stringify(p.ids.slice(0, 5)));
});

// ---------- 融合：向量补词面，但绝不替它出手 ----------

ok('词面交白卷时，向量一条都不许补', () => {
  // 这条是整个融合里最要紧的一句。向量永远能凑出点什么——实测一个工作区里根本不存在的问题
  // 也能得 0.432，而一条正确答案才 0.445。让它在「什么都没找到」时补位，等于把静默降级
  // 请回来，而且更难发现：界面上会出现十条看着挺像那么回事的记录。
  assert.deepStrictEqual(retrieve.fuse([], ['a', 'b', 'c'], 8), []);
});

ok('没有向量的时候，就是原来那份', () => {
  assert.deepStrictEqual(retrieve.fuse(['a', 'b'], [], 8), ['a', 'b']);
  assert.deepStrictEqual(retrieve.fuse(['a', 'b'], null, 8), ['a', 'b']);
});

ok('两边都排前面的，融合后更靠前', () => {
  const out = retrieve.fuse(['x', 'a'], ['a', 'y'], 8);
  assert.strictEqual(out[0], 'a', JSON.stringify(out));
});

ok('向量能把词面漏掉的补进来，但补在后面', () => {
  // 「显示器型号」就是这个形状：词面找到三条不相干的，向量知道那条英文记录才是答案
  const out = retrieve.fuse(['l1', 'l2', 'l3'], ['v1', 'l3'], 8);
  assert.ok(out.includes('v1'), JSON.stringify(out));
  assert.ok(out.indexOf('l1') < out.indexOf('v1'), '词面第一名被向量顶掉了: ' + JSON.stringify(out));
});

ok('融合之后才截断，截断的条数说了算', () => {
  const out = retrieve.fuse(['a', 'b', 'c'], ['d', 'e', 'f'], 4);
  assert.strictEqual(out.length, 4, JSON.stringify(out));
});

// ---------- 真实工作区（可选） ----------
//
// 真实工作区一直在变，所以不能写死期望。改成查不变量：如果工作区里**确实存在**含着某句话的记录，
// 那这句话就必须进得了 prompt；不存在就跳过。这样它在任何一台机器上都说得出有意义的话。

if (LIVE) {
  const home = process.env.HOME || '';
  const dir = path.join(home, 'Library/Application Support/briffy/workspace/entries');
  if (!fs.existsSync(dir)) {
    console.log('\n--live：本机没有工作区，跳过');
  } else {
    console.log('\n--live：本机真实工作区');
    index.close();
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-live-'));
    index.open(tmp2, path.dirname(dir));
    const src2 = { dir, loadDay: (k) => { try { return JSON.parse(fs.readFileSync(path.join(dir, `${k}.json`), 'utf8')); } catch (_) { return []; } } };
    let s2; do { s2 = index.sync(src2, { budgetMs: 20000 }); } while (!s2.done);
    const live = loadAll(dir);
    const today = new Date().toISOString().slice(0, 10);
    console.log(`  索引 ${index.stats().entries} 条`);

    const CASES = [
      { q: '我最近有个 walking 挑战，你帮我看看记录帮我生成行程单', want: ['12 Sep 2026', 'Walking Only'] },
      { q: '我报名的那个 walking 是哪天，多少钱', want: ['12 Sep 2026'] },
    ];
    for (const c of CASES) {
      // 工作区里有没有含着这句话的记录？没有就没什么可断言的。
      const exists = c.want.filter((w) => [...live.values()].some((e) => String(e.text || '').includes(w)));
      if (!exists.length) { console.log(`  skip  ${c.q}（工作区里本来就没有这些字）`); continue; }
      const p = promptFor(c.q, live, today);
      const missing = exists.filter((w) => !p.text.includes(w));
      if (missing.length) {
        console.log(`  FAIL  ${c.q}\n        取回 ${p.ids.length} 条，但没进 prompt：${JSON.stringify(missing)}`);
        process.exitCode = 1;
      } else {
        console.log(`  ok    ${c.q}（取回 ${p.ids.length} 条，${JSON.stringify(exists)} 都在）`);
      }
    }
    fs.rmSync(tmp2, { recursive: true, force: true });
  }
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* 系统会收 */ }
console.log(`\nretrieval: ${pass} passed`);
process.exit(process.exitCode || 0);
