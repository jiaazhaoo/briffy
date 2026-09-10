'use strict';
// 扩展从页面里抓什么：全文，**连评论一起**，外加这一页的图和视频。
//
//   node dev/extract-test.js
//
// 这一组守的是 2026-09-10 那次的账。用户说「我打开 inspect，所有文本内容已经都在了」，
// 而收藏下来只有正文。量出来（一条 1723 条评论的 Hacker News 帖子，整页 498,483 字）：
//
//     旧版抓到    104 字   （0%）
//     新版抓到 456,827 字   （92%，剩下的是 reply / parent 那些页面家具链接）
//
// **坏在两个地方，只修一个毫无变化。** `SKIP`（挑正文容器时按名字排掉的）和 `JUNK_SEL`
// （读文本时按选择器跳过的）里各写着一次 comment。先只拆了 SKIP，重测还是 104——
// 因为 HN 的评论树是 `table.comment-tree`，它在 JUNK_SEL 那儿被整棵跳过。
// 所以这个台子盯的是**两处都不许再出现**，而不是其中一处。
//
// 端到端那一半要真的 DOM，node 里跑不了。复跑的办法记在这儿：
//   curl -sL 'https://news.ycombinator.com/item?id=<id>' -o /tmp/hn.html
//   把 extension/extract.js 里的 window.BriffyExtract 改名成两份（old/new），
//   一个小页面 <iframe src=hn.html> 同源加载，两份都跑一遍比长度。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const EXT = path.join(__dirname, '..', 'extension');
const extract = fs.readFileSync(path.join(EXT, 'extract.js'), 'utf8');
const background = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
const bookmark = fs.readFileSync(path.join(EXT, 'bookmark.js'), 'utf8');
const popupHtml = fs.readFileSync(path.join(EXT, 'popup.html'), 'utf8');

let pass = 0;
const ok = (name, fn) => {
  try { fn(); pass++; } catch (e) { console.log(`  FAIL ${name} — ${e.message}`); process.exitCode = 1; }
};

// ---------- 两处黑名单 ----------
const skipLine = (extract.match(/^\s*const SKIP = .*$/m) || [''])[0];
const junkBlock = (extract.match(/const JUNK_SEL = \[[\s\S]*?\]\.join/) || [''])[0];

ok('SKIP 里没有 comment', () => assert.ok(skipLine && !/\bcomment\b/.test(skipLine), skipLine));
ok('JUNK_SEL 里没有 comment', () => {
  const code = junkBlock.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(code && !/comment/i.test(code), '评论区又被当成页面家具跳过了');
});
ok('两处都还在（别把整条规则删了）', () => {
  assert.ok(/advert/.test(skipLine), 'SKIP 该还留着广告那些');
  assert.ok(/newsletter/.test(junkBlock), 'JUNK_SEL 该还留着订阅条那些');
});

// ---------- 上限 ----------
ok('一页的上限够装下一场讨论', () => {
  const m = extract.match(/const MAX_TEXT = (\d+)/);
  assert.ok(m, '找不到 MAX_TEXT');
  assert.ok(Number(m[1]) >= 400000, `MAX_TEXT 是 ${m[1]}，装不下量过的那 456,827 字`);
});
ok('到顶了要说出来，不能默默截断', () => assert.ok(/truncated/.test(extract), 'extract() 该带 truncated 回去'));

// ---------- 正文之外还要收评论 ----------
ok('有一段专门去收评论区', () => assert.ok(/function commentBlocks/.test(extract)));
ok('正文和评论是相加不是二选一', () => assert.ok(/commentBlocks\(doc, win, el\)/.test(extract)
  && /commentBlocks\(doc, win, best\.el\)/.test(extract), '两条分支都要接上评论'));
ok('收最外层那一个，不然同一段字收几十遍', () => assert.ok(/found\.some\(\(f\) => f\.contains\(el\)\)/.test(extract)));

// ---------- 收藏时把媒体一起带走 ----------
ok('收藏这条路会去收媒体', () => {
  const h = (background.match(/if \(msg\.type === 'bookmarked'\)[\s\S]*?\n    \}/) || [''])[0];
  assert.ok(/collect\(tabId/.test(h), '收藏时没有去 collect 媒体');
  assert.ok(/sendItems\(/.test(h), '收到了也没送出去');
  assert.ok(/downloadVideos: true/.test(h), '视频要送文件，不是只送地址');
});
ok('不打断正在跑的传输', () => {
  const h = (background.match(/if \(msg\.type === 'bookmarked'\)[\s\S]*?\n    \}/) || [''])[0];
  assert.ok(/job\.done < job\.total/.test(h), '该先看一眼有没有传输在跑');
});
ok('面板里那个「同时下载视频」默认勾上', () => assert.ok(/id="downloadVideos"[^>]*\bchecked\b/.test(popupHtml)));

// ---------- 没有回退 ----------
ok('收藏仍然只调一次 extract', () => assert.strictEqual((bookmark.match(/BriffyExtract\.extract\(/g) || []).length, 1));

console.log(`extract: ${pass} passed`);
