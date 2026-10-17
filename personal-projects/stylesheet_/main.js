// main.js: Electron main process for Stylesheet_.
// Owns everything that needs Node: the window, file dialogs, the library folder on disk,
// atomic JSON saving, the ssfile:// protocol, the trash folder, the "flush before quit" handshake (which may be
// cancelled by the unsaved-changes prompt), SHA-256 hashes of library files, .S_ project files (save, read, import
// their assets, recent projects), and single-instance handling (a double-clicked .S_ file opens in the running app).
// The renderer (src/) never touches Node; it only talks to this file through preload.js.

const { app, BrowserWindow, ipcMain, dialog, protocol, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');

// Dev/testing only: lets me point the app at a throwaway data folder so tests never touch real data.
if (process.env.STYLESHEET_USERDATA) app.setPath('userData', process.env.STYLESHEET_USERDATA);

// ---------- One app at a time ----------
// Double-clicking a .S_ file while the app is open must open it in the running window, not start a second copy.
// The second copy asks for the lock, doesn't get it, hands its command line to the first one ('second-instance'
// below) and quits. (The lock is per data folder, so a test run with STYLESHEET_USERDATA never blocks the real app.)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

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
const MEDIA_EXT = ['.svg', '.png', '.jpg', '.jpeg'];

// Turns a relative path (e.g. "fonts/abc.ttf") into an absolute one INSIDE the library folder.
// Anything that resolves outside the library folder is rejected: this is the security gate.
function resolveLibraryPath(rel) {
  const base = path.resolve(libraryDir());
  const full = path.resolve(base, String(rel).replace(/^[\\/]+/, ''));
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error('Path outside library: ' + rel);
  return full;
}

// ---------- Data version (fresh-start wipe) ----------
// Every save of library.json and session.json carries `dataVersion`. When the data format changes in a way old
// files can't be loaded, bump this number: on the next launch, files with no dataVersion or an older one are moved
// (with the library/ folder) into userData/old-data-backup-<date>/ and the app starts like a first launch.
// settings.json is never touched. The renderer never sees dataVersion: main adds it on save and strips it on load.
const DATA_VERSION = 2;
const DATA_FILES = ['library.json', 'session.json'];

// True if a data file exists but is NOT current-version data (no dataVersion, an older one, or unreadable).
// A missing file is not "old" (that is a first launch). A NEWER version is left alone.
function isOldDataFile(name) {
  const file = jsonPath(name);
  if (!fs.existsSync(file)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return !(data && typeof data.dataVersion === 'number' && data.dataVersion >= DATA_VERSION);
  } catch {
    return true;   // unreadable: back it up rather than silently overwriting it
  }
}

// Moves a file or folder; falls back to copy + delete if a plain rename isn't possible (e.g. across drives).
function moveSync(from, to) {
  try {
    fs.renameSync(from, to);
  } catch {
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

// Runs once at startup, BEFORE the window exists. If either data file is old-format, moves library.json,
// session.json (plus any leftover .tmp files) and the library/ folder into a new userData/old-data-backup-<date>/
// folder (-2, -3... if that name is taken). Returns the backup folder, or null if nothing had to move.
function backupOldData() {
  if (!DATA_FILES.some(isOldDataFile)) return null;
  // Local date (YYYY-MM-DD), so the folder name matches the user's own calendar (toISOString would use UTC).
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  let dir = path.join(userData(), `old-data-backup-${stamp}`);
  for (let n = 2; fs.existsSync(dir); n++) dir = path.join(userData(), `old-data-backup-${stamp}-${n}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of [...DATA_FILES, ...DATA_FILES.map((f) => f + '.tmp'), 'library']) {
    const from = path.join(userData(), name);
    if (fs.existsSync(from)) moveSync(from, path.join(dir, name));
  }
  return dir;
}

// Adds the current dataVersion to an object before it is written to disk.
const withVersion = (data) => JSON.stringify({ ...data, dataVersion: DATA_VERSION });
// Removes dataVersion from a loaded object, so it never ends up inside the renderer's state.
function withoutVersion(data) {
  if (data && typeof data === 'object') delete data.dataVersion;
  return data;
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

// Same idea for any file outside userData (a .S_ project file): write a .tmp next to it, then rename it over.
async function writeFileAtomic(target, text) {
  const tmp = target + '.tmp';
  await fsp.writeFile(tmp, text, 'utf8');
  await fsp.rename(tmp, target);
}

// The SHA-256 hash (hex) of a file's bytes. Assets are always compared by CONTENT, never by name.
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

// Reads a JSON file; returns null if it doesn't exist or can't be parsed (first launch / corrupt file).
async function readJson(name) {
  try {
    return JSON.parse(await fsp.readFile(jsonPath(name), 'utf8'));
  } catch {
    return null;
  }
}

// ---------- App settings (settings.json) ----------
// A tiny file separate from session.json because main needs the "on launch" value BEFORE the window exists.
// It also remembers the last folder each file dialog used (fonts import, media import, export, projects = open/save
// of .S_ files) and the last RECENT_MAX project files opened or saved (newest first).
// Returns a complete settings object; anything missing or invalid falls back to the default
// (maximized, no remembered folders, no recent projects), so a bad file can never break startup.
const FOLDER_KEYS = ['fonts', 'media', 'export', 'projects'];
const RECENT_MAX = 5;
const isAbsPath = (p) => typeof p === 'string' && p.length < 4096 && path.isAbsolute(p);
function cleanSettings(raw) {
  const launch = raw && raw.launch === 'windowed' ? 'windowed' : 'maximized';
  const lastFolders = {};
  const src = raw && raw.lastFolders;
  if (src && typeof src === 'object') {
    for (const key of FOLDER_KEYS) {
      const dir = src[key];
      // Only plain absolute paths are kept; anything else is dropped (= default dialog location).
      if (isAbsPath(dir)) lastFolders[key] = dir;
    }
  }
  const recentProjects = (raw && Array.isArray(raw.recentProjects) ? raw.recentProjects : []).filter(isAbsPath).slice(0, RECENT_MAX);
  return { launch, lastFolders, recentProjects };
}

// Puts a project file at the top of the recent list (no duplicates; Windows paths ignore case), max RECENT_MAX.
async function addRecent(file) {
  const current = await getSettings();
  const others = current.recentProjects.filter((p) => p.toLowerCase() !== file.toLowerCase());
  settings = cleanSettings({ ...current, recentProjects: [file, ...others] });
  await saveSettingsFile();
}
// Takes a project file off the recent list (it no longer exists).
async function removeRecent(file) {
  const current = await getSettings();
  settings = cleanSettings({ ...current, recentProjects: current.recentProjects.filter((p) => p.toLowerCase() !== String(file).toLowerCase()) });
  await saveSettingsFile();
}
async function loadSettings() {
  return cleanSettings(await readJson('settings.json'));
}

// Main keeps the one live copy of the settings (loaded at startup) so the renderer's "on launch" saves
// and the dialogs' folder updates never overwrite each other.
let settings = null;
async function getSettings() {
  if (!settings) settings = await loadSettings();
  return settings;
}
async function saveSettingsFile() {
  await writeJsonAtomic('settings.json', JSON.stringify(settings));
}

// Remembers the folder a dialog was last used in (key: 'fonts' | 'media' | 'export').
async function rememberFolder(key, dir) {
  const current = await getSettings();
  settings = cleanSettings({ ...current, lastFolders: { ...current.lastFolders, [key]: dir } });
  await saveSettingsFile();
}

// The remembered folder for a dialog, or null if there is none or it no longer exists (= default location).
async function rememberedFolder(key) {
  const dir = (await getSettings()).lastFolders[key];
  if (!dir) return null;
  try {
    return (await fsp.stat(dir)).isDirectory() ? dir : null;
  } catch {
    return null;   // deleted, renamed, or an unplugged drive
  }
}

// ---------- Window ----------
let win = null;

function createWindow(settings) {
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
  // The window stays hidden (show: false) until the page is ready. If the "on launch" setting is maximized,
  // maximize it right before showing, so the user never sees a small window first.
  // (maximize() on a hidden window would show it immediately, which is why it happens here, not earlier.)
  win.once('ready-to-show', () => {
    if (settings.launch === 'maximized') win.maximize();
    win.show();
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Tell the renderer when maximize state changes so the icon can swap between maximize / restore.
  const sendMax = () => win && !win.isDestroyed() && win.webContents.send('window:maximize-change', win.isMaximized());
  win.on('maximize', sendMax);
  win.on('unmaximize', sendMax);

  // Flush-before-close: hold the close until the renderer says its autosave is written
  // (or 2 seconds pass, so a hung renderer can never trap the app open).
  // The renderer may first ask "save changes to <name>?" (unsaved project). While that prompt is open it sends
  // 'app:close-wait', which stops the 2-second fallback (the user may take their time). Its answer comes back with
  // 'app:flush-done': ok = false means "cancel", and the window simply stays open.
  let flushed = false;
  let asking = false;              // a close is already being handled (a second click on close is ignored)
  win.on('close', (event) => {
    if (flushed) return;
    event.preventDefault();
    if (asking) return;
    asking = true;
    let timer = null;
    const cleanup = () => {
      clearTimeout(timer);
      ipcMain.removeListener('app:flush-done', onDone);
      ipcMain.removeListener('app:close-wait', onWait);
      asking = false;
    };
    const onDone = (e, ok) => {
      cleanup();
      if (ok === false) return;                      // the user cancelled: keep the window open
      flushed = true;
      if (win && !win.isDestroyed()) win.close();
    };
    const onWait = () => clearTimeout(timer);
    ipcMain.on('app:flush-done', onDone);
    ipcMain.on('app:close-wait', onWait);
    if (!win.webContents.isDestroyed()) win.webContents.send('app:before-quit');
    timer = setTimeout(() => onDone(null, true), 2000);
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
// Library and session carry dataVersion on disk only (added on save, removed on load; see "Data version" above).
ipcMain.handle('library:load', async () => withoutVersion(await readJson('library.json')));
ipcMain.handle('library:save', (e, data) => writeJsonAtomic('library.json', withVersion(data)));
ipcMain.handle('session:load', async () => withoutVersion(await readJson('session.json')));
ipcMain.handle('session:save', (e, data) => writeJsonAtomic('session.json', withVersion(data)));
// App settings. The renderer can only change "on launch" (takes effect the next time the app starts);
// the remembered dialog folders are managed here in main and are always kept as they are.
ipcMain.handle('settings:load', () => getSettings());
ipcMain.handle('settings:save', async (e, data) => {
  const current = await getSettings();
  settings = cleanSettings({ ...current, launch: data && data.launch });
  await saveSettingsFile();
});

// ---------- IPC: importing files ----------
// The name a file gets inside the library folder: a unique prefix + the original name, so two files called
// "logo.svg" never overwrite each other. (Unsafe characters in the original name become "_".)
const storedName = (safe) => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}_${safe}`;

// Opens a file dialog, copies each chosen file into library/fonts or library/media,
// and returns metadata the renderer uses to build library entries.
// `type` is 'font' or 'media': each library section has its own import button, and the dialog
// (and the copy loop below) only accepts that section's file types.
ipcMain.handle('files:import', async (e, type) => {
  const isFont = type === 'font';
  const allowed = isFont ? FONT_EXT : MEDIA_EXT;
  const folderKey = isFont ? 'fonts' : 'media';   // each import button remembers its own last folder
  const startIn = await rememberedFolder(folderKey);
  // Dev-only shortcut so automated tests can import without a dialog (never active in a packaged build).
  const scripted = !app.isPackaged && process.env.STYLESHEET_IMPORT;
  const result = scripted
    ? { canceled: false, filePaths: process.env.STYLESHEET_IMPORT.split(';') }
    : await dialog.showOpenDialog(win, {
      title: isFont ? 'Import fonts' : 'Import media',
      ...(startIn ? { defaultPath: startIn } : {}),   // no remembered folder: Windows picks its usual default
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: isFont ? 'Fonts' : 'Images and vectors', extensions: allowed.map((x) => x.slice(1)) }],
    });
  if (result.canceled) return [];
  const imported = [];
  for (const source of result.filePaths) {
    const ext = path.extname(source).toLowerCase();
    if (!allowed.includes(ext)) continue;
    const kind = isFont ? 'font' : 'media';
    const subdir = kind === 'font' ? 'fonts' : 'media';
    // Unique stored name so two files called "logo.svg" never overwrite each other.
    const safe = path.basename(source).replace(/[^\w.\-]+/g, '_');
    const fileName = storedName(safe);
    await fsp.mkdir(path.join(libraryDir(), subdir), { recursive: true });
    await fsp.copyFile(source, path.join(libraryDir(), subdir, fileName));
    // The hash is how .S_ project files find this file again (by its contents, never by its name).
    const hash = sha256(await fsp.readFile(path.join(libraryDir(), subdir, fileName)));
    imported.push({ kind, subdir, fileName, originalName: path.basename(source), ext, hash });
  }
  // Remember where the files came from so the next import of this type opens there (only if something was imported).
  if (imported.length) await rememberFolder(folderKey, path.dirname(result.filePaths[0]));
  return imported;
});

// First launch: copies the default media that ships with the app (src/defaults/media) into library/media and returns
// the same metadata as an import, in this fixed order (the renderer gives the first one the newest addedAt).
// Files are read and written (not copyFile) because in the installed app they live inside app.asar.
// v1.2.2: the new logo and wordmark (no dark background, no empty artboard space: padding comes from the app). The
// names (with a space) are what a fresh install shows on the media cards.
const DEFAULT_MEDIA = ['Stylesheet_ Logo.svg', 'Stylesheet_ Wordmark.svg'];
ipcMain.handle('defaults:installMedia', async () => {
  const dir = path.join(libraryDir(), 'media');
  await fsp.mkdir(dir, { recursive: true });
  const installed = [];
  for (const name of DEFAULT_MEDIA) {
    const data = await fsp.readFile(path.join(__dirname, 'src', 'defaults', 'media', name));
    const fileName = storedName(name);   // same pattern as imports
    await fsp.writeFile(path.join(dir, fileName), data);
    installed.push({ kind: 'media', subdir: 'media', fileName, originalName: name, ext: '.svg', hash: sha256(data) });
  }
  return installed;
});

// Returns a library file's text (used for SVG contents).
ipcMain.handle('files:read', async (e, rel) => fsp.readFile(resolveLibraryPath(rel), 'utf8'));

// SHA-256 hashes of library files: files = [{ subdir: 'fonts' | 'media', fileName }] -> [hash or null (missing)].
// Used once to give an existing library its hashes (the upgrade), and whenever an entry has none yet.
ipcMain.handle('files:hash', async (e, files) => {
  const out = [];
  for (const f of Array.isArray(files) ? files : []) {
    try { out.push(sha256(await fsp.readFile(resolveLibraryPath(`${f.subdir}/${path.basename(String(f.fileName))}`)))); }
    catch { out.push(null); }
  }
  return out;
});

// ---------- IPC: .S_ project files ----------
// A project file is ONE readable JSON file with the extension ".S_" (always a capital S). It holds the app name +
// version, dataVersion, the project name, every board (all layers and properties), the export settings, every color
// used (hex + library name when known), and ONLY the assets the boards use, embedded as base64: each font file (family,
// weight, style, original file name) and each media file (name, kind), each with the SHA-256 hash of its contents.
// The renderer builds the boards/colors/asset LIST (payload); main reads the asset files, hashes and embeds them.
const PROJECT_EXT = '.S_';
const PROJECT_FILTERS = [{ name: 'Stylesheet_ Project', extensions: ['S_'] }];
const isProjectPath = (p) => isAbsPath(p) && /\.s_$/i.test(p);
// "C:\work\saturn_coffee.S_" -> "saturn_coffee"
const projectNameOf = (p) => path.basename(p).replace(/\.s_$/i, '');
// Always ends in ".S_" with a capital S (a typed ".s_" or a missing extension are fixed).
const withProjectExt = (p) => (/\.s_$/i.test(p) ? p.slice(0, -3) : p) + PROJECT_EXT;
// A project name usable as a Windows file name (the default name in the save dialog).
const safeFileName = (name) => String(name || 'untitled').replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').trim() || 'untitled';
// The original name of a library file: its stored name without the unique prefix ("lk3j9a2b_Brand.ttf" -> "Brand.ttf").
const originalNameOf = (fileName) => String(fileName).replace(/^[0-9a-z]+_/, '');

// Save / Save As. filePath null = Save As (the dialog, starting in the remembered projects folder, default name =
// the project name; Windows itself asks before replacing an existing file). Returns { saved, filePath, fontCount }.
ipcMain.handle('project:save', async (e, { filePath, defaultName, payload }) => {
  let target = isAbsPath(filePath) ? filePath : null;
  if (!target) {
    const folder = (await rememberedFolder('projects')) || app.getPath('documents');
    // Dev-only shortcut so automated tests can save without a dialog (never active in a packaged build).
    const scripted = !app.isPackaged && process.env.STYLESHEET_PROJECT_PATH;
    const result = scripted
      ? { canceled: false, filePath: process.env.STYLESHEET_PROJECT_PATH }
      : await dialog.showSaveDialog(win, {
        title: 'Save project',
        defaultPath: path.join(folder, safeFileName(defaultName) + PROJECT_EXT),
        filters: PROJECT_FILTERS,
      });
    if (result.canceled || !result.filePath) return { saved: false };
    target = result.filePath;
  }
  target = withProjectExt(target);

  // Embed each asset the renderer listed: read it from the library, hash it, base64 it. A file that can't be read
  // (e.g. it was deleted outside the app) is left out; its blocks then show their gray placeholder when opened.
  const embed = async (subdir, list, describe) => {
    const out = [];
    for (const item of Array.isArray(list) ? list : []) {
      try {
        const data = await fsp.readFile(resolveLibraryPath(`${subdir}/${path.basename(String(item.fileName))}`));
        out.push({ ...describe(item), hash: sha256(data), data: data.toString('base64') });
      } catch { /* missing on disk: skip */ }
    }
    return out;
  };
  const fonts = await embed('fonts', payload.fonts, (f) => ({ id: f.id, family: f.family, weight: f.weight, style: f.style, originalName: originalNameOf(f.fileName) }));
  const media = await embed('media', payload.media, (m) => ({ id: m.id, name: m.name, kind: m.kind }));
  const file = {
    app: 'Stylesheet_',
    appVersion: app.getVersion(),
    dataVersion: DATA_VERSION,
    name: projectNameOf(target),
    savedAt: new Date().toISOString(),
    boards: payload.boards,
    export: payload.export,
    colors: payload.colors,
    assets: { fonts, media },
  };
  await writeFileAtomic(target, JSON.stringify(file, null, 2));   // indented: readable in any text editor
  await rememberFolder('projects', path.dirname(target));
  await addRecent(target);
  return { saved: true, filePath: target, fontCount: fonts.length };
});

// The open dialog for .S_ files (starts in the remembered projects folder). Returns the chosen path or null.
ipcMain.handle('project:openDialog', async () => {
  const startIn = await rememberedFolder('projects');
  // Dev-only shortcut so automated tests can open without a dialog (never active in a packaged build).
  const scripted = !app.isPackaged && process.env.STYLESHEET_OPEN_PATH;
  const result = scripted
    ? { canceled: false, filePaths: [process.env.STYLESHEET_OPEN_PATH] }
    : await dialog.showOpenDialog(win, {
      title: 'Open project',
      ...(startIn ? { defaultPath: startIn } : {}),
      properties: ['openFile'],
      filters: PROJECT_FILTERS,
    });
  if (result.canceled || !result.filePaths.length) return null;
  await rememberFolder('projects', path.dirname(result.filePaths[0]));
  return result.filePaths[0];
});

// Reads and checks a .S_ file WITHOUT its embedded file data (that stays here until "import assets").
// Returns { ok: true, filePath, name, project: { boards, export, colors, fonts, media } } where every font/media entry
// carries `index` (its place in the file) and `hash` (recomputed from the embedded bytes: the contents are the truth),
// or { ok: false, error: 'missing' | 'invalid' | 'newer' }.
async function readProjectFile(filePath) {
  if (!isProjectPath(filePath)) return { ok: false, error: 'invalid' };
  let text;
  try { text = await fsp.readFile(filePath, 'utf8'); } catch { return { ok: false, error: 'missing' }; }
  let data;
  try { data = JSON.parse(text); } catch { return { ok: false, error: 'invalid' }; }
  if (!data || data.app !== 'Stylesheet_' || typeof data.dataVersion !== 'number' || !Array.isArray(data.boards)) return { ok: false, error: 'invalid' };
  if (data.dataVersion > DATA_VERSION) return { ok: false, error: 'newer' };
  return { ok: true, data };
}
ipcMain.handle('project:read', async (e, filePath) => {
  const res = await readProjectFile(filePath);
  if (!res.ok) return res;
  const { data } = res;
  const assets = data.assets || {};
  const describe = (list) => (Array.isArray(list) ? list : [])
    .map((a, index) => ({ a, index }))
    .filter(({ a }) => a && typeof a.data === 'string')
    .map(({ a, index }) => {
      const { data: bytes, ...meta } = a;
      return { ...meta, index, hash: sha256(Buffer.from(bytes, 'base64')) };
    });
  return {
    ok: true,
    filePath,
    name: projectNameOf(filePath),
    project: {
      boards: data.boards,
      export: data.export && typeof data.export === 'object' ? data.export : null,
      colors: Array.isArray(data.colors) ? data.colors : [],
      fonts: describe(assets.fonts),
      media: describe(assets.media),
    },
  };
});

// "import assets": writes the chosen embedded files (by their index in the file) into library/fonts and library/media
// under new unique stored names. Returns [{ kind: 'font' | 'media', index, fileName, hash }] for the files written.
ipcMain.handle('project:importAssets', async (e, filePath, wanted) => {
  const res = await readProjectFile(filePath);
  if (!res.ok) throw new Error('could not read the project file');
  const assets = res.data.assets || {};
  const written = [];
  const write = async (kind, list, indexes, nameOf, allowed) => {
    const subdir = kind === 'font' ? 'fonts' : 'media';
    await fsp.mkdir(path.join(libraryDir(), subdir), { recursive: true });
    for (const index of Array.isArray(indexes) ? indexes : []) {
      const a = (Array.isArray(list) ? list : [])[index];
      if (!a || typeof a.data !== 'string') continue;
      const original = path.basename(String(nameOf(a) || ''));
      if (!allowed.includes(path.extname(original).toLowerCase())) continue;   // only real font / media files
      const bytes = Buffer.from(a.data, 'base64');
      const fileName = storedName(original.replace(/[^\w.\-]+/g, '_'));
      await fsp.writeFile(path.join(libraryDir(), subdir, fileName), bytes);
      written.push({ kind, index, fileName, hash: sha256(bytes) });
    }
  };
  await write('font', assets.fonts, wanted && wanted.fonts, (a) => a.originalName, FONT_EXT);
  await write('media', assets.media, wanted && wanted.media, (a) => a.name, MEDIA_EXT);
  return written;
});

// Recent projects (newest first), each with the name shown in the menu.
ipcMain.handle('project:recent', async () => (await getSettings()).recentProjects.map((p) => ({ path: p, name: projectNameOf(p) })));
ipcMain.handle('project:addRecent', (e, p) => (isProjectPath(p) ? addRecent(p) : null));
ipcMain.handle('project:removeRecent', (e, p) => removeRecent(p));

// A .S_ file the app was started with (double-click in Explorer). The renderer asks once, after it has started; from
// then on, files from a second launch are sent straight to it ('project:open-file').
let launchFile = null;
let rendererReady = false;
// The first .S_ path on a command line (Explorer passes the file as an argument), or null.
const projectArg = (argv) => (argv || []).find((a) => isProjectPath(a) && fs.existsSync(a)) || null;
ipcMain.handle('project:takeLaunchFile', () => {
  rendererReady = true;
  const file = launchFile;
  launchFile = null;
  return file;
});

// A second copy of the app was started (e.g. a .S_ file was double-clicked while the app is open): bring this window
// to the front and open the file in it (the renderer still asks about unsaved changes first).
app.on('second-instance', (event, argv) => {
  const file = projectArg(argv);
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
  if (!file) return;
  if (win && rendererReady) win.webContents.send('project:open-file', file);
  else launchFile = file;   // the window is still starting: it picks the file up when it asks
});

// ---------- IPC: trash ----------
// The renderer sends the list of files that SHOULD be in the trash folder. We make the disk match:
// listed files still in the live folder move to trash; unlisted files in trash move back (this is undo/restore).
ipcMain.handle('trash:sync', async (e, wanted) => {
  const wantSet = new Set(wanted.map((f) => `${f.subdir}/${f.fileName}`));
  for (const subdir of ['fonts', 'media']) {
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
// format: 'png' | 'jpeg' | 'webp'. The dialog starts in the folder of the last export (or Pictures).
ipcMain.handle('export:save', async (e, dataUrl, format) => {
  const ext = format === 'jpeg' ? 'jpg' : format === 'webp' ? 'webp' : 'png';
  const stamp = new Date().toISOString().slice(0, 10);
  const folder = (await rememberedFolder('export')) || app.getPath('pictures');
  // Dev-only shortcut so automated tests can export without a dialog (never active in a packaged build).
  const scripted = !app.isPackaged && process.env.STYLESHEET_EXPORT_PATH;
  const result = scripted
    ? { canceled: false, filePath: process.env.STYLESHEET_EXPORT_PATH }
    : await dialog.showSaveDialog(win, {
      title: 'Export image',
      defaultPath: path.join(folder, `stylesheet_export_${stamp}.${ext}`),
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
  if (result.canceled || !result.filePath) return { saved: false };
  const base64 = dataUrl.split(',')[1];
  await fsp.writeFile(result.filePath, Buffer.from(base64, 'base64'));
  await rememberFolder('export', path.dirname(result.filePath));   // next export opens here
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

// Eyedropper: reads the color of ONE on-screen pixel of the app window at (x, y) in CSS pixels.
// capturePage grabs exactly what is drawn (vectors, images, text, backgrounds), so it works for any block.
// The bitmap is BGRA on Windows; on high-DPI screens a 1x1 rect may come back as 2x2, so we read the first pixel.
ipcMain.handle('eyedropper:sample', async (e, x, y) => {
  if (!win || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const image = await win.webContents.capturePage({ x: Math.floor(x), y: Math.floor(y), width: 1, height: 1 });
  const px = image.toBitmap();
  if (px.length < 4) return null;
  const hex = (n) => n.toString(16).padStart(2, '0').toUpperCase();
  return `#${hex(px[2])}${hex(px[1])}${hex(px[0])}`;   // BGRA -> #RRGGBB
});

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
app.whenReady().then(async () => {
  if (!gotLock) return;               // a second copy: it already handed its file to the first one and is quitting
  launchFile = projectArg(process.argv);   // started by double-clicking a .S_ file
  registerProtocol();
  // Old-format data (no dataVersion, or an older one) is moved into a backup folder so the app starts fresh.
  // If that fails, quit instead of loading (and later overwriting) data this version can't read.
  try {
    const backup = backupOldData();
    if (backup) console.log(`old data moved to ${backup}`);
  } catch (err) {
    dialog.showErrorBox('Stylesheet_ could not start',
      `Your saved data is from an older version and could not be moved to a backup folder:\n${err.message}\n\nNothing was deleted. Data folder: ${userData()}`);
    app.quit();
    return;
  }
  fs.mkdirSync(path.join(libraryDir(), 'fonts'), { recursive: true });
  fs.mkdirSync(path.join(libraryDir(), 'media'), { recursive: true });
  createWindow(await getSettings());   // settings are read first because the launch mode decides the window state
});
app.on('window-all-closed', () => app.quit());
