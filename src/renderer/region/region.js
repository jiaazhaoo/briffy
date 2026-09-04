'use strict';
/* global region */
(() => {
  const api = window.region;
  const $ = (s) => document.querySelector(s);
  const frozen = $('#frozen');
  const box = $('#box');
  const shade = $('#shade');
  const sizeChip = $('#size');
  const toolbar = $('#toolbar');
  const hint = $('#hint');

  const MIN = 8;
  let sel = null;            // { x, y, w, h } in CSS pixels
  let drag = null;           // { mode:'new'|'move'|'resize', corner, startX, startY, orig }
  let scale = 1;

  // the four dimmed rectangles around the selection
  const shadeParts = ['top', 'bottom', 'left', 'right'].map((name) => {
    const el = document.createElement('div');
    el.className = `shade-part ${name}`;
    el.style.display = 'none';
    document.body.appendChild(el);
    return el;
  });
  const setRect = (el, x, y, w, h) => {
    el.style.left = `${x}px`; el.style.top = `${y}px`;
    el.style.width = `${Math.max(0, w)}px`; el.style.height = `${Math.max(0, h)}px`;
  };

  api.onInit(({ image, scale: s, strings }) => {
    frozen.src = image;
    scale = s || 1;
    $('#hintText').innerHTML = strings.hint;
    $('#labelOk').textContent = strings.ok;
    $('#labelCancel').textContent = strings.cancel;
    sel = null; drag = null;
    hint.classList.remove('hidden');
    render();
  });
  // the window is reused, so clear the previous selection when it is put away
  if (api.onReset) api.onReset(() => { sel = null; drag = null; frozen.removeAttribute('src'); hint.classList.remove('hidden'); render(); });

  // A mouse reports far more often than the screen refreshes, so drawing on every event is wasted work.
  // Events only update `sel`; the DOM is written once per frame.
  let frameQueued = false;
  function render() {
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(() => { frameQueued = false; draw(); });
  }

  function draw() {
    if (!sel) {
      box.classList.add('hidden'); sizeChip.classList.add('hidden'); toolbar.classList.add('hidden');
      for (const el of shadeParts) el.style.display = 'none';
      shade.style.display = '';
      return;
    }
    shade.style.display = 'none';
    // four plain rectangles instead of one 9999px box-shadow: the shadow has to be repainted over the
    // whole screen on every frame, the rectangles are just four composited boxes
    const { x, y, w, h } = sel;
    setRect(shadeParts[0], 0, 0, innerWidth, y);                       // above
    setRect(shadeParts[1], 0, y + h, innerWidth, innerHeight - y - h); // below
    setRect(shadeParts[2], 0, y, x, h);                                // left
    setRect(shadeParts[3], x + w, y, innerWidth - x - w, h);           // right
    for (const el of shadeParts) el.style.display = '';
    box.classList.remove('hidden');
    box.style.left = `${sel.x}px`;
    box.style.top = `${sel.y}px`;
    box.style.width = `${sel.w}px`;
    box.style.height = `${sel.h}px`;

    sizeChip.classList.remove('hidden');
    sizeChip.textContent = `${Math.round(sel.w * scale)} × ${Math.round(sel.h * scale)}`;
    const chipTop = sel.y > 26 ? sel.y - 24 : sel.y + 6;
    sizeChip.style.left = `${Math.max(4, sel.x)}px`;
    sizeChip.style.top = `${chipTop}px`;

    if (drag) { toolbar.classList.add('hidden'); return; }
    toolbar.classList.remove('hidden');
    const tw = toolbar.offsetWidth || 150;
    const th = toolbar.offsetHeight || 36;
    let tx = sel.x + sel.w - tw;
    let ty = sel.y + sel.h + 8;
    if (ty + th > innerHeight - 4) ty = Math.max(4, sel.y - th - 8);
    toolbar.style.left = `${Math.max(4, Math.min(tx, innerWidth - tw - 4))}px`;
    toolbar.style.top = `${ty}px`;
    hint.classList.add('hidden');
  }

  function normalize(x1, y1, x2, y2) {
    return {
      x: Math.max(0, Math.min(x1, x2)),
      y: Math.max(0, Math.min(y1, y2)),
      w: Math.min(Math.abs(x2 - x1), innerWidth),
      h: Math.min(Math.abs(y2 - y1), innerHeight),
    };
  }
  function clamp(s) {
    s.x = Math.max(0, Math.min(s.x, innerWidth - s.w));
    s.y = Math.max(0, Math.min(s.y, innerHeight - s.h));
    return s;
  }

  // ---------- pointer ----------
  // `e.target` is only an Element for real pointer events; guard so a stray event cannot break the overlay
  // and strand the user behind a full-screen window.
  const closest = (target, sel2) => (target && typeof target.closest === 'function' ? target.closest(sel2) : null);

  document.addEventListener('mousedown', (e) => {
    if (e.button === 2) { api.cancel(); return; }
    if (e.button !== 0) return;
    const handle = closest(e.target, '.handle');
    if (handle) {
      drag = { mode: 'resize', corner: [...handle.classList].find((c) => c !== 'handle'), orig: { ...sel } };
    } else if (sel && e.target === box) {
      drag = { mode: 'move', startX: e.clientX, startY: e.clientY, orig: { ...sel } };
    } else if (!closest(e.target, '.toolbar')) {
      drag = { mode: 'new', startX: e.clientX, startY: e.clientY };
      sel = { x: e.clientX, y: e.clientY, w: 0, h: 0 };
    }
    render();
  });

  document.addEventListener('mousemove', (e) => {
    if (!drag) return;
    if (drag.mode === 'new') {
      sel = normalize(drag.startX, drag.startY, e.clientX, e.clientY);
    } else if (drag.mode === 'move') {
      sel = clamp({ ...drag.orig, x: drag.orig.x + (e.clientX - drag.startX), y: drag.orig.y + (e.clientY - drag.startY) });
    } else {
      const o = drag.orig;
      const left = drag.corner.includes('w') ? e.clientX : o.x;
      const top = drag.corner.includes('n') ? e.clientY : o.y;
      const right = drag.corner.includes('e') ? e.clientX : o.x + o.w;
      const bottom = drag.corner.includes('s') ? e.clientY : o.y + o.h;
      sel = normalize(left, top, right, bottom);
    }
    render();
  });

  document.addEventListener('mouseup', () => {
    if (!drag) return;
    const wasNew = drag.mode === 'new';
    drag = null;
    if (sel && (sel.w < MIN || sel.h < MIN)) { if (wasNew) sel = null; }
    render();
  });

  // double-click inside the selection confirms, like the screenshot tools people already use
  document.addEventListener('dblclick', (e) => {
    if (sel && sel.w >= MIN && sel.h >= MIN && !closest(e.target, '.toolbar')) confirm();
  });
  document.addEventListener('contextmenu', (e) => { e.preventDefault(); api.cancel(); });

  // ---------- keyboard ----------
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { api.cancel(); return; }
    if (e.key === 'Enter') { confirm(); return; }
    if (e.ctrlKey && (e.key === 'a' || e.key === 'A')) {   // whole screen
      sel = { x: 0, y: 0, w: innerWidth, h: innerHeight };
      render();
      return;
    }
    if (!sel) return;
    const step = e.shiftKey ? 10 : 1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    if (e.altKey) { sel.w = Math.max(MIN, sel.w + m[0]); sel.h = Math.max(MIN, sel.h + m[1]); }
    else { sel = clamp({ ...sel, x: sel.x + m[0], y: sel.y + m[1] }); }
    render();
  });

  function confirm() {
    if (!sel || sel.w < MIN || sel.h < MIN) return;
    api.select({ x: sel.x, y: sel.y, width: sel.w, height: sel.h });
  }
  $('#btnOk').addEventListener('click', confirm);
  $('#btnCancel').addEventListener('click', () => api.cancel());
  window.addEventListener('blur', () => { /* keep the overlay up; Esc or right-click cancels */ });
})();
