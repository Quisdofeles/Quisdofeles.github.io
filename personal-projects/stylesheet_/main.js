// main.js: Electron main process for Stylesheet_.
// Owns everything that needs Node: the window, file dialogs, the library folder on disk,
// atomic JSON saving, the ssfile:// protocol, the trash folder, and the "flush before quit" handshake.
// The renderer (src/) never touches Node; it only talks to this file through preload.js.

const { app, BrowserWindow, ipcMain, dialog, protocol, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

// Dev/testing only: lets me point the app at a throwaway data folder so tests never touch real data.
if (process.env.STYLESHEET_USERDATA) app.setPath('userData', process.env.STYLESHEET_USERDATA);

// ssfile:// must be declared "privileged" BEFORE the app is ready.
// corsEnabled is added on top of the spec so fetch() from the file:// page can read imported fonts/SVGs.
protocol.registerSchemesAsPrivileged([
  { scheme: 'ssfile', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// ---------- Paths ----------
const userData = () => app.getPath('userData');
const libraryDir = () => path.join(userData(), 'library');
const trashDir = () => path.join(libraryDir(), 'trash');
const jsonPath = (name) => path.join(userData(), name);

const MIME = {
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
};
const FONT_EXT = ['.ttf', '.otf', '.woff', '.woff2'];
const VECTOR_EXT = ['.svg', '.png', '.jpg', '.jpeg'];

// Turns a relative path (e.g. "fonts/abc.ttf") into an absolute one INSIDE the library folder.
// Anything that resolves outside the library folder is rejected: this is the security gate.
function resolveLibraryPath(rel) {
  const base = path.resolve(libraryDir());
  const full = path.resolve(base, String(rel).replace(/^[\\/]+/, ''));
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error('Path outside library: ' + rel);
  return full;
}

// ---------- Atomic JSON writes ----------
// Write to name.tmp, then rename over the real file, so a crash can never leave half a file.
// Writes to the same file are queued so two quick saves never fight over the same .tmp file.
const writeQueues = new Map();
function writeJsonAtomic(name, text) {
  const target = jsonPath(name);
  const prev = writeQueues.get(name) || Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const tmp = target + '.tmp';
    await fsp.writeFile(tmp, text, 'utf8');
    await fsp.rename(tmp, target);
  });
  writeQueues.set(name, next);
  return next;
}

// Reads a JSON file; returns null if it doesn't exist or can't be parsed (first launch / corrupt file).
async function readJson(name) {
  try {
    return JSON.parse(await fsp.readFile(jsonPath(name), 'utf8'));
  } catch {
    return null;
  }
}

// ---------- Window ----------
let win = null;

function createWindow() {
  const work = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1440, work.width),
    height: Math.min(1000, work.height),
    minWidth: 1280,
    minHeight: 720,
    center: true,
    frame: false,
    backgroundColor: '#0A0A0B', // matches --bg so there is no white flash on launch
    show: false,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Tell the renderer when maximize state changes so the icon can swap between maximize / restore.
  const sendMax = () => win && !win.isDestroyed() && win.webContents.send('window:maximize-change', win.isMaximized());
  win.on('maximize', sendMax);
  win.on('unmaximize', sendMax);

  // Flush-before-close: hold the close until the renderer says its autosave is written
  // (or 2 seconds pass, so a hung renderer can never trap the app open).
  let flushed = false;
  win.on('close', (event) => {
    if (flushed) return;
    event.preventDefault();
    const finish = () => {
      if (flushed) return;
      flushed = true;
      if (win && !win.isDestroyed()) win.close();
    };
    ipcMain.once('app:flush-done', finish);
    if (!win.webContents.isDestroyed()) win.webContents.send('app:before-quit');
    setTimeout(finish, 2000);
  });
  win.on('closed', () => { win = null; });

  // Debug helpers (never active in a packaged build).
  if (!app.isPackaged && process.env.STYLESHEET_DEBUG) {
    win.webContents.on('console-message', (event) => {
      console.log(`[renderer:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
    });
  }
  if (!app.isPackaged && process.env.STYLESHEET_HARNESS) {
    require(process.env.STYLESHEET_HARNESS)({ app, win, ipcMain });
  }
}

// ---------- ssfile:// protocol ----------
// ssfile://lib/fonts/abc.ttf  ->  <userData>/library/fonts/abc.ttf  (only inside the library folder)
function registerProtocol() {
  protocol.handle('ssfile', async (request) => {
    try {
      const url = new URL(request.url);
      const rel = decodeURIComponent(url.pathname);
      const full = resolveLibraryPath(rel);
      const data = await fsp.readFile(full);
      const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
      return new Response(data, { headers: { 'content-type': type, 'access-control-allow-origin': '*' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ---------- IPC: JSON data ----------
ipcMain.handle('library:load', () => readJson('library.json'));
ipcMain.handle('library:save', (e, data) => writeJsonAtomic('library.json', JSON.stringify(data)));
ipcMain.handle('session:load', () => readJson('session.json'));
ipcMain.handle('session:save', (e, data) => writeJsonAtomic('session.json', JSON.stringify(data)));

// ---------- IPC: importing files ----------
// Opens a file dialog, copies each chosen file into library/fonts or library/vectors,
// and returns metadata the renderer uses to build library entries.
ipcMain.handle('files:import', async () => {
  // Dev-only shortcut so automated tests can import without a dialog (never active in a packaged build).
  const scripted = !app.isPackaged && process.env.STYLESHEET_IMPORT;
  const result = scripted
    ? { canceled: false, filePaths: process.env.STYLESHEET_IMPORT.split(';') }
    : await dialog.showOpenDialog(win, {
      title: 'Import into library',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Fonts, vectors and images', extensions: ['ttf', 'otf', 'woff', 'woff2', 'svg', 'png', 'jpg', 'jpeg'] }],
    });
  if (result.canceled) return [];
  const imported = [];
  for (const source of result.filePaths) {
    const ext = path.extname(source).toLowerCase();
    const kind = FONT_EXT.includes(ext) ? 'font' : VECTOR_EXT.includes(ext) ? 'vector' : null;
    if (!kind) continue;
    const subdir = kind === 'font' ? 'fonts' : 'vectors';
    // Unique stored name so two files called "logo.svg" never overwrite each other.
    const safe = path.basename(source).replace(/[^\w.\-]+/g, '_');
    const fileName = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}_${safe}`;
    await fsp.mkdir(path.join(libraryDir(), subdir), { recursive: true });
    await fsp.copyFile(source, path.join(libraryDir(), subdir, fileName));
    imported.push({ kind, subdir, fileName, originalName: path.basename(source), ext });
  }
  return imported;
});

// Returns a library file's text (used for SVG contents).
ipcMain.handle('files:read', async (e, rel) => fsp.readFile(resolveLibraryPath(rel), 'utf8'));

// ---------- IPC: trash ----------
// The renderer sends the list of files that SHOULD be in the trash folder. We make the disk match:
// listed files still in the live folder move to trash; unlisted files in trash move back (this is undo/restore).
ipcMain.handle('trash:sync', async (e, wanted) => {
  const wantSet = new Set(wanted.map((f) => `${f.subdir}/${f.fileName}`));
  for (const subdir of ['fonts', 'vectors']) {
    const live = path.join(libraryDir(), subdir);
    const trash = path.join(trashDir(), subdir);
    await fsp.mkdir(live, { recursive: true });
    await fsp.mkdir(trash, { recursive: true });
    // Move wanted files into trash.
    for (const f of wanted.filter((w) => w.subdir === subdir)) {
      const from = path.join(live, f.fileName);
      if (fs.existsSync(from)) await fsp.rename(from, path.join(trash, f.fileName));
    }
    // Move anything in trash that is no longer wanted back to the live folder.
    for (const name of await fsp.readdir(trash)) {
      if (!wantSet.has(`${subdir}/${name}`)) await fsp.rename(path.join(trash, name), path.join(live, name));
    }
  }
  return true;
});

// Permanently deletes files from the trash folder (only called when the user empties the trash).
ipcMain.handle('trash:purge', async (e, files) => {
  for (const f of files) {
    try { await fsp.unlink(path.join(trashDir(), f.subdir, path.basename(f.fileName))); } catch { /* already gone */ }
  }
  return true;
});

// ---------- IPC: export, folders, fonts, version ----------
ipcMain.handle('export:save', async (e, dataUrl, format) => {
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  const stamp = new Date().toISOString().slice(0, 10);
  // Dev-only shortcut so automated tests can export without a dialog (never active in a packaged build).
  const scripted = !app.isPackaged && process.env.STYLESHEET_EXPORT_PATH;
  const result = scripted
    ? { canceled: false, filePath: process.env.STYLESHEET_EXPORT_PATH }
    : await dialog.showSaveDialog(win, {
      title: 'Export image',
      defaultPath: path.join(app.getPath('pictures'), `stylesheet_export_${stamp}.${ext}`),
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
  if (result.canceled || !result.filePath) return { saved: false };
  const base64 = dataUrl.split(',')[1];
  await fsp.writeFile(result.filePath, Buffer.from(base64, 'base64'));
  return { saved: true, path: result.filePath };
});

ipcMain.handle('library:openFolder', async () => {
  await fsp.mkdir(libraryDir(), { recursive: true });
  return shell.openPath(libraryDir());
});

// The app's own UI fonts, as base64, so exports can embed them (file:// pages can't fetch() local files).
ipcMain.handle('fonts:bundled', async (e, name) => {
  if (!/^[\w-]+\.ttf$/.test(name)) throw new Error('Bad font name');
  return (await fsp.readFile(path.join(__dirname, 'src', 'fonts', name))).toString('base64');
});

ipcMain.handle('app:version', () => app.getVersion());

// ---------- IPC: window controls ----------
ipcMain.handle('window:minimize', () => win && win.minimize());
ipcMain.handle('window:toggleMaximize', () => {
  if (!win) return false;
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
  return win.isMaximized();
});
ipcMain.handle('window:close', () => win && win.close());
ipcMain.handle('window:isMaximized', () => !!win && win.isMaximized());

// ---------- App lifecycle ----------
app.whenReady().then(() => {
  registerProtocol();
  fs.mkdirSync(path.join(libraryDir(), 'fonts'), { recursive: true });
  fs.mkdirSync(path.join(libraryDir(), 'vectors'), { recursive: true });
  createWindow();
});
app.on('window-all-closed', () => app.quit());
