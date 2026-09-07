// Mock of the preload `window.viewer` API, for looking at the picture window in a browser.
(() => {
  const shots = ['/sample.png', '/assets/icon.png', '/assets/pet/avatar.png'];
  const pictures = shots.map((u, i) => ({ id: `p${i}`, fileUrl: u, title: `图片 ${i + 1}`, text: 'Hello world\nThis is the recognised text on the picture.' }));
  let cb = null;
  window.viewer = {
    onShow: (fn) => { cb = fn; setTimeout(() => fn({ entry: pictures[0], pictures }), 30); },
    list: async () => pictures,
    entry: async (id) => pictures.find((p) => p.id === id),
    close: () => console.log('close'),
    minimize: () => {},
    pin: async (on) => on,
    copyPng: async (d) => { console.log('copyPng', d.length, 'chars'); return { ok: true }; },
    translate: async (text) => ({ ok: true, text: `（示例翻译）${text}`, model: 'mock' }),
  };
})();
