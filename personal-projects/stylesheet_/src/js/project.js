// project.js: the ONE open project and its .S_ file (an addition to the CLAUDE.md file list).
// - Save / Save As: collects the boards, the export settings, every color used and the library fonts/media the boards
//   use; main.js embeds those files (base64 + SHA-256 hash) into one readable JSON file "<name>.S_".
// - Open (menu, Ctrl+O, a recent project, a .S_ dropped on the window, a double-clicked file): checks the file, asks
//   about unsaved changes, then compares every embedded font/media file with the library BY HASH (file contents, never
//   names). All present: opens right away. Something missing: "import assets" / "open as preset" / "cancel".
// - New project, the unsaved-changes prompt (also before the app closes), the project menu in the top bar, the
//   Ctrl+S / Ctrl+Shift+S / Ctrl+O / Ctrl+N shortcuts, and ensureHashes() (gives every library file its hash).
// The project state itself (file path + unsaved flag) lives in state.js (session.project).

import {
  state, projectName, isProjectDirty, markSaved, loadProject, newProject, addPreset, addImportedAssets, setAssetHashes,
  allFonts,
} from './state.js';
import { structureFromCanvas, canvasFromStructure, createCanvas, isTextType, BASE_NAME } from './blocks.js';
import { uid, slug, clone, isHex, normalizeHex, $, isEditingText } from './util.js';
import { showToast, choiceDialog } from './overlays.js';
import { openMenu } from './popover.js';
import { fit } from './preview.js';
import { registerFonts } from './fonts.js';
import { processSvg, cacheMedia } from './svg.js';
import { setQuitGuard } from './persistence.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------- Hashes of library files ----------
// Every library font and media entry carries `hash` (SHA-256 of the file, computed in main). Imports get it right
// away; this fills in any entry that has none yet: once for a library from before project files (the UPGRADE,
// removable later together with upgradeLibrary() in state.js), and after an undo/restore brings back an entry without
// one. Runs one at a time; a file that can't be read (missing) simply stays without a hash.
let hashing = Promise.resolve();
export function ensureHashes() {
  hashing = hashing.then(async () => {
    const todo = [
      ...state.library.fonts.filter((f) => !f.hash).map((f) => ({ kind: 'font', id: f.id, subdir: 'fonts', fileName: f.fileName })),
      ...state.library.media.filter((m) => !m.hash).map((m) => ({ kind: 'media', id: m.id, subdir: 'media', fileName: m.fileName })),
    ];
    if (!todo.length) return;
    const hashes = await window.api.hashLibraryFiles(todo.map(({ subdir, fileName }) => ({ subdir, fileName })));
    setAssetHashes(todo.map((t, i) => ({ kind: t.kind, id: t.id, hash: hashes[i] })).filter((t) => t.hash));
  }).catch((err) => console.error('hashing library files failed:', err));
  return hashing;
}

// ---------- What goes into the file ----------
// The library name of a hex, if a library color or palette swatch has exactly that value.
function libraryColorName(hex) {
  const all = [...state.library.colors, ...state.library.palettes.flatMap((p) => p.colors)];
  const hit = all.find((c) => normalizeHex(c.hex) === hex);
  return hit ? hit.name : null;
}

// Everything the renderer knows about the project: every board (hidden ones too) with all layers and properties, the
// export settings, every color stored on the boards (hex + library name when known: a palette section's own name, or a
// library color with that hex), and the library fonts/media the boards use (built-in fonts are never embedded). Main
// reads and embeds the asset files themselves.
function collectProject() {
  const boards = clone(state.session.canvases);
  const fontIds = new Set();
  const mediaIds = new Set();
  const colors = new Map();      // hex -> name (or null)
  const addColor = (hex, name = null) => {
    if (!hex || !isHex(hex)) return;
    const h = normalizeHex(hex);
    if (!colors.get(h)) colors.set(h, name || libraryColorName(h));
  };
  const walk = (n) => {
    if (n.type === 'canvas' || n.type === 'group') addColor(n.background);
    if (n.bgImage && n.bgImage.mediaId) mediaIds.add(n.bgImage.mediaId);
    if (isTextType(n.type)) { fontIds.add(n.font); addColor(n.color); }
    if ((n.type === 'vector' || n.type === 'image') && n.mediaId) mediaIds.add(n.mediaId);
    if (n.type === 'vector') Object.values(n.layerColors || {}).forEach((h) => addColor(h));
    if (n.type === 'palette') n.sections.forEach((s) => addColor(s.hex, s.name));
    (n.children || []).forEach(walk);
  };
  boards.forEach(walk);
  return {
    boards,
    export: clone(state.session.export),
    colors: [...colors].map(([hex, name]) => ({ hex, name: name || null })),
    fonts: state.library.fonts.filter((f) => fontIds.has(f.id)).map(({ id, family, weight, style, fileName }) => ({ id, family, weight, style, fileName })),
    media: state.library.media.filter((m) => mediaIds.has(m.id)).map(({ id, name, kind, fileName }) => ({ id, name, kind, fileName })),
  };
}

// ---------- Save ----------
// Save writes to the project's file; an untitled project (or saveAs) goes through the Save As dialog. Returns true
// when the file was written. The first save to a new file (Save As) of a project that bundles fonts reminds the user
// that sharing a .S_ file shares those fonts too.
export async function saveProject({ saveAs = false } = {}) {
  const current = state.session.project.filePath;
  const asNew = saveAs || !current;
  try {
    const res = await window.api.saveProject({ filePath: asNew ? null : current, defaultName: projectName(), payload: collectProject() });
    if (!res.saved) return false;
    markSaved(res.filePath);
    showToast(`saved ${projectName()}`);
    if (asNew && res.fontCount) showToast(`this project includes ${plural(res.fontCount, 'font')}, check their licenses allow sharing`);
    return true;
  } catch (err) {
    console.error('save failed:', err);
    showToast(`save failed: ${err.message}`, { warn: true });
    return false;
  }
}

// ---------- Unsaved changes ----------
// Before New, Open and closing the app: if the project has unsaved changes, asks "save changes to <name>?".
// Resolves true to go on (saved, or "don't save"), false to stop (cancel, or the Save As dialog was cancelled).
// With nothing unsaved it never asks. `closing` tells main to wait for the answer (no 2-second fallback).
export async function confirmUnsaved({ closing = false } = {}) {
  if (!isProjectDirty()) return true;
  if (closing) window.api.holdClose();
  const name = projectName();
  const choice = await choiceDialog({
    title: `save changes to ${name}?`,
    message: state.session.project.filePath
      ? `${name} has changes that aren't saved in its .S_ file yet.`
      : `${name} has never been saved to a .S_ file.`,
    choices: [
      { label: 'save', value: 'save', primary: true },
      { label: 'don\'t save', value: 'discard' },
      { label: 'cancel', value: 'cancel' },
    ],
  });
  if (choice === 'cancel') return false;
  if (choice === 'save') return saveProject();
  return true;
}

// ---------- New ----------
export async function newProjectFlow() {
  if (!(await confirmUnsaved())) return;
  newProject();
  fit();
}

// ---------- Open ----------
// Boards from a file go through createCanvas(), so a board always has the fields the renderer reads without checks
// (size, padding, radius...), even from a hand-edited file. Anything that isn't a board is dropped.
const cleanBoards = (boards) => (Array.isArray(boards) ? boards : [])
  .filter((b) => b && b.type === 'canvas' && Array.isArray(b.children))
  .map((b) => createCanvas(clone(b)));

// Points every block (and background image) at the library ids of the matching fonts/media (maps: file id -> library id).
function remapBoards(boards, fontMap, mediaMap) {
  const walk = (n) => {
    if (isTextType(n.type) && fontMap.has(n.font)) n.font = fontMap.get(n.font);
    if (n.mediaId && mediaMap.has(n.mediaId)) n.mediaId = mediaMap.get(n.mediaId);
    if (n.bgImage && n.bgImage.mediaId && mediaMap.has(n.bgImage.mediaId)) n.bgImage.mediaId = mediaMap.get(n.bgImage.mediaId);
    (n.children || []).forEach(walk);
  };
  boards.forEach(walk);
  return boards;
}

// "Brand.svg" -> "Brand (2).svg" (then (3)...) when a library media item already uses that name.
function uniqueMediaName(name, used) {
  if (!used.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  let n = 2;
  while (used.has(`${base} (${n})${ext}`)) n++;
  return `${base} (${n})${ext}`;
}

// The family an imported font gets. If a library font (built-in included) already has the same family AND the same
// weight + style as one of this family's imported files (but different contents, or it wouldn't be missing), the whole
// imported family is renamed "Brand Sans (2)" ((3)...), so both are kept and can be told apart. Otherwise the name stays.
function importedFamilyName(family, importing) {
  const fonts = allFonts();
  const clash = importing.some((f) => f.family === family
    && fonts.some((x) => x.family === family && x.weight === f.weight && x.style === f.style));
  if (!clash) return family;
  let n = 2;
  while (fonts.some((x) => x.family === `${family} (${n})`)) n++;
  return `${family} (${n})`;
}

// The project's colors as ONE palette named after the project, or null (no colors, or an identical palette with that
// name already exists: same name, same colors in the same order). Colors without a library name are named by their hex.
function projectPalette(name, colors) {
  const list = colors.filter((c) => c && isHex(c.hex))
    .map((c) => ({ name: c.name || normalizeHex(c.hex).slice(1).toLowerCase(), hex: normalizeHex(c.hex) }));
  if (!list.length) return null;
  const palName = slug(name);
  const identical = state.library.palettes.some((p) => p.name === palName && p.colors.length === list.length
    && p.colors.every((c, i) => normalizeHex(c.hex) === list[i].hex && c.name === list[i].name));
  return identical ? null : { id: uid('p'), name: palName, colors: list.map((c) => ({ id: uid('c'), ...c })) };
}

// Replaces the workspace with the file's boards (already pointing at library ids) and its export settings.
function openAsSaved(res, boards) {
  loadProject({ canvases: boards, exportSettings: res.project.export, filePath: res.filePath, dirty: false });
  window.api.addRecentProject(res.filePath);
  fit();
}

// "import assets": writes ONLY the missing fonts/media into the library (with their hashes; same-name media become
// "Brand (2).svg", a clashing font family "Brand Sans (2)"), adds the project's colors as one palette, then opens the
// project exactly as saved. No preset is made.
async function importAndOpen(res, boards, fontMap, mediaMap, missingFonts, missingMedia) {
  const written = await window.api.importProjectAssets(res.filePath, {
    fonts: missingFonts.map((f) => f.index), media: missingMedia.map((m) => m.index),
  });
  const writtenFor = (kind, index) => written.find((w) => w.kind === kind && w.index === index);

  const fontEntries = [];
  const familyOf = new Map();       // family in the file -> family in the library
  for (const f of missingFonts) {
    const w = writtenFor('font', f.index);
    if (!w) continue;
    if (!familyOf.has(f.family)) familyOf.set(f.family, importedFamilyName(f.family, missingFonts));
    const entry = { id: uid('f'), family: familyOf.get(f.family), fileName: w.fileName, style: f.style === 'italic' ? 'italic' : 'normal', weight: Number(f.weight) || 400, hash: w.hash };
    fontEntries.push(entry);
    fontMap.set(f.id, entry.id);
  }

  const mediaEntries = [];
  const usedNames = new Set(state.library.media.map((m) => m.name));
  const now = Date.now();
  for (const [i, m] of missingMedia.entries()) {
    const w = writtenFor('media', m.index);
    if (!w) continue;
    const kind = m.kind === 'image' ? 'image' : 'svg';
    const id = uid(kind === 'svg' ? 'v' : 'm');
    if (kind === 'svg') {
      try {
        cacheMedia(id, processSvg(await window.api.readLibraryFile(`media/${w.fileName}`), id));   // sanitized, like an import
      } catch {
        showToast(`${m.name} isn't a valid svg and was skipped.`, { warn: true });
        continue;
      }
    }
    const name = uniqueMediaName(m.name, usedNames);
    usedNames.add(name);
    mediaEntries.push({ id, name, fileName: w.fileName, kind, addedAt: now + i, hash: w.hash });
    mediaMap.set(m.id, id);
  }

  await registerFonts(fontEntries);
  addImportedAssets({ fonts: fontEntries, media: mediaEntries, palette: projectPalette(res.name, res.project.colors) });
  openAsSaved(res, remapBoards(boards, fontMap, mediaMap));
  showToast(`opened ${res.name}`);
  const bits = [];
  if (fontEntries.length) bits.push(plural(fontEntries.length, 'font'));
  if (mediaEntries.length) bits.push(`${mediaEntries.length} media`);
  if (bits.length) showToast(`imported ${bits.join(', ')}`);
}

// "open as preset": a new preset from ALL the file's boards (normal preset rules: structure only, no colors, fonts,
// text or media), named after the project, plus a new untitled project holding those boards. Nothing else is imported.
function openAsPreset(res, boards) {
  const structures = boards.map(structureFromCanvas);
  addPreset(slug(res.name), structures);
  const canvases = structures.map((s, i) => canvasFromStructure(s, `${BASE_NAME} ${i + 1}`));
  loadProject({ canvases, dirty: true });    // untitled, and it holds boards that aren't in any file yet
  fit();
  showToast(`opened ${res.name} as a preset`);
}

// Opens a .S_ file by path. `asked` = the unsaved-changes prompt already ran (the open dialog asks before it opens);
// `fromRecent` = clicked in the recent list (a missing file is then taken off the list).
export async function openProjectFile(filePath, { asked = false, fromRecent = false } = {}) {
  const res = await window.api.readProject(filePath);
  const shortName = String(filePath).split(/[\\/]/).pop();
  if (!res.ok) {
    if (res.error === 'newer') showToast('this file was made with a newer Stylesheet_, update to open it', { warn: true });
    else if (res.error === 'missing' && fromRecent) {
      await window.api.removeRecentProject(filePath);
      showToast(`${shortName} no longer exists, removed from recent projects`, { warn: true });
    } else if (res.error === 'missing') showToast(`${shortName} could not be found`, { warn: true });
    else showToast(`${shortName} isn't a Stylesheet_ project file`, { warn: true });
    return;
  }
  if (!asked && !(await confirmUnsaved())) return;

  // Compare every embedded file with the library by hash (contents). A library file with the same name but other
  // contents doesn't match, so it counts as missing.
  await ensureHashes();
  const p = res.project;
  const fontMap = new Map(), mediaMap = new Map();
  const missingFonts = [], missingMedia = [];
  for (const f of p.fonts) {
    const hit = state.library.fonts.find((x) => x.hash && x.hash === f.hash);
    if (hit) fontMap.set(f.id, hit.id); else missingFonts.push(f);
  }
  for (const m of p.media) {
    const hit = state.library.media.find((x) => x.hash && x.hash === m.hash);
    if (hit) mediaMap.set(m.id, hit.id); else missingMedia.push(m);
  }
  const boards = cleanBoards(p.boards);

  if (!missingFonts.length && !missingMedia.length) {
    openAsSaved(res, remapBoards(boards, fontMap, mediaMap));
    showToast(`opened ${res.name}`);
    return;
  }

  const parts = [];
  if (missingFonts.length) parts.push(plural(missingFonts.length, 'font'));
  if (missingMedia.length) parts.push(`${missingMedia.length} media file${missingMedia.length === 1 ? '' : 's'}`);
  const choice = await choiceDialog({
    title: `${res.name}: missing assets`,
    message: `${parts.join(' and ')} used by ${res.name} ${missingFonts.length + missingMedia.length === 1 ? 'is' : 'are'} not in your library. `
      + 'Import assets adds them to your library and opens the project exactly as saved. '
      + 'Open as preset saves its boards as a preset and opens them as a new untitled project, without colors, fonts, text or media.',
    choices: [
      { label: 'import assets', value: 'import', primary: true },
      { label: 'open as preset', value: 'preset' },
      { label: 'cancel', value: 'cancel' },
    ],
  });
  if (choice === 'import') await importAndOpen(res, boards, fontMap, mediaMap, missingFonts, missingMedia);
  else if (choice === 'preset') openAsPreset(res, boards);
}

// Open… (menu / Ctrl+O): the unsaved-changes prompt comes BEFORE the open dialog.
export async function openProjectDialogFlow() {
  if (!(await confirmUnsaved())) return;
  const filePath = await window.api.openProjectDialog();
  if (filePath) await openProjectFile(filePath, { asked: true });
}

// ---------- One action at a time ----------
// New / open / save never overlap (e.g. Ctrl+S pressed twice while the save dialog is open).
let busy = false;
export async function runProjectAction(fn) {
  if (busy) return;
  busy = true;
  try { await fn(); } catch (err) {
    console.error('project action failed:', err);
    showToast(`something went wrong: ${err.message}`, { warn: true });
  } finally { busy = false; }
}

// A file dropped from Explorer onto the window: a .S_ file opens (the first one, if several); anything else is ignored.
export function openDroppedFiles(files) {
  const file = [...files].find((f) => /\.s_$/i.test(f.name));
  if (!file) return;
  const filePath = window.api.pathForFile(file);
  if (filePath) runProjectAction(() => openProjectFile(filePath));
}

// ---------- The project menu (top bar) ----------
// new project, open…, save, save as…, a divider, then up to 5 recent projects (or a muted note). Shortcut hints on the right.
export async function openProjectMenu(anchor) {
  const recent = await window.api.getRecentProjects();
  openMenu(anchor, [
    { label: 'new project', sub: 'ctrl+n', onClick: () => runProjectAction(newProjectFlow) },
    { label: 'open…', sub: 'ctrl+o', onClick: () => runProjectAction(openProjectDialogFlow) },
    { label: 'save', sub: 'ctrl+s', onClick: () => runProjectAction(() => saveProject()) },
    { label: 'save as…', sub: 'ctrl+shift+s', onClick: () => runProjectAction(() => saveProject({ saveAs: true })) },
    { divider: true },
    ...(recent.length
      ? recent.map((r) => ({ label: r.name, title: r.path, onClick: () => runProjectAction(() => openProjectFile(r.path, { fromRecent: true })) }))
      : [{ note: 'no recent projects' }]),
  ]);
}

// ---------- Setup ----------
// Called once from app.js: shortcuts, the close guard, files from a second launch, and the file the app started with.
export async function initProject() {
  setQuitGuard(() => confirmUnsaved({ closing: true }));
  // Ctrl+S save, Ctrl+Shift+S save as, Ctrl+O open, Ctrl+N new project. They work wherever the user last clicked,
  // except while editing text (a text input, textarea, or text on a board: isEditingText in util.js) and while a
  // dialog or the help overlay is open.
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || isEditingText(e.target)) return;
    if ($('.modal-backdrop') || $('.help-overlay')) return;
    const key = e.key.toLowerCase();
    if (key === 's') { e.preventDefault(); runProjectAction(() => saveProject({ saveAs: e.shiftKey })); }
    else if (key === 'o' && !e.shiftKey) { e.preventDefault(); runProjectAction(openProjectDialogFlow); }
    else if (key === 'n' && !e.shiftKey) { e.preventDefault(); runProjectAction(newProjectFlow); }
  });
  window.api.onOpenFile((filePath) => runProjectAction(() => openProjectFile(filePath)));
  const launchFile = await window.api.takeLaunchFile();
  if (launchFile) runProjectAction(() => openProjectFile(launchFile));
}
