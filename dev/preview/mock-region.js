'use strict';
// The selection overlay in a normal browser, so the snapping can be seen and clicked.
// The window rectangles are the real ones off this machine, dumped by dev/window-snap-test.js.
(() => {
  const handlers = {};
  window.region = {
    onInit: (fn) => { handlers.init = fn; },
    onReset: (fn) => { handlers.reset = fn; },
    select: (rect) => { window.__picked = rect; console.log('[mock] select', rect); document.title = `picked ${Math.round(rect.width)}x${Math.round(rect.height)}`; },
    cancel: () => { window.__cancelled = true; console.log('[mock] cancel'); document.title = 'cancelled'; },
  };

  // A stand-in desktop: a few blocks so the frozen picture is not a flat colour.
  const c = document.createElement('canvas');
  c.width = 1440; c.height = 900;
  const g = c.getContext('2d');
  g.fillStyle = '#3b3f4a'; g.fillRect(0, 0, c.width, c.height);
  for (const [x, y, w, h, fill] of [
    [40, 60, 620, 420, '#f3f1ec'], [500, 60, 520, 300, '#e6e9f2'],
    [200, 520, 760, 320, '#2b3350'], [980, 400, 380, 460, '#f7ede1'],
  ]) { g.fillStyle = fill; g.fillRect(x, y, w, h); }
  g.fillStyle = '#8a8f9a'; g.font = '20px sans-serif';
  g.fillText('mock desktop — hover a window, click to snap; drag for a free box', 60, 40);

  window.addEventListener('DOMContentLoaded', () => {
    window.__initCalled = !!handlers.init;
    const payload = {
      image: c.toDataURL('image/jpeg', 0.9),
      scale: 2,
      // deliberately overlapping and in front-to-back order, like CGWindowList gives them
      windows: [
        { app: 'WeChat', title: '微信', x: 500, y: 60, w: 520, h: 300 },   // deliberately over Chrome's right edge
        { app: 'Google Chrome', title: 'Facebook', x: 40, y: 60, w: 620, h: 420 },
        { app: 'Terminal', title: 'jia — briffy', x: 200, y: 520, w: 760, h: 320 },
        { app: 'Finder', title: 'Downloads', x: 980, y: 400, w: 380, h: 460 },
        { app: 'OffScreen', title: 'half outside', x: 1300, y: 700, w: 400, h: 400 },
      ],
      strings: { hint: '拖动选择区域 · <kbd>Esc</kbd> 取消', ok: '保存', cancel: '取消', long: '长截图', tools: { rect: '画框', ellipse: '画圆', pen: '画笔', mosaic: '马赛克', text: '添加文字', undo: '撤销' } },
    };
    window.__init = payload;                 // so a probe can see exactly what the overlay was handed
    handlers.init && handlers.init(payload);
  });
})();
