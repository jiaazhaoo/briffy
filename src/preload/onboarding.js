'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('ob', {
  meta: invoke('ob:meta'),
  permissions: invoke('ob:permissions'),
  grant: invoke('ob:grant'),
  save: invoke('ob:save'),
  runSetup: invoke('ob:run-setup'),
  summary: invoke('ob:summary'),
  finish: invoke('ob:finish'),
  onSetup: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on('ob:setup-progress', h);
    return () => ipcRenderer.removeListener('ob:setup-progress', h);
  },
});
