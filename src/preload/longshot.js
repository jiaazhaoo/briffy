'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('longshot', {
  onInit: (cb) => ipcRenderer.on('longshot:init', (_e, p) => cb(p)),
  // Awaited: the next frame must be taken after the scroll, not during it.
  step: (dy) => ipcRenderer.invoke('longshot:step', dy),
  done: (payload) => ipcRenderer.send('longshot:done', payload),
  cancel: () => ipcRenderer.send('longshot:cancel'),
});
