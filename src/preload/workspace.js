'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const listen = (channel) => (cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('ws', {
  // 拖进窗口和拖到常驻头像上是同一件事，所以走同一个 ingest
  drop: (payload) => ipcRenderer.invoke('pet:drop', payload),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch (_) { return ''; } },
  getSettings: invoke('ws:get-settings'),
  saveSettings: invoke('ws:save-settings'),
  petCatalog: invoke('ws:pet-catalog'),
  petSetAvatar: invoke('ws:pet-set-avatar'),
  testProvider: invoke('ws:test-provider'),
  providerStatus: invoke('ws:provider-status'),
  openrouterModels: invoke('ws:openrouter-models'),
  openrouterLogin: invoke('ws:openrouter-login'),
  openrouterCancelLogin: invoke('ws:openrouter-cancel-login'),
  anthropicLogin: invoke('ws:anthropic-login'),
  ollamaPull: invoke('ws:ollama-pull'),
  ollamaInstall: invoke('ws:ollama-install'),
  ollamaStart: invoke('ws:ollama-start'),
  ollamaRemove: invoke('ws:ollama-remove'),
  forgetPendingPull: invoke('ws:forget-pending-pull'),
  ffmpegStatus: invoke('ws:ffmpeg-status'),
  ffmpegInstall: invoke('ws:ffmpeg-install'),
  onFfmpegInstall: listen('ws:ffmpeg-install-progress'),
  onOllamaInstall: listen('ws:ollama-install-progress'),
  openExtensionDir: invoke('ws:open-extension-dir'),
  extensionStatus: invoke('ws:extension-status'),
  openExtensionGuide: invoke('ws:open-extension-guide'),
  // 接进来的东西。凭据只从这里往主进程走，回来的永远只有状态。
  connectList: () => ipcRenderer.invoke('ws:connect-list'),
  connectSet: (name, creds) => ipcRenderer.invoke('ws:connect-set', name, creds),
  connectDrop: (name) => ipcRenderer.invoke('ws:connect-drop', name),
  connectSync: (name, opts) => ipcRenderer.invoke('ws:connect-sync', name, opts),
  onConnectProgress: listen('ws:connect-progress'),
  importPick: () => ipcRenderer.invoke('ws:import-pick'),
  onExtension: listen('ws:extension'),
  exportExtension: invoke('ws:export-extension'),
  runSetup: invoke('ws:run-setup'),
  onSetup: listen('ws:setup-progress'),
  micDevices: invoke('ws:mic-devices'),
  micTest: invoke('ws:mic-test'),
  onOllamaPull: listen('ws:ollama-pull-progress'),
  chooseDir: invoke('ws:choose-dir'),
  listDates: invoke('ws:list-dates'),
  listEntries: invoke('ws:list-entries'),
  searchNear: (q, exclude) => ipcRenderer.invoke('ws:search-near', q, exclude),
  getEntry: invoke('ws:get-entry'),
  deleteEntry: invoke('ws:delete-entry'),
  retryEntry: invoke('ws:retry-entry'),
  updateEntry: invoke('ws:update-entry'),
  openEntry: invoke('ws:open-entry'),
  revealEntry: invoke('ws:reveal-entry'),
  openExternal: invoke('ws:open-external'),
  openWorkspaceDir: invoke('ws:open-workspace-dir'),
  addFiles: invoke('ws:add-files'),
  addUrl: invoke('ws:add-url'),
  addNote: invoke('ws:add-note'),
  capture: invoke('ws:capture'),
  listSummaries: invoke('ws:list-summaries'),
  getSummary: invoke('ws:get-summary'),
  generateSummary: invoke('ws:generate-summary'),
  ask: invoke('ws:ask'),
  stats: invoke('ws:stats'),
  entryBoxes: invoke('ws:entry-boxes'),        // where each line of recognised text sits on a picture
  dayStats: invoke('ws:day-stats'),            // one day by counting, plus whether briffy was running
  contextProbe: invoke('ws:context-probe'),    // what this machine can tell us about the front app
  entryLink: invoke('ws:entry-link'),
  nameSpeaker: invoke('ws:name-speaker'),      // give one of the remembered voices a name          // briffy://entry/<id>
  onEntry: listen('ws:entry'),
  onSummary: listen('ws:summary'),
  onSettings: listen('ws:settings'),
  onNavigate: listen('ws:navigate'),
});
