'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('region', {
  onInit: (cb) => ipcRenderer.on('region:init', (_e, p) => cb(p)),
  onReset: (cb) => ipcRenderer.on('region:reset', () => cb()),
  select: (rect) => ipcRenderer.send('region:select', rect),
  cancel: () => ipcRenderer.send('region:cancel'),
});
