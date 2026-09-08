'use strict';
// briffy 认不认得出自己的倒影。
//
//   node dev/mirror-test.js
//
// 两个方向都要钉：该判的判出来，**不该判的一条都不许碰**。第二个方向更要紧——
// 第一版只数「撞上几条界面文案」，把 Ultra Challenge 那张报名页、「赛程分前后半程」
// （地址那个案子的关键证据）、Bishops Park、Ollama 地址全判成了倒影。
const assert = require('assert');
const mirror = require('../src/main/mirror');

let pass = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; } };

ok('读得到 briffy 自己的界面文案', () => {
  assert.ok(mirror.phrases().size > 100, `只读到 ${mirror.phrases().size} 条`);
});

ok('整条就是一句界面文案', () => {
  assert.strictEqual(mirror.isMirror('选择一条记录查看详情'), true);
});

ok('一屏界面文案 OCR 出来的截图', () => {
  assert.strictEqual(mirror.isMirror('搜索标题/文字/画面内容 全部日期 网格列表选择 记一句话'), true);
});

ok('一张网页碰巧含着一句 briffy 也说过的话，不算', () => {
  const page = 'Ultra Challenge UK’s #1 Trek & Trail Run Challenges for ALL Experience Levels. '
    + 'Walk, jog or run 10km, 25km, 50km or 100km along the Thames Path. 全部日期都可以报名，'
    + '起点 Bishops Park Fulham，终点 Runnymede Pleasure Ground, Egham, Surrey TW20 0AE。';
  assert.strictEqual(mirror.isMirror(page), false);
});

ok('设置页抄下来的 Ollama 地址要留着——里面写着你要的东西', () => {
  const note = 'Ollama 地址 http://127.0.0.1:11434 重新检测 本机: Apple M2 Max · 12 线程 · RAM 64 GB '
    + '推荐在这台电脑上用 qwen3.5:27b';
  assert.strictEqual(mirror.isMirror(note), false);
});

ok('单个拉丁词不当判据（Screenshot 既是界面标签也是普通词）', () => {
  assert.strictEqual(mirror.isMirror('ScreenshotOne'), false);
  assert.strictEqual(mirror.isMirror('Clipboard'), false);
});

ok('空正文不算倒影', () => {
  assert.strictEqual(mirror.isMirror(''), false);
  assert.strictEqual(mirror.isMirror('   '), false);
});

ok('只有数字和时间戳的，不靠这条闸挡（那是 ask.js 的 THIN 管的）', () => {
  assert.strictEqual(mirror.isMirror('12:00 9条 A it'), false);
});

ok('占位符不当字：`{n} 条记录` 拆开之后剩下的才算', () => {
  // 「条记录」只有三个汉字，够不到 MIN_CJK，不该单独把一条记录判成倒影
  assert.strictEqual(mirror.isMirror('这一批一共 3 条记录，明天再看'), false);
});

ok('缓存能丢掉', () => {
  const n = mirror.phrases().size;
  mirror.forget();
  assert.strictEqual(mirror.phrases().size, n);
});

console.log(`mirror: ${pass} passed`);
