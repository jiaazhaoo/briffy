// Mock of `window.bubble` for browser previews. ?text=...&state=...&below=1&tail=280&zoom=3&bg=%23333
(() => {
  const textCbs = []; const layoutCbs = [];
  window.bubble = { onText: (cb) => textCbs.push(cb), onLayout: (cb) => layoutCbs.push(cb) };
  const q = new URLSearchParams(location.search);
  if (q.get('zoom')) { document.documentElement.style.zoom = q.get('zoom'); document.documentElement.style.background = q.get('bg') || '#dfe3ea'; }
  setTimeout(() => {
    textCbs.forEach((cb) => cb({ text: q.get('text') || '🏷 预算 · 路线图 · 产品团队 · 会议 · 第三季度', state: q.get('state') || 'success' }));
    layoutCbs.forEach((cb) => cb({ below: q.get('below') === '1', tail: Number(q.get('tail') || 280) }));
  }, 50);
})();
