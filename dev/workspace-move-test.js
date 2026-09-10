'use strict';
// 换工作区文件夹的时候东西真的搬过去了吗，以及**原来那份还在吗**。
//
//   node dev/workspace-move-test.js
//
// 这个台子守的是「我们不能丢弃任何数据」。2026-09-10 之前「选择…」只改设置不搬东西，
// 用户会看到一个空工作区，而记录留在卸载工具专门扫的那个目录里。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mv = require('../src/main/workspace-move');

let checks = 0;
const fail = [];
const eq = (got, want, what) => { checks++; if (got !== want) fail.push(`${what}：得到 ${got}，该是 ${want}`); };
const yes = (cond, what) => { checks++; if (!cond) fail.push(what); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-move-'));
const src = path.join(tmp, 'old');
const mk = (root, rel, body) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
};
mk(src, 'entries/2026-09-09.json', '[{"id":"a"}]');
mk(src, 'entries/2026-09-10.json', '[{"id":"b"},{"id":"c"}]');
mk(src, 'screenshots/2026-09-09/1.png', Buffer.alloc(2048, 7));
mk(src, 'thumbs/2026-09-09/a.jpg', Buffer.alloc(512, 3));
mk(src, 'speakers.json', '{}');

// 点数
const s = mv.survey(src);
eq(s.files, 5, '数出五个文件');
yes(s.bytes > 2500, '总字节算上了图片');
eq(mv.survey(path.join(tmp, '不存在')).files, 0, '不存在的目录数出 0，不抛');

// 拒绝：套娃
eq(mv.canReceive(src, path.join(src, 'sub')).why, 'nested', '新的在旧的里面 → 拒绝');
eq(mv.canReceive(path.join(tmp, 'old', 'x'), tmp).why, 'nested', '旧的在新的里面 → 拒绝');
eq(mv.canReceive(src, '').why, 'empty', '空路径 → 拒绝');

// 拒绝：目标非空
const busy = path.join(tmp, 'busy');
mk(busy, '别人的东西.txt', 'x');
eq(mv.canReceive(src, busy).why, 'notEmpty', '目标里已经有东西 → 拒绝');

// 目标是空的（或者压根不存在）→ 可以
const dest = path.join(tmp, 'new');
yes(mv.canReceive(src, dest).ok, '目标不存在 → 可以');
fs.mkdirSync(dest, { recursive: true });
yes(mv.canReceive(src, dest).ok, '目标是空目录 → 可以');

// 真的搬
const r = mv.copyInto(src, dest);
yes(r.ok, `复制该成功，实际 ${JSON.stringify(r)}`);
eq(r.files, 5, '新的那份也是五个文件');
eq(r.bytes, s.bytes, '总字节对得上');
eq(fs.readFileSync(path.join(dest, 'entries/2026-09-10.json'), 'utf8'), '[{"id":"b"},{"id":"c"}]', '内容一字不差');
yes(fs.existsSync(path.join(dest, 'screenshots/2026-09-09/1.png')), '子目录也过去了');

// **最要紧的一条：原来那份必须还在**
const after = mv.survey(src);
eq(after.files, 5, '搬完之后原来那份还是五个文件');
eq(after.bytes, s.bytes, '搬完之后原来那份一个字节没少');
yes(fs.existsSync(path.join(src, 'entries/2026-09-09.json')), '原件还在原地');

// 点数点不上的时候要报出来（伪造一次：复制完偷偷加一个文件）
const dest2 = path.join(tmp, 'new2');
mv.copyInto(src, dest2);
mk(dest2, '多出来的.txt', 'x');
const chk = mv.survey(dest2);
yes(chk.files === 6, '伪造成功');
yes(mv.copyInto(src, dest2).ok === false, '目标被动过 → 点数点不上，报失败');

fs.rmSync(tmp, { recursive: true, force: true });

for (const f of fail) console.log(`✗ ${f}`);
console.log(`workspace-move: ${checks} 项，没过的 ${fail.length} 个`);
assert.strictEqual(fail.length, 0, '换工作区文件夹这条路上有问题');
console.log('全对。');
