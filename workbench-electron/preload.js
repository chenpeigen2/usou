'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wb', {
  getState: () => ipcRenderer.invoke('state:get'),
  startScan: (opts) => ipcRenderer.invoke('scan:start', opts),
  openPath: (p) => ipcRenderer.invoke('path:open', p),
  showInFolder: (p) => ipcRenderer.invoke('path:show', p),
  pathExists: (paths) => ipcRenderer.invoke('path:exists', paths),
  openIn: (p, mode) => ipcRenderer.invoke('open:in', p, mode),
  gitDetail: (p) => ipcRenderer.invoke('git:detail', p),
  projectDetail: (p) => ipcRenderer.invoke('project:detail', p),
  projectDirs: (p, force) => ipcRenderer.invoke('project:dirs', p, force),
  analyze: (root, force) => ipcRenderer.invoke('disk:analyze', root, force),
  saveSettings: (s) => ipcRenderer.invoke('settings:set', s),
  scanErrorsClear: () => ipcRenderer.invoke('scan-errors:clear'),
  briefCopy: (text) => ipcRenderer.invoke('brief:copy', text),
  briefExport: (md) => ipcRenderer.invoke('brief:export', md),
  loginItemSet: (open) => ipcRenderer.invoke('login-item:set', open),
  on: (ch, cb) => ipcRenderer.on(ch, (_e, payload) => cb(payload)),
  winMin: () => ipcRenderer.send('win:minimize'),
  winMax: () => ipcRenderer.send('win:maximize'),
  winClose: () => ipcRenderer.send('win:close'),
  onWinState: (cb) => ipcRenderer.on('win:state', (_e, m) => cb(m)),
  pulseStart: () => ipcRenderer.send('pulse:start'),
  pulseStop: () => ipcRenderer.send('pulse:stop'),
  onPulse: (cb) => ipcRenderer.on('pulse', (_e, s) => cb(s))
});
