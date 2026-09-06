'use strict';
// 把模型写回来的 markdown 变成纸上的字。
//
//   node dev/md-test.js
//
// 这个函数以前不存在。turnHtml 一直在调它，于是只要有回答送到就抛 ReferenceError，「问」那一页
// 永远停在「正在翻记录…」——那就是「没有 AI 聊天页面」的真相。
//
// 它同时是一道安全边界：内容是模型写的，而模型会照抄用户记录里的东西。**先转义再解析**，
// 所以这里第一组检查是「标签进不来」，不是「格式好不好看」。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 从 workspace.js 里把 md() 和它依赖的 esc() 取出来跑，免得测试和实现各写一份
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'workspace', 'workspace.js'), 'utf8');
const escSrc = src.match(/const esc = \(s\) => [^\n]+/)[0];
const mdSrc = src.match(/ {2}function md\(src\) \{[\s\S]*?\n {2}\}/)[0];
// eslint-disable-next-line no-new-func
const md = new Function(`${escSrc};\n${mdSrc};\nreturn md;`)();

let pass = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; } };

// ---------- 先是安全 ----------
ok('标签进不来', () => {
  const out = md('<script>alert(1)</script>');
  assert.ok(!out.includes('<script'), out);
  assert.ok(out.includes('&lt;script&gt;'), out);
});

ok('属性里的引号也逃不掉', () => {
  const out = md('看这个 <img src=x onerror="alert(1)">');
  assert.ok(!/<img/i.test(out), out);
});

ok('只认 http(s) 链接，javascript: 不认', () => {
  assert.ok(md('[点我](https://example.com)').includes('href="https://example.com"'));
  const bad = md('[点我](javascript:alert(1))');
  assert.ok(!bad.includes('href'), bad);
  assert.ok(bad.includes('[点我]'), '不认的链接应该原样留着，而不是被吞掉');
});

ok('代码块里的东西一律照抄，不当标签', () => {
  const out = md('```\n<b>不该加粗</b>\n```');
  assert.ok(out.includes('<pre><code>'), out);
  assert.ok(out.includes('&lt;b&gt;'), out);
});

// ---------- 再是格式 ----------
ok('空行分段，段内换行是 <br>', () => {
  const out = md('第一段第一行\n第一段第二行\n\n第二段');
  assert.strictEqual((out.match(/<p>/g) || []).length, 2, out);
  assert.ok(out.includes('<br>'), out);
});

ok('加粗认得，斜体不认——纸面标准里没有斜体', () => {
  assert.ok(md('这是 **重点**').includes('<b>重点</b>'));
  const it = md('这是 *斜的* 字');
  assert.ok(!it.includes('<i>') && !it.includes('<em>'), it);
});

ok('两种列表', () => {
  assert.ok(md('- 甲\n- 乙').includes('<ul><li>甲</li><li>乙</li></ul>'), md('- 甲\n- 乙'));
  assert.ok(md('1. 甲\n2. 乙').includes('<ol><li>甲</li><li>乙</li></ol>'), md('1. 甲\n2. 乙'));
});

ok('列表换一种就重开一个，不会混在一起', () => {
  const out = md('- 甲\n1. 乙');
  assert.ok(out.includes('</ul>') && out.includes('<ol>'), out);
});

ok('行内代码', () => {
  assert.ok(md('跑 `npm start` 就行').includes('<code>npm start</code>'));
});

ok('标题变成一行加重的话，不另起字号', () => {
  const out = md('## 小标题');
  assert.ok(out.includes('class="mdh"'), out);
  assert.ok(!/<h[1-6]/.test(out), out);
});

ok('没闭合的代码块也要收尾，不能把剩下的全吃掉', () => {
  const out = md('前面一段\n\n```\n没关');
  assert.ok(out.includes('<p>'), out);
  assert.ok(out.includes('<pre><code>没关</code></pre>'), out);
});

ok('空的、乱的都不炸', () => {
  for (const v of ['', null, undefined, '\n\n\n', '```', '- ']) md(v);
});

// ---------- 引用编号要活下来 ----------
ok('[1] 这种编号原样留着，交给 withCitations 去变成可点的号码', () => {
  const out = md('你把页脚收成了一行 [1]，图标也换了 [4]。');
  assert.ok(out.includes('[1]') && out.includes('[4]'), out);
});

console.log(`md: ${pass} checks passed`);
