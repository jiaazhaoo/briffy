'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const listen = (channel) => (cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('ws', {
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
  onOllamaInstall: listen('ws:ollama-install-progress'),
  openExtensionDir: invoke('ws:open-extension-dir'),
  extensionStatus: invoke('ws:extension-status'),
  openExtensionGuide: invoke('ws:open-extension-guide'),
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
  stats: invoke('ws:stats'),
  onEntry: listen('ws:entry'),
  onSummary: listen('ws:summary'),
  onSettings: listen('ws:settings'),
  onNavigate: listen('ws:navigate'),
});
