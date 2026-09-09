'use strict';
// 筛选行上每个词后面那个数，必须**等于**点它之后屏幕上的条数。
//
//   node dev/filter-count-test.js [工作区路径]
//
// 筛选是**两级**的（store.js 的 entryBucket / entrySub）：一级是屏幕上那五种纸，
// 二级跟着一级换。所以这个台子除了对数，还守着两条结构上的不变量：
// 五格**互斥**（没有哪条记录落在两格里）、**全覆盖**（五格加起来等于全库，没有孤儿）。
//
// 对数这一条听起来是废话，但 2026-09-09 之前它是错的，而且错得很大。当时「筛」和「数」是两段
// 各自算的代码：listEntries 那一路知道「全部」里要悄悄扣掉剪贴板（那台机器上 329 条里
// 260 条是剪贴板），stats 那一路不知道，它数的是全库。于是——
//
//     筛选行上写着            屏幕上真有
//     文字 203                19
//     图片  97                34
//     全部 329                69
//
// 用户读的是前一列，看的是后一列。一个筛选器的全部本事就是「点下去之后屏上剩什么」，
// 数错了它就什么都不是。修法不是把 stats 也补上那条规矩（那只是把同一个错误抄两遍，
// 下一条规矩来了照样分叉），而是**让两条路共用同一个判据**：store.entryMatches。
// 这个台子就是那条不变量的守卫：每一个数都真的去 listEntries 要一遍，对不上就红。
const path = require('path');
const assert = require('assert');

// store.js 的 paths() 会问 electron 要 userData（放模型的那两处），node 里没有那个 app。
// 垫一个假的：这个台子一个模型文件都不碰。
const Module = require('module');
const realLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return { app: { getPath: () => path.join(__dirname, '.no-userdata') } };
  return realLoad.call(this, req, ...rest);
};
const { Store, BUCKETS, entrySub, entryBucket } = require('../src/main/store');

const WS = process.argv[2]
  || path.join(process.env.HOME, 'Library/Application Support/briffy/workspace');
const store = new Store();
store.settings = { workspaceDir: WS };

const dates = store.listDates();
if (!dates.length) { console.log(`工作区里没有记录：${WS}`); process.exit(0); }

const ALL = 100000;   // 「屏幕上会有几条」不能被 limit 截断，否则台子自己在说谎
const list = (o) => store.listEntries({ ...o, limit: ALL }).length;

// 时间维度取四种形状：不限 / 一天 / 两天 / 大半个库——覆盖 dates=null、单天、多天。
const RANGES = { 不限: null, 一天: [dates[0]], 两天: dates.slice(0, 2), 大半: dates.slice(0, 4) };
// 一级：全部 + 五格 + 一个不存在的值（应当处处是 0，不是「忽略这一维」）
const BKTS = ['', ...BUCKETS, '不存在的一级'];
const QUERIES = ['', 'briffy', '模型'];
// 「全部里不含剪贴板」那条规矩（设置里的 clipboardInAll）：开关两种状态都要对
const HIDES = { 规矩开着: ['clip'], 规矩关掉: null };

let checks = 0;
const fail = [];
const eq = (got, want, what) => {
  checks++;
  if (got !== want) fail.push(`${what}：写着 ${got}，点下去 ${want}`);
};

// 二级的值是跟着一级走的，先把每一格里真有哪些值取出来（外加一个不存在的值）
const subsOf = (bucket) => ['', ...Object.keys(store.stats({ bucket }).bySub), '不存在的二级'];

for (const q of QUERIES) {
  for (const [rk, d] of Object.entries(RANGES)) {
    for (const [hk, hideInAll] of Object.entries(HIDES)) {
    for (const bucket of BKTS) {
      for (const sub of subsOf(bucket)) {
        const where = `q=${q || '空'} 时间=${rk} ${hk} 一级=${bucket || '全部'} 二级=${sub || '全部'}`;
        const base = { query: q, dates: d, bucket, sub, hideInAll };
        const st = store.stats(base);

        // 屏幕上那几条
        eq(st.shown, list(base), `${where} · shown`);

        // 一级那一排：放开一级、二级**和那条规矩**（点「剪贴板」就该看得见剪贴板）
        for (const [k, n] of Object.entries(st.byBucket)) {
          eq(n, list({ ...base, bucket: k, sub: '' }), `${where} · 一级「${k}」`);
        }
        // 「全部」那一格：点它回到「没选一级」，规矩又生效——所以它**不是**五格之和
        eq(st.allCount, list({ ...base, bucket: '', sub: '' }), `${where} · 一级「全部」`);

        // 二级那一排：放开二级、按住一级。没选一级时它应当是空的
        if (!bucket) {
          eq(Object.keys(st.bySub).length, 0, `${where} · 没选一级时 bySub 应当是空的`);
        } else {
          for (const [k, n] of Object.entries(st.bySub)) {
            eq(n, list({ ...base, sub: k }), `${where} · 二级「${k}」`);
          }
          eq(Object.values(st.bySub).reduce((a, b) => a + b, 0),
            list({ ...base, sub: '' }), `${where} · 二级「全部」`);
        }

        // 时间那一排：放开日期，每一天的数 = 只看那一天的条数
        for (const day of dates) {
          eq(st.byDay[day] || 0, list({ ...base, dates: [day] }), `${where} · ${day}`);
        }
      }
    }
    }
  }
}

// 二级的值是**开集**，只有剪贴板那一格是闭集。文件那格踩过这个坑：一开始用 entryFormat
// 那张 11 项的固定表，于是 .sketch 和 .dmg 一起进了「其它」。这一段守着它——
// 拖进来的每一种扩展名都得是自己的一格。
{
  const drop = (name) => ({ id: name, title: name, path: `files/2026-09-09/${name}` });
  const cases = [['合同.pdf', 'PDF'], ['P60.PDF', 'PDF'], ['设计稿.sketch', 'SKETCH'],
    ['账目.csv', 'CSV'], ['素材.zip', 'ZIP'], ['安装包.dmg', 'DMG'], ['照片.HEIC', 'HEIC']];
  for (const [name, want] of cases) {
    const e = drop(name);
    checks++;
    if (entryBucket(e) !== 'file') fail.push(`${name} 该落在「文件」那一格，实际是 ${entryBucket(e)}`);
    checks++;
    if (entrySub(e) !== want) fail.push(`${name} 的二级该是 ${want}，实际是 ${entrySub(e)}`);
  }
  // 每一种都得是自己的一格，不能挤在一起
  eq(new Set(cases.map(([n]) => entrySub(drop(n)))).size, 6, '七个文件分出六种扩展名');
  // 没有扩展名的（拖进来的一条网址）退回格式
  eq(entrySub({ id: 'u', type: 'url', mime: 'text/uri-list', title: 'Example Domain', path: '' }),
    'link', '拖进来的网址退回「链接」');
}

// 那条规矩只在「没选一级」时生效：点了「剪贴板」那一格就必须看得见剪贴板
{
  const hidden = store.listEntries({ hideInAll: ['clip'], limit: ALL }).length;
  const whole = store.listEntries({ limit: ALL }).length;
  const clip = store.listEntries({ bucket: 'clip', limit: ALL }).length;
  eq(hidden + clip, whole, '「全部」挡掉的正好是剪贴板那一格');
  eq(store.listEntries({ bucket: 'clip', hideInAll: ['clip'], limit: ALL }).length, clip,
    '选中「剪贴板」时那条规矩不该生效');
}

// 五格互斥、全覆盖：每条记录落在且只落在一格里，加起来一定等于全库
{
  const whole = store.stats();
  const sum = Object.values(whole.byBucket).reduce((a, b) => a + b, 0);
  eq(sum, whole.entries, '五格加起来 = 全库');
  const seen = new Set();
  for (const b of BUCKETS) for (const e of store.listEntries({ bucket: b, limit: ALL })) {
    checks++;
    if (seen.has(e.id)) fail.push(`${e.id} 落在不止一格里`);
    seen.add(e.id);
  }
  eq(seen.size, whole.entries, '每条记录都有一格');
}

// 不给条件那一路必须和以前一字不差（main.js 里那处 store.stats() 没改）
const plain = store.stats();
eq(plain.allCount, plain.entries, '不给条件 · allCount');
eq(plain.entries, dates.reduce((n, d) => n + store.loadDay(d).length, 0), '不给条件 · entries');
eq(plain.shown, plain.entries, '不给条件 · shown');

for (const f of fail) console.log(`✗ ${f}`);
console.log(`\n${WS}`);
console.log(`${dates.length} 天 ${plain.entries} 条 · ${checks} 个数 · 对不上的 ${fail.length} 个`);
assert.strictEqual(fail.length, 0, '筛选行上的数和屏幕上的条数对不上');
console.log('全对。');
