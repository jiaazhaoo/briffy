'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('region', {
  onInit: (cb) => ipcRenderer.on('region:init', (_e, p) => cb(p)),
  onReset: (cb) => ipcRenderer.on('region:reset', () => cb()),
  select: (rect) => ipcRenderer.send('region:select', rect),
  long: (rect) => ipcRenderer.send('region:long', rect),      // 同一个框，但要滚动着拼成一张长图
  cancel: () => ipcRenderer.send('region:cancel'),
});
