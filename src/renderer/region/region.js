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
  const snapBox = $('#snap');
  const snapLabel = $('#snapLabel');
  const ink = $('#ink');
  const typing = $('#typing');
  const pop = $('#pop');

  // 在选区上画点什么。引擎和「看图」那一页是同一份（src/renderer/shared/annotate.js）。
  //
  // 坐标记在**整块屏幕的物理像素**里，不是选区里的：这样画完之后选区还能接着挪、接着改大小，
  // 画上去的东西钉在桌面上、不跟着框走——像素记在框里的话，一挪框，标注就整个错位。
  const ann = window.Annotate.create({
    source: frozen,
    canvas: ink,
    typing,
    toLocal: (ev) => ({ x: ev.clientX * scale, y: ev.clientY * scale }),
    placeTyping: (p) => { typing.style.left = `${p.x / scale}px`; typing.style.top = `${p.y / scale}px`; },
    onChange: () => { $('#btnUndo').disabled = ann.empty(); },
  });

  const MIN = 8;
  let sel = null;            // { x, y, w, h } in CSS pixels
  let drag = null;           // { mode:'new'|'move'|'resize', corner, startX, startY, orig }
  let scale = 1;
  let windows = [];          // every window on this screen, front to back (see src/main/window-list.js)
  let snap = null;           // the one under the cursor right now
  // The rectangles read out of the frozen picture itself -- a toolbar, a card, one pane of a split
  // view. The window list cannot know about any of them; see src/renderer/region/boxes.js.
  let elBoxes = [];
  let here = null;           // the last place the pointer was known to be, mouse moved or not
  let boxRun = 0;            // which overlay opening these boxes belong to

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

  api.onInit(({ image, scale: s, strings, windows: wins, cursor }) => {
    frozen.src = image;
    scale = s || 1;
    windows = Array.isArray(wins) ? wins : [];
    elBoxes = [];
    // Where the pointer already is, so something is lit before it has moved a pixel. Without this the
    // overlay computed its target only on mousemove: press the shortcut while resting over a window
    // and the screen went dark with nothing highlighted until you jiggled the mouse. It was the first
    // thing anyone noticed, and it made snapping look broken when it was merely asleep.
    here = cursor && Number.isFinite(cursor.x) ? { x: cursor.x, y: cursor.y } : null;
    snap = here ? targetAt(here.x, here.y) : null;
    findBoxes(++boxRun, image);
    $('#hintText').innerHTML = strings.hint;
    $('#labelOk').textContent = strings.ok;
    $('#labelCancel').textContent = strings.cancel;
    $('#labelLong').textContent = strings.long || '';
    $('#btnLong').hidden = !strings.long;
    const names = strings.tools || {};
    for (const b of document.querySelectorAll('.tool[data-tool]')) b.title = names[b.dataset.tool] || '';
    $('#btnUndo').title = names.undo || '';
    sel = null; drag = null;
    // 画布开在物理像素上：写 CSS 尺寸就够显示，但存出去的是原图分辨率，标注不能是糊的
    ink.width = Math.round(innerWidth * scale);
    ink.height = Math.round(innerHeight * scale);
    ann.reset();
    syncTools();
    hint.classList.remove('hidden');
    render();
  });
  // the window is reused, so clear the previous selection when it is put away
  if (api.onReset) api.onReset(() => { sel = null; drag = null; snap = null; windows = []; elBoxes = []; boxRun++; frozen.removeAttribute('src'); hint.classList.remove('hidden'); render(); });

  // ---------- reading the rectangles out of the picture ----------
  //
  // Deliberately after the overlay is already on screen. It costs about a tenth of a second on a big
  // display, and an overlay that appears a tenth of a second late is a worse tool than one whose
  // snapping arrives a tenth of a second after it -- for that tenth of a second, window snapping is
  // still there, which is what the overlay had before this existed.
  async function findBoxes(run, src) {
    if (!window.boxes || !src) return;
    try {
      const im = new Image();
      im.src = src;
      await im.decode();
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      if (run !== boxRun) return;
      const c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      const ctx = c.getContext('2d', { alpha: false, willReadFrequently: true });
      ctx.drawImage(im, 0, 0);
      const px = ctx.getImageData(0, 0, c.width, c.height).data;
      if (run !== boxRun) return;
      elBoxes = window.boxes.find(px, c.width, c.height, scale);
      // The boxes arrive a moment after the overlay does. If the pointer has not moved since, the
      // highlight is still whatever the window list offered, and it should now become the better
      // answer -- otherwise standing still means never seeing what this pass found.
      if (here && !sel && !drag) {
        const better = targetAt(here.x, here.y);
        if (better && (!snap || better.w * better.h < snap.w * snap.h)) { snap = better; render(); }
      }
    } catch (_) { elBoxes = []; }     // no snapping beyond windows; never a broken overlay
  }

  /**
   * What is under the cursor: the smallest rectangle in the picture, or failing that the window.
   *
   * The smaller of the two wins when both answer. A window's own box is in the picture too -- it is
   * the biggest flat thing on it -- and offering that instead of the card the cursor is actually on
   * would make the whole thing pointless.
   */
  function targetAt(px, py) {
    const el = window.boxes ? window.boxes.at(elBoxes, px, py, { maxW: innerWidth, maxH: innerHeight }) : null;
    const win = windowAt(px, py);
    if (!el) return win;
    if (!win) return el;
    return (el.w * el.h) <= (win.w * win.h) ? el : win;
  }

  // ---------- the window under the cursor ----------
  //
  // The list arrives front to back, so the first window containing the point is the one that is
  // actually visible there -- no depth sorting, no guessing. Clipped to this screen, because a window
  // can hang off the side of it and the capture cannot.
  function windowAt(px, py) {
    for (const w of windows) {
      if (px < w.x || py < w.y || px >= w.x + w.w || py >= w.y + w.h) continue;
      const x = Math.max(0, w.x);
      const y = Math.max(0, w.y);
      const right = Math.min(innerWidth, w.x + w.w);
      const bottom = Math.min(innerHeight, w.y + w.h);
      if (right - x < MIN || bottom - y < MIN) return null;
      return { x, y, w: right - x, h: bottom - y, app: w.app, title: w.title };
    }
    return null;
  }

  function drawSnap() {
    // Only while nothing has been chosen yet: once there is a selection, the highlight would be a
    // second box competing with it.
    if (!snap || sel || drag) {
      snapBox.classList.add('hidden');
      snapLabel.classList.add('hidden');
      return;
    }
    snapBox.classList.remove('hidden');
    snapBox.style.left = `${snap.x}px`;
    snapBox.style.top = `${snap.y}px`;
    snapBox.style.width = `${snap.w}px`;
    snapBox.style.height = `${snap.h}px`;

    const name = [snap.app, snap.title].filter(Boolean).join(' · ');
    const size = `${Math.round(snap.w * scale)} × ${Math.round(snap.h * scale)}`;
    snapLabel.textContent = name ? `${name}  ${size}` : size;
    snapLabel.classList.remove('hidden');
    const lw = snapLabel.offsetWidth || 120;
    snapLabel.style.left = `${Math.max(4, Math.min(snap.x, innerWidth - lw - 4))}px`;
    snapLabel.style.top = `${snap.y > 26 ? snap.y - 24 : snap.y + 6}px`;
  }

  // A mouse reports far more often than the screen refreshes, so drawing on every event is wasted work.
  // Events only update `sel`; the DOM is written once per frame.
  let frameQueued = false;
  function render() {
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(() => { frameQueued = false; draw(); });
  }

  // Whatever is about to be captured is shown at full brightness and everything else is dimmed --
  // for the window under the cursor exactly as for a box already drawn. A tint laid *over* the window
  // instead was the first attempt and it was the wrong way round: dimmed screen plus a wash of blue
  // is two veils on the one thing you are trying to look at, and it read as barely there.
  function hole() { return sel || (!drag ? snap : null); }

  function draw() {
    drawSnap();
    const cut = hole();
    if (!cut) {
      box.classList.add('hidden'); sizeChip.classList.add('hidden'); toolbar.classList.add('hidden');
      for (const el of shadeParts) el.style.display = 'none';
      shade.style.display = '';
      return;
    }
    shade.style.display = 'none';
    // four plain rectangles instead of one 9999px box-shadow: the shadow has to be repainted over the
    // whole screen on every frame, the rectangles are just four composited boxes
    {
      const { x, y, w, h } = cut;
      setRect(shadeParts[0], 0, 0, innerWidth, y);                       // above
      setRect(shadeParts[1], 0, y + h, innerWidth, innerHeight - y - h); // below
      setRect(shadeParts[2], 0, y, x, h);                                // left
      setRect(shadeParts[3], x + w, y, innerWidth - x - w, h);           // right
      for (const el of shadeParts) el.style.display = '';
    }
    if (!sel) { box.classList.add('hidden'); sizeChip.classList.add('hidden'); toolbar.classList.add('hidden'); return; }
    const { x, y, w, h } = sel;
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

    if (drag) { toolbar.classList.add('hidden'); pop.classList.add('hidden'); return; }
    toolbar.classList.remove('hidden');
    const tw = toolbar.offsetWidth || 150;
    const th = toolbar.offsetHeight || 36;
    let tx = sel.x + sel.w - tw;
    let ty = sel.y + sel.h + 8;
    if (ty + th > innerHeight - 4) ty = Math.max(4, sel.y - th - 8);
    toolbar.style.left = `${Math.max(4, Math.min(tx, innerWidth - tw - 4))}px`;
    toolbar.style.top = `${ty}px`;
    hint.classList.add('hidden');
    showPop();                       // 调色板贴着工具带走，工具带一动它就得跟上
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
    // 工具带和调色板上的点击归它们自己
    if (closest(e.target, '.toolbar') || closest(e.target, '.pop') || e.target === typing) return;
    // 选了工具就是在画，不是在拉框——这是「先框出来，再在上面标」这个顺序的全部实现。
    // 四个角除外：画到一半想把框改大一点，不该先把工具收起来。
    const handle = closest(e.target, '.handle');
    if (!handle && ann.down(e)) return;
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
    if (ann.move(e)) return;
    if (!drag) {
      if (sel || (!windows.length && !elBoxes.length)) return;
      here = { x: e.clientX, y: e.clientY };
      const next = targetAt(e.clientX, e.clientY);
      const same = (a, b) => (!a && !b) || (a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);
      if (same(next, snap)) return;
      snap = next;
      render();
      return;
    }
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

  document.addEventListener('mouseup', (e) => {
    if (ann.up()) return;
    if (!drag) return;
    const wasNew = drag.mode === 'new';
    drag = null;
    if (sel && (sel.w < MIN || sel.h < MIN)) {
      if (wasNew) {
        // A press with no drag is a click, and a click on a window means that window. Dragging a real
        // box says the opposite -- the user wants their own edges -- so snapping only ever fills in
        // for the gesture that would otherwise have done nothing at all.
        const hit = targetAt(e.clientX, e.clientY);
        sel = hit ? { x: hit.x, y: hit.y, w: hit.w, h: hit.h } : null;
        snap = null;
      }
    }
    render();
  });

  // double-click inside the selection confirms, like the screenshot tools people already use
  document.addEventListener('dblclick', (e) => {
    if (ann.tool) return;                       // 正在画的时候双击是画第二笔，不是「存」
    if (sel && sel.w >= MIN && sel.h >= MIN && !closest(e.target, '.toolbar')) confirm();
  });
  document.addEventListener('contextmenu', (e) => { e.preventDefault(); api.cancel(); });

  // ---------- keyboard ----------
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // 一层一层往回退，别一下子全丢：先收起工具，再放掉选区，最后才是整个放弃
      if (ann.tool) { pickTool(ann.tool); return; }
      if (sel && (windows.length || elBoxes.length)) { sel = null; snap = null; render(); return; }
      api.cancel();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); ann.undo(); return; }
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
    ann.commitText();                            // 还开着的输入框先落到画布上，别丢掉最后一句
    const rect = { x: sel.x, y: sel.y, width: sel.w, height: sel.h };
    // 只交出画上去的那一层，底图那一半留在主进程里从没被压过的原图上裁——
    // 送到这边来的桌面是 JPEG（为了快），拿它当底图存出去等于凭空掉一次画质。
    const ink2 = ann.empty() ? '' : ann.inkOnly({
      x: sel.x * scale, y: sel.y * scale, w: sel.w * scale, h: sel.h * scale,
    });
    api.select({ ...rect, ink: ink2 });
  }

  // ---------- 工具带 ----------
  function syncTools() {
    for (const b of document.querySelectorAll('.tool[data-tool]')) b.classList.toggle('on', b.dataset.tool === ann.tool);
    document.body.classList.toggle('drawing', !!ann.tool);
    $('#btnUndo').disabled = ann.empty();
    showPop();
  }
  function pickTool(next) { ann.setTool(next); syncTools(); }
  for (const b of document.querySelectorAll('.tool[data-tool]')) {
    b.addEventListener('click', () => pickTool(b.dataset.tool));
  }
  $('#btnUndo').addEventListener('click', () => { ann.undo(); syncTools(); });

  /** 粗细和颜色只在真的会用到的时候才升起来，贴着工具带的上沿 */
  function showPop() {
    if (!ann.tool) { pop.classList.add('hidden'); return; }
    pop.classList.remove('hidden');
    const tb = toolbar.getBoundingClientRect();
    const w = pop.offsetWidth || 240;
    const h = pop.offsetHeight || 34;
    pop.style.left = `${Math.max(4, Math.min(tb.left, innerWidth - w - 4))}px`;
    // 工具带自己有可能被顶到选区上面去，那时候调色板跟着翻到它下面，别飘出屏幕
    pop.style.top = tb.top - h - 6 >= 4 ? `${tb.top - h - 6}px` : `${tb.bottom + 6}px`;
  }
  window.Annotate.palette($('#sizes'), $('#swatches'), ann);
  $('#btnOk').addEventListener('click', confirm);
  // The same rectangle, handed over to be watched instead of cropped.
  $('#btnLong').addEventListener('click', () => {
    if (!sel || sel.w < MIN || sel.h < MIN) return;
    api.long({ x: sel.x, y: sel.y, width: sel.w, height: sel.h });
  });
  $('#btnCancel').addEventListener('click', () => api.cancel());
  window.addEventListener('blur', () => { /* keep the overlay up; Esc or right-click cancels */ });
})();
