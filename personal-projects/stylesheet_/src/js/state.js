// state.js: THE single source of truth.
// All app data lives in the one `state` object below. Other modules READ it and render from it;
// they CHANGE it only by calling the functions exported here, which then notify subscribers.
// Also holds the undo/redo history (snapshots of canvases + library, max 50), the open project's state (its .S_ file
// path and the unsaved-changes flag, session.project) and the load-time upgrade of older saved libraries.
//
// Notification meta (what changed), passed to every subscriber:
//   { library, session, live, view, selection, history, project }

import { uid, clone, normalizeHex } from './util.js';
import {
  createBlock, createCanvas, cloneWithNewIds, structureFromCanvas, canvasFromStructure,
  isContainer, isTextType, hasVisibleContent, BASE_NAME, groupingDefaults,
  STARTER_COLORS, STARTER_PALETTES, EMPTY_SIZE, SECTION_GRAY,
} from './blocks.js';
import { BUILTIN_FONTS } from './fonts.js';

const MAX_HISTORY = 50;

// The state object. `library` and `session` are replaced wholesale by undo/redo, so modules must
// always read `state.library` / `state.session` fresh instead of caching them.
export const state = { library: null, session: null };
export let isFirstLaunch = false;

const listeners = new Set();
let undoStack = [];
let redoStack = [];
let gestureOpen = false;     // true while a slider drag is in progress (one history entry per drag)

// ---------- Subscribe / notify ----------
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify(meta) {
  for (const fn of listeners) {
    try { fn(meta); } catch (err) { console.error('subscriber failed:', err); }
  }
}

// ---------- Initial data ----------
// A brand-new library: the starter colors and palettes, no presets. The default media (logo + wordmark) is added
// right after by app.js (seedMedia), because copying the files needs the main process.
function defaultLibrary() {
  const colors = STARTER_COLORS.map((c) => ({ id: uid('c'), ...c }));
  const palettes = STARTER_PALETTES.map((p) => ({
    id: uid('p'), name: p.name,
    colors: p.colors.map((c) => ({ id: uid('c'), name: c.name, hex: c.hex })),
  }));
  return { fonts: [], colors, palettes, media: [], presets: [], trash: [] };
}

function defaultSession() {
  return {
    canvases: [],            // a new user starts with an empty preview (it shows the "+ add board" button)
    selection: [],           // ids of the selected nodes (a LIST; see cleanSelection() for the rules)
    zoom: 1,
    pan: { x: 0, y: 0 },
    // canvasLabels: show each board's name above it (preview and export; "board labels" on screen).
    // A new session: both labels on, PNG, transparent off, 1× (saved sessions keep their own values).
    export: { styleLabels: true, canvasLabels: true, format: 'png', transparent: false, scale: 1 },
    collapsedGroups: {},     // editor property groups the user collapsed
    collapsedNodes: {},      // layers-tree nodes the user collapsed
    expandedSection: null,   // the library section filling the whole panel ('blocks' | 'media' | 'fonts' | 'colors' | 'palettes'), or null
    helpSeen: false,
    // The one open project: the .S_ file it was last saved to / opened from (null = never saved: "untitled"), and
    // whether the boards changed since then (the "*"). Saved with the session, so a restart reopens the same project.
    project: { filePath: null, dirty: false },
  };
}

// ---------- Upgrade of older saved data (REMOVABLE LATER) ----------
// The project-files batch changed how presets are saved: { structure } (one board) became { boards: [structure, ...] }.
// Saved libraries (and preset entries waiting in the trash) are upgraded here on load, in place; the upgraded shape is
// written back by the next library save. The other half of this upgrade (adding a `hash` to every library font and
// media file) needs the main process and lives in project.js ensureHashes(). DATA_VERSION stays 2 on purpose (main.js
// would otherwise move the whole library into a backup folder). Once every saved library has been upgraded, this
// function and its call in initState() can be deleted.
function upgradeLibrary(library) {
  const upgradePreset = (p) => {
    if (p && p.structure && !p.boards) { p.boards = [p.structure]; delete p.structure; }
  };
  library.presets.forEach(upgradePreset);
  library.trash.filter((t) => t.kind === 'preset').forEach((t) => upgradePreset(t.item));
}

// Fills in any top-level key missing from a loaded file with its default (a safety net for a hand-edited or partly
// written file). Old-format saves never get here: main.js backs them up and the app starts fresh (see dataVersion).
function normalize(loaded, fallback) {
  const out = { ...fallback, ...(loaded || {}) };
  for (const key of Object.keys(fallback)) if (out[key] === undefined || out[key] === null) out[key] = fallback[key];
  return out;
}

// A dynamic canvas needs content (an empty one would have no size). Any dynamic canvas that has no visible block
// left (its last block was deleted, hidden or dragged out) switches to fixed 160×160. Runs after every change(),
// so it is part of the same undo step as the action that emptied the canvas.
function fixEmptyDynamicCanvases() {
  for (const cv of state.session.canvases) {
    if (cv.size.mode === 'dynamic' && !hasVisibleContent(cv)) cv.size = { mode: 'fixed', width: EMPTY_SIZE, height: EMPTY_SIZE };
  }
}

// Called once at startup with whatever persistence loaded (null on first launch, including right after main.js
// backed up old-format data: then both files are gone, so it is a first launch).
export function initState(library, session) {
  isFirstLaunch = !library && !session;
  state.library = normalize(library, defaultLibrary());
  upgradeLibrary(state.library);             // old single-board presets -> { boards: [...] } (removable later)
  state.session = normalize(session, defaultSession());   // a session from before project files gets project: untitled, saved
  state.session.export = { ...defaultSession().export, ...state.session.export };
  state.session.selection = cleanSelection(state.session.selection);
  fixEmptyDynamicCanvases();
  undoStack = [];
  redoStack = [];
}

// ---------- History ----------
function snapshot() {
  return JSON.stringify({ canvases: state.session.canvases, selection: state.session.selection, library: state.library });
}
function pushHistory() {
  undoStack.push(snapshot());
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
}
function restore(snap) {
  const data = JSON.parse(snap);
  state.session.canvases = data.canvases;
  state.library = data.library;
  state.session.selection = cleanSelection(data.selection || []);   // after the canvases are back, so ids can be checked
}

export function undo() {
  if (!undoStack.length) return false;
  const before = JSON.stringify(state.session.canvases);
  redoStack.push(snapshot());
  restore(undoStack.pop());
  gestureOpen = false;
  if (JSON.stringify(state.session.canvases) !== before) markDirty();   // undoing a library-only step changes no board
  notify({ session: true, library: true, history: true });
  return true;
}
export function redo() {
  if (!redoStack.length) return false;
  const before = JSON.stringify(state.session.canvases);
  undoStack.push(snapshot());
  restore(redoStack.pop());
  gestureOpen = false;
  if (JSON.stringify(state.session.canvases) !== before) markDirty();
  notify({ session: true, library: true, history: true });
  return true;
}

// ---------- Project (the one open .S_ file) ----------
// The project's name = its file name without ".S_"; a workspace that was never saved is "untitled".
export function projectName() {
  const file = state.session.project.filePath;
  return file ? file.split(/[\\/]/).pop().replace(/\.s_$/i, '') : 'untitled';
}
export const isProjectDirty = () => !!state.session.project.dirty;

// Unsaved changes: set by every change to the BOARDS (any undoable step that isn't library-only, an undo/redo that
// changes the boards) and by the export settings (they are saved in the file). Library-only changes (imports, library
// colors, presets) don't count: they aren't part of the project. Cleared by save / open (markSaved, loadProject).
function markDirty() { state.session.project.dirty = true; }

// After a successful save: this file is now the project's file and nothing is unsaved.
export function markSaved(filePath) {
  state.session.project = { filePath, dirty: false };
  notify({ session: true, ui: true, project: true });
}

// Replaces the workspace with a project's boards (open, "new project", "open as preset"). Clears the selection, the
// layers-tree collapse state and the undo history (an undo must never bring back the previous project's boards).
// `exportSettings` (optional) replaces the export settings; `filePath` null = untitled; `dirty` = starts unsaved.
export function loadProject({ canvases, exportSettings = null, filePath = null, dirty = false }) {
  state.session.canvases = canvases;
  state.session.selection = [];
  state.session.collapsedNodes = {};
  if (exportSettings) state.session.export = { ...defaultSession().export, ...exportSettings };
  state.session.project = { filePath, dirty };
  anchorId = null;
  fixEmptyDynamicCanvases();
  undoStack = [];
  redoStack = [];
  gestureOpen = false;
  notify({ session: true, library: true, history: true, project: true });
}

// "new project": a fresh untitled workspace with one empty "Board 1" (like clear boards). The library is untouched;
// the export settings are kept (they are the user's own defaults until a file brings its own).
export function newProject() {
  loadProject({ canvases: [createCanvas({ name: `${BASE_NAME} 1` })] });
}

// Stores the SHA-256 hash of library font/media files (computed by the main process). Not an undo step and not a board
// change; the library is saved like after any other library change. entries: [{ kind: 'font' | 'media', id, hash }].
export function setAssetHashes(entries) {
  let changed = false;
  for (const { kind, id, hash } of entries) {
    const item = (kind === 'font' ? state.library.fonts : state.library.media).find((x) => x.id === id);
    if (item && hash && item.hash !== hash) { item.hash = hash; changed = true; }
  }
  if (changed) notify({ library: true });
}

// "import assets" of a .S_ file: adds the missing fonts and media (already copied into the library folder) and,
// optionally, the project's colors as one palette. One library change (the opened project then clears the history).
export function addImportedAssets({ fonts = [], media = [], palette = null }) {
  change(() => {
    state.library.fonts.push(...fonts);
    state.library.media.push(...media);
    if (palette) state.library.palettes.push(palette);
  }, { library: true });
}

// Slider drags call this when the drag ends ('change' event), so the NEXT drag starts a new history entry.
export function endGesture() { gestureOpen = false; }

// Runs a mutation as one undoable step and notifies. meta.live = a slider tick (history pushed once per drag).
// meta.noHistory = not an undo step (selection, zoom, UI collapse...).
function change(fn, meta = {}) {
  if (!meta.noHistory) {
    if (meta.live) { if (!gestureOpen) { pushHistory(); gestureOpen = true; } }
    else { pushHistory(); gestureOpen = false; }
  }
  fn();
  fixEmptyDynamicCanvases();       // an emptied dynamic canvas falls back to fixed 160×160 (same undo step)
  if (!meta.noHistory && !meta.library) markDirty();   // a board change: the project now has unsaved changes
  notify({ session: true, ...meta });
}

// ---------- Reading helpers ----------
// Finds a node anywhere in the canvas tree. Returns { node, parent, index, list, canvas } or null.
export function findNode(id) {
  if (!id) return null;
  function walk(list, parent, canvas) {
    for (let i = 0; i < list.length; i++) {
      const node = list[i];
      const cv = node.type === 'canvas' ? node : canvas;
      if (node.id === id) return { node, parent, index: i, list, canvas: cv };
      if (node.children) {
        const hit = walk(node.children, node, cv);
        if (hit) return hit;
      }
    }
    return null;
  }
  return walk(state.session.canvases, null, null);
}

// Nodes from the canvas down to `id` (for the breadcrumb).
export function pathTo(id) {
  const path = [];
  let hit = findNode(id);
  while (hit) { path.unshift(hit.node); hit = hit.parent ? findNode(hit.parent.id) : null; }
  return path;
}

export const visibleCanvases = () => state.session.canvases.filter((c) => !c.hidden);

// ---------- Selection (a list of ids) ----------
// Rules, enforced by cleanSelection() every time the selection is set:
//  - a selection is EITHER blocks that all live in one canvas, OR canvases (never a mix);
//  - the LAST id in the list is the one just picked. If it doesn't fit the rest (a block from another canvas, a
//    canvas while blocks are selected, a block while canvases are selected) the older picks are dropped, so the
//    selection simply switches to the new item. (It never turns into canvases: that could make Delete remove
//    whole canvases by accident.)
//  - a block that sits inside another selected block (a group) is dropped: the outer one wins.
function cleanSelection(ids) {
  const hits = [...new Set(ids)].map(findNode).filter(Boolean);
  if (!hits.length) return [];
  const focus = hits[hits.length - 1];
  const fits = focus.node.type === 'canvas'
    ? hits.filter((h) => h.node.type === 'canvas')
    : hits.filter((h) => h.node.type !== 'canvas' && h.canvas.id === focus.canvas.id);
  const picked = new Set(fits.map((h) => h.node.id));
  const insideAPicked = (hit) => {
    for (let p = hit.parent; p && p.type !== 'canvas'; p = (findNode(p.id) || {}).parent) if (picked.has(p.id)) return true;
    return false;
  };
  return fits.filter((h) => !insideAPicked(h)).map((h) => h.node.id);
}

let anchorId = null;       // the last plainly/ctrl-clicked node: where a Shift-click range starts (not saved)
export const selectedIds = () => state.session.selection;
export const isSelected = (id) => state.session.selection.includes(id);
export const selectedNodes = () => state.session.selection.map((id) => (findNode(id) || {}).node).filter(Boolean);

// The canvases the selection lives in (the canvases themselves, or the one owning the selected blocks).
export function selectionCanvasIds() {
  return [...new Set(state.session.selection.map((id) => (findNode(id) || { canvas: {} }).canvas.id).filter(Boolean))];
}

// Sets the selection inside a change() (no notify of its own); the last id becomes the range anchor.
function pick(ids) {
  state.session.selection = cleanSelection(ids);
  anchorId = ids.length ? ids[ids.length - 1] : null;
}

// Looks up a font by id: the built-in fonts (Space Grotesk, IBM Plex Mono) first, then the user's library fonts.
export const getFont = (id) => BUILTIN_FONTS.find((f) => f.id === id) || state.library.fonts.find((f) => f.id === id) || null;
// Every font a text block can use (built-in + library), for the font pickers.
export const allFonts = () => [...BUILTIN_FONTS, ...state.library.fonts];
export const getMedia = (id) => state.library.media.find((m) => m.id === id) || null;

// Looks up a color by id among single colors AND palette swatches (both are draggable "colors").
export function findColor(id) {
  return state.library.colors.find((c) => c.id === id)
    || state.library.palettes.flatMap((p) => p.colors).find((c) => c.id === id) || null;
}

// Every node in every canvas, flattened (used for usage counts).
function allNodes() {
  const out = [];
  const walk = (list) => list.forEach((n) => { out.push(n); if (n.children) walk(n.children); });
  walk(state.session.canvases);
  return out;
}

// How many blocks use these library items. Fonts: text blocks whose own font is one of them.
// Media: vector/image blocks pointing at it, plus boards and groups using it as their background image.
// Colors/palettes/presets store copies, so they are never "in use".
export function usageCount(kind, ids) {
  const set = new Set(ids);
  let count = 0;
  const usesAsBackground = (n) => kind === 'media' && n.bgImage && set.has(n.bgImage.mediaId);
  for (const cv of state.session.canvases) {
    if (usesAsBackground(cv)) count++;
    const walk = (list) => list.forEach((n) => {
      if (kind === 'font' && isTextType(n.type) && set.has(n.font)) count++;
      if (kind === 'media' && (n.type === 'vector' || n.type === 'image') && set.has(n.mediaId)) count++;
      if (usesAsBackground(n)) count++;
      if (n.children) walk(n.children);
    });
    walk(cv.children);
  }
  return count;
}

// Asks every panel to redraw without changing any data (used after fonts/media finish loading from disk).
export function requestRender() {
  notify({ refresh: true });
}

// ---------- Selection, view, UI (not undo steps) ----------
// Applies a new selection (cleaned by the rules above) and notifies, but only if it really changed.
function setSelection(ids) {
  const next = cleanSelection(ids);
  const prev = state.session.selection;
  if (next.length === prev.length && next.every((id, i) => id === prev[i])) return;
  state.session.selection = next;
  notify({ session: true, selection: true });
}
// Plain click: select just this node (null = clear).
export function selectNode(id) {
  anchorId = id || null;
  setSelection(id ? [id] : []);
}
export const clearSelection = () => selectNode(null);
// Drag-select box in the preview: replaces the selection with these ids (they already follow the selection rules).
export function selectIds(ids) {
  anchorId = ids.length ? ids[ids.length - 1] : null;
  setSelection(ids);
}
// Ctrl/Shift+click in the preview, Ctrl+click in the tree: add the node to the selection, or remove it if it is in.
export function toggleSelect(id) {
  const cur = state.session.selection;
  anchorId = id;
  setSelection(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
}
// Shift+click in the tree: select every row between the anchor and `id`. `orderedIds` = the rows on screen, top to bottom.
export function selectRange(id, orderedIds) {
  const start = orderedIds.indexOf(findNode(anchorId) ? anchorId : state.session.selection[state.session.selection.length - 1]);
  const end = orderedIds.indexOf(id);
  if (start < 0 || end < 0) { selectNode(id); return; }
  const range = orderedIds.slice(Math.min(start, end), Math.max(start, end) + 1);
  // The clicked row goes last (it is the one that counts when the range crosses canvases); the anchor stays where it was.
  setSelection([...range.filter((x) => x !== id), id]);
}
export function setView(zoom, pan) {
  state.session.zoom = zoom;
  state.session.pan = pan;
  notify({ session: true, view: true });
}
export function setExport(patch) {
  Object.assign(state.session.export, patch);
  markDirty();                     // the export settings are saved in the project file
  notify({ session: true, exportSettings: true });
}
export function setGroupCollapsed(name, collapsed) {
  state.session.collapsedGroups[name] = collapsed;
  notify({ session: true, ui: true });
}
// Expands one library section to fill the panel (null = the normal equal layout). Saved in the session like the
// collapse states; not an undo step.
export function setExpandedSection(name) {
  state.session.expandedSection = name || null;
  notify({ session: true, ui: true });
}
export function setNodeCollapsed(id, collapsed) {
  if (collapsed) state.session.collapsedNodes[id] = true; else delete state.session.collapsedNodes[id];
  notify({ session: true, ui: true });
}
export function setHelpSeen() {
  state.session.helpSeen = true;
  notify({ session: true, ui: true });
}

// ---------- Canvas + block mutations ----------
// Picks the name for a new canvas, copy or paste: "Board 1", "Board 2"... the first number no canvas uses yet.
// (A renamed canvas frees its number, so the next new one may fill that gap.)
function nextCanvasName() {
  const used = new Set(state.session.canvases.map((c) => c.name));
  let n = 1;
  while (used.has(`${BASE_NAME} ${n}`)) n++;
  return `${BASE_NAME} ${n}`;
}

// Every name used by a node inside a canvas (the canvas itself is not counted), for unique block names.
function namesIn(canvas) {
  const names = new Set();
  const walk = (list) => list.forEach((n) => { names.add(n.name); if (n.children) walk(n.children); });
  walk(canvas.children);
  return names;
}
// "heading 1", "heading 2"...: the first number not yet used by a node in this canvas.
function numberedName(type, canvas) {
  const used = namesIn(canvas);
  let n = 1;
  while (used.has(`${type} ${n}`)) n++;
  return `${type} ${n}`;
}
// "title 1 copy", "title 1 copy 2"...: a unique name for a duplicate/paste (copying a copy doesn't stack suffixes).
function copyName(name, canvas) {
  const root = name.replace(/ copy( \d+)?$/, '');
  const used = namesIn(canvas);
  let candidate = `${root} copy`;
  for (let n = 2; used.has(candidate); n++) candidate = `${root} copy ${n}`;
  return candidate;
}

// Adds a new canvas (optionally from a preset structure) and selects it. Returns the canvas.
export function addCanvas({ structure, index } = {}) {
  const name = nextCanvasName();
  const canvas = structure ? canvasFromStructure(structure, name) : createCanvas({ name });
  change(() => {
    const list = state.session.canvases;
    list.splice(index === undefined ? list.length : index, 0, canvas);
    pick([canvas.id]);
  });
  return canvas;
}

// A preset dropped in the preview / layers: adds ALL of its boards, in the preset's order, at `index` (the end when
// left out), as ONE undo step. Each board gets the next free "Board N" name; the new boards become the selection.
export function addCanvasFromPreset(presetId, index) {
  const preset = state.library.presets.find((p) => p.id === presetId);
  if (!preset || !preset.boards.length) return null;
  const added = [];
  change(() => {
    const list = state.session.canvases;
    let at = index === undefined ? list.length : index;
    for (const structure of preset.boards) {
      const canvas = canvasFromStructure(structure, nextCanvasName());   // named after the boards added so far
      list.splice(at++, 0, canvas);
      added.push(canvas.id);
    }
    pick(added);
  });
  return added;
}

// Adds a block of `type` into a container (canvas/group) at `index`. Returns the block.
export function addBlock(type, parentId, index, extra = {}) {
  if (type === 'canvas') return addCanvas();
  const parent = findNode(parentId);
  if (!parent || !isContainer(parent.node)) return null;
  // Blocks added without a name get a numbered one ("heading 1", "heading 2"...), unique inside the canvas.
  const block = createBlock(type, { name: numberedName(type, parent.canvas), ...extra });
  change(() => {
    const kids = parent.node.children;
    kids.splice(index === undefined ? kids.length : Math.max(0, Math.min(index, kids.length)), 0, block);
    pick([block.id]);
  });
  return block;
}

// "+ block" in the layers header. The block goes to the end of every selected canvas (or of the canvas that owns
// the selected blocks): one new block per canvas, one undo step. A "canvas" just adds a new top-level canvas, and
// with nothing selected the block gets a new canvas of its own.
export function addBlockToSelection(type) {
  if (type === 'canvas') return addCanvas();
  const targets = selectionCanvasIds();
  if (!targets.length) return addBlockToNewCanvas(type);
  const created = [];
  change(() => {
    for (const canvasId of targets) {
      const canvas = findNode(canvasId).node;
      const block = createBlock(type, { name: numberedName(type, canvas) });
      canvas.children.push(block);
      created.push(block.id);
    }
    pick(targets.length > 1 ? targets : created);   // several canvases -> keep those canvases selected (blocks in different canvases can't be)
  });
  return created;
}

// Adds a vector/image block already pointing at a library media item.
export function addMediaBlock(mediaId, parentId, index) {
  const item = getMedia(mediaId);
  if (!item) return null;
  const type = item.kind === 'image' ? 'image' : 'vector';
  // A new vector shows the colors that are in the file (layerColors starts empty).
  return addBlock(type, parentId, index, { mediaId, name: item.name });
}

// A media item dropped on the empty dot grid: a new (dynamic) canvas containing a vector/image block with it.
export function addMediaToNewCanvas(mediaId) {
  const item = getMedia(mediaId);
  if (!item) return null;
  return addBlockToNewCanvas(item.kind === 'image' ? 'image' : 'vector', { mediaId, name: item.name });
}

// A font card dropped on empty space inside a board/group: a heading block in that font (the card's own file, the
// weight closest to 400), at `index` in the flow. Normal heading defaults and naming ("heading 1"...). One undo step.
export function addFontHeading(fontId, parentId, index) {
  if (!getFont(fontId)) return null;
  return addBlock('heading', parentId, index, { font: fontId });
}

// A font card dropped on the empty dot grid: a new (dynamic) board containing one heading block in that font.
export function addFontHeadingToNewCanvas(fontId) {
  if (!getFont(fontId)) return null;
  return addBlockToNewCanvas('heading', { font: fontId });
}

// Drops a block type onto empty space: a new canvas containing that block (or just a canvas).
// A canvas created WITH content starts dynamic (it shrink-wraps the block plus padding 24).
export function addBlockToNewCanvas(type, extra = {}) {
  if (type === 'canvas') return addCanvas();
  const canvas = createCanvas({
    name: nextCanvasName(),
    size: { mode: 'dynamic', width: EMPTY_SIZE, height: EMPTY_SIZE },   // padding: createCanvas()'s default 24 on every side
  });
  canvas.children.push(createBlock(type, { name: `${type} 1`, ...extra }));
  change(() => {
    state.session.canvases.push(canvas);
    pick([canvas.children[0].id]);
  });
  return canvas;
}

// The text blocks a font drop on `nodeId` will change: if that block is one of several selected text blocks, ALL the
// selected text blocks (so a font can be dropped on any one of them); otherwise just that block.
export function fontTargets(nodeId) {
  const selected = state.session.selection.filter((id) => { const h = findNode(id); return h && isTextType(h.node.type); });
  return selected.includes(nodeId) ? selected : [nodeId];
}

// Merges `patch` into a node (shallow). Pass { live: true } for slider ticks.
export function updateNode(id, patch, opts = {}) {
  const hit = findNode(id);
  if (!hit) return;
  change(() => Object.assign(hit.node, patch), opts.live ? { live: true } : {});
}

export function updateLayout(id, patch, opts = {}) {
  const hit = findNode(id);
  if (!hit || !hit.node.layout) return;
  change(() => Object.assign(hit.node.layout, patch), opts.live ? { live: true } : {});
}

// ---------- Canvas size ----------
// Merges `patch` into a canvas's size ({ width, height }). Pass { live: true } for slider ticks.
export function updateCanvasSize(id, patch, opts = {}) {
  const hit = findNode(id);
  if (!hit || hit.node.type !== 'canvas') return;
  change(() => Object.assign(hit.node.size, patch), opts.live ? { live: true } : {});
}

// Switches a canvas between 'fixed' and 'dynamic'. Going to fixed takes `current` = the canvas's rendered size at
// 100% zoom ({ width, height }, measured by the caller), so nothing jumps. Dynamic needs visible content.
export function setCanvasSizeMode(id, mode, current) {
  const hit = findNode(id);
  if (!hit || hit.node.type !== 'canvas' || hit.node.size.mode === mode) return;
  if (mode === 'dynamic' && !hasVisibleContent(hit.node)) return;
  change(() => {
    const size = hit.node.size;
    size.mode = mode;
    if (mode === 'fixed' && current) { size.width = current.width; size.height = current.height; }
  });
}

// ---------- Colors (each colorable thing stores its own; a change never touches any other block) ----------
// Every hex may carry an alpha ("#RRGGBBAA"; normalizeHex keeps it). The color setters take `opts.live` = true for
// the color picker's alpha slider ticks, so one drag is one undo step (like the property sliders).
const liveMeta = (opts) => (opts && opts.live ? { live: true } : {});

// Sets a canvas's background color.
export function setCanvasBackground(canvasId, hex, opts = {}) {
  const hit = findNode(canvasId);
  if (!hit || hit.node.type !== 'canvas') return;
  change(() => { hit.node.background = normalizeHex(hex); }, liveMeta(opts));
}

// Sets a group's background color. hex = null makes it transparent ("none"; also what reset does).
export function setGroupBackground(groupId, hex, opts = {}) {
  const hit = findNode(groupId);
  if (!hit || hit.node.type !== 'group') return;
  change(() => { hit.node.background = hex ? normalizeHex(hex) : null; }, liveMeta(opts));
}

// Sets (or swaps) the background image of a board or group, keeping its fit (cover for a new one). One undo step.
export function setBgImage(nodeId, mediaId) {
  const hit = findNode(nodeId);
  if (!hit || !isContainer(hit.node) || !getMedia(mediaId)) return;
  change(() => { hit.node.bgImage = { mediaId, fit: (hit.node.bgImage || {}).fit || 'cover' }; });
}

// Sets a text block's color.
export function setTextColor(blockId, hex, opts = {}) {
  const hit = findNode(blockId);
  if (!hit || !isTextType(hit.node.type)) return;
  change(() => { hit.node.color = normalizeHex(hex); }, liveMeta(opts));
}

// Sets the font of the given text blocks (their OWN font; nothing else changes), as one undo step.
// Non-text ids are ignored. fontId is a library font id or a built-in one.
export function setBlockFonts(ids, fontId) {
  const hits = ids.map((id) => findNode(id)).filter((h) => h && isTextType(h.node.type));
  if (!hits.length) return;
  change(() => { hits.forEach((h) => { h.node.font = fontId; }); });
}

// Gives ONE first-level layer of a vector block a color (the whole layer becomes that color).
// hex = null resets the layer to the original colors from the file.
export function setLayerColor(blockId, layer, hex, opts = {}) {
  const hit = findNode(blockId);
  if (!hit || hit.node.type !== 'vector') return;
  change(() => {
    if (!hit.node.layerColors) hit.node.layerColors = {};
    if (hex) hit.node.layerColors[layer] = normalizeHex(hex); else delete hit.node.layerColors[layer];
  }, liveMeta(opts));
}

// ---------- Palette block sections ----------
// Sets the color of ONE section of a palette block. opts.name: the library color's name when the color came from
// the library (a library color dropped or picked), null when it was typed; left out (e.g. an alpha slider tick)
// = keep the section's current name. opts.live: an alpha slider tick (one undo step per drag).
export function setSectionColor(blockId, index, hex, opts = {}) {
  const hit = findNode(blockId);
  if (!hit || hit.node.type !== 'palette' || !hit.node.sections[index]) return;
  change(() => {
    const s = hit.node.sections[index];
    s.hex = normalizeHex(hex);
    if ('name' in opts) s.name = opts.name || null;
  }, liveMeta(opts));
}

// "+ add section": a gray section at the end of a palette block. One undo step.
export function addSection(blockId) {
  const hit = findNode(blockId);
  if (!hit || hit.node.type !== 'palette') return;
  change(() => { hit.node.sections.push({ hex: SECTION_GRAY, name: null }); });
}

// The × of a section: removes it. A palette block always keeps at least one section.
export function removeSection(blockId, index) {
  const hit = findNode(blockId);
  if (!hit || hit.node.type !== 'palette' || hit.node.sections.length <= 1) return;
  change(() => { hit.node.sections.splice(index, 1); });
}

// The sections a library palette turns into: COPIES of its colors (hex + name), so later edits of the library
// palette never change the block.
function sectionsFrom(palette) {
  return palette.colors.map((c) => ({ hex: normalizeHex(c.hex), name: c.name }));
}

// A library palette card dropped on a board or group: adds a palette block with copies of its colors at `index`.
// The block is named after the palette (like a media block keeps its file name).
export function addPaletteBlock(paletteId, parentId, index) {
  const palette = state.library.palettes.find((p) => p.id === paletteId);
  if (!palette || !palette.colors.length) return null;
  return addBlock('palette', parentId, index, { name: palette.name, sections: sectionsFrom(palette) });
}

// A library palette card dropped on the empty dot grid: a new (dynamic) board containing the palette block.
export function addPaletteToNewCanvas(paletteId) {
  const palette = state.library.palettes.find((p) => p.id === paletteId);
  if (!palette || !palette.colors.length) return null;
  return addBlockToNewCanvas('palette', { name: palette.name, sections: sectionsFrom(palette) });
}

// The container whose BACKGROUND a color dropped on `node` changes: a group itself; an image block's own
// container (the group or board it sits in); anything else -> its board. Exported for dragdrop.js (the outline).
export function backgroundTargetOf(nodeId) {
  const hit = findNode(nodeId);
  if (!hit) return null;
  if (hit.node.type === 'canvas' || hit.node.type === 'group') return hit.node;
  if (hit.node.type === 'image' && hit.parent && hit.parent.type === 'group') return hit.parent;
  return hit.canvas;
}

// A color dropped on something (one undo step); it sets just that one thing:
// a text block -> its color; a vector block -> the layer under the pointer (`layer`, required: with no layer
// nothing happens); a group -> its background; an image -> its container's background (group or board);
// a canvas or anything else -> the canvas background.
export function dropColor(nodeId, hex, layer) {
  const hit = findNode(nodeId);
  if (!hit) return;
  const node = hit.node;
  if (node.type === 'vector' && layer === undefined) return;
  if (node.type === 'palette') return;      // a palette block's colors are set per section (setSectionColor)
  if (isTextType(node.type)) { setTextColor(node.id, hex); return; }
  if (node.type === 'vector') { setLayerColor(node.id, layer, hex); return; }
  const target = backgroundTargetOf(node.id);
  if (target.type === 'group') setGroupBackground(target.id, hex);
  else setCanvasBackground(target.id, hex);
}

// Swaps the media item a block points at. A vector's layer colors belong to the old file's layers, so they reset
// to the new file's original colors.
export function swapMedia(blockId, mediaId) {
  const hit = findNode(blockId);
  const item = getMedia(mediaId);
  if (!hit || !item) return;
  change(() => {
    const b = hit.node;
    const oldName = (getMedia(b.mediaId) || {}).name;
    b.mediaId = mediaId;
    if (b.type === 'vector') b.layerColors = {};
    if (!oldName || b.name === oldName) b.name = item.name;
  });
}

// Moves a node into `newParentId` (null = top level, canvases only) at `index`. One undo step.
export function moveNode(id, newParentId, index) {
  const loc = findNode(id);
  if (!loc) return;
  let target;
  if (loc.node.type === 'canvas') {
    if (newParentId) return;                       // canvases only live at the top level
    target = state.session.canvases;
  } else {
    const parent = findNode(newParentId);
    if (!parent || !isContainer(parent.node)) return;
    if (parent.node.id === id || isInside(loc.node, parent.node.id)) return;   // never into itself or its own child
    target = parent.node.children;
  }
  change(() => {
    const [moved] = loc.list.splice(loc.index, 1);
    let at = index === undefined ? target.length : index;
    if (loc.list === target && loc.index < at) at--;          // removing earlier item shifts the target slot
    target.splice(Math.max(0, Math.min(at, target.length)), 0, moved);
    keepSelectionValid();                                     // e.g. a selected block moved into a selected group
  });
}

// Re-applies the selection rules after the tree changed shape (deleted ids drop out, an inner block of a selected
// group is dropped). Empty groups are NOT removed any more: you can build empty layouts first and fill them later.
function keepSelectionValid() {
  state.session.selection = cleanSelection(state.session.selection);
}

// Wraps the selected blocks in a new group (right-click -> group, Ctrl+G), as ONE undo step; the new group becomes
// the selection. Canvases can't be grouped (they are ignored). The group sits where the first selected block (top of
// the tree) was, the blocks keep their tree order, and it is set up so nothing shifts visually: no background,
// fit × fit, no padding, square corners (groupingDefaults() in blocks.js) and a copy of the parent's layout.
// One extra rule: if a grouped block is a group that FILLS an axis, the new group fills that axis too, so the inner
// fill keeps filling the same space (inside a fit group it would act like fit and shrink).
export function groupNodes(ids) {
  const hits = ids.map((id) => findNode(id)).filter((h) => h && h.node.type !== 'canvas');
  if (!hits.length) return null;
  const order = new Map(allNodes().map((n, i) => [n.id, i]));
  hits.sort((a, b) => order.get(a.node.id) - order.get(b.node.id));
  const first = hits[0];
  const fills = (key) => hits.some((h) => h.node.type === 'group' && h.node.size[key] === 'fill');
  const extra = groupingDefaults();
  if (fills('widthMode')) extra.size.widthMode = 'fill';
  if (fills('heightMode')) extra.size.heightMode = 'fill';
  const group = createBlock('group', { ...extra, name: numberedName('group', first.canvas), layout: { ...first.parent.layout } });
  change(() => {
    first.list.splice(first.index, 1, group);                 // the group takes the first block's slot
    group.children.push(first.node);
    for (const hit of hits.slice(1)) {
      const loc = findNode(hit.node.id);                      // looked up fresh: earlier removals shift the indexes
      loc.list.splice(loc.index, 1);
      group.children.push(hit.node);
    }
    pick([group.id]);
  });
  return group;
}

// Replaces each selected group with its children, in the same spot and order (right-click -> ungroup, Ctrl+Shift+G).
// One undo step; the freed blocks become the selection. Anything selected that isn't a group is left alone.
export function ungroupNodes(ids) {
  const groups = ids.map((id) => findNode(id)).filter((h) => h && h.node.type === 'group');
  if (!groups.length) return [];
  const freed = [];
  change(() => {
    for (const g of groups) {
      const loc = findNode(g.node.id);
      loc.list.splice(loc.index, 1, ...loc.node.children);
      freed.push(...loc.node.children.map((c) => c.id));
    }
    pick(freed);
  });
  return freed;
}
// True if `id` is somewhere inside `node` (used to block dragging a container into its own child).
function isInside(node, id) {
  return (node.children || []).some((c) => c.id === id || isInside(c, id));
}

// Removes every node in `ids` as ONE undo step (Delete key and the right-click menu pass the whole selection).
export function removeNodes(ids) {
  if (!ids.some((id) => findNode(id))) return;
  change(() => {
    for (const id of ids) {
      const loc = findNode(id);               // looked up fresh: an earlier removal may have taken this one with it
      if (loc) loc.list.splice(loc.index, 1);
    }
    keepSelectionValid();
  });
}

// Duplicates every node in `ids` as ONE undo step; each copy goes right after its original and the copies become
// the selection. Canvases get the first free number ("Board 3"); blocks get "name copy", "name copy 2"...
export function duplicateNodes(ids) {
  const copies = [];
  change(() => {
    for (const id of ids) {
      const loc = findNode(id);
      if (!loc) continue;
      const copy = cloneWithNewIds(loc.node);
      copy.name = copy.type === 'canvas' ? nextCanvasName() : copyName(loc.node.name, loc.canvas);
      loc.list.splice(loc.index + 1, 0, copy);
      copies.push(copy.id);
    }
    pick(copies);
  });
  return copies;
}

// ---------- Copy / paste (layers tree) ----------
// The clipboard lives only in memory (not saved, not part of undo): deep copies of what was copied.
let clipboard = null;      // { kind: 'canvas' | 'blocks', nodes: [...] }
export const hasClipboard = () => !!clipboard;

export function copyNodes(ids) {
  const nodes = ids.map((id) => findNode(id)).filter(Boolean).map((hit) => clone(hit.node));
  if (!nodes.length) return false;
  clipboard = { kind: nodes[0].type === 'canvas' ? 'canvas' : 'blocks', nodes };
  return true;
}

// Pastes the clipboard as ONE undo step and selects the pasted items. Returns false if there was nowhere to paste.
//  - copied canvases go right after the last selected canvas (or at the end when nothing is selected);
//  - copied blocks go right after the last selected block, or to the end of each selected canvas.
export function pasteClipboard() {
  if (!clipboard) return false;
  const sel = state.session.selection.map((id) => findNode(id)).filter(Boolean);
  if (clipboard.kind === 'blocks' && !sel.length) return false;
  const pasted = [];
  let spotCanvasIds = [];
  change(() => {
    if (clipboard.kind === 'canvas') {
      const canvases = state.session.canvases;
      let at = sel.length ? canvases.indexOf(sel[sel.length - 1].canvas) + 1 : canvases.length;
      for (const node of clipboard.nodes) {
        const copy = cloneWithNewIds(node);
        copy.name = nextCanvasName();
        canvases.splice(at++, 0, copy);
        pasted.push(copy.id);
      }
    } else {
      // Where each batch of copies lands: after the last selected block, or at the end of every selected canvas.
      const spots = sel[0].node.type === 'canvas'
        ? sel.map((hit) => ({ list: hit.node.children, at: hit.node.children.length, canvas: hit.node }))
        : [{ list: sel[sel.length - 1].list, at: sel[sel.length - 1].index + 1, canvas: sel[sel.length - 1].canvas }];
      spotCanvasIds = spots.map((s) => s.canvas.id);
      for (const spot of spots) {
        for (const node of clipboard.nodes) {
          const copy = cloneWithNewIds(node);
          copy.name = copyName(node.name, spot.canvas);
          spot.list.splice(spot.at++, 0, copy);
          pasted.push(copy.id);
        }
      }
    }
    // Pasting into several canvases keeps those canvases selected; otherwise the pasted items are selected.
    pick(clipboard.kind === 'blocks' && spotCanvasIds.length > 1 ? spotCanvasIds : pasted);
  });
  return true;
}

export function toggleHidden(id) {
  const loc = findNode(id);
  if (loc) change(() => { loc.node.hidden = !loc.node.hidden; });
}

// "clear boards" in settings: removes every canvas and leaves one empty "Board 1". Undoable.
export function clearCanvases() {
  change(() => {
    state.session.canvases = [createCanvas({ name: `${BASE_NAME} 1` })];
    state.session.selection = [];
  });
}

// ---------- Library mutations ----------
export function addColor({ name, hex }) {
  const color = { id: uid('c'), name, hex: normalizeHex(hex) };
  change(() => state.library.colors.push(color), { library: true });
  return color;
}

// Edits a color's name/hex, whether it is a single color or a swatch inside a palette (the hex may carry an alpha).
export function updateColor(id, patch) {
  const color = findColor(id);
  if (!color) return;
  if (patch.hex) patch = { ...patch, hex: normalizeHex(patch.hex) };
  change(() => Object.assign(color, patch), { library: true });
}

// A new palette with one swatch: gray from "+ add", or the picked color from the palettes header eyedropper.
export function addPalette(name, hex = '#888888') {
  const palette = { id: uid('p'), name, colors: [{ id: uid('c'), name: 'new_color', hex: normalizeHex(hex) }] };
  change(() => state.library.palettes.push(palette), { library: true });
  return palette;
}
export function renamePalette(id, name) {
  const p = state.library.palettes.find((x) => x.id === id);
  if (p) change(() => { p.name = name; }, { library: true });
}
export function addPaletteColor(paletteId) {
  const p = state.library.palettes.find((x) => x.id === paletteId);
  if (!p) return null;
  const color = { id: uid('c'), name: 'new_color', hex: '#888888' };
  change(() => p.colors.push(color), { library: true });
  return color;
}

// Drag a color (library color or another palette's swatch) onto a palette: adds a COPY (new id, same name + hex)
// at `index` (0 = first; the end when past it). Later edits of the original don't change the copy. One undo step.
export function insertPaletteColor(paletteId, { name, hex }, index) {
  const p = state.library.palettes.find((x) => x.id === paletteId);
  if (!p) return;
  const color = { id: uid('c'), name, hex: normalizeHex(hex) };
  const at = Math.max(0, Math.min(index, p.colors.length));
  change(() => p.colors.splice(at, 0, color), { library: true });
}

// Drag a swatch within its OWN palette: moves it (no copy). `index` is the insertion point in the list as it is
// now (before the swatch is taken out), the same number the drop line shows. A drop on its own spot does nothing.
export function movePaletteColor(paletteId, colorId, index) {
  const p = state.library.palettes.find((x) => x.id === paletteId);
  if (!p) return;
  const from = p.colors.findIndex((c) => c.id === colorId);
  if (from < 0) return;
  let to = Math.max(0, Math.min(index, p.colors.length));
  if (to > from) to -= 1;          // taking the swatch out shifts every later spot one to the left
  if (to === from) return;         // no history entry for a drop that changes nothing
  change(() => { const [c] = p.colors.splice(from, 1); p.colors.splice(to, 0, c); }, { library: true });
}

export function addFonts(entries) {
  change(() => state.library.fonts.push(...entries), { library: true });
}
// Entries must carry `addedAt` (Date.now()); the library sorts media newest-first by it.
export function addMedia(entries) {
  change(() => state.library.media.push(...entries), { library: true });
}

// First launch only: puts the default media (logo + wordmark) into the brand-new library. NOT an undo step, so
// Ctrl+Z can't take the starter content away; the library is saved like after any other library change.
export function seedMedia(entries) {
  state.library.media.push(...entries);
  notify({ library: true });
}

// "save as preset": stores the STRUCTURE of one or more boards (`canvasIds`), in the order they have in the preview
// and layers tree (not the order they were clicked). preset = { id, name, addedAt, boards: [structure, ...] }.
export function savePreset(canvasIds, name) {
  const ids = new Set(canvasIds);
  const boards = state.session.canvases.filter((c) => ids.has(c.id));
  if (!boards.length) return null;
  const preset = { id: uid('pr'), name, addedAt: Date.now(), boards: boards.map(structureFromCanvas) };
  change(() => state.library.presets.push(preset), { library: true });
  return preset;
}

// Adds a ready-made preset to the library (used by "open as preset" for a .S_ file). One undo step.
export function addPreset(name, boards) {
  const preset = { id: uid('pr'), name, addedAt: Date.now(), boards };
  change(() => state.library.presets.push(preset), { library: true });
  return preset;
}

// ---------- Soft delete (trash) ----------
const LISTS = { font: 'fonts', color: 'colors', palette: 'palettes', media: 'media', preset: 'presets' };

// Moves library items into the trash as ONE undo step. Blocks that used them are left untouched:
// they simply fail to find the item and render their gray placeholder (and re-link if it is restored).
// kind: font | color | palette | media | preset | palette_color
export function trashItems(kind, ids) {
  change(() => {
    for (const id of ids) {
      let item = null;
      if (kind === 'palette_color') {
        const palette = state.library.palettes.find((p) => p.colors.some((c) => c.id === id));
        if (!palette) continue;
        const index = palette.colors.findIndex((c) => c.id === id);
        item = { paletteId: palette.id, index, color: palette.colors.splice(index, 1)[0] };
      } else {
        const list = state.library[LISTS[kind]];
        const i = list.findIndex((x) => x.id === id);
        if (i < 0) continue;
        item = list.splice(i, 1)[0];
      }
      state.library.trash.push({ id: uid('t'), kind, item, deletedAt: Date.now() });
    }
  }, { library: true });
}

// The disk location of a trash entry's file, or null for items without files.
export function trashFileOf(entry) {
  if (entry.kind === 'font') return { subdir: 'fonts', fileName: entry.item.fileName };
  if (entry.kind === 'media') return { subdir: 'media', fileName: entry.item.fileName };
  return null;
}

// Display name of a trash entry.
export function trashLabel(entry) {
  const it = entry.item;
  if (entry.kind === 'font') return `${it.family} ${it.weight}${it.style === 'italic' ? ' italic' : ''}`;
  if (entry.kind === 'palette_color') return it.color.name;
  return it.name;
}

// Puts a trashed item back in the library. Returns false if it can't (e.g. its palette is gone).
export function restoreTrash(trashId) {
  const entry = state.library.trash.find((t) => t.id === trashId);
  if (!entry) return false;
  if (entry.kind === 'palette_color') {
    const palette = state.library.palettes.find((p) => p.id === entry.item.paletteId);
    if (!palette) return false;
  }
  change(() => {
    if (entry.kind === 'palette_color') {
      const palette = state.library.palettes.find((p) => p.id === entry.item.paletteId);
      palette.colors.splice(Math.min(entry.item.index, palette.colors.length), 0, entry.item.color);
    } else {
      state.library[LISTS[entry.kind]].push(entry.item);
    }
    state.library.trash = state.library.trash.filter((t) => t.id !== trashId);
  }, { library: true });
  return true;
}

// Permanently removes entries from the trash list (null = all). NOT undoable, so history is cleared.
// The caller deletes the files first (window.api.purgeTrashFiles). Returns the removed entries.
export function purgeTrash(ids = null) {
  const removed = state.library.trash.filter((t) => !ids || ids.includes(t.id));
  state.library.trash = state.library.trash.filter((t) => !removed.includes(t));
  undoStack = [];
  redoStack = [];
  notify({ session: true, library: true });
  return removed;
}
