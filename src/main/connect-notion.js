'use strict';
// Notion：把你那些页面接进来。
//
// 认证用**你自己建的 integration token**，不是 OAuth。理由是这样最省事也最诚实：Notion 的内部集成
// 是在你自己的工作区里点几下就有的一串 token，不需要 briffy 去注册一个公开集成、不需要回调地址、
// 也不需要 briffy 碰你的登录。代价是你得手动把要同步的页面「连接」给那个集成——而这恰好也是好事：
// **你决定它能看见哪些页面**，而不是一授权就把整个工作区端过来。
//
// 取内容分两步，因为 Notion 就是这么设计的：search 给页面清单，blocks 才给正文。
// 一页正文可能有几百个 block，所以只取前 MAX_BLOCKS 个——搜索要的是"这页讲什么"，不是逐字副本，
// 而真要看全文，标题上那个链接会把你送回 Notion。
const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';
const PAGE_SIZE = 50;
const MAX_BLOCKS = 120;          // 一页最多取这么多块
const GAP_MS = 350;              // Notion 的限速大约每秒三次请求，留出余量

const label = 'Notion';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hasCreds(store) { return !!store.getSecret('notionToken'); }
function loadCreds(store) { return { token: store.getSecret('notionToken') }; }
function saveCreds(store, creds) { store.setSecret('notionToken', String(creds.token || '').trim()); }
function clearCreds(store) { store.setSecret('notionToken', ''); }

async function call(token, path, { method = 'GET', body = null } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': VERSION,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429) {                       // 被限速了就等它说的时间，别硬撞
    const wait = Number(res.headers.get('retry-after') || 2) * 1000;
    await sleep(wait);
    return call(token, path, { method, body });
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
  if (!res.ok) throw new Error((data && data.message) || `Notion ${res.status}`);
  return data;
}

/** token 对不对，顺便把这个集成的名字带回来。 */
async function check({ token }) {
  const t = String(token || '').trim();
  if (!t) throw new Error('缺少 token');
  const me = await call(t, '/users/me');
  return { account: (me && (me.name || (me.bot && me.bot.workspace_name))) || 'Notion' };
}

/** 一个 block 里的纯文字。Notion 把文字塞在十几种类型各自的 rich_text 里，形状是一样的。 */
function blockText(b) {
  const kind = b && b.type;
  const inner = kind && b[kind];
  const rich = inner && (inner.rich_text || inner.caption);
  if (!Array.isArray(rich)) return '';
  const line = rich.map((r) => (r && r.plain_text) || '').join('');
  if (!line.trim()) return '';
  if (kind === 'heading_1' || kind === 'heading_2' || kind === 'heading_3') return `\n${line}\n`;
  if (kind === 'bulleted_list_item' || kind === 'numbered_list_item') return `· ${line}`;
  if (kind === 'to_do') return `${inner.checked ? '☑' : '☐'} ${line}`;
  return line;
}

/** 页面标题：Notion 把它藏在 properties 里那个 type 为 title 的字段中，字段名各家不同。 */
function pageTitle(page) {
  const props = (page && page.properties) || {};
  for (const v of Object.values(props)) {
    if (v && v.type === 'title' && Array.isArray(v.title)) {
      const s = v.title.map((r) => r.plain_text || '').join('').trim();
      if (s) return s;
    }
  }
  return '(无标题)';
}

async function bodyOf(token, pageId) {
  const parts = [];
  let cursor = '';
  while (parts.length < MAX_BLOCKS) {
    const q = new URLSearchParams({ page_size: '100', ...(cursor ? { start_cursor: cursor } : {}) });
    const data = await call(token, `/blocks/${pageId}/children?${q}`);
    for (const b of (data.results || [])) {
      const line = blockText(b);
      if (line) parts.push(line);
      if (parts.length >= MAX_BLOCKS) break;
    }
    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
    await sleep(GAP_MS);
  }
  return parts.join('\n').trim();
}

/**
 * 拉一页清单，每一条都取正文再交给 take。
 * @returns {Promise<{cursor:string, more:boolean}>}
 */
async function pull({ token }, cursor, take) {
  const data = await call(token, '/search', {
    method: 'POST',
    body: {
      page_size: PAGE_SIZE,
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
      ...(cursor ? { start_cursor: cursor } : {}),
    },
  });
  for (const page of (data.results || [])) {
    if (page.object !== 'page') continue;                 // 数据库本身没有正文，跳过
    await sleep(GAP_MS);
    let text = '';
    try { text = await bodyOf(token, page.id); }
    catch (e) { text = ''; console.warn('[notion] 取不到正文', page.id, e.message); }
    take({
      id: page.id,
      title: pageTitle(page),
      text,
      url: page.url || '',
      at: page.last_edited_time || page.created_time || '',
      type: 'note',
    });
  }
  return { cursor: data.next_cursor || '', more: !!data.has_more };
}

module.exports = { label, check, pull, hasCreds, loadCreds, saveCreds, clearCreds, _blockText: blockText, _pageTitle: pageTitle };
