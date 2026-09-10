'use strict';
// 换工作区文件夹的时候，**把东西真的搬过去**。
//
// 2026-09-10 之前不是这样：设置里「选择…」只是把 settings.workspaceDir 指向新文件夹，
// 清空内存、建好空目录、重新加载——于是你看到一个**空的工作区**，而全部记录原封不动留在
// `~/Library/Application Support/briffy/workspace` 里。
//
// 这不只是「没搬」，是**会真的丢**：那个目录是各种卸载工具（AppCleaner、CleanMyMac）
// 专门扫的地方，而且整个 briffy 目录接近 800 MB（模型占了九成），在它们的界面上就是
// 一条写着「残留文件 799 MB」的垃圾。你会以为记录已经搬到自己看得见的地方了。
// 「我们不能丢弃任何数据」这条规矩，指的就是这种时候。
//
// 三条铁律：
//   1. **只复制，不移动。** 原来那份一个字节不动，也永远不删——删是用户自己的事，
//      而且他得先亲眼看见新的那份是好的。
//   2. **复制完要点数。** 文件个数和总字节都对得上才算成功；对不上就报出来，设置不改。
//   3. **目标非空就不干。** 往一个已经有东西的文件夹里倒，合并规则说不清楚，宁可拒绝。
//
// 纯 fs，node 直接跑得起来（见 dev/workspace-move-test.js）。
const fs = require('fs');
const path = require('path');

/** 这个目录里有多少东西。@returns {{files:number, bytes:number}} */
function survey(dir) {
  let files = 0; let bytes = 0;
  const walk = (d) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.isFile()) continue;                 // 软链接不算，也不跟着走
      files += 1;
      try { bytes += fs.statSync(p).size; } catch (_) { /* 刚被删掉 */ }
    }
  };
  walk(dir);
  return { files, bytes };
}

/** a 是不是在 b 底下（或者就是 b）。搬家最怕这个：往自己肚子里搬。 */
function inside(a, b) {
  const x = path.resolve(a) + path.sep;
  const y = path.resolve(b) + path.sep;
  return x === y || x.startsWith(y);
}

/**
 * 这个目标能不能接。
 * @returns {{ok:boolean, why:string}} why 是给人看的原因（i18n 键在 main.js 那边）
 */
function canReceive(src, dest) {
  if (!dest) return { ok: false, why: 'empty' };
  if (inside(dest, src)) return { ok: false, why: 'nested' };    // 新的在旧的里面
  if (inside(src, dest)) return { ok: false, why: 'nested' };    // 旧的在新的里面
  const there = survey(dest);
  if (there.files > 0) return { ok: false, why: 'notEmpty' };
  return { ok: true, why: '' };
}

/**
 * 复制过去，然后点数。**原来那份不动。**
 * @returns {{ok:boolean, files:number, bytes:number, want:{files:number,bytes:number}, error:string}}
 */
function copyInto(src, dest) {
  const want = survey(src);
  try {
    fs.mkdirSync(dest, { recursive: true });
    // dereference: false —— 软链接照原样，不把它指向的东西拷成实体
    fs.cpSync(src, dest, { recursive: true, force: true, errorOnExist: false, dereference: false });
  } catch (err) {
    return { ok: false, files: 0, bytes: 0, want, error: String(err && err.message) };
  }
  const got = survey(dest);
  // 点数：个数和总字节都得对上。对不上**不改设置**，让用户还留在原来那份上。
  const ok = got.files === want.files && got.bytes === want.bytes;
  return { ok, files: got.files, bytes: got.bytes, want, error: ok ? '' : 'mismatch' };
}

module.exports = { survey, canReceive, copyInto, inside };
