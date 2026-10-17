// preload.js: the secure bridge between the renderer and the main process.
// It exposes ONE object, window.api, built with contextBridge. The renderer cannot reach Node or fs;
// every capability it has is listed here and handled in main.js.

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // JSON data
  loadLibrary: () => ipcRenderer.invoke('library:load'),
  saveLibrary: (data) => ipcRenderer.invoke('library:save', data),
  loadSession: () => ipcRenderer.invoke('session:load'),
  saveSession: (data) => ipcRenderer.invoke('session:save', data),
  loadSettings: () => ipcRenderer.invoke('settings:load'),           // { launch, lastFolders: { fonts, media, export, projects }, recentProjects }
  saveSettings: (data) => ipcRenderer.invoke('settings:save', data), // only `launch` is taken; lastFolders and recentProjects are managed by main

  // Files
  importFiles: (type) => ipcRenderer.invoke('files:import', type),   // type: 'font' | 'media'; each result carries its SHA-256 `hash`
  readLibraryFile: (relPath) => ipcRenderer.invoke('files:read', relPath),
  hashLibraryFiles: (files) => ipcRenderer.invoke('files:hash', files),   // [{ subdir, fileName }] -> [hash | null]
  saveExport: (dataUrl, format) => ipcRenderer.invoke('export:save', dataUrl, format),   // format: 'png' | 'jpeg' | 'webp'
  openLibraryFolder: () => ipcRenderer.invoke('library:openFolder'),
  readBundledFont: (name) => ipcRenderer.invoke('fonts:bundled', name),
  installDefaultMedia: () => ipcRenderer.invoke('defaults:installMedia'),   // first launch: copies the logo + wordmark into the library

  // .S_ project files
  saveProject: (args) => ipcRenderer.invoke('project:save', args),   // { filePath | null (= Save As), defaultName, payload } -> { saved, filePath, fontCount }
  openProjectDialog: () => ipcRenderer.invoke('project:openDialog'),   // -> path | null
  readProject: (filePath) => ipcRenderer.invoke('project:read', filePath),   // -> { ok, filePath, name, project } | { ok: false, error }
  importProjectAssets: (filePath, wanted) => ipcRenderer.invoke('project:importAssets', filePath, wanted),   // wanted = { fonts: [index], media: [index] }
  getRecentProjects: () => ipcRenderer.invoke('project:recent'),     // -> [{ path, name }], newest first (max 5)
  addRecentProject: (filePath) => ipcRenderer.invoke('project:addRecent', filePath),
  removeRecentProject: (filePath) => ipcRenderer.invoke('project:removeRecent', filePath),
  takeLaunchFile: () => ipcRenderer.invoke('project:takeLaunchFile'),   // the .S_ file the app was started with, or null
  onOpenFile: (cb) => ipcRenderer.on('project:open-file', (e, filePath) => cb(filePath)),   // a .S_ file double-clicked while running
  pathForFile: (file) => webUtils.getPathForFile(file),             // the disk path of a file dropped from Explorer

  // Trash: syncTrash makes the disk match the list; purgeTrashFiles deletes for good.
  syncTrash: (files) => ipcRenderer.invoke('trash:sync', files),
  purgeTrashFiles: (files) => ipcRenderer.invoke('trash:purge', files),

  getVersion: () => ipcRenderer.invoke('app:version'),

  // Eyedropper: the "#RRGGBB" color of the window pixel at (x, y) (CSS pixels), or null.
  samplePixel: (x, y) => ipcRenderer.invoke('eyedropper:sample', x, y),

  // Window controls (the app is frameless, so the renderer draws its own buttons)
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximizeChange: (cb) => ipcRenderer.on('window:maximize-change', (e, isMax) => cb(isMax)),
  },

  // Called when the app is about to close. The callback may return a promise; main waits for the "done" message
  // sent here so the autosave is never lost. If the callback returns false (the user chose "cancel" in the
  // unsaved-changes prompt), the window stays open.
  onBeforeQuit: (cb) => {
    ipcRenderer.on('app:before-quit', async () => {
      let ok = true;
      try { ok = (await cb()) !== false; } finally { ipcRenderer.send('app:flush-done', ok); }
    });
  },
  // Tells main that a prompt is open, so its 2-second "renderer is hung" fallback must not close the window.
  holdClose: () => ipcRenderer.send('app:close-wait'),
});
