'use strict';
// 把导出的整包拖进来：Notion 的 zip、Gmail Takeout 的 mbox、或一个文件夹。
//
//   node dev/import-test.js
//
// 这条路存在是因为授权太贵：Gmail 的受限权限要过 CASA 审计，Notion 的公开集成必须带 client secret。
// 导出文件一样也不需要——所以它必须真的能把那两家导出来的东西读明白，不能只是「大致能跑」。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bulk = require('../src/main/import-bulk');

let pass = 0;
const ok = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { console.log(`  FAIL ${name} — ${e.message}`); process.exitCode = 1; }
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-imp-'));
const write = (rel, body) => {
  const f = path.join(TMP, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
  return f;
};

const run = async () => {

await ok('mbox 按行首的 From 分信，正文里的 >From 不算', async () => {
  const mbox = write('a.mbox', [
    'From bob@x.com Mon Sep  1 10:00:00 2026',
    'From: Bob <bob@x.com>',
    'To: me@y.com',
    'Subject: 季度会议',
    'Date: Mon, 1 Sep 2026 10:00:00 +0100',
    '',
    '会议改到下午三点。',
    '>From 这行在正文里，不该被当成新的一封',
    '',
    'From ann@x.com Tue Sep  2 09:00:00 2026',
    'From: Ann <ann@x.com>',
    'Subject: 第二封',
    '',
    '正文二',
    '',
  ].join('\n'));
  const got = [];
  const out = await bulk.read(mbox, (i) => got.push(i));
  assert.strictEqual(out.count, 2, `分出了 ${out.count} 封`);
  assert.strictEqual(got[0].title, '季度会议');
  assert.ok(got[0].text.includes('会议改到下午三点'), got[0].text);
  assert.ok(got[0].text.includes('>From 这行'), '正文被切断了');
  assert.ok(got[0].text.startsWith('From Bob'), got[0].text.slice(0, 40));
  assert.strictEqual(got[1].title, '第二封');
});

await ok('折行的头要接回去', () => {
  const m = bulk.parseMessage('Subject: 这是一个很长的\n\t主题被折了行\nFrom: a@b.c\n\n正文');
  assert.strictEqual(m.subject, '这是一个很长的 主题被折了行');
});

await ok('=?utf-8?B?...?= 编码的中文主题', () => {
  const enc = Buffer.from('季度预算与路线图', 'utf8').toString('base64');
  assert.strictEqual(bulk.decodeHeader(`=?utf-8?B?${enc}?=`), '季度预算与路线图');
  assert.strictEqual(bulk.decodeHeader('=?utf-8?Q?hello=20world?='), 'hello world');
  assert.strictEqual(bulk.decodeHeader('普通主题'), '普通主题');
});

await ok('base64 和 quoted-printable 的正文都要解开', () => {
  const b = Buffer.from('这是正文', 'utf8').toString('base64');
  assert.strictEqual(bulk.parseMessage(`Content-Transfer-Encoding: base64\n\n${b}`).body, '这是正文');
  assert.strictEqual(bulk.parseMessage('Content-Transfer-Encoding: quoted-printable\n\nhello=20world').body, 'hello world');
});

await ok('只有 HTML 的信，剥成能搜的字', () => {
  const m = bulk.parseMessage('Content-Type: text/html\n\n<style>p{}</style><p>会议室<b>预订</b></p><script>x</script>');
  assert.ok(m.body.includes('会议室'), m.body);
  assert.ok(!/[<>]/.test(m.body), m.body);
  assert.ok(!m.body.includes('script'), m.body);
});

await ok('Notion 导出的文件夹：走进子目录，文件名末尾那串 id 去掉', async () => {
  write('export/产品路线图 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d.md', '# 路线图\n\n第三季度要做的事');
  write('export/子页面/会议纪要 0011223344556677889900aabbccddee.md', '纪要内容');
  write('export/图片.png', 'PNG');                       // 非文本，不收
  write('export/__MACOSX/垃圾.md', 'x');                  // 解压残留，跳过
  const got = [];
  const out = await bulk.read(path.join(TMP, 'export'), (i) => got.push(i));
  assert.strictEqual(out.count, 2, `收了 ${out.count} 个：${got.map((g) => g.title)}`);
  const titles = got.map((g) => g.title).sort();
  assert.deepStrictEqual(titles, ['产品路线图', '会议纪要'], JSON.stringify(titles));
  assert.ok(got.every((g) => g.origin === 'notion'));
});

await ok('zip 解开再收，临时目录会清掉', async () => {
  const { execFileSync } = require('child_process');
  const zdir = path.join(TMP, 'zsrc');
  fs.mkdirSync(zdir, { recursive: true });
  fs.writeFileSync(path.join(zdir, '一篇笔记 aabbccddeeff00112233445566778899.md'), '笔记正文');
  const zip = path.join(TMP, 'notion.zip');
  execFileSync('/usr/bin/zip', ['-q', '-r', zip, '.'], { cwd: zdir });
  const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('briffy-import-')).length;
  const got = [];
  const out = await bulk.read(zip, (i) => got.push(i));
  assert.strictEqual(out.kind, 'zip');
  assert.strictEqual(out.count, 1, `收了 ${out.count}`);
  assert.strictEqual(got[0].title, '一篇笔记');
  const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('briffy-import-')).length;
  assert.strictEqual(after, before, '解压用的临时目录没清掉');
});

await ok('每条都带 id，重复导入才认得出是同一个', async () => {
  const got = [];
  await bulk.read(path.join(TMP, 'a.mbox'), (i) => got.push(i));
  assert.ok(got.every((g) => g.id), '有条目没有 id');
  const again = [];
  await bulk.read(path.join(TMP, 'a.mbox'), (i) => again.push(i));
  assert.deepStrictEqual(got.map((g) => g.id), again.map((g) => g.id), '两次导入的 id 对不上');
});

await ok('空的、坏的都不炸', async () => {
  const empty = write('empty.mbox', '');
  assert.strictEqual((await bulk.read(empty, () => {})).count, 0);
  const junk = write('junk.mbox', '这不是邮件\n随便写的');
  await bulk.read(junk, () => {});
});

// sniff 决定「拖进来的这个东西要不要拆开」。猜错的代价不对称：把导出当文件，用户少一次方便；
// 把用户想原样留的 zip 拆开，他丢的是他要的东西。所以这几条是保守方向的护栏。
await ok('文件夹和 mbox 认得出是整包', async () => {
  write('sn/一页.md', '# 一页\n内容');
  assert.strictEqual(await bulk.sniff(path.join(TMP, 'sn')), 'folder');
  write('sn.mbox', 'From a@b Thu Jan  1 00:00:00 2026\nSubject: x\n\n正文');
  assert.strictEqual(await bulk.sniff(path.join(TMP, 'sn.mbox')), 'mbox');
});

await ok('一堆文本的 zip 算导出，别的 zip 原样存', async () => {
  const { execFileSync } = require('child_process');
  const docs = path.join(TMP, 'zsrc');
  for (const n of ['a.md', 'b.md', 'c.md']) write(path.join('zsrc', n), '# ' + n);
  execFileSync('/usr/bin/zip', ['-q', '-r', path.join(TMP, 'notion.zip'), '.'], { cwd: docs });
  assert.strictEqual(await bulk.sniff(path.join(TMP, 'notion.zip')), 'zip');

  const blobs = path.join(TMP, 'bsrc');
  for (const n of ['a.png', 'b.png', 'c.png']) write(path.join('bsrc', n), 'PNG');
  execFileSync('/usr/bin/zip', ['-q', '-r', path.join(TMP, 'shots.zip'), '.'], { cwd: blobs });
  assert.strictEqual(await bulk.sniff(path.join(TMP, 'shots.zip')), '', '图片包被当成导出拆开了');
});

await ok('普通文件和不存在的路径都不算整包', async () => {
  assert.strictEqual(await bulk.sniff(write('一份.pdf', '%PDF-1.4')), '');
  assert.strictEqual(await bulk.sniff(path.join(TMP, '没有这个')), '');
});

// 到这里为止测的都是「读得对不对」。下面这条测的是「入库对不对」——importFiles 走的是和
// Notion / Gmail 同步同一个 fileOne，所以那句「同一份导出选两次不会变成两份」必须在真的
// 入库路径上成立，而不只是 read() 每次给出一样的 id。
await ok('同一份导出收两次不会变成两份，改了的会更新', async () => {
  const connect = require('../src/main/connect');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-ws-'));
  const rows = new Map();
  let n = 0;
  connect.init({ store: {
    workspaceDir: home,
    getSettings: () => ({}),
    updateSettings: () => {},
    getEntry: (id) => rows.get(id) || null,
    addEntry: (f) => { const e = { id: `e${++n}`, ...f }; rows.set(e.id, e); return e; },
    updateEntry: (id, patch) => { Object.assign(rows.get(id), patch); },
  } });

  const dir = path.join(TMP, 'notion-export');
  write('notion-export/会议纪要 0123456789abcdef0123456789abcdef.md', '# 会议纪要\n下周一确认预算');
  write('notion-export/子目录/另一页.md', '另一页的内容');

  const first = await connect.importFiles([dir]);
  assert.strictEqual(first.added, 2, `第一次该收 2 条，实际 ${first.added}`);
  assert.strictEqual(rows.size, 2);
  const titles = [...rows.values()].map((r) => r.title);
  assert.ok(titles.includes('会议纪要'), '文件名末尾那串 id 没去掉: ' + titles.join(','));

  const second = await connect.importFiles([dir]);
  assert.strictEqual(second.added, 0, '第二次又添了新条目');
  assert.strictEqual(rows.size, 2, `重复导入变成了 ${rows.size} 条`);

  // 原件改了，应该是同一条被更新，不是又添一条
  write('notion-export/会议纪要 0123456789abcdef0123456789abcdef.md', '# 会议纪要\n预算改成下周三确认');
  await connect.importFiles([dir]);
  assert.strictEqual(rows.size, 2, '改过的页面又添了一条');
  const hit = [...rows.values()].find((r) => r.title === '会议纪要');
  assert.ok(hit.text.includes('下周三'), '内容没更新: ' + hit.text);

  assert.ok(fs.existsSync(path.join(home, 'remote.json')), '认得出重复靠的那张表没落盘');
  fs.rmSync(home, { recursive: true, force: true });
});

};

run().then(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* 留着也行 */ }
  console.log(`\nimport: ${pass} passed`);
  process.exit(process.exitCode || 0);
});
