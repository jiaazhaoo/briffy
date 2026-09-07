'use strict';
// 剥网页家具。
//
//   node dev/boilerplate-test.js
//
// 这一组一半在盯「剥掉」，一半在盯「别剥过头」——后者才是危险的那一半，因为它不吭声：
// 正文还在，只是内容没了，而向量、主题、证据词照跑不误，只是全错。
// 真实工作区上抓到过两条（一条 26 字的记录被剥成 0，一条报名页 2092 → 167），都钉在这儿。
const assert = require('assert');
const bp = require('../src/main/boilerplate');

let pass = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { console.log(`  FAIL ${name} — ${e.message}`); process.exitCode = 1; }
};

// JustPark 那一页的形状：十四行菜单，然后才是你真正要的东西
const NAV = ['Find parking', 'How it works', 'Rent out your space', 'Airports', 'Company',
  'Help', 'Jia Z', 'Bookings made', 'Messages', 'Transactions', 'Payment Methods',
  'My profile', 'Communication preferences', 'Log out'];
const BODY = ['Where is it?',
  '3 Buckingham Court Kingston Road Staines-upon-Thames TW184JG',
  'The parking spot is labelled with the number 3 (there are two spots you can use).',
  'If something happens to your car whilst parked, we will refund 100% of the excess.'];
const PAGE = [...NAV, ...BODY, ...new Array(8).fill('').map((_, i) => `filler line number ${i} with enough words to be prose here.`)].join('\n');

ok('成串的短行是菜单，剥掉', () => {
  const out = bp.strip(PAGE, new Set());
  assert.ok(!out.includes('Payment Methods'), '菜单该没了');
  assert.ok(!out.includes('Rent out your space'), '菜单该没了');
});

ok('菜单底下的内容一个字不动', () => {
  const out = bp.strip(PAGE, new Set());
  assert.ok(out.includes('Staines-upon-Thames TW184JG'), '地址是内容');
  assert.ok(out.includes('labelled with the number 3'), '说明是内容');
});

ok('一行短的自己站着，不是菜单——地址就是这种', () => {
  const addr = 'Windsor Road, Egham TW20 0AE';
  assert.strictEqual(bp.strip(addr, new Set()), addr);
});

ok('短记录整条都是内容，一律不动', () => {
  const t = ['买菜', '取快递', '交房租', '还书', '洗车', '剪头发'].join('\n');
  assert.strictEqual(bp.strip(t, new Set()), t, '六行短的，但整条就这么长');
});

ok('剥完不许是空的 —— 26 字那条真的被剥成过 0', () => {
  const t = '1st Half Challenge (~50km)';
  const fur = new Set([bp.key(t)]);              // 它同时被当成了「跨记录重复」
  assert.strictEqual(bp.strip(t, fur), t, '整条就是内容，不能因为别处也有就剥光');
});

ok('剥掉一大半就作废，退回原文 —— 报名页真的被剥成过 8%', () => {
  const page = new Array(30).fill(0).map((_, i) => `Option ${i}`).join('\n');
  const out = bp.strip(page, new Set());
  assert.strictEqual(out, page.trim(), '整页都是短选项，那就整页都是内容');
});

ok('跨记录重复的行是家具（语言选择条那种）', () => {
  const texts = [
    'English (Great Britain)\n真正的内容甲，这一句足够长，长到不会被当成菜单项处理。',
    'English (Great Britain)\n真正的内容乙，这一句足够长，长到不会被当成菜单项处理。',
    'English (Great Britain)\n真正的内容丙，这一句足够长，长到不会被当成菜单项处理。',
  ];
  const fur = bp.learn(texts);
  assert.ok(fur.has(bp.key('English (Great Britain)')), '三条里都有，是家具');
  assert.ok(!bp.strip(texts[0], fur).includes('English'), '该剥掉');
  assert.ok(bp.strip(texts[0], fur).includes('内容甲'), '内容要留着');
});

ok('一个字符、纯数字的行不算家具——剥了它什么也没解决，还会连坐内容里的数字', () => {
  const texts = ['1\n甲的正文，这一句写得足够长，不会被当成菜单。', '1\n乙的正文，这一句写得足够长，不会被当成菜单。', '1\n丙的正文，这一句写得足够长，不会被当成菜单。'];
  assert.ok(!bp.learn(texts).has('1'));
});

ok('同一条里重复很多遍的行，不用别人作证也是家具', () => {
  const lines = [];
  for (let i = 0; i < 8; i++) { lines.push(`这是第 ${i} 段真正的内容，写得够长，不会被当成菜单项。`); lines.push('Share'); }
  for (let i = 0; i < 8; i++) lines.push(`补充第 ${i} 段，同样写得够长，不会被当成菜单项。`);
  const out = bp.strip(lines.join('\n'), new Set());
  assert.ok(!out.includes('Share'), '一页上八个 Share，第一个还有点意思，第八个没有');
  assert.ok(out.includes('第 3 段真正的内容'), '内容不许动');
});

ok('原件从头到尾没被碰过', () => {
  const e = { title: 't', text: PAGE };
  const before = e.text;
  bp.textOf(e, bp.learn([PAGE]));
  assert.strictEqual(e.text, before, '**存下来的东西一个字都不能改**');
});

ok('空的、没有的，都不炸', () => {
  assert.strictEqual(bp.strip('', new Set()), '');
  assert.strictEqual(bp.strip(null, null), '');
  assert.strictEqual(bp.textOf(null, null), '');
  assert.strictEqual(bp.learn(null).size, 0);
});

console.log(`\nboilerplate: ${pass} passed`);
process.exit(process.exitCode || 0);
