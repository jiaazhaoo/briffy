'use strict';
// The shelf: the last fifteen things saved, reachable by resting the pointer on the pet.
//
// Two ways out of it, because there are two things people do with something they just copied. Click
// puts it back on the clipboard, ready to paste. Drag pulls the file itself out -- into a Finder
// window, a tweet, a chat -- which the main process starts natively (see shelf:drag-out); a web drag
// cannot leave the window on its own, so the drag begins here and is handed straight over.
(() => {
  const api = window.shelf;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let strings = {};
  let items = [];
  let toastTimer = null;
  let drawn = '';                              // 上一次画的是哪十五条

  const time = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  // 和工作区同一条规矩（workspace.js 的 cardKind）：剪贴板排在图片前面
  function kindOf(e) {
    if (e.source === 'clipboard') return 'clip';
    if ((e.type === 'screenshot' || e.type === 'image') && e.thumb) return 'shot';
    if (e.type === 'audio') return 'voice';
    if (e.source === 'bookmark') return 'mark';
    if (e.type === 'note' || e.type === 'text') return 'note';
    return 'file';
  }

  function render() {
    const list = $('#list');
    if (!items.length) { list.innerHTML = `<div class="empty">${esc(strings.empty || '')}</div>`; drawn = ''; return; }
    // 每次停到头像上都重画一遍，缩略图就跟着重解码一遍——这是「卡」的大头。
    // 内容没变就什么都不做。
    const sig = items.map((e) => `${e.id}:${e.pinned ? 1 : 0}:${e.note}`).join('|');
    if (sig === drawn) return;
    drawn = sig;
    list.innerHTML = items.map((e) => {
      const kind = kindOf(e);
      const body = kind === 'shot' || (kind === 'clip' && e.thumb)
        ? `<img src="${esc(e.thumb)}" loading="lazy" alt="" />`
        : `<span class="tx"><span class="t">${e.pinned ? '<span class="pin"></span>' : ''}${esc(e.title)}</span>`
          + `<span class="m">${esc(e.note || e.kind)}</span></span>`;
      // 置顶的排在前面并带一个墨点：特意留下的东西，不该被一个忙碌的小时挤下去
      return `<div class="card k-${kind}${e.pinned ? ' pinned' : ''}" data-id="${esc(e.id)}"`
        + ` draggable="${e.file ? 'true' : 'false'}" title="${esc(e.note || e.title)}">`
        + `${body}<span class="tm">${esc(time(e.createdAt))}</span></div>`;
    }).join('');
  }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1300);
  }

  // The window is placed and filled while it is still hidden; the entrance plays only once the main
  // process has actually put it on screen (shelf:in), so the slide never starts off-screen and arrive
  // half-done. Leaving reverses it and reports when the panel has finished sliding away.
  api.onShow(({ entries, strings: s, replay }) => {
    strings = s || strings;
    items = entries || [];
    $('#openLabel').textContent = strings.open || '';
    render();
    if (!replay) return;                       // already on screen: new content, no entrance
    document.body.classList.remove('in');
    requestAnimationFrame(() => requestAnimationFrame(() => api.painted()));
  });
  api.onIn(() => { document.body.classList.add('in'); });
  api.onOut(() => {
    const panel = $('#panel');
    if (!document.body.classList.contains('in')) { api.faded(); return; }
    let done = false;
    const finish = () => { if (!done) { done = true; api.faded(); } };
    panel.addEventListener('transitionend', (ev) => { if (ev.propertyName === 'transform') finish(); }, { once: true });
    setTimeout(finish, 320);                   // a transition that never fires must not strand the window
    document.body.classList.remove('in');
  });

  // Resting on the panel keeps it open; leaving it starts the same close timer the pet uses.
  $('#panel').addEventListener('mouseenter', () => api.keep());
  $('#panel').addEventListener('mouseleave', () => api.leave());

  $('#list').addEventListener('click', async (ev) => {
    const card = ev.target.closest('.card');
    if (!card) return;
    const r = await api.copy(card.dataset.id);
    if (!r || !r.ok) return;
    card.classList.add('copied');
    setTimeout(() => card.classList.remove('copied'), 700);
    toast(strings.copied || '');
  });

  // A drag that leaves the window has to be handed to the main process, which owns the native one.
  $('#list').addEventListener('dragstart', (ev) => {
    const card = ev.target.closest('.card');
    if (!card) return;
    ev.preventDefault();                       // the web drag would die at the window edge
    api.dragOut(card.dataset.id);
  });

  $('#open').addEventListener('click', () => api.openWorkspace());
  window.addEventListener('error', (e) => api.log(`shelf error: ${e.message}`));
})();
