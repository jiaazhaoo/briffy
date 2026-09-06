'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bubble', {
  onText: (cb) => ipcRenderer.on('bubble:text', (_e, p) => cb(p)),
  onLayout: (cb) => ipcRenderer.on('bubble:layout', (_e, p) => cb(p)),
  painted: () => ipcRenderer.send('bubble:painted'),
});
