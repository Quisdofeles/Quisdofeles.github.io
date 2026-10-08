// state.js: THE single source of truth.
// All app data lives in the one `state` object below. Other modules READ it and render from it;
// they CHANGE it only by calling the functions exported here, which then notify subscribers.
// Also holds the undo/redo history (snapshots of canvases + library, max 50).
//
// Notification meta (what changed), passed to every subscriber:
//   { library, session, live, view, selection, history }

import { uid, clone, normalizeHex } from './util.js';
import {
  createBlock, createCanvas, cloneWithNewIds, structureFromCanvas, canvasFromStructure,
  defaultLayerRoles, isContainer, isTextType, BASE_NAME,
  DEFAULT_PRESETS, STARTER_COLORS, STARTER_PALETTES,
} from './blocks.js';

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
function defaultLibrary() {
  const colors = STARTER_COLORS.map((c) => ({ id: uid('c'), ...c }));
  const byName = Object.fromEntries(colors.map((c) => [c.name, c]));
  const palettes = STARTER_PALETTES.map((p) => ({
    id: uid('p'), name: p.name,
    colors: p.colors.map((n) => ({ id: uid('c'), name: byName[n].name, hex: byName[n].hex })),
  }));
  return { fonts: [], colors, palettes, vectors: [], presets: clone(DEFAULT_PRESETS), trash: [] };
}

function defaultSession() {
  return {
    canvases: [createCanvas({ name: `${BASE_NAME}_A` })],
    selectedId: null,
    zoom: 1,
    pan: { x: 0, y: 0 },
    export: { styleLabels: true, format: 'png', transparent: true, scale: 2 },
    collapsedGroups: {},     // editor property groups the user collapsed
    collapsedNodes: {},      // layers-tree nodes the user collapsed
    helpSeen: false,
  };
}

// Fills in anything missing from a loaded file so older saves keep working.
function normalize(loaded, fallback) {
  const out = { ...fallback, ...(loaded || {}) };
  for (const key of Object.keys(fallback)) if (out[key] === undefined || out[key] === null) out[key] = fallback[key];
  return out;
}

// Called once at startup with whatever persistence loaded (null on first launch).
export function initState(library, session) {
  isFirstLaunch = !library && !session;
  state.library = normalize(library, defaultLibrary());
  state.session = normalize(session, defaultSession());
  state.session.export = { ...defaultSession().export, ...state.session.export };
  if (!findNode(state.session.selectedId)) state.session.selectedId = null;
  undoStack = [];
  redoStack = [];
}

// ---------- History ----------
function snapshot() {
  return JSON.stringify({ canvases: state.session.canvases, selectedId: state.session.selectedId, library: state.library });
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
  state.session.selectedId = findNode(data.selectedId) ? data.selectedId : null;
}

export function undo() {
  if (!undoStack.length) return false;
  redoStack.push(snapshot());
  restore(undoStack.pop());
  gestureOpen = false;
  notify({ session: true, library: true, history: true });
  return true;
}
export function redo() {
  if (!redoStack.length) return false;
  undoStack.push(snapshot());
  restore(redoStack.pop());
  gestureOpen = false;
  notify({ session: true, library: true, history: true });
  return true;
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
export const selectedNode = () => (findNode(state.session.selectedId) || {}).node || null;

// The canvas the current selection belongs to (or null).
export function selectedCanvas() {
  const hit = findNode(state.session.selectedId);
  return hit ? hit.canvas : null;
}

export const getFont = (id) => state.library.fonts.find((f) => f.id === id) || null;
export const getVector = (id) => state.library.vectors.find((v) => v.id === id) || null;

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

// How many blocks use these library items. Fonts: text blocks that resolve to the font (override or canvas role).
// Vectors: vector/image blocks pointing at it. Colors/palettes/presets store copies, so they are never "in use".
export function usageCount(kind, ids) {
  const set = new Set(ids);
  let count = 0;
  for (const cv of state.session.canvases) {
    const walk = (list) => list.forEach((n) => {
      if (kind === 'font' && isTextType(n.type) && set.has(n.fontOverride || cv.fonts[n.type])) count++;
      if (kind === 'vector' && (n.type === 'vector' || n.type === 'image') && set.has(n.vectorId)) count++;
      if (n.children) walk(n.children);
    });
    walk(cv.children);
  }
  return count;
}

// Asks every panel to redraw without changing any data (used after fonts/vectors finish loading from disk).
export function requestRender() {
  notify({ refresh: true });
}

// ---------- Selection, view, UI (not undo steps) ----------
export function selectNode(id) {
  if (state.session.selectedId === id) return;
  state.session.selectedId = id;
  notify({ session: true, selection: true });
}
export function setView(zoom, pan) {
  state.session.zoom = zoom;
  state.session.pan = pan;
  notify({ session: true, view: true });
}
export function setExport(patch) {
  Object.assign(state.session.export, patch);
  notify({ session: true, exportSettings: true });
}
export function setGroupCollapsed(name, collapsed) {
  state.session.collapsedGroups[name] = collapsed;
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
// Picks the next unused name for a canvas copy: lockup_A -> lockup_B (first free letter).
function nextCanvasName(baseName = BASE_NAME) {
  const base = baseName.replace(/_[A-Z]$/, '');
  const used = new Set(state.session.canvases.map((c) => c.name));
  for (let i = 0; i < 26; i++) {
    const name = `${base}_${String.fromCharCode(65 + i)}`;
    if (!used.has(name)) return name;
  }
  return `${base}_${state.session.canvases.length + 1}`;
}

// Adds a new canvas (optionally from a preset structure) and selects it. Returns the canvas.
export function addCanvas({ structure, index } = {}) {
  const name = nextCanvasName(BASE_NAME);
  const canvas = structure ? canvasFromStructure(structure, name) : createCanvas({ name });
  change(() => {
    const list = state.session.canvases;
    list.splice(index === undefined ? list.length : index, 0, canvas);
    state.session.selectedId = canvas.id;
  });
  return canvas;
}

export function addCanvasFromPreset(presetId, index) {
  const preset = state.library.presets.find((p) => p.id === presetId);
  return preset ? addCanvas({ structure: preset.structure, index }) : null;
}

// Adds a block of `type` into a container (canvas/group) at `index`. Returns the block.
export function addBlock(type, parentId, index, extra = {}) {
  if (type === 'canvas') return addCanvas();
  const parent = findNode(parentId);
  if (!parent || !isContainer(parent.node)) return null;
  const block = createBlock(type, extra);
  change(() => {
    const kids = parent.node.children;
    kids.splice(index === undefined ? kids.length : Math.max(0, Math.min(index, kids.length)), 0, block);
    state.session.selectedId = block.id;
  });
  return block;
}

// Adds a vector/image block already pointing at a library vector.
export function addVectorBlock(vectorId, parentId, index) {
  const vec = getVector(vectorId);
  if (!vec) return null;
  const type = vec.kind === 'image' ? 'image' : 'vector';
  const extra = { vectorId, name: vec.name };
  if (type === 'vector') extra.layerRoles = defaultLayerRoles(vec.layers);
  return addBlock(type, parentId, index, extra);
}

// Drops a block type onto empty space: a new canvas containing that block (or just a canvas).
export function addBlockToNewCanvas(type, extra = {}) {
  if (type === 'canvas') return addCanvas();
  const canvas = createCanvas({ name: nextCanvasName(BASE_NAME) });
  canvas.children.push(createBlock(type, extra));
  change(() => {
    state.session.canvases.push(canvas);
    state.session.selectedId = canvas.children[0].id;
  });
  return canvas;
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

export function setRole(canvasId, role, hex) {
  const hit = findNode(canvasId);
  if (!hit || hit.node.type !== 'canvas') return;
  change(() => { hit.node.roles[role] = normalizeHex(hex); });
}

// Sets the font for a text role on a canvas (all blocks of that role update). fontId may be null.
export function setCanvasFont(canvasId, textType, fontId) {
  const hit = findNode(canvasId);
  if (!hit) return;
  change(() => { hit.node.fonts[textType] = fontId; });
}

// Sets a vector block's per-layer role; passing a hex sets an override instead.
export function setLayerColor(blockId, layer, { role, hex, reset }) {
  const hit = findNode(blockId);
  if (!hit) return;
  change(() => {
    const b = hit.node;
    if (role) { b.layerRoles[layer] = role; delete b.layerOverrides[layer]; }
    if (hex) b.layerOverrides[layer] = normalizeHex(hex);
    if (reset) delete b.layerOverrides[layer];
  });
}

// A color dropped on something (one undo step). Sets the ROLE that the target uses on its canvas:
// a canvas (or any non-color block) -> background; a text block -> its color role; a vector block -> the
// role of the layer under the pointer. Any override that would hide the change is cleared.
export function dropColor(nodeId, hex, layer) {
  const hit = findNode(nodeId);
  if (!hit) return;
  const canvas = hit.canvas, node = hit.node;
  hex = normalizeHex(hex);
  change(() => {
    if (isTextType(node.type)) {
      canvas.roles[node.colorRole] = hex;
      node.colorOverride = null;
    } else if (node.type === 'vector') {
      const key = layer && layer in node.layerRoles ? layer : Object.keys(node.layerRoles)[0];
      if (key !== undefined) { canvas.roles[node.layerRoles[key] || 'primary'] = hex; delete node.layerOverrides[key]; }
    } else {
      canvas.roles.background = hex;
    }
  });
}

// Swaps the vector a block points at, keeping layer roles whose names still exist.
export function swapVector(blockId, vectorId) {
  const hit = findNode(blockId);
  const vec = getVector(vectorId);
  if (!hit || !vec) return;
  change(() => {
    const b = hit.node;
    const oldName = (getVector(b.vectorId) || {}).name;
    const fresh = defaultLayerRoles(vec.layers);
    for (const k of Object.keys(fresh)) if (b.layerRoles && b.layerRoles[k]) fresh[k] = b.layerRoles[k];
    b.vectorId = vectorId;
    if (b.type === 'vector') { b.layerRoles = fresh; b.layerOverrides = {}; }
    if (!oldName || b.name === oldName) b.name = vec.name;
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
  });
}
// True if `id` is somewhere inside `node` (used to block dragging a container into its own child).
function isInside(node, id) {
  return (node.children || []).some((c) => c.id === id || isInside(c, id));
}

export function removeNode(id) {
  const loc = findNode(id);
  if (!loc) return;
  change(() => {
    loc.list.splice(loc.index, 1);
    if (!findNode(state.session.selectedId)) state.session.selectedId = null;
  });
}

export function duplicateNode(id) {
  const loc = findNode(id);
  if (!loc) return null;
  const copy = cloneWithNewIds(loc.node);
  if (copy.type === 'canvas') copy.name = nextCanvasName(loc.node.name);
  change(() => {
    loc.list.splice(loc.index + 1, 0, copy);
    state.session.selectedId = copy.id;
  });
  return copy;
}

export function toggleHidden(id) {
  const loc = findNode(id);
  if (loc) change(() => { loc.node.hidden = !loc.node.hidden; });
}

// "clear canvas" in settings: removes every canvas and leaves one empty lockup_A. Undoable.
export function clearCanvases() {
  change(() => {
    state.session.canvases = [createCanvas({ name: `${BASE_NAME}_A` })];
    state.session.selectedId = null;
  });
}

// ---------- Library mutations ----------
export function addColor({ name, hex }) {
  const color = { id: uid('c'), name, hex: normalizeHex(hex) };
  change(() => state.library.colors.push(color), { library: true });
  return color;
}

// Edits a color's name/hex, whether it is a single color or a swatch inside a palette.
export function updateColor(id, patch) {
  const color = findColor(id);
  if (!color) return;
  if (patch.hex) patch = { ...patch, hex: normalizeHex(patch.hex) };
  change(() => Object.assign(color, patch), { library: true });
}

export function addPalette(name) {
  const palette = { id: uid('p'), name, colors: [{ id: uid('c'), name: 'new_color', hex: '#888888' }] };
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

export function addFonts(entries) {
  change(() => state.library.fonts.push(...entries), { library: true });
}
export function addVectors(entries) {
  change(() => state.library.vectors.push(...entries), { library: true });
}

export function savePreset(canvasId, name) {
  const hit = findNode(canvasId);
  if (!hit || hit.node.type !== 'canvas') return null;
  const preset = { id: uid('pr'), name, structure: structureFromCanvas(hit.node) };
  change(() => state.library.presets.push(preset), { library: true });
  return preset;
}

// ---------- Soft delete (trash) ----------
const LISTS = { font: 'fonts', color: 'colors', palette: 'palettes', vector: 'vectors', preset: 'presets' };

// Moves library items into the trash as ONE undo step. Blocks that used them are left untouched:
// they simply fail to find the item and render their gray placeholder (and re-link if it is restored).
// kind: font | color | palette | vector | preset | palette_color
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
  if (entry.kind === 'vector') return { subdir: 'vectors', fileName: entry.item.fileName };
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
