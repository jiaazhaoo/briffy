'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  click: () => ipcRenderer.send('pet:click'),
  regionCapture: () => ipcRenderer.send('pet:region'),
  dragStart: (p) => ipcRenderer.send('pet:drag-start', p),
  dragMove: (p) => ipcRenderer.send('pet:drag-move', p),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  contextMenu: () => ipcRenderer.send('pet:context-menu'),
  openWorkspace: () => ipcRenderer.send('pet:open-workspace'),
  drop: (payload) => ipcRenderer.invoke('pet:drop', payload),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch (_) { return ''; } },
  recordingState: (s) => ipcRenderer.send('pet:recording-state', s),
  submitAudio: (payload) => ipcRenderer.invoke('pet:audio', payload),
  requestMic: () => ipcRenderer.invoke('pet:request-mic'),
  micDenied: () => ipcRenderer.send('pet:mic-denied'),
  getConfig: () => ipcRenderer.invoke('pet:get-config'),
  micDevices: (devices) => ipcRenderer.send('pet:mic-devices', devices),
  micTestResult: (r) => ipcRenderer.send('pet:mic-test-result', r),
  log: (...args) => ipcRenderer.send('pet:log', args.map((a) => (a && a.message) || String(a)).join(' ')),
  onState: (cb) => ipcRenderer.on('pet:state', (_e, s) => cb(s)),
  onCommand: (cb) => ipcRenderer.on('pet:command', (_e, c) => cb(c)),
});
