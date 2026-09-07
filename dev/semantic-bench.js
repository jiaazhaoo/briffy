'use strict';
// 向量检索到底能补上什么——在真实工作区上量，不猜。
//
//   npx electron dev/semantic-bench.js
//
// 要 electron，因为 src/main/embed.js 用 utilityProcess 把模型放在独立进程里跑（一个这台机器
// 跑不动的 ONNX 模型会把它所在的进程整个带走，所以它必须在外面）。那套东西早就写好了，本来是给
// 「抽三个词描述这条记录」用的，那个功能被砍掉之后就一直闲置着。
//
// 要回答的只有一个问题：**它能不能把「车顶架」和「Roof bars for a 2012 Vauxhall insignia」
// 连起来。** 连不上，后面所有关于调度、回填、去重的讨论都是空的。
//
// 顺带量三件事，因为它们决定这个方案能不能落地：
//   一条记录要多久 —— 决定新记录能不能做到分钟级
//   全量要多久     —— 决定回填是六分钟还是六小时（方案里那个 6 分钟是拍的）
//   切块有没有必要 —— 这个模型只吃 128 token，一条一万三千字的网页只会被它的开头代表，
//                    而网页的开头永远是语言选择和 Cookie 提示
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const CHUNK = 220;          // 一块大约这么多字符：128 token 中文大概装 100 出头，英文多些
const OVERLAP = 40;         // 块之间叠一点，别把一句话从中间切断
const MAX_CHUNKS = 10;      // 一条记录最多取这么多块，够覆盖前 2000 字
const BATCH = 32;

// 七个日常问题，和它们在工作区里的正确答案（按标题认）。这七个就是 dev/retrieval-test.js
// --live 里那一批，词面检索现在对五个。
const CASES = [
  { q: '我之前查的那个车顶架是给哪辆车的，要多少钱', title: 'Roof bars for a 2012 Vauxhall' },
  { q: '我本机的 ollama 地址是多少', title: 'Ollama 地址' },
  { q: '之前说这台电脑推荐跑哪个模型来着，多大', title: '推荐在这台电脑上用 qwen3.5:27b' },
  { q: '中国区的付费我当时打算怎么改', title: '把中国区改成一次性年卡' },
  { q: '我记过一个显示器的型号，是哪个', title: 'Dell ultrawide monitor p3425we' },
  { q: '那个 grok 图标的开源项目叫什么，谁写的', title: 'GitHub - blessonism/grok-icon-study' },
  { q: '我上个月去哪里旅游了', title: null },      // 工作区里没有，向量检索也不该硬凑
];

function chunksOf(entry) {
  const head = `${entry.title || ''}`.trim();
  const body = `${entry.text || ''}`.replace(/\s+/g, ' ').trim();
  const whole = (head ? `${head}。${body}` : body).trim();
  if (!whole) return [];
  const out = [];
  for (let i = 0; i < whole.length && out.length < MAX_CHUNKS; i += (CHUNK - OVERLAP)) {
    const c = whole.slice(i, i + CHUNK);
    if (c.trim().length >= 8) out.push(c);
    if (i + CHUNK >= whole.length) break;
  }
  return out.length ? out : [whole];
}

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// 两个模型对着量。paraphrase-* 的训练目标是「两句话像不像」（对称相似度），检索要的是
// 「短问题 ↔ 长文档」（不对称），那是 e5 在做的事——代价是它要求给问题和文档加不同的前缀，
// 不加的话它的表现会明显变差。这个差别在跨语言检索上通常很大，所以值得花五分钟排除掉。
const MODELS = [
  { id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', q: (s) => s, d: (s) => s },
  { id: 'Xenova/multilingual-e5-small', q: (s) => `query: ${s}`, d: (s) => `passage: ${s}` },
];

async function main() {
  const embed = require('../src/main/embed');
  const WS = path.join(os.homedir(), 'Library/Application Support/briffy/workspace');
  const dir = path.join(WS, 'entries');
  const cacheDir = path.join(os.homedir(), 'Library/Application Support/briffy/models');

  const entries = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    let e; try { e = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { continue; }
    for (const x of (Array.isArray(e) ? e : e.entries || [])) entries.push(x);
  }
  console.log(`工作区 ${entries.length} 条`);

  const chunks = [];               // {ei, text}
  for (let ei = 0; ei < entries.length; ei++) for (const c of chunksOf(entries[ei])) chunks.push({ ei, text: c });
  console.log(`切成 ${chunks.length} 块（平均每条 ${(chunks.length / entries.length).toFixed(1)} 块）\n`);

for (const M of MODELS) {
  console.log(`\n════════════ ${M.id}`);
  const vecs = [];
  const t0 = Date.now();
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const v = await embed.embed(batch.map((c) => M.d(c.text)), { cacheDir, model: M.id });
    vecs.push(...v);
    if (i === 0) console.log(`  第一批（含加载模型）${Date.now() - t0}ms`);
    process.stdout.write(`\r  ${Math.min(i + BATCH, chunks.length)}/${chunks.length}`);
  }
  const ms = Date.now() - t0;
  console.log(`\n\n全量 ${chunks.length} 块用了 ${(ms / 1000).toFixed(1)}s`);
  console.log(`  每块 ${(ms / chunks.length).toFixed(0)}ms · 每条记录 ${(ms / entries.length).toFixed(0)}ms`);
  console.log(`  照这个速度：攒 10 条 ≈ ${((ms / entries.length) * 10 / 1000).toFixed(1)}s，一天 200 条 ≈ ${((ms / entries.length) * 200 / 1000).toFixed(0)}s`);
  console.log(`  向量占用：${chunks.length} × 384 × 4B = ${(chunks.length * 384 * 4 / 1024 / 1024).toFixed(1)}MB\n`);

  let hit = 0;
  for (const c of CASES) {
    const [qv] = await embed.embed([M.q(c.q)], { cacheDir, model: M.id });
    const best = new Map();        // 记录 → 它最好的一块的分
    for (let i = 0; i < chunks.length; i++) {
      const s = dot(qv, vecs[i]);
      const ei = chunks[i].ei;
      if (!best.has(ei) || s > best.get(ei)) best.set(ei, s);
    }
    const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
    const rank = c.title ? ranked.findIndex(([ei]) => String(entries[ei].title || '').includes(c.title)) + 1 : 0;
    const top = ranked.slice(0, 3).map(([ei, s], i) => `      ${i + 1}. ${s.toFixed(3)}  ${String(entries[ei].title || '').slice(0, 40)}`);
    if (c.title) {
      const ok = rank >= 1 && rank <= 8;
      if (ok) hit++;
      console.log(`  ${ok ? 'ok  ' : 'MISS'} ${c.q}\n      正确那条排第 ${rank || '—'} 名（分 ${rank ? ranked[rank - 1][1].toFixed(3) : '—'}）`);
    } else {
      console.log(`  ——   ${c.q}\n      没有正确答案，看它硬凑出什么：`);
    }
    console.log(top.join('\n'));
  }
  console.log(`\n  → ${M.id.split('/')[1]}：${hit}/6 条有答案的问题，正确记录进了前 8`);
}
  console.log('\n（词面检索现在 4/6，漏的是「车顶架」「显示器型号」）');
  embed.dispose();
  app.quit();
}

app.whenReady().then(() => main().catch((e) => { console.error('炸了:', e && e.stack || e); app.quit(); }));
