'use strict';
// 在一张图上画点什么。看图那一页和框选截图那一屏用的是**同一份**。
//
// 画的东西存成一串形状（`shapes`），不是直接糊到像素上：所以可以撤销，可以在放大之后还对得上
// 位置，也可以在导出的时候按原图的分辨率重画一遍——屏幕上看到的是缩放后的样子，存出去的却是
// 原尺寸。**每个形状的坐标都记在「源图自己的像素」里**，不是屏幕坐标；缩放、旋转、平移，
// 以及框选那边「选区还能接着挪」，都只是换一种把它画出来的方式，不动已经画下的东西。
//
// 宿主要给三样：源图（读像素的地方，马赛克和导出都要它）、一张画布、一个把鼠标事件换算成
// 源图像素的函数。剩下的这里管。
(() => {
  const COLOURS = ['#2f7bf6', '#7ac70c', '#f5a623', '#4a4a4a', '#ffffff', '#f5514f'];
  const SIZES = [2, 4, 7, 12];

  /**
   * @param {object} o
   * @param {HTMLImageElement|HTMLCanvasElement} o.source 读像素的地方；坐标系是它的自然尺寸
   * @param {HTMLCanvasElement} o.canvas 画的那一层，宽高得是源图像素数
   * @param {HTMLTextAreaElement} [o.typing] 「添加文字」用的输入框，不给就没有这个工具
   * @param {(ev:MouseEvent)=>{x:number,y:number}} o.toLocal 屏幕事件 → 源图像素
   * @param {(p:{x:number,y:number})=>void} [o.placeTyping] 把输入框摆到这个点上（坐标系由宿主定）
   * @param {()=>void} [o.onChange] 形状有增减时叫一声（给按钮变灰用）
   */
  function create(o) {
    const { source, canvas, typing, toLocal } = o;
    const ctx = canvas.getContext('2d');
    let shapes = [];
    let tool = '';            // '' = 不画；rect / ellipse / pen / mosaic / text / crop
    let colour = COLOURS[5];
    let size = SIZES[1];
    let drawing = null;

    const changed = () => { if (o.onChange) o.onChange(); };

    function paint() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const s of shapes) drawShape(ctx, s);
    }

    function drawShape(c, s) {
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

    /** 马赛克：把框住的那块按格子重采样。读的是源图，所以放大之后也不会糊上一层旧像素 */
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
      sc.drawImage(source, x, y, w, h, 0, 0, small.width, small.height);
      c.imageSmoothingEnabled = false;
      c.drawImage(small, 0, 0, small.width, small.height, x, y, w, h);
      c.imageSmoothingEnabled = true;
    }

    // ---------- 手上的动作 ----------
    /** @returns {boolean} 接住了没有——没接住的话宿主拿回去做自己的事（拖着看、拉选区） */
    function down(ev) {
      if (typing && !typing.hidden) { commitText(); return true; }
      if (!tool) return false;
      ev.preventDefault();
      const p = toLocal(ev);
      if (tool === 'text') { openText(p); return true; }
      drawing = tool === 'pen'
        ? { kind: 'pen', pts: [p], colour, size }
        : { kind: tool, x: p.x, y: p.y, w: 0, h: 0, colour, size };
      if (tool !== 'crop') shapes.push(drawing);
      return true;
    }

    function move(ev) {
      if (!drawing) return false;
      const p = toLocal(ev);
      if (drawing.kind === 'pen') drawing.pts.push(p);
      else { drawing.w = p.x - drawing.x; drawing.h = p.y - drawing.y; }
      if (drawing.kind !== 'crop') paint();
      return true;
    }

    /** @returns {object|null} 刚画完的那个形状；裁剪工具靠它把框交出去 */
    function up() {
      if (!drawing) return null;
      const done = drawing;
      drawing = null;
      if (done.kind === 'crop') return done;
      // 一下点出来的空形状不留（笔画除外，它本来就可以只有一个点）
      if (done.kind !== 'pen' && Math.abs(done.w) < 3 && Math.abs(done.h) < 3) shapes.pop();
      paint();
      changed();
      return done;
    }

    // ---------- 打字 ----------
    function openText(p) {
      typing.hidden = false;
      typing.value = '';
      typing.dataset.x = p.x;
      typing.dataset.y = p.y;
      typing.style.color = colour;
      typing.style.fontSize = `${size * 5}px`;
      typing.style.lineHeight = '1.35';
      if (o.placeTyping) o.placeTyping(p);
      // 焦点要等这一轮的默认行为走完再给，不然会被 pointerdown 的默认行为抢走
      setTimeout(() => { typing.focus(); typing.setSelectionRange(0, 0); }, 0);
    }
    let committing = false;
    function commitText() {
      if (!typing || committing || typing.hidden) return;   // mousedown 和 blur 会前后脚各叫一次
      committing = true;
      const value = typing.value.trim();
      typing.hidden = true;
      committing = false;
      if (!value) return;
      shapes.push({ kind: 'text', x: +typing.dataset.x, y: +typing.dataset.y, text: value, colour, size });
      paint();
      changed();
    }
    if (typing) {
      typing.addEventListener('keydown', (ev) => {
        ev.stopPropagation();                                   // Esc / Enter 是这个框的，不是外面那一屏的
        if (ev.key === 'Escape') { typing.value = ''; typing.hidden = true; }
        if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) commitText();
      });
      typing.addEventListener('blur', commitText);
    }

    // ---------- 导出 ----------
    const boxOf = (crop) => crop || { x: 0, y: 0, w: source.naturalWidth || source.width, h: source.naturalHeight || source.height };

    /** 源图 + 画上去的东西，原尺寸 */
    function compose(crop = null) {
      const box = boxOf(crop);
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(box.w));
      out.height = Math.max(1, Math.round(box.h));
      const c = out.getContext('2d');
      c.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, out.width, out.height);
      c.translate(-box.x, -box.y);
      for (const s of shapes) drawShape(c, s);
      return out.toDataURL('image/png');
    }

    /**
     * 只有画上去的东西，底下是透明的。
     *
     * 框选截图走这一条：底图那一半留在主进程里，从没被压过的那张原图上裁——
     * 送过来给渲染层的那张桌面是 JPEG（为了快），拿它当底图存出去等于凭空掉一次画质。
     * 所以渲染层只交出这一层，主进程把两层叠起来。
     */
    function inkOnly(crop = null) {
      const box = boxOf(crop);
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(box.w));
      out.height = Math.max(1, Math.round(box.h));
      const c = out.getContext('2d');
      c.translate(-box.x, -box.y);
      for (const s of shapes) drawShape(c, s);
      return out.toDataURL('image/png');
    }

    // ---------- 工具 ----------
    /** 再点一下同一个就是收起来 */
    function setTool(next) { tool = tool === next ? '' : next; if (typing) commitText(); return tool; }

    return {
      get tool() { return tool; },
      get colour() { return colour; },
      set colour(v) { colour = v; },
      get size() { return size; },
      set size(v) { size = v; },
      get shapes() { return shapes; },
      empty: () => shapes.length === 0,
      setTool,
      paint,
      down,
      move,
      up,
      commitText,
      undo() { shapes.pop(); paint(); changed(); },
      reset() { shapes = []; tool = ''; paint(); changed(); },
      compose,
      inkOnly,
    };
  }

  /** 粗细和颜色那一排的内容。样式各家自己写，这里只管画出来和记住选了哪个 */
  function palette(sizesEl, swatchesEl, ann) {
    const render = () => {
      sizesEl.innerHTML = SIZES.map((s) => `<button type="button" data-size="${s}" class="${s === ann.size ? 'on' : ''}" title="${s}px"><i style="width:${Math.min(16, s + 3)}px;height:${Math.min(16, s + 3)}px"></i></button>`).join('');
      swatchesEl.innerHTML = COLOURS.map((c) => `<button type="button" data-colour="${c}" class="${c === ann.colour ? 'on' : ''}" style="background:${c}" title="${c}"></button>`).join('');
    };
    const onClick = (ev) => {
      const s = ev.target.closest('[data-size]');
      const c = ev.target.closest('[data-colour]');
      if (s) ann.size = Number(s.dataset.size);
      if (c) ann.colour = c.dataset.colour;
      if (s || c) render();
    };
    sizesEl.addEventListener('click', onClick);
    if (swatchesEl !== sizesEl) swatchesEl.addEventListener('click', onClick);
    render();
    return render;
  }

  window.Annotate = { create, palette, COLOURS, SIZES };
})();
