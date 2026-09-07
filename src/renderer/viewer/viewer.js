'use strict';
/* global viewer */
// 看一张图，并且在上面画点什么。
//
// 画的东西存成一串形状（`shapes`），不是直接糊到像素上：所以可以撤销，可以在放大之后还对得上位置，
// 也可以在导出的时候按原图的分辨率重画一遍——屏幕上看到的是缩放后的样子，复制出去的却是原尺寸。
// 每个形状的坐标都记在**图片自己的像素**里，不是屏幕坐标；缩放和旋转只改变怎么把它画出来。
//
// 马赛克是唯一一个要读原图的：它把框住的那一块按 12px 一格重新采样，画回同一个位置。
(() => {
  const api = window.viewer;
  const $ = (s) => document.querySelector(s);

  const stage = $('#stage');
  const wrap = $('#wrap');
  const pic = $('#pic');
  const ink = $('#ink');
  const ctx = ink.getContext('2d');
  const marq = $('#marquee');
  const typing = $('#typing');
  const pop = $('#pop');

  const COLOURS = ['#2f7bf6', '#7ac70c', '#f5a623', '#4a4a4a', '#ffffff', '#f5514f'];
  const SIZES = [2, 4, 7, 12];

  let entry = null;
  let all = [];
  let shapes = [];
  let tool = '';              // '' = 只是看；rect / ellipse / pen / mosaic / text / crop
  let colour = COLOURS[5];
  let size = SIZES[1];
  let zoom = 1;
  let rot = 0;                // 0 / 90 / 180 / 270
  let fitZoom = 1;
  let pinned = false;
  let drawing = null;         // 正在画的那个形状
  let panFrom = null;
  let pan = { x: 0, y: 0 };

  const t = (k) => ({
    vGrid: '展开', vZoomOut: '缩小', vZoomIn: '放大', vFit: '实际大小 / 适应窗口', vRotate: '旋转',
    vRect: '画框', vEllipse: '画圆', vPen: '画笔', vMosaic: '马赛克', vText: '添加文字', vCrop: '截图',
    vUndo: '撤销', vTranslate: '一键翻译', vCopy: '复制', vPin: '钉在最上层', close: '关闭',
    copied: '已复制', copyFailed: '复制失败', cropped: '已裁剪', pinOn: '已钉在最上层', pinOff: '取消钉住',
    translating: '翻译中…', noProvider: '还没配 AI 服务', noText: '这张图上没有认出文字', transFailed: '翻译失败',
  }[k] || k);

  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);

  // ---------- 图片 ----------
  function show(payload) {
    all = payload.pictures || [];
    load(payload.entry);
    renderGrid();
  }
  function load(e) {
    if (!e) return;
    entry = e;
    shapes = [];
    rot = 0; pan = { x: 0, y: 0 };
    pic.onload = () => { fit(); renderGrid(); };
    pic.src = e.fileUrl || '';
    document.title = e.title || 'briffy';
  }

  /** 图在窗口里最大能显示到多大——一进来就是这个大小，也是**能缩到的最小**。
      再往下缩就只是把图丢进一片空底里，没人想看那个。 */
  function fit() {
    const box = stage.getBoundingClientRect();
    const w = rot % 180 === 0 ? pic.naturalWidth : pic.naturalHeight;
    const h = rot % 180 === 0 ? pic.naturalHeight : pic.naturalWidth;
    if (!w || !h) return;
    fitZoom = Math.min(1, (box.width - 48) / w, (box.height - 24) / h);
    zoom = fitZoom;
    pan = { x: 0, y: 0 };
    layout();
  }

  function layout() {
    ink.width = pic.naturalWidth;
    ink.height = pic.naturalHeight;
    wrap.style.width = `${pic.naturalWidth}px`;
    wrap.style.height = `${pic.naturalHeight}px`;
    wrap.style.transform = `translate(${pan.x}px, ${pan.y}px) rotate(${rot}deg) scale(${zoom})`;
    paint();
  }

  // 屏幕坐标 → 图片自己的像素。旋转之后 x/y 会换位，所以别用 getBoundingClientRect 反推
  function toPic(ev) {
    const r = pic.getBoundingClientRect();
    const cx = ev.clientX - (r.left + r.width / 2);
    const cy = ev.clientY - (r.top + r.height / 2);
    const rad = (-rot * Math.PI) / 180;
    const ux = (cx * Math.cos(rad) - cy * Math.sin(rad)) / zoom;
    const uy = (cx * Math.sin(rad) + cy * Math.cos(rad)) / zoom;
    return { x: ux + pic.naturalWidth / 2, y: uy + pic.naturalHeight / 2 };
  }

  // ---------- 画 ----------
  function paint(target = ctx, scale = 1) {
    target.clearRect(0, 0, ink.width, ink.height);
    for (const s of shapes) drawShape(target, s, scale);
  }

  function drawShape(c, s, scale = 1) {
    c.save();
    c.strokeStyle = s.colour;
    c.fillStyle = s.colour;
    c.lineWidth = Math.max(1, s.size);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if (s.kind === 'rect') c.strokeRect(s.x, s.y, s.w, s.h);
    else if (s.kind === 'ellipse') {
      c.beginPath();
      c.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.abs(s.w / 2), Math.abs(s.h / 2), 0, 0, Math.PI * 2);
      c.stroke();
    } else if (s.kind === 'pen') {
      c.beginPath();
      s.pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
      c.stroke();
    } else if (s.kind === 'text') {
      c.font = `600 ${s.size * 5}px ${getComputedStyle(document.body).fontFamily}`;
      c.textBaseline = 'top';
      s.text.split('\n').forEach((line, i) => c.fillText(line, s.x, s.y + i * s.size * 6.6));
    } else if (s.kind === 'mosaic') {
      mosaic(c, s);
    }
    c.restore();
  }

  /** 马赛克：把框住的那块按格子重采样。读的是原图，所以放大之后也不会糊上一层旧像素 */
  function mosaic(c, s) {
    const x = Math.round(Math.min(s.x, s.x + s.w));
    const y = Math.round(Math.min(s.y, s.y + s.h));
    const w = Math.round(Math.abs(s.w));
    const h = Math.round(Math.abs(s.h));
    if (w < 2 || h < 2) return;
    const step = Math.max(6, s.size * 3);
    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.round(w / step));
    small.height = Math.max(1, Math.round(h / step));
    const sc = small.getContext('2d');
    sc.imageSmoothingEnabled = true;
    sc.drawImage(pic, x, y, w, h, 0, 0, small.width, small.height);
    c.imageSmoothingEnabled = false;
    c.drawImage(small, 0, 0, small.width, small.height, x, y, w, h);
    c.imageSmoothingEnabled = true;
  }

  // ---------- 手上的动作 ----------
  stage.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    if (typing.hidden === false) { commitText(); return; }
    // 按下去的默认行为是把焦点交给被点的那个元素——刚 focus() 的输入框会当场被抢走，
    // 于是 blur 立刻触发、框又关上了，看着就是「添加文字不好使」
    if (tool) ev.preventDefault();
    if (!tool) {                                   // 没选工具就是拖着看
      if (zoom <= fitZoom + 0.001) return;
      panFrom = { x: ev.clientX - pan.x, y: ev.clientY - pan.y };
      document.body.classList.add('panning');
      return;
    }
    const p = toPic(ev);
    if (tool === 'text') { openText(p); return; }
    if (tool === 'crop') { drawing = { kind: 'crop', x: p.x, y: p.y, w: 0, h: 0 }; marq.hidden = false; startMarq(ev); return; }
    drawing = tool === 'pen'
      ? { kind: 'pen', pts: [p], colour, size }
      : { kind: tool, x: p.x, y: p.y, w: 0, h: 0, colour, size };
    shapes.push(drawing);
  });

  window.addEventListener('pointermove', (ev) => {
    if (panFrom) { pan = { x: ev.clientX - panFrom.x, y: ev.clientY - panFrom.y }; layout(); return; }
    if (!drawing) return;
    const p = toPic(ev);
    if (drawing.kind === 'pen') drawing.pts.push(p);
    else { drawing.w = p.x - drawing.x; drawing.h = p.y - drawing.y; }
    if (drawing.kind === 'crop') moveMarq(ev); else paint();
  });

  window.addEventListener('pointerup', async () => {
    document.body.classList.remove('panning');
    panFrom = null;
    if (!drawing) return;
    const done = drawing;
    drawing = null;
    if (done.kind === 'crop') { marq.hidden = true; marqStart = null; applyCrop(done); return; }
    // 一下点出来的空形状不留（笔画除外，它本来就可以只有一个点）
    if (done.kind !== 'pen' && Math.abs(done.w) < 3 && Math.abs(done.h) < 3) shapes.pop();
    paint();
  });

  let marqStart = null;
  function startMarq(ev) { marqStart = { x: ev.clientX, y: ev.clientY }; moveMarq(ev); }
  function moveMarq(ev) {
    if (!marqStart) return;
    const l = Math.min(marqStart.x, ev.clientX), tp = Math.min(marqStart.y, ev.clientY);
    marq.style.cssText = `position:fixed;left:${l}px;top:${tp}px;width:${Math.abs(ev.clientX - marqStart.x)}px;height:${Math.abs(ev.clientY - marqStart.y)}px`;
  }

  // ---------- 打字 ----------
  function openText(p) {
    typing.hidden = false;
    typing.value = '';
    typing.dataset.x = p.x;
    typing.dataset.y = p.y;
    // .canvasWrap 的坐标系就是图片自己的像素（外面那层 transform 负责缩放和旋转），
    // 所以这里直接用 p，不需要再拿 clientX 反推一次
    typing.style.left = `${p.x}px`;
    typing.style.top = `${p.y}px`;
    typing.style.color = colour;
    typing.style.fontSize = `${size * 5}px`;
    typing.style.lineHeight = '1.35';
    // 焦点要等这一轮的默认行为走完再给，不然还是会被抢走
    setTimeout(() => { typing.focus(); typing.setSelectionRange(0, 0); }, 0);
  }
  let committing = false;
  function commitText() {
    if (committing || typing.hidden) return;   // pointerdown 和 blur 会前后脚各叫一次
    committing = true;
    const value = typing.value.trim();
    typing.hidden = true;
    committing = false;
    if (!value) return;
    shapes.push({ kind: 'text', x: +typing.dataset.x, y: +typing.dataset.y, text: value, colour, size });
    paint();
  }
  typing.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { typing.value = ''; typing.hidden = true; }
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) commitText();
  });
  typing.addEventListener('blur', commitText);

  // ---------- 导出 ----------
  /** 整张图（连同画上去的东西），原尺寸 */
  function compose(crop = null) {
    const out = document.createElement('canvas');
    const box = crop || { x: 0, y: 0, w: pic.naturalWidth, h: pic.naturalHeight };
    out.width = Math.max(1, Math.round(box.w));
    out.height = Math.max(1, Math.round(box.h));
    const c = out.getContext('2d');
    c.drawImage(pic, box.x, box.y, box.w, box.h, 0, 0, out.width, out.height);
    c.translate(-box.x, -box.y);
    for (const s of shapes) drawShape(c, s);
    return out.toDataURL('image/png');
  }

  async function copyWhole() {
    const r = await api.copyPng(compose());
    toast(t(r && r.ok ? 'copied' : 'copyFailed'));
  }
  /** 裁剪：把当前这张图换成框住的那一块。画上去的东西一并烙进去，然后清空——
      它们已经是新图的一部分了，再留着形状会画第二遍。原文件不动，这里只是眼前这一张。 */
  function applyCrop(box) {
    const x = Math.max(0, Math.min(box.x, box.x + box.w));
    const y = Math.max(0, Math.min(box.y, box.y + box.h));
    const w = Math.min(Math.abs(box.w), pic.naturalWidth - x);
    const h = Math.min(Math.abs(box.h), pic.naturalHeight - y);
    if (w < 4 || h < 4) return;
    const url = compose({ x, y, w, h });
    shapes = [];
    pic.onload = () => { fit(); };
    pic.src = url;
    pickTool('crop');                 // 裁完就把工具收起来，别一松手又开始框
    toast(t('cropped'));
  }

  // ---------- 工具条 ----------
  function pickTool(next) {
    tool = tool === next ? '' : next;
    for (const b of document.querySelectorAll('.tool')) b.classList.toggle('on', b.dataset.tool === tool);
    document.body.classList.toggle('drawing', !!tool);
    showPop();
  }
  for (const b of document.querySelectorAll('.tool')) b.addEventListener('click', () => pickTool(b.dataset.tool));

  /** 粗细和颜色只在真的会用到的时候才升起来，而且贴着当前那个工具 */
  function showPop() {
    if (!tool || tool === 'crop') { pop.hidden = true; return; }
    const b = document.querySelector(`.tool[data-tool="${tool}"]`);
    pop.hidden = false;
    const r = b.getBoundingClientRect();
    const w = pop.offsetWidth || 260;
    pop.style.left = `${Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2))}px`;
  }
  function renderPop() {
    $('#sizes').innerHTML = SIZES.map((s) => `<button type="button" data-size="${s}" class="${s === size ? 'on' : ''}" title="${s}px"><i style="width:${Math.min(16, s + 3)}px;height:${Math.min(16, s + 3)}px"></i></button>`).join('');
    $('#swatches').innerHTML = COLOURS.map((c) => `<button type="button" data-colour="${c}" class="${c === colour ? 'on' : ''}" style="background:${c}" title="${c}"></button>`).join('');
  }
  pop.addEventListener('click', (ev) => {
    const s = ev.target.closest('[data-size]');
    const c = ev.target.closest('[data-colour]');
    if (s) size = Number(s.dataset.size);
    if (c) colour = c.dataset.colour;
    if (s || c) renderPop();
  });

  // 下限是 fitZoom：图最小也要占满这个框的宽或高
  const clampZoom = (z) => Math.max(fitZoom, Math.min(8, z));

  /**
   * 缩放，并且让 (ax, ay) 这个点底下的画面待在原地。
   *
   * 图是绕**自己的中心**缩放的，所以要盯住的那个点相对中心的向量 v 会被拉成 f·v；
   * 把 pan 反向补上 (f−1)·v，那个点就不动了。中心必须现算——台面有内边距，
   * 展开那张网格之后右边还会缩进去一截，拿窗口中心当图的中心是错的（上一版就是这么错的）。
   */
  function zoomAt(next, ax, ay) {
    const before = zoom;
    const after = clampZoom(next);
    if (Math.abs(after - before) < 0.0001) return;
    const r = wrap.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const f = after / before;
    zoom = after;
    pan = { x: pan.x - (ax - cx) * (f - 1), y: pan.y - (ay - cy) * (f - 1) };
    if (zoom <= fitZoom + 0.0001) pan = { x: 0, y: 0 };   // 缩回铺满就归位，别停在偏一边
    layout();
  }
  /** 按钮没有鼠标位置，就盯住台面的中心 */
  function stageMid() { const b = stage.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }
  $('#tIn').addEventListener('click', () => zoomAt(zoom * 1.25, ...stageMid()));
  $('#tOut').addEventListener('click', () => zoomAt(zoom / 1.25, ...stageMid()));
  $('#tFit').addEventListener('click', () => {
    if (Math.abs(zoom - 1) < 0.01) fit();
    else { zoom = clampZoom(1); pan = { x: 0, y: 0 }; layout(); }
  });
  $('#tRot').addEventListener('click', () => { rot = (rot + 90) % 360; fit(); });
  $('#tUndo').addEventListener('click', () => { shapes.pop(); paint(); });
  $('#tCopy').addEventListener('click', copyWhole);
  $('#vClose').addEventListener('click', () => api.close());

  $('#tPin').addEventListener('click', async () => {
    pinned = await api.pin(!pinned);
    $('#tPin').classList.toggle('on', pinned);
    toast(t(pinned ? 'pinOn' : 'pinOff'));
  });

  $('#tGrid').addEventListener('click', () => {
    const open = document.body.classList.toggle('gridOpen');
    $('#grid').hidden = !open;
    $('#tGrid').classList.toggle('on', open);
    requestAnimationFrame(() => setTimeout(fit, 170));
  });

  $('#tTrans').addEventListener('click', async () => {
    const body = (entry && (entry.text || '').trim()) || '';
    $('#trans').hidden = false;
    $('#transTitle').textContent = t('translating');
    $('#transBody').textContent = '';
    const r = await api.translate(body);
    if (r && r.ok) { $('#transTitle').textContent = r.model || ''; $('#transBody').textContent = r.text; return; }
    $('#transTitle').textContent = '';
    $('#transBody').textContent = t(r && r.reason ? r.reason : 'transFailed');
  });
  $('#transClose').addEventListener('click', () => { $('#trans').hidden = true; });

  function renderGrid() {
    $('#gridIn').innerHTML = all.map((e) => `<button type="button" data-id="${e.id}" class="${entry && e.id === entry.id ? 'now' : ''}">`
      + `<img src="${e.fileUrl}" loading="lazy" alt="" /></button>`).join('');
  }
  $('#gridIn').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-id]');
    if (!b) return;
    load(all.find((x) => x.id === b.dataset.id));
  });

  // 滚轮缩放，围着鼠标；两指平移
  stage.addEventListener('wheel', (ev) => {
    if (!ev.ctrlKey && !ev.metaKey && Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) return;
    ev.preventDefault();
    zoomAt(zoom * (ev.deltaY < 0 ? 1.08 : 1 / 1.08), ev.clientX, ev.clientY);
  }, { passive: false });

  document.addEventListener('keydown', (ev) => {
    if (!typing.hidden) return;
    if (ev.key === 'Escape') { if (tool) pickTool(tool); else api.close(); }
    if (ev.key === '+' || ev.key === '=') $('#tIn').click();
    if (ev.key === '-') $('#tOut').click();
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z') { shapes.pop(); paint(); }
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'c') copyWhole();
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
      const i = all.findIndex((x) => entry && x.id === entry.id);
      const next = all[i + (ev.key === 'ArrowRight' ? 1 : -1)];
      if (next) load(next);
    }
  });

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 1600);
  }

  // 窗口一变，「铺满」是多少也跟着变；当前缩放要是掉到新的下限以下，把它顶回去
  window.addEventListener('resize', () => {
    const was = zoom;
    fit();
    if (was > fitZoom) { zoom = Math.min(8, was); layout(); }
    showPop();
  });
  renderPop();
  if (api && api.onShow) api.onShow(show);
})();
