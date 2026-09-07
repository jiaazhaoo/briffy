'use strict';
// 证据链：A 和 B 共用一个词，B 和 C 共用另一个词，于是 A 和 C 串上了。
//
//   npx electron dev/evidence-chain-bench.js
//
// 和前面几条路的根本区别：**边不是「像」，是「共用了哪个词」**——每条边都拿得出那个词。
// 向量那条路已经量死了（地址对主题 0.155，降门槛到 0.2 才连上 3/8 而且全连通）；
// 「同一处」精确但不传递（各人来自各人的一页，没有兄弟）。传递性正是这一条要补的。
//
// 唯一的旋钮是**词有多罕见才算证据**。太松，「google」「parking」会把不相干的事件焊在一起；
// 太紧，链断成一节一节。所以这里不定死一个数，而是把 df 上限扫一遍，同时报两件事：
//   连上了几条（要的）· 那个连通块有多大（代价）
// 一个把 237 条全吞进去的连通块，和没有链是一回事。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const HOME = os.homedir();
const WS = path.join(HOME, 'Library/Application Support/briffy/workspace');
const DIR = path.join(WS, 'entries');
const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// 截图里那 9 条 + 主题里已有的 5 条
const NINE = [/^Find parking/i, /^Windsor Road, Egham/i, /^Buckingham Court, Kingston/i,
  /^Parking space on Buckingham/i, /^£10 接驳车/, /^停 Staines/, /^Runnymede Pleasure/i,
  /^赛程分前后半程/, /^Bishops Park/i];
const FIVE = [/^English \(Great Britain\)$/, /^Sat・12 Sep 2026/, /^Ultra Challenge$/,
  /^Thank you! Your registration/i, /^1st Half Challenge$/];

async function main() {
  const index = require('../src/main/index-db');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-chain-'));
  index.open(tmp, WS);

  const all = [];
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.json')) continue;
    let e; try { e = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (_) { continue; }
    for (const x of (Array.isArray(e) ? e : e.entries || [])) all.push(x);
  }
  const byId = new Map(all.map((e) => [e.id, e]));
  const name = (id) => one((byId.get(id) || {}).title).slice(0, 30) || '（无标题）';

  // 一条记录拿得出的词。**窗口标题一定要进来**——那是「你当时在哪一页」，
  // 而这整件事的连接词（Staines、赛程、Thames）多半只写在那儿。
  const BODY = 1200;   // 正文只取开头：一页 5462 字的宣传语会把它半个词表塞进来
  // SRC=head 只取标题和窗口标题，不要正文。假设：**噪声词全来自正文里的导航栏**
  // （rent / airports / payment / log / high 全是 JustPark 的菜单），而证据词全在标题上
  // （tw20 / egham / runnymede / 0ae / thames）。这一条如果成立，剥掉正文就同时解决两件事。
  const HEAD_ONLY = process.env.SRC === 'head';
  // STRIP=1 先剥掉网页家具（src/main/boilerplate.js）再取词。这一步就是为这里做的：
  // 「rent / airports / payment / log / high」全是 JustPark 的菜单，它们混在证据词里，
  // 能把毫不相干的两晚焊在一起。
  const bp = require('../src/main/boilerplate');
  const STRIP = process.env.STRIP === '1';
  const fur = STRIP ? bp.learn(all.map((e) => String(e.text || ''))) : null;
  const bodyOf = (e) => (STRIP ? bp.strip(String(e.text || ''), fur) : String(e.text || ''));
  const srcOf = (e) => {
    const c = e.context || {};
    return (HEAD_ONLY ? [e.title, c.window, c.url, e.url]
      : [e.title, bodyOf(e).slice(0, BODY), c.window, c.url, e.url]).filter(Boolean).join(' ');
  };

  // ── 两套取词policy，为的是回答同一个问题：证据词该长什么样
  // A 全部词：现在这一版。**在一个以中文为主的工作区里，英文虚词天生就「罕见」**——
  //   hour / should / there / get 在 238 条里只出现两三次，于是它们通过了 df 筛，
  //   变成了「证据」，把毫不相干的两件事焊在一起。df 量的是这个工作区里的罕见，
  //   不是这个词有没有意思。
  // B 只认名字：专名（原文里首字母大写的）、带数字的（TW18、TW20、0AE 这种邮编）、
  //   和成串的汉字。一个地名、一个邮编、一个赛事名才是证据；一个介词不是。
  const STOP = new Set(('the a an and or of to in on at for with from by is are was were be been am '
    + 'this that these those it its as if not no yes you your i my we our they them he she his her '
    + 'will would can could should may might must do does did done have has had get got got go goes '
    + 'there here when where what which who how why all any some more most other than then also '
    + 'about into over under out up down off just now new more see all one two three hour hours '
    + 'day days time home half back only very much many such same').split(/\s+/));
  const namey = (raw) => {
    const out = new Set();
    for (const m of String(raw).matchAll(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]{2,8}/gu)) out.add(m[0]);
    for (const m of String(raw).matchAll(/\b[A-Za-z][A-Za-z'’-]{1,}\b/g)) {
      const w = m[0];
      if (!/^[A-Z]/.test(w)) continue;                    // 专名：原文里首字母大写的
      const low = w.toLowerCase();
      if (STOP.has(low) || low.length < 3) continue;
      out.add(low);
      // 连字符里的每一节也算：Staines-upon-Thames 的那个 thames，正是它和赛事名之间唯一的桥。
      // 不拆，这座桥就不存在——而它是整条证据链里最实的一根。
      if (low.includes('-')) for (const part of low.split('-')) if (part.length >= 3 && !STOP.has(part)) out.add(part);
    }
    for (const m of String(raw).matchAll(/\b(?=[A-Za-z0-9]*[0-9])[A-Za-z0-9]{3,10}\b/g)) out.add(m[0].toLowerCase());
    return out;
  };
  const POLICY = process.env.POLICY || 'B';
  const wordsOf = (e) => (POLICY === 'A'
    ? new Set(index.tokens(srcOf(e)).filter((w) => w.length > 1 && !/^\d+$/.test(w) && !STOP.has(w)))
    : namey(srcOf(e)));
  const W = new Map(all.map((e) => [e.id, wordsOf(e)]));
  const df = new Map();
  for (const s of W.values()) for (const w of s) df.set(w, (df.get(w) || 0) + 1);
  console.log(`取词 policy = ${POLICY}（A 全部词 · B 只认专名/邮编/汉字），词表 ${df.size} 个`);

  // 桥词的 df：一个词之所以能把两件事连起来，正因为它**两边都出现**——而这恰恰把它的 df 抬高，
  // 于是「罕见才算证据」这条规则会主动把最好的桥词筛掉。这是这个思路真正的要害，所以单列出来看。
  console.log('\n  候选桥词   出现在几条里   都在哪几条（前 6 条）');
  for (const w of ['thames', '泰晤士', 'staines', 'egham', 'challenge', 'ultra', '赛程', 'runnymede', 'tw20', 'tw18']) {
    const who = [...W].filter(([, s2]) => s2.has(w)).map(([id]) => id);
    if (!who.length) { console.log(`  ${w.padEnd(12)} —— 一条都没有（取词把它丢了）`); continue; }
    console.log(`  ${w.padEnd(12)}${String(who.length).padStart(6)}       ${who.slice(0, 6).map(name).map((x) => x.slice(0, 18)).join(' · ')}`);
  }
  console.log('');

  const pick = (list) => list.map((re) => {
    const hits = all.filter((e) => re.test(one(e.title)));
    return hits.length ? hits[hits.length - 1].id : '';
  }).filter(Boolean);
  const targets = [...new Set([...pick(NINE), ...pick(FIVE)])];
  console.log(`${all.length} 条记录，盯住其中 ${targets.length} 条（截图那 9 条 + 主题里那 5 条）\n`);

  function graphAt(dfMax) {
    const post = new Map();          // 词 -> 哪些记录有它
    for (const [id, s] of W) for (const w of s) {
      const n = df.get(w);
      if (n < 2 || n > dfMax) continue;
      if (!post.has(w)) post.set(w, []);
      post.get(w).push(id);
    }
    const adj = new Map(all.map((e) => [e.id, new Map()]));   // id -> (id -> 证据词[])
    for (const [w, ids] of post) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          if (!adj.get(ids[i]).has(ids[j])) { adj.get(ids[i]).set(ids[j], []); adj.get(ids[j]).set(ids[i], []); }
          adj.get(ids[i]).get(ids[j]).push(w);
          adj.get(ids[j]).get(ids[i]).push(w);
        }
      }
    }
    return adj;
  }
  const reach = (adj, from) => {
    const seen = new Set([from]); const q = [from];
    while (q.length) for (const nb of adj.get(q.shift()).keys()) if (!seen.has(nb)) { seen.add(nb); q.push(nb); }
    return seen;
  };
  const pathOf = (adj, from, to) => {
    const prev = new Map([[from, null]]); const q = [from];
    while (q.length) {
      const cur = q.shift();
      if (cur === to) break;
      for (const nb of adj.get(cur).keys()) if (!prev.has(nb)) { prev.set(nb, cur); q.push(nb); }
    }
    if (!prev.has(to)) return null;
    const out = []; let cur = to;
    while (cur) { out.unshift(cur); cur = prev.get(cur); }
    return out;
  };

  console.log('  词最多出现在几条里才算证据   14 条串成几块   最大的块有多大   平均每条几条边');
  for (const dfMax of [2, 3, 4, 6, 8, 12, 20]) {
    const adj = graphAt(dfMax);
    const blocks = [];
    const done = new Set();
    for (const t of targets) {
      if (done.has(t)) continue;
      const r = reach(adj, t);
      const mine = targets.filter((x) => r.has(x));
      for (const m of mine) done.add(m);
      blocks.push({ n: mine.length, size: r.size });
    }
    const deg = [...adj.values()].reduce((s, m) => s + m.size, 0) / all.length;
    const biggest = Math.max(...blocks.map((b) => b.size));
    console.log(`  ${String(dfMax).padStart(4)}                       ${String(blocks.length).padStart(6)} 块        ${String(biggest).padStart(5)} / ${all.length}       ${deg.toFixed(1)}`);
  }

  // 挑一个门槛看实际的链
  const DF = Number(process.env.DF || 6);
  console.log(`\n════ 门槛 df ≤ ${DF} 时，链长什么样 ════`);
  const adj = graphAt(DF);
  const a = pick([/^Windsor Road, Egham/i])[0];
  const b = pick([/^Thank you! Your registration/i])[0];
  const p = a && b ? pathOf(adj, a, b) : null;
  if (!p) console.log('  「Windsor Road, Egham」和「Thank you! Your registration」之间没有链');
  else {
    console.log(`  从「${name(a)}」到「${name(b)}」，${p.length - 1} 跳：`);
    for (let i = 0; i < p.length - 1; i++) {
      const ev = adj.get(p[i]).get(p[i + 1]).slice(0, 4).join(' · ');
      console.log(`     ${name(p[i]).padEnd(32)}\n        ↕ 共用「${ev}」`);
    }
    console.log(`     ${name(p[p.length - 1])}`);
  }

  // 逐跳验一条具体的链：每一跳共用了哪些词，把它们摊开看是不是真的证据
  console.log('\n════ 逐跳验：从一个邮编走到报名成功 ════');
  const CHAIN = [/^Windsor Road, Egham/i, /^Runnymede Pleasure/i, /^赛程分前后半程/,
    /^Ultra Challenge$/, /^Thank you! Your registration/i];
  const ids = CHAIN.map((re) => pick([re])[0]);
  for (let i = 0; i < ids.length - 1; i++) {
    if (!ids[i] || !ids[i + 1]) { console.log('  （少了一条记录）'); continue; }
    const shared = [...W.get(ids[i])].filter((w) => W.get(ids[i + 1]).has(w))
      .map((w) => [w, df.get(w)]).sort((a2, b2) => a2[1] - b2[1]).slice(0, 6);
    console.log(`  ${name(ids[i]).slice(0, 30)}`);
    console.log(`     ↕ ${shared.map(([w, n]) => `${w}(${n})`).join(' · ') || '—— 没有共用词'}`);
  }
  console.log(`  ${name(ids[ids.length - 1]).slice(0, 30)}`);

  console.log('\n════ 这 14 条各自的直接证据边（只列和另外 13 条之间的）════');
  for (const t of targets) {
    const nb = [...adj.get(t)].filter(([id]) => targets.includes(id));
    if (!nb.length) { console.log(`  ${name(t).padEnd(30)} —— 和另外 13 条一条直接边都没有`); continue; }
    console.log(`  ${name(t)}`);
    for (const [id, ws] of nb.slice(0, 4)) console.log(`     ↕ ${name(id).padEnd(30)} 「${ws.slice(0, 3).join(' · ')}」`);
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  app.quit();
}
app.whenReady().then(() => main().catch((e) => { console.error('炸了:', e && e.stack || e); app.quit(); }));
