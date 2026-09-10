'use strict';
// 桌面上那枚回形针（和它的书架）待在哪个桌面上。
//
//   node dev/pet-window-test.js
//
// 守的是 2026-09-10 那次：用户问「悬浮形象为啥会出现在全屏下」。代码里本来写着不要，
// 靠的是 `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })`，
// 而那句注释（「macOS 上全屏应用有自己的 Space，这个 flag 就够了」）是错的——
// 前半句设的是 `canJoinAllSpaces`，全屏应用的 Space 也是一个 Space，于是它被一起带过去；
// `visibleOnFullScreen: false` 只是不加 `fullScreenAuxiliary`，取消不掉前者。
//
// 当天量过的另外两条兜底，都不成立（记在 windows.js 那段注释里）：
//   · workArea >= bounds：真全屏时 1059 → 1122，而 bounds 1152，仍然是 false
//   · 按窗口几何认：全屏那扇窗在另一个 Space，窗口列表里根本看不见
//
// 用户选的是「不跟着换桌面」：零开销，代价是换个桌面小猫就不在了。
// 这个台子只看源码——窗口行为要真的开起来才看得见，那一步得人来。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'windows.js'), 'utf8');
const viewer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'viewer.js'), 'utf8');

let pass = 0;
const ok = (name, fn) => {
  try { fn(); pass++; } catch (e) { console.log(`  FAIL ${name} — ${e.message}`); process.exitCode = 1; }
};

const calls = [...src.matchAll(/(\w+)\.setVisibleOnAllWorkspaces\(([^)]*)\)/g)].map((m) => ({ win: m[1], args: m[2] }));

ok('小猫和书架都不跟着换桌面', () => {
  assert.strictEqual(calls.length, 2, `windows.js 里该只有两处，实际 ${calls.length}`);
  for (const c of calls) {
    assert.ok(/^false$/.test(c.args.trim()),
      `${c.win} 传的是 ${c.args} —— 只要是 true 就带上了 canJoinAllSpaces，全屏应用的 Space 也会被带进去`);
  }
  assert.deepStrictEqual(calls.map((c) => c.win).sort(), ['petWin', 'shelfWin']);
});

ok('书架不能和小猫分家', () => {
  const pet = calls.find((c) => c.win === 'petWin');
  const shelf = calls.find((c) => c.win === 'shelfWin');
  assert.strictEqual(pet.args.trim(), shelf.args.trim(), '面板和它的主人必须在同一个桌面上');
});

ok('轮询仍然留给 Windows / Linux', () => {
  assert.ok(/function watchFullscreen/.test(src), 'watchFullscreen 不该被删——那两个平台没有 Space');
  assert.ok(/platform === 'darwin'\) return/.test(src), 'macOS 该继续跳过它（判据在那儿永远是 false）');
});

// 看图窗的图钉是**故意**要压住全屏的：钉一张图就是要它一直在最上面。别把这条一起改了。
ok('看图窗的图钉不受影响', () => {
  assert.ok(/visibleOnFullScreen: true/.test(viewer), '图钉要的就是压住全屏');
  assert.ok(/'screen-saver'/.test(viewer), '普通的 floating 压不住全屏应用');
});

console.log(`pet-window: ${pass} passed`);
