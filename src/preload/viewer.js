'use strict';
// The picture viewer's bridge. It gets file urls and the four things a renderer cannot do itself.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('viewer', {
  onShow: (cb) => ipcRenderer.on('viewer:show', (_e, payload) => cb(payload)),
  list: () => ipcRenderer.invoke('viewer:list'),
  entry: (id) => ipcRenderer.invoke('viewer:entry', id),
  close: () => ipcRenderer.send('viewer:close'),
  minimize: () => ipcRenderer.send('viewer:minimize'),
  pin: (on) => ipcRenderer.invoke('viewer:pin', on),
  copyPng: (dataUrl) => ipcRenderer.invoke('viewer:copy-png', dataUrl),
  translate: (text) => ipcRenderer.invoke('viewer:translate', text),
});
