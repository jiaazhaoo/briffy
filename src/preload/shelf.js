'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shelf', {
  onShow: (cb) => ipcRenderer.on('shelf:show', (_e, p) => cb(p)),
  onIn: (cb) => ipcRenderer.on('shelf:in', () => cb()),
  onOut: (cb) => ipcRenderer.on('shelf:out', () => cb()),
  painted: () => ipcRenderer.send('shelf:painted'),
  faded: () => ipcRenderer.send('shelf:faded'),
  keep: () => ipcRenderer.send('shelf:keep'),
  leave: () => ipcRenderer.send('shelf:leave'),
  copy: (id) => ipcRenderer.invoke('shelf:copy', id),
  dragOut: (id) => ipcRenderer.send('shelf:drag-out', id),
  openWorkspace: () => ipcRenderer.send('shelf:open-workspace'),
  log: (msg) => ipcRenderer.send('pet:log', msg),
});
