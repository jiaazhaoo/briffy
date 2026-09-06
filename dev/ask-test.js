// Regression test for the retrieval behind "ask my log" (src/main/recall.js). No Electron, no network,
// no model: `node dev/ask-test.js`. Everything a question can do — pick a stretch of days, find the one
// entry that matters, or ask for a whole week at once — is pinned here.
const { recall, parseRange, queryTerms } = require('../src/main/recall.js');

const TODAY = '2026-09-04';   // a Friday
let pass = 0; let fail = 0;

function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

function entry(id, dateKey, time, fields) {
  return {
    id, dateKey, createdAt: `${dateKey}T${time}:00.000Z`, type: 'screenshot',
    title: '', tags: [], summary: '', text: '', path: '', status: 'done', ...fields,
  };
}

const ENTRIES = [
  entry('pg', '2026-08-26', '10:12', {
    title: 'Postgres 连接池报错', tags: ['Postgres', '连接池', '报错', 'timeout', '后端'],
    summary: '数据库连接池耗尽导致的 timeout 报错截图。', text: 'FATAL: remaining connection slots are reserved\nPostgresError: connection pool timeout',
  }),
  entry('standup', '2026-08-27', '09:30', {
    type: 'audio', title: '早会语音记录', tags: ['早会', '排期', '发版', 'Q3', '团队'],
    summary: '早会上讨论了发版排期。', text: '今天早会讨论了下周的发版排期，后端接口还差一个联调',
  }),
  entry('recipe', '2026-08-28', '19:40', {
    type: 'image', title: '番茄牛腩做法', tags: ['番茄', '牛腩', '做法', '晚饭', '菜谱'],
    summary: '一张菜谱截图。', text: '番茄牛腩 材料 牛腩 500g 番茄 3个 炖 90 分钟',
  }),
  entry('lease', '2026-09-01', '14:05', {
    type: 'pdf', title: '租房合同 2026', tags: ['租房', '合同', '押金', '房东', '条款'],
    summary: '租房合同 PDF，押一付三。', text: '乙方应于签订本合同时支付押金 人民币 8000 元 房东 王先生',
  }),
  entry('pgagain', '2026-09-03', '16:20', {
    title: 'Postgres 慢查询', tags: ['Postgres', '慢查询', '索引', 'EXPLAIN', '优化'],
    summary: '给慢查询加索引后的 EXPLAIN 结果。', text: 'EXPLAIN ANALYZE seq scan on orders 已加索引 Postgres',
  }),
  entry('cat', '2026-09-04', '11:00', {
    title: '猫粮比价', tags: ['猫粮', '比价', '渴望', '电商', '囤货'],
    summary: '几家店的猫粮价格。', text: '渴望鸡肉 2kg 售价对比 天猫 京东 拼多多',
  }),
];

console.log('date expressions (today = 2026-09-04, a Friday)');
const R = (q) => { const r = parseRange(q, TODAY); return r ? `${r.from}~${r.to}` : null; };
check('今天', R('今天存了什么') === '2026-09-04~2026-09-04', R('今天存了什么'));
check('昨天', R('昨天的记录') === '2026-09-03~2026-09-03', R('昨天的记录'));
check('前天 beats 天', R('前天那个截图') === '2026-09-02~2026-09-02', R('前天那个截图'));
check('上周 = Mon..Sun', R('上周都干了什么') === '2026-08-24~2026-08-30', R('上周都干了什么'));
check('本周 = Mon..today', R('本周的记录') === '2026-08-31~2026-09-04', R('本周的记录'));
check('last week', R('what did I look at last week') === '2026-08-24~2026-08-30', R('what did I look at last week'));
check('上个月 = whole month', R('上个月的合同') === '2026-08-01~2026-08-31', R('上个月的合同'));
check('这个月 = 1st..today', R('这个月花了多少') === '2026-09-01~2026-09-04', R('这个月花了多少'));
check('最近三天', R('最近三天') === '2026-09-02~2026-09-04', R('最近三天'));
check('过去 10 天', R('过去 10 天的报错') === '2026-08-26~2026-09-04', R('过去 10 天的报错'));
check('last 5 days', R('last 5 days') === '2026-08-31~2026-09-04', R('last 5 days'));
check('9月3日', R('9月3日的记录') === '2026-09-03~2026-09-03', R('9月3日的记录'));
check('ISO date', R('2026-08-27 的语音') === '2026-08-27~2026-08-27', R('2026-08-27 的语音'));
check('ISO span', R('2026-08-26 到 2026-09-01') === '2026-08-26~2026-09-01', R('2026-08-26 到 2026-09-01'));
check('no time word', R('猫粮比价') === null, R('猫粮比价'));

console.log('question terms');
const terms = (q) => queryTerms(q).join(' ');
check('CJK becomes bigrams', terms('报错截图') === '报错 错截 截图', terms('报错截图'));
check('function words dropped', terms('我的租房合同在哪') === '租房 合同', terms('我的租房合同在哪'));
check('short latin kept', terms('那个 PR 和 AI') === 'pr ai', terms('那个 PR 和 AI'));
check('english stop words dropped', terms('what was the postgres error about') === 'postgres error', terms('what was the postgres error about'));

console.log('retrieval');
const top = (q) => { const r = recall(ENTRIES, q, { today: TODAY }); return r.entries.map((e) => e.id); };
check('finds the one entry meant', top('Postgres 连接池报错')[0] === 'pg', top('Postgres 连接池报错').join(','));
check('a later entry on the same topic still ranks', top('Postgres').slice(0, 2).sort().join(',') === 'pg,pgagain', top('Postgres').join(','));
check('time word narrows a common term', top('上周的 Postgres 报错').join(',') === 'pg', top('上周的 Postgres 报错').join(','));
check('tags are searchable', top('押金')[0] === 'lease', top('押金').join(','));
check('OCR text is searchable', top('渴望鸡肉')[0] === 'cat', top('渴望鸡肉').join(','));
check('unrelated question finds nothing', top('量子计算论文').length === 0, top('量子计算论文').join(','));

const week = recall(ENTRIES, '上周我都在忙什么', { today: TODAY });
check('pure time question returns the range unscored', !week.scored && week.entries.length === 3, `scored=${week.scored} n=${week.entries.length}`);
check('  ... newest first', week.entries[0].id === 'recipe', week.entries.map((e) => e.id).join(','));
const empty = recall(ENTRIES, '昨天', { today: TODAY });
check('a day with entries comes back whole', empty.entries.map((e) => e.id).join(',') === 'pgagain', empty.entries.map((e) => e.id).join(','));
const limited = recall(ENTRIES, '', { today: TODAY, limit: 2 });
check('limit is honoured', limited.entries.length === 2, String(limited.entries.length));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
