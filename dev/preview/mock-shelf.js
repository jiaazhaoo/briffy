// Mock of the preload `window.shelf` API, for browser previews of the hover shelf.
// The panel normally opens because the main process says so; here it opens on its own after a beat,
// so the entrance animation plays exactly as it does in the app.
(() => {
  const now = new Date();
  const at = (min) => new Date(now.getTime() - min * 60000).toISOString();
  const entries = [
    { id: '1', title: '选 A，把 C 留作可切换的「列表」', createdAt: at(2), type: 'note', kind: '笔记', thumb: '', file: true, pinned: true, note: '版面就照这个来' },
    { id: '2', title: '截图 11:22', createdAt: at(8), type: 'screenshot', kind: '截图', thumb: '/sample.png', file: true },
    { id: '3', title: '为什么 SQLite 不需要服务器', createdAt: at(14), type: 'url', kind: '链接', source: 'bookmark', thumb: '', file: true },
    { id: '4', title: '剪贴板图片 11:05', createdAt: at(31), type: 'image', kind: '图片', source: 'clipboard', thumb: '/sample.png', file: true },
    { id: '5', title: '语音 10:58', createdAt: at(39), type: 'audio', kind: '语音', thumb: '', file: true },
    { id: '6', title: 'chrome://extensions/', createdAt: at(46), type: 'note', kind: '笔记', source: 'clipboard', thumb: '', file: true },
    { id: '7', title: '第三季度预算与路线图会议.pdf', createdAt: at(52), type: 'pdf', kind: 'PDF', thumb: '', file: true },
    { id: '8', title: '剪贴板图片 10:31', createdAt: at(66), type: 'image', kind: '图片', thumb: '/sample.png', file: true },
    { id: '9', title: '后端联调排在本周四，前端先按 mock 走', createdAt: at(74), type: 'note', kind: '笔记', thumb: '', file: true },
    { id: '10', title: 'photos.zip', createdAt: at(88), type: 'file', kind: '文件', thumb: '', file: true },
    { id: '11', title: 'Andrew Ng on X: "AI Engineering Skills Map"', createdAt: at(95), type: 'url', kind: '链接', thumb: '', file: true },
    { id: '12', title: '截图 09:52', createdAt: at(105), type: 'screenshot', kind: '截图', thumb: '/sample.png', file: true },
    { id: '13', title: '明天上午十点和产品团队开会', createdAt: at(118), type: 'note', kind: '笔记', thumb: '', file: true },
    { id: '14', title: '剪贴板图片 09:30', createdAt: at(127), type: 'image', kind: '图片', thumb: '/sample.png', file: true },
    { id: '15', title: 'Optical character recognition - Wikipedia', createdAt: at(140), type: 'url', kind: '链接', thumb: '', file: true },
  ];
  const strings = { open: '打开工作区', copied: '已复制', empty: '还没有记录。\n截图、复制点什么，就会出现在这里。' };
  let onShow = () => {}; let onIn = () => {};
  window.shelf = {
    onShow: (cb) => { onShow = cb; },
    onIn: (cb) => { onIn = cb; },
    onOut: (cb) => { window.__shelfOut = cb; },
    painted: () => setTimeout(() => onIn(), 30),      // the main process would show the window here
    faded: () => {},
    keep: () => {},
    leave: () => {},
    copy: async () => ({ ok: true }),
    dragOut: () => {},
    openWorkspace: () => {},
    log: (m) => console.log(m),
  };
  // replay the entrance on demand, the way hovering the pet does
  window.__shelfShow = () => onShow({ entries, strings, replay: true });
  setTimeout(() => window.__shelfShow(), 120);
})();
