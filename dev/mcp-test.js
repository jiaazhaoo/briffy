'use strict';
// briffy 的 MCP 服务器还答得动吗——别的 agent（Claude Code、Codex）靠它读这个工作区。
//
//   node dev/mcp-test.js [工作区路径]
//
// 它是**独立进程**，所以只能像客户端那样跟它说话：起进程、走 stdio、发 JSON-RPC。
// 守两件事：协议那几步还通；以及**它和应用说同一套词**——bucket / sub 来自
// src/main/classify.js，两边共用一份判据。抄第二份就会漂，而漂了没人发现。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SERVER = path.join(__dirname, '..', 'mcp', 'briffy-mcp.js');

/** 起一次服务器，把这几条请求灌进去，收齐回应。 */
function talk(reqs, workspace) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [SERVER], {
      env: { ...process.env, BRIFFY_WORKSPACE: workspace },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = ''; let err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('超时')); }, 20000);
    p.stdout.on('data', (b) => { out += b; });
    p.stderr.on('data', (b) => { err += b; });
    p.on('close', () => {
      clearTimeout(timer);
      const msgs = out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return { bad: l }; } });
      resolve({ msgs, err });
    });
    for (const r of reqs) p.stdin.write(`${JSON.stringify(r)}\n`);
    p.stdin.end();
  });
}
const call = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const rows = (m) => JSON.parse(m.result.content[0].text);

// 一个小工作区，内容自己造——不碰用户的真库，台子要能在任何机器上跑
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-mcp-'));
const ws = path.join(tmp, 'workspace');
fs.mkdirSync(path.join(ws, 'entries'), { recursive: true });
fs.writeFileSync(path.join(ws, 'entries', '2026-09-09.json'), JSON.stringify([
  { id: 'a1', createdAt: '2026-09-09T10:00:00.000Z', dateKey: '2026-09-09', type: 'note', title: '复制来的一段', text: '会议定在明天十点', origin: 'clipboard', tags: [] },
  { id: 'b2', createdAt: '2026-09-09T11:00:00.000Z', dateKey: '2026-09-09', type: 'screenshot', title: '一张截图', text: 'ticket number XA200143', context: { app: 'Claude' }, tags: [] },
  { id: 'c3', createdAt: '2026-09-09T12:00:00.000Z', dateKey: '2026-09-09', type: 'url', title: '收藏的一条', url: 'https://www.bilibili.com/video/x', origin: 'bookmark', tags: [] },
  { id: 'd4', createdAt: '2026-09-09T13:00:00.000Z', dateKey: '2026-09-09', type: 'pdf', title: '合同.pdf', path: 'files/2026-09-09/合同.pdf', mime: 'application/pdf', tags: [] },
]));

let checks = 0;
const fail = [];
// 比的时候要能比数组——`!==` 对数组永远成立（比的是引用），那样台子会永远红
const eq = (got, want, what) => {
  checks++;
  const same = Array.isArray(got) || (got && typeof got === 'object')
    ? JSON.stringify(got) === JSON.stringify(want) : got === want;
  if (!same) fail.push(`${what}：得到 ${JSON.stringify(got)}，该是 ${JSON.stringify(want)}`);
};
const yes = (cond, what) => { checks++; if (!cond) fail.push(what); };

(async () => {
  const { msgs, err } = await talk([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    call(3, 'search_entries', { limit: 20 }),
    call(4, 'search_entries', { bucket: 'saved' }),
    call(5, 'search_entries', { bucket: 'clip' }),
    call(6, 'search_entries', { bucket: 'shot', sub: 'Claude' }),
    call(7, 'search_entries', { bucket: 'file' }),
    call(8, 'search_entries', { query: '会议' }),
    call(9, 'get_entry', { id: 'b2' }),
    call(10, 'list_days', {}),
  ], ws);
  const by = Object.fromEntries(msgs.filter((m) => m.id).map((m) => [m.id, m]));

  yes(!/Error|error/.test(err) || err.trim() === '', `stderr 该是干净的，实际：${err.slice(0, 200)}`);
  eq(by[1].result.serverInfo.name, 'briffy', 'initialize 报出自己的名字');
  eq(by[2].result.tools.length, 5, 'tools/list 给出五个工具');
  yes(by[2].result.tools.every((t) => t.inputSchema), '每个工具都有 inputSchema');

  eq(rows(by[3]).length, 4, '不加条件拿到全部四条');

  // **和应用同一套词**：这四条正好落在四个不同的格子里
  eq(rows(by[4]).map((r) => r.id), ['c3'], 'bucket=saved 只有那条书签');
  eq(rows(by[4])[0].sub, '哔哩哔哩', '收藏的二级是站点名');
  eq(rows(by[5]).map((r) => r.id), ['a1'], 'bucket=clip 只有复制来的那条');
  eq(rows(by[5])[0].sub, 'text', '剪贴板的二级是格式');
  eq(rows(by[6]).map((r) => r.id), ['b2'], 'bucket=shot + sub=Claude 找得到那张截图');
  eq(rows(by[7])[0].sub, 'PDF', '文件的二级是真的扩展名');

  eq(rows(by[8]).map((r) => r.id), ['a1'], '按词搜搜得到正文');
  eq(by[9] && JSON.parse(by[9].result.content[0].text).id, 'b2', 'get_entry 取得回整条');
  yes(JSON.parse(by[10].result.content[0].text).length >= 1, 'list_days 至少一天');

  // 认不出的格子筛出空，不是「忽略这一维」
  const { msgs: m2 } = await talk([call(1, 'search_entries', { bucket: '不存在的格子' })], ws);
  eq(rows(m2[0]).length, 0, '不存在的一级筛出空');

  fs.rmSync(tmp, { recursive: true, force: true });
  for (const f of fail) console.log(`✗ ${f}`);
  console.log(`mcp: ${checks} 项，没过的 ${fail.length} 个`);
  assert.strictEqual(fail.length, 0, 'MCP 服务器有问题');
  console.log('全对。');
})().catch((e) => { console.error(e); process.exit(1); });
