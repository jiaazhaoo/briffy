'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('listen', {
  ready: () => ipcRenderer.send('listen:ready'),
  onCommand: (cb) => ipcRenderer.on('listen:command', (_e, c) => cb(c)),
  state: (s) => ipcRenderer.send('listen:state', s),
  segment: (seg) => ipcRenderer.send('listen:segment', seg),
});
