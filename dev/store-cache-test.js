'use strict';
// 内存里的天缓存是缓存，不是存储。
//
//   npx electron dev/store-cache-test.js
//
// store.days 按日期缓存整天的记录，现在有了上限（MAX_DAYS_CACHED）。这个文件钉住的是那句承诺：
// **淘汰一条缓存，数据一个字节都不会少**——它只是下次要用时重新从天文件读一遍。
// 会丢数据的只有一种情况：把还没落盘的那一天淘汰掉。所以那一条单独钉。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-cache-'));
app.setPath('userData', TMP);

let pass = 0; let fail = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name} — ${e.message}`); }
};

app.whenReady().then(() => {
  const { Store } = require('../src/main/store');
  const store = new Store();
  store.init();

  const DAYS = 60;                       // 比上限多，逼它淘汰
  const written = new Map();
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(2026, 0, 1 + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const list = Array.from({ length: 5 }, (_, j) => ({
      id: `${key}-${j}`, createdAt: `${key}T0${j}:00:00.000Z`, dateKey: key, type: 'note',
      title: `第 ${i} 天第 ${j} 条`, text: `内容 ${i}-${j} 独一无二`, summary: '', tags: [], pinned: false,
    }));
    fs.mkdirSync(path.dirname(store.dayFile(key)), { recursive: true });
    fs.writeFileSync(store.dayFile(key), JSON.stringify(list));
    written.set(key, list);
  }

  // 全读一遍，缓存必然溢出
  for (const key of written.keys()) store.loadDay(key);

  ok('缓存确实有上限，不是无限长大', () => {
    assert.ok(store.days.size <= 40, `缓存里有 ${store.days.size} 天`);
    assert.ok(store.days.size < DAYS, '根本没淘汰');
  });

  ok('被淘汰的那些天，重新读回来一字不差', () => {
    let checked = 0;
    for (const [key, list] of written) {
      const back = store.loadDay(key);
      assert.deepStrictEqual(back, list, `${key} 读回来不一样`);
      checked++;
    }
    assert.strictEqual(checked, DAYS);
  });

  ok('磁盘上的天文件数量没变——淘汰不删文件', () => {
    const files = fs.readdirSync(path.dirname(store.dayFile('2026-01-01'))).filter((f) => f.endsWith('.json'));
    assert.strictEqual(files.length, DAYS, `${files.length} 个文件`);
  });

  ok('按 id 取一条早就被淘汰的记录，照样取得到', () => {
    // id -> 日期 那张表不淘汰，所以 getEntry 仍然知道该去读哪一天
    const oldest = [...written.keys()][0];
    const e = store.getEntry(`${oldest}-3`);
    assert.ok(e, '取不到');
    assert.strictEqual(e.title, written.get(oldest)[3].title);
  });

  ok('还没落盘的那一天，绝不淘汰', () => {
    const key = '2026-03-01';
    const list = [{ id: 'pending-1', createdAt: `${key}T09:00:00.000Z`, dateKey: key, type: 'note', title: '还没存', text: '', summary: '', tags: [] }];
    store.days.set(key, list);
    store.saveTimers.set(key, setTimeout(() => {}, 60000));   // 假装有一次写在排队
    for (const k of written.keys()) store.loadDay(k);         // 再把缓存挤爆
    assert.ok(store.days.has(key), '把还没存的那一天淘汰了，这就是丢数据');
    clearTimeout(store.saveTimers.get(key)); store.saveTimers.delete(key);
  });

  ok('最久没碰的先走，刚用过的留下', () => {
    store.days.clear();
    const keys = [...written.keys()].slice(0, 45);
    for (const k of keys) store.loadDay(k);
    const recent = keys[keys.length - 1];
    store.loadDay(recent);                                    // 再碰一次最新的
    for (const k of [...written.keys()].slice(45, 50)) store.loadDay(k);
    assert.ok(store.days.has(recent), '刚用过的被淘汰了');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* 留着也行 */ }
  process.exit(fail ? 1 : 0);
});
