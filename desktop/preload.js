// DeepSeek Harness Desktop — preload bridge (contextIsolation on).
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dshDesktop', {
  // renderer -> main
  getInfo: () => ipcRenderer.invoke('dsh:get-info'),
  retryStart: () => ipcRenderer.send('dsh:retry-start'),

  // sidebar workspace
  getWorkspaceInfo: () => ipcRenderer.invoke('dsh:workspace-info'),
  listDir: (dirPath) => ipcRenderer.invoke('dsh:list-dir', dirPath),
  revealInExplorer: (p) => ipcRenderer.invoke('dsh:reveal', p),
  openFile: (p) => ipcRenderer.invoke('dsh:open-file', p),

  // workspace file-tree visibility (plugin-style toggle)
  toggleFileTree: () => ipcRenderer.invoke('dsh:toggle-file-tree'),
  setFileTree: (visible) => ipcRenderer.invoke('dsh:set-file-tree', visible),
  onFileTreeState: (callback) => {
    const listener = (_event, visible) => callback(visible);
    ipcRenderer.on('dsh:file-tree-state', listener);
    return () => ipcRenderer.removeListener('dsh:file-tree-state', listener);
  },

  // diagnostics
  logError: (msg) => ipcRenderer.send('dsh:log-error', msg),

  // skin awareness
  getSkinInfo: () => ipcRenderer.invoke('dsh:skin-info-get'),
  onSkinInfo: (callback) => {
    const listener = (_event, info) => callback(info);
    ipcRenderer.on('dsh:skin-info', listener);
    return () => ipcRenderer.removeListener('dsh:skin-info', listener);
  },

  // conversation safety net
  sessionBackup: () => ipcRenderer.invoke('dsh:session-backup'),
  sessionRollback: () => ipcRenderer.invoke('dsh:session-rollback'),
  sessionRestore: () => ipcRenderer.invoke('dsh:session-restore'),

  // main -> renderer subscription (returns an unsubscribe function)
  onServerStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('dsh:server-status', listener);
    return () => ipcRenderer.removeListener('dsh:server-status', listener);
  },
});
