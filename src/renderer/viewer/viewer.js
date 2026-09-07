'use strict';
/* global viewer */
// 看一张图，并且在上面画点什么。
//
// 画的那一套（形状、撤销、马赛克、导出）在 src/renderer/shared/annotate.js，
// 框选截图那一屏用的是同一份——两处都要能在图上画，没有理由各写一遍，写两遍就会各歪各的。
// 这里只剩看图这一半：缩放、旋转、平移、翻页，以及把屏幕坐标换算成图片自己的像素。
(() => {
  const api = window.viewer;
  const $ = (s) => document.querySelector(s);

  const stage = $('#stage');
  const wrap = $('#wrap');
  const pic = $('#pic');
  const ink = $('#ink');
  const marq = $('#marquee');
  const typing = $('#typing');
  const pop = $('#pop');

  let entry = null;
  let all = [];
  let zoom = 1;
  let rot = 0;                // 0 / 90 / 180 / 270
  let fitZoom = 1;
  let pinned = false;
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
    ann.reset(); syncTools();
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

  // 画的那一套：形状、撤销、马赛克、导出，都在共用的那一份里。这里只负责告诉它
  // 「源图是谁」「画在哪张布上」「一个鼠标点落在图片的哪个像素上」。
  const ann = window.Annotate.create({
    source: pic,
    canvas: ink,
    typing,
    toLocal: toPic,
    // .canvasWrap 的坐标系就是图片自己的像素（外面那层 transform 负责缩放和旋转），
    // 所以直接用 p，不需要再拿 clientX 反推一次
    placeTyping: (p) => { typing.style.left = `${p.x}px`; typing.style.top = `${p.y}px`; },
  });
  const paint = () => ann.paint();

  // ---------- 手上的动作 ----------
  // 引擎先看这一下是不是它的：选了工具就是它的，没选工具就是「拖着看」。
  stage.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    if (ann.down(ev)) { if (ann.tool === 'crop') { marq.hidden = false; startMarq(ev); } return; }
    if (zoom <= fitZoom + 0.001) return;
    panFrom = { x: ev.clientX - pan.x, y: ev.clientY - pan.y };
    document.body.classList.add('panning');
  });

  window.addEventListener('pointermove', (ev) => {
    if (panFrom) { pan = { x: ev.clientX - panFrom.x, y: ev.clientY - panFrom.y }; layout(); return; }
    if (ann.move(ev) && ann.tool === 'crop') moveMarq(ev);
  });

  window.addEventListener('pointerup', () => {
    document.body.classList.remove('panning');
    panFrom = null;
    const done = ann.up();
    if (done && done.kind === 'crop') { marq.hidden = true; marqStart = null; applyCrop(done); }
  });

  let marqStart = null;
  function startMarq(ev) { marqStart = { x: ev.clientX, y: ev.clientY }; moveMarq(ev); }
  function moveMarq(ev) {
    if (!marqStart) return;
    const l = Math.min(marqStart.x, ev.clientX), tp = Math.min(marqStart.y, ev.clientY);
    marq.style.cssText = `position:fixed;left:${l}px;top:${tp}px;width:${Math.abs(ev.clientX - marqStart.x)}px;height:${Math.abs(ev.clientY - marqStart.y)}px`;
  }


  // ---------- 导出 ----------
  async function copyWhole() {
    const r = await api.copyPng(ann.compose());
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
    const url = ann.compose({ x, y, w, h });
    ann.reset();                      // 画的东西已经烙进新图了，留着形状会画第二遍
    pic.onload = () => { fit(); };
    pic.src = url;
    syncTools();                      // 裁完就把工具收起来，别一松手又开始框
    toast(t('cropped'));
  }

  // ---------- 工具条 ----------
  function syncTools() {
    for (const b of document.querySelectorAll('.tool')) b.classList.toggle('on', b.dataset.tool === ann.tool);
    document.body.classList.toggle('drawing', !!ann.tool);
    showPop();
  }
  function pickTool(next) { ann.setTool(next); syncTools(); }
  for (const b of document.querySelectorAll('.tool')) b.addEventListener('click', () => pickTool(b.dataset.tool));

  /** 粗细和颜色只在真的会用到的时候才升起来，而且贴着当前那个工具 */
  function showPop() {
    if (!ann.tool || ann.tool === 'crop') { pop.hidden = true; return; }
    const b = document.querySelector(`.tool[data-tool="${ann.tool}"]`);
    pop.hidden = false;
    const r = b.getBoundingClientRect();
    const w = pop.offsetWidth || 260;
    pop.style.left = `${Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2))}px`;
  }
  const renderPop = window.Annotate.palette($('#sizes'), $('#swatches'), ann);

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
  $('#tUndo').addEventListener('click', () => ann.undo());
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
    if (ev.key === 'Escape') { if (ann.tool) pickTool(ann.tool); else api.close(); }
    if (ev.key === '+' || ev.key === '=') $('#tIn').click();
    if (ev.key === '-') $('#tOut').click();
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z') ann.undo();
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
