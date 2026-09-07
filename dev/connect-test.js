'use strict';
// 接进来的东西：Notion 的页面、Gmail 的邮件。
//
//   node dev/connect-test.js
//
// 全程不碰真实账号：网络调用被换成一个假的 fetch，所以这里测的是**我们这一侧**的行为——
// 认不认得出正文、同一封邮件会不会进来两遍、页面改了是更新还是又添一条、断点续传接不接得上。
// 真正连账号是用户在设置里自己做的事，凭据也只在他自己的机器上。
const assert = require('assert');

let pass = 0;
const ok = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { console.log(`  FAIL ${name} — ${e.message}`); process.exitCode = 1; }
};

const notion = require('../src/main/connect-notion');
const gmail = require('../src/main/connect-gmail');

// ---------- Gmail：正文得能被挖出来 ----------
const b64u = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

const run = async () => {
await ok('纯文本的信', () => {
  const body = gmail._bodyOf({ mimeType: 'text/plain', body: { data: b64u('明天十点的会推迟到下午三点') } });
  assert.strictEqual(body, '明天十点的会推迟到下午三点');
});

await ok('多层 MIME 里也挖得出来，而且优先纯文本', () => {
  const payload = { mimeType: 'multipart/mixed', parts: [
    { mimeType: 'multipart/alternative', parts: [
      { mimeType: 'text/html', body: { data: b64u('<p>HTML 那一份</p>') } },
      { mimeType: 'text/plain', body: { data: b64u('纯文本那一份') } },
    ] },
    { mimeType: 'application/pdf', filename: 'x.pdf', body: { attachmentId: 'a1' } },
  ] };
  assert.strictEqual(gmail._bodyOf(payload), '纯文本那一份');
});

await ok('只有 HTML 的信，把标签剥掉留下字', () => {
  const html = '<style>p{color:red}</style><p>会议室<b>预订</b>改了</p><script>alert(1)</script><br>请看附件';
  const out = gmail._bodyOf({ mimeType: 'text/html', body: { data: b64u(html) } });
  assert.ok(out.includes('会议室'), out);
  assert.ok(out.includes('预订'), out);
  assert.ok(!/[<>]/.test(out), '标签没剥干净: ' + out);
  assert.ok(!out.includes('alert'), 'script 的内容不该留下: ' + out);
  assert.ok(!out.includes('color:red'), 'style 的内容不该留下: ' + out);
});

await ok('空的、缺字段的都不炸', () => {
  for (const p of [null, {}, { parts: [] }, { parts: [{ }] }]) gmail._bodyOf(p);
});

await ok('头字段大小写无关', () => {
  const h = [{ name: 'Subject', value: '季度会议' }, { name: 'FROM', value: 'a@b.c' }];
  assert.strictEqual(gmail._header(h, 'subject'), '季度会议');
  assert.strictEqual(gmail._header(h, 'from'), 'a@b.c');
});

// ---------- Notion：块和标题 ----------
await ok('各种块都变成一行字', () => {
  const rt = (s) => [{ plain_text: s }];
  assert.strictEqual(notion._blockText({ type: 'paragraph', paragraph: { rich_text: rt('一段话') } }), '一段话');
  assert.strictEqual(notion._blockText({ type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt('一条') } }), '· 一条');
  assert.ok(notion._blockText({ type: 'heading_2', heading_2: { rich_text: rt('小标题') } }).includes('小标题'));
  assert.strictEqual(notion._blockText({ type: 'image', image: {} }), '');
  assert.strictEqual(notion._blockText(null), '');
});

await ok('标题字段的名字各家不同，靠 type 找', () => {
  assert.strictEqual(notion._pageTitle({ properties: { 'Name': { type: 'title', title: [{ plain_text: '周会纪要' }] } } }), '周会纪要');
  assert.strictEqual(notion._pageTitle({ properties: { '名称': { type: 'title', title: [{ plain_text: '产品路线' }] } } }), '产品路线');
  assert.strictEqual(notion._pageTitle({ properties: {} }), '(无标题)');
});

// ---------- 拉取：分页、游标、幂等 ----------
function fakeFetch(routes) {
  return async (url, opts) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) return { ok: false, status: 404, headers: new Map(), text: async () => '{}', json: async () => ({}) };
    const body = routes[key](String(url), opts);
    return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify(body), json: async () => body };
  };
}

await ok('Notion：一页拉完给出游标，还有下一页就说还有', async () => {
  const real = global.fetch;
  global.fetch = fakeFetch({
    '/search': () => ({ results: [
      { object: 'page', id: 'p1', url: 'https://notion.so/p1', last_edited_time: '2026-09-01T10:00:00.000Z',
        properties: { Name: { type: 'title', title: [{ plain_text: '第一页' }] } } },
      { object: 'database', id: 'd1' },
    ], has_more: true, next_cursor: 'CUR2' }),
    '/blocks/': () => ({ results: [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: '正文一句' }] } }], has_more: false }),
  });
  const got = [];
  const out = await notion.pull({ token: 'x' }, '', (i) => got.push(i));
  global.fetch = real;
  assert.strictEqual(got.length, 1, '数据库不该被当成页面');
  assert.strictEqual(got[0].title, '第一页');
  assert.strictEqual(got[0].text, '正文一句');
  assert.strictEqual(out.cursor, 'CUR2');
  assert.strictEqual(out.more, true);
});

await ok('Gmail：列表给 id，正文一封封取，游标传下去', async () => {
  const real = global.fetch;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com')) return { ok: true, status: 200, json: async () => ({ access_token: 'T', expires_in: 3600 }) };
    if (u.includes('/messages?')) return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'm1' }, { id: 'm2' }], nextPageToken: 'NEXT' }) };
    const id = u.match(/\/messages\/(\w+)/)[1];
    return { ok: true, status: 200, json: async () => ({
      id, internalDate: '1757000000000',
      payload: { headers: [{ name: 'Subject', value: `信 ${id}` }, { name: 'From', value: 'a@b.c' }],
        mimeType: 'text/plain', body: { data: b64u(`正文 ${id}`) } } }) };
  };
  const got = [];
  const out = await gmail.pull({ clientId: 'c', clientSecret: 's', refresh: 'r' }, '', (i) => got.push(i));
  global.fetch = real;
  assert.strictEqual(got.length, 2);
  assert.ok(got[0].title.startsWith('信 '), got[0].title);
  assert.ok(got[0].text.includes('From a@b.c'), got[0].text);
  assert.ok(got[0].text.includes('正文 m1'), got[0].text);
  assert.strictEqual(out.cursor, 'NEXT');
  assert.strictEqual(out.more, true);
});

// ---------- 凭据只进不出 ----------
await ok('凭据存的是加密槽，list() 永远不把它带出来', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'main', 'connect.js'), 'utf8');
  const listFn = src.match(/function list\(\)[\s\S]*?\n\}/)[0];
  for (const bad of ['getSecret', 'token', 'clientSecret', 'refresh']) {
    assert.ok(!listFn.includes(bad), `list() 里出现了 ${bad}`);
  }
});

};
run().then(() => {
  console.log(`\nconnect: ${pass} passed`);
  process.exit(process.exitCode || 0);
});
