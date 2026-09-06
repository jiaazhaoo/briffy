'use strict';
(async () => {
  const $ = (s) => document.querySelector(s);
  const state = { items: [], selected: new Set(), kind: 'all', minSize: 150, tab: null, pageTitle: '', mse: false, players: [] };
  const KIND_ICON = { image: '🖼️', video: '🎬', audio: '🎵', stream: '📺', blob: '🎬' };
  const KIND_LABEL = { image: '图片', video: '视频', audio: '音频', stream: '流媒体', blob: '页内播放' };

  // ---------- app connectivity ----------
  const { port } = await chrome.storage.local.get({ port: 47831 });
  $('#port').value = port;
  $('#port').addEventListener('change', async () => { await chrome.storage.local.set({ port: Number($('#port').value) || 47831 }); checkApp(); });
  async function checkApp() {
    const r = await chrome.runtime.sendMessage({ type: 'ping' });
    const el = $('#appStatus');
    el.className = `status ${r && r.ok ? 'ok' : 'bad'}`;
    el.querySelector('span').textContent = r && r.ok ? `briffy ${r.version || ''} 已连接` : 'briffy 未运行';
    return !!(r && r.ok);
  }
  checkApp();

  // ---------- scan ----------
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tab = tab;
  state.pageTitle = tab.title || '';
  $('#pageTitle').textContent = tab.title || tab.url;
  let dom = [];
  let players = [];
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['scan.js'] });
    for (const r of results) {
      if (!r || !r.result) continue;
      if (Array.isArray(r.result.items)) dom.push(...r.result.items);
      if (Array.isArray(r.result.players)) players.push(...r.result.players);
    }
  } catch (e) {
    $('#grid').innerHTML = `<div class="empty">无法扫描这个页面（${e.message}）。浏览器内置页面和商店页面不允许扩展访问。</div>`;
  }
  const collected = (await chrome.runtime.sendMessage({ type: 'collect', tabId: tab.id, pageUrl: tab.url })) || {};
  const sniffed = collected.items || [];
  state.mse = !!collected.mse;
  state.players = players;
  const byUrl = new Map();
  for (const it of [...dom, ...sniffed]) {
    const cur = byUrl.get(it.url);
    if (!cur) byUrl.set(it.url, { ...it });
    else Object.assign(cur, { ...it, ...cur, width: Math.max(cur.width || 0, it.width || 0), height: Math.max(cur.height || 0, it.height || 0), sniffed: cur.sniffed || it.sniffed });
  }
  const poster = (players.find((pl) => pl.poster) || {}).poster || '';
  state.items = [...byUrl.values()]
    .filter((it) => it.kind !== 'blob' && it.kind !== 'segment')
    .map((it, i) => {
      const isVideo = it.kind === 'video' || it.kind === 'stream';
      // filename stays the technical one so the app can trust its extension; name is for reading
      return { ...it, id: i, filename: it.filename || baseName(it.url) || '', name: displayName(it, i), poster: isVideo ? poster : '' };
    });
  // videos and streams first, then big images
  state.items.sort((a, b) => rank(b) - rank(a));
  function rank(it) { return (it.kind === 'video' || it.kind === 'stream' ? 1e9 : it.kind === 'audio' ? 5e8 : 0) + (it.width || 0) * (it.height || 0) + (it.size || 0) / 1000; }
  for (const it of state.items) if (it.kind !== 'image' || Math.min(it.width || 9999, it.height || 9999) >= state.minSize) { /* default selection below */ }
  render();

  // ---------- rendering ----------
  function visible() {
    return state.items.filter((it) => {
      if (state.kind !== 'all' && !(state.kind === 'video' ? (it.kind === 'video' || it.kind === 'stream') : it.kind === state.kind)) return false;
      if (it.kind === 'image' && it.width && it.height && Math.min(it.width, it.height) < state.minSize) return false;
      return true;
    });
  }
  function counts() {
    const c = { all: 0, image: 0, video: 0, audio: 0 };
    for (const it of state.items) { c.all++; if (it.kind === 'image') c.image++; else if (it.kind === 'video' || it.kind === 'stream') c.video++; else if (it.kind === 'audio') c.audio++; }
    $('#nAll').textContent = c.all; $('#nImage').textContent = c.image; $('#nVideo').textContent = c.video; $('#nAudio').textContent = c.audio;
  }
  function displayName(it, i) {
    const base = baseName(it.url);
    if (base) return base;
    if (it.hint) return cleanTitle(state.pageTitle, state.tab && state.tab.url) || `stream-${i}`;
    if (it.kind === 'video' || it.kind === 'stream' || it.kind === 'audio') {
      const t = cleanTitle(state.pageTitle, state.tab && state.tab.url);
      if (t) return t;
    }
    if (it.alt) return it.alt.slice(0, 60);
    return `media-${i}`;
  }

  function fmtSize(n) { return n ? (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`) : ''; }
  function render() {
    counts();
    const list = visible();
    const grid = $('#grid');
    if (!list.length) {
      const why = [];
      if (state.players.length) why.push(`页面里有 ${state.players.length} 个 <video>，但它的地址是 blob:（播放器自己拼流）`);
      if (state.mse) why.push('检测到 MSE 流式播放');
      why.push('试试先让视频播放几秒再打开这个面板，分片请求出现后才认得出来');
      grid.innerHTML = `<div class="empty">这个页面上没有找到符合条件的媒体<br><span class="why">${why.map(escapeHtml).join('<br>')}</span></div>`;
      updateSummary(); return;
    }
    grid.innerHTML = list.map((it) => {
      const on = state.selected.has(it.id) ? ' on' : '';
      const thumbSrc = it.kind === 'image' ? it.url : it.poster;
      const thumb = thumbSrc ? `<img src="${thumbSrc.replace(/"/g, '&quot;')}" loading="lazy" alt="" />` : (KIND_ICON[it.kind] || '📎');
      const dims = it.hint ? `${it.fragments} 个分片` : it.width && it.height ? `${it.width}×${it.height}` : fmtSize(it.size) || KIND_LABEL[it.kind];
      return `<div class="item${on}" data-id="${it.id}" title="${it.url.replace(/"/g, '&quot;')}">
        <div class="th">${thumb}</div><span class="chk"></span><span class="tag">${KIND_LABEL[it.kind] || it.kind}</span>
        <div class="cap"><b>${escapeHtml(it.name)}</b><br>${dims}${it.sniffed ? ' · 网络' : ''}</div></div>`;
    }).join('');
    // learn real sizes from the loaded thumbnails
    for (const img of grid.querySelectorAll('img')) {
      img.addEventListener('load', () => {
        const id = Number(img.closest('.item').dataset.id);
        const it = state.items.find((x) => x.id === id);
        if (it && it.kind === 'image' && (!it.width || !it.height)) {
          it.width = img.naturalWidth; it.height = img.naturalHeight;
          img.closest('.item').querySelector('.cap').innerHTML = `<b>${escapeHtml(it.name)}</b><br>${it.width}×${it.height}${it.sniffed ? ' · 网络' : ''}`;
        }
      }, { once: true });
      img.addEventListener('error', () => { img.replaceWith(document.createTextNode('🖼️')); }, { once: true });
    }
    updateSummary();
  }
  function escapeHtml(s) { return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function updateSummary() {
    const n = state.selected.size;
    $('#summary').textContent = n ? `已选择 ${n} 项` : '未选择';
    $('#btnSend').disabled = !n;
  }

  // ---------- interactions ----------
  $('#grid').addEventListener('click', (e) => {
    const el = e.target.closest('.item');
    if (!el) return;
    const id = Number(el.dataset.id);
    if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
    el.classList.toggle('on', state.selected.has(id));
    updateSummary();
  });
  $('#kindSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    state.kind = b.dataset.kind;
    for (const x of $('#kindSeg').children) x.classList.toggle('active', x === b);
    render();
  });
  $('#minSize').addEventListener('input', (e) => { state.minSize = Number(e.target.value); $('#minSizeLabel').textContent = `${state.minSize}px`; render(); });
  $('#btnAll').addEventListener('click', () => { for (const it of visible()) state.selected.add(it.id); render(); });
  $('#btnNone').addEventListener('click', () => { state.selected.clear(); render(); });

  $('#btnSend').addEventListener('click', async () => {
    if (!(await checkApp())) { alert('briffy 没有运行，请先打开 App。'); return; }
    const items = state.items.filter((it) => state.selected.has(it.id)).map(({ id, ...rest }) => rest);
    $('#btnSend').disabled = true;
    $('#progress').classList.remove('hidden');
    const poll = setInterval(async () => {
      const job = await chrome.runtime.sendMessage({ type: 'job' });
      if (!job) return;
      $('#progress .bar i').style.width = `${Math.round((job.done / job.total) * 100)}%`;
      $('#progress span').textContent = `${job.done}/${job.total}${job.failed ? `（失败 ${job.failed}）` : ''}`;
    }, 300);
    const r = await chrome.runtime.sendMessage({ type: 'send', pageUrl: state.tab.url, pageTitle: state.pageTitle, items, downloadVideos: $('#downloadVideos').checked });
    clearInterval(poll);
    if (r && r.ok) {
      $('#progress .bar i').style.width = '100%';
      $('#progress span').textContent = `完成：${r.done - r.failed} 项已发送${r.failed ? `，${r.failed} 项失败` : ''}`;
      state.selected.clear(); render();
    } else {
      $('#progress span').textContent = `发送失败：${(r && r.error) || '未知错误'}`;
      $('#btnSend').disabled = false;
    }
  });
})();
