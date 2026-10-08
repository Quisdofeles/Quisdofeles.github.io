// preload.js: the secure bridge between the renderer and the main process.
// It exposes ONE object, window.api, built with contextBridge. The renderer cannot reach Node or fs;
// every capability it has is listed here and handled in main.js.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // JSON data
  loadLibrary: () => ipcRenderer.invoke('library:load'),
  saveLibrary: (data) => ipcRenderer.invoke('library:save', data),
  loadSession: () => ipcRenderer.invoke('session:load'),
  saveSession: (data) => ipcRenderer.invoke('session:save', data),

  // Files
  importFiles: () => ipcRenderer.invoke('files:import'),
  readLibraryFile: (relPath) => ipcRenderer.invoke('files:read', relPath),
  saveExport: (dataUrl, format) => ipcRenderer.invoke('export:save', dataUrl, format),
  openLibraryFolder: () => ipcRenderer.invoke('library:openFolder'),
  readBundledFont: (name) => ipcRenderer.invoke('fonts:bundled', name),

  // Trash: syncTrash makes the disk match the list; purgeTrashFiles deletes for good.
  syncTrash: (files) => ipcRenderer.invoke('trash:sync', files),
  purgeTrashFiles: (files) => ipcRenderer.invoke('trash:purge', files),

  getVersion: () => ipcRenderer.invoke('app:version'),

  // Window controls (the app is frameless, so the renderer draws its own buttons)
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximizeChange: (cb) => ipcRenderer.on('window:maximize-change', (e, isMax) => cb(isMax)),
  },

  // Called when the app is about to close. The callback may return a promise;
  // main waits for the "done" message sent here so the autosave is never lost.
  onBeforeQuit: (cb) => {
    ipcRenderer.on('app:before-quit', async () => {
      try { await cb(); } finally { ipcRenderer.send('app:flush-done'); }
    });
  },
});
