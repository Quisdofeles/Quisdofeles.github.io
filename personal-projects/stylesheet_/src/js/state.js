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
  isContainer, isTextType, hasVisibleContent, BASE_NAME, DEFAULT_TEXT_COLOR,
  LEGACY_PRESETS, STARTER_COLORS, STARTER_PALETTES, EMPTY_SIZE, DEFAULT_PADDING, LEGACY_PADDING, legacySize,
} from './blocks.js';
import { layerInfo } from './svg.js';
import { BUILTIN_FONTS, DEFAULT_FONT_ID } from './fonts.js';

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
    canvases: [],            // a new user starts with an empty preview (it shows the "+ add canvas" button)
    selection: [],           // ids of the selected nodes (a LIST; see cleanSelection() for the rules)
    zoom: 1,
    pan: { x: 0, y: 0 },
    // canvasLabels: show the OPTION A/B… label on each canvas (preview and export). Old saves without it get true
    // because initState() merges these defaults under the saved values. A new session: both labels on, PNG,
    // transparent off, 1× (saved sessions keep their own values).
    export: { styleLabels: true, canvasLabels: true, format: 'png', transparent: false, scale: 1 },
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

// One-time upgrade of saves made before "vectors" became "media". Safe to run on every load: it does nothing
// once the data is already in the new shape. Also backfills `addedAt` (used for newest-first sorting) so old
// items keep their current relative order: they get small numbers (their position), older than any real timestamp.
function migrateOldSaves(library, session) {
  if (library) {
    if (library.vectors && !library.media) library.media = library.vectors;
    delete library.vectors;
    (library.media || []).forEach((m, i) => { if (m.addedAt === undefined) m.addedAt = i + 1; delete m.layers; });   // layers are now read from the SVG itself
    (library.trash || []).filter((t) => t.kind === 'media').forEach((t) => { delete t.item.layers; });
    const defaultIds = new Set(LEGACY_PRESETS.map((p) => p.id));
    (library.presets || []).forEach((p, i) => { if (p.addedAt === undefined) p.addedAt = defaultIds.has(p.id) ? 0 : i + 1; });
    for (const t of library.trash || []) {
      if (t.kind === 'vector') t.kind = 'media';
      if (t.kind === 'media' && t.item.addedAt === undefined) t.item.addedAt = 0;
      if (t.kind === 'preset' && t.item.addedAt === undefined) t.item.addedAt = defaultIds.has(t.item.id) ? 0 : 1;
    }
  }
  if (session) {
    // Old sessions saved ONE selected id; the selection is now a list.
    if (!Array.isArray(session.selection)) session.selection = session.selectedId ? [session.selectedId] : [];
    delete session.selectedId;
    const walk = (list) => list.forEach((n) => {
      if ('vectorId' in n) { n.mediaId = n.vectorId; delete n.vectorId; }
      if (n.children) walk(n.children);
    });
    walk(session.canvases || []);
    migrateRolesToColors(session.canvases || []);
    migrateFontRoles(session.canvases || []);
  }
  if (library) {
    // Presets store structure only: drop the old role pointers and the removed swatch block from them.
    const cleanStructure = (list) => list.filter((s) => s.type !== 'swatch').map((s) => {
      delete s.colorRole;
      if (s.children) s.children = cleanStructure(s.children);
      return s;
    });
    const cleanPreset = (p) => { if (p.structure && p.structure.children) p.structure.children = cleanStructure(p.structure.children); };
    (library.presets || []).forEach(cleanPreset);
    (library.trash || []).filter((t) => t.kind === 'preset').forEach((t) => cleanPreset(t.item));
  }
  migrateCanvasSizes(library, session);
}

// Upgrades canvases and presets from `aspect` (every canvas was 384px wide, height from its aspect, content inset
// ~28px) to `size` + `padding`. Saved canvases become FIXED at exactly their old size with padding 28, so they look
// the same. The presets older versions shipped take their new settings from LEGACY_PRESETS (business_card and social_post: fixed
// at their old size; the others: dynamic); user-saved presets become fixed at their old size like canvases.
// Safe to run on every load (it only touches things that still have no `size`). Delete once all old saves are gone.
function migrateCanvasSizes(library, session) {
  const upgrade = (obj) => {
    if (!obj || obj.size) return;
    obj.size = legacySize(obj.aspect);
    obj.padding = LEGACY_PADDING;
    delete obj.aspect;
  };
  if (session) (session.canvases || []).forEach(upgrade);
  if (library) {
    const shipped = Object.fromEntries(LEGACY_PRESETS.map((p) => [p.id, p.structure]));
    const upgradePreset = (p) => {
      if (!p.structure || p.structure.size) return;
      if (shipped[p.id]) {
        p.structure.size = { ...shipped[p.id].size };
        p.structure.padding = shipped[p.id].padding;
        delete p.structure.aspect;
      } else upgrade(p.structure);
    };
    (library.presets || []).forEach(upgradePreset);
    (library.trash || []).filter((t) => t.kind === 'preset').forEach((t) => upgradePreset(t.item));
  }
}

// A dynamic canvas needs content (an empty one would have no size). Any dynamic canvas that has no visible block
// left (its last block was deleted, hidden or dragged out) switches to fixed 160×160. Runs after every change(),
// so it is part of the same undo step as the action that emptied the canvas.
function fixEmptyDynamicCanvases() {
  for (const cv of state.session.canvases) {
    if (cv.size.mode === 'dynamic' && !hasVisibleContent(cv)) cv.size = { mode: 'fixed', width: EMPTY_SIZE, height: EMPTY_SIZE };
  }
}

// Upgrades the colors/roles model: every canvas used to have 4 roles and blocks pointed at them. Each block now
// stores its own fixed color, copied from its canvas's role values, so nothing changes visually.
//  - canvas.roles.background -> canvas.background
//  - text block colorOverride / roles[colorRole] -> block.color
//  - vector block layerRoles / layerOverrides (keyed by Illustrator layer NAME) -> block.legacyLayerColors, which
//    resolveLegacyLayerColors() turns into layerColors (keyed by layer index) once the SVG has been loaded
//  - swatch blocks no longer exist and are removed
function migrateRolesToColors(canvases) {
  const dropSwatches = (list) => list.filter((n) => n.type !== 'swatch');
  for (const cv of canvases) {
    const roles = cv.roles || null;
    const walk = (list) => list.forEach((n) => {
      if (roles && isTextType(n.type) && ('colorRole' in n || 'colorOverride' in n)) {
        n.color = n.colorOverride || roles[n.colorRole] || roles.primary;
      }
      if (isTextType(n.type)) { delete n.colorRole; delete n.colorOverride; if (!n.color) n.color = DEFAULT_TEXT_COLOR; }
      if (n.type === 'vector') {
        if (roles && ('layerRoles' in n || 'layerOverrides' in n)) {
          const legacy = {};
          for (const [layer, role] of Object.entries(n.layerRoles || {})) legacy[layer] = roles[role] || roles.primary;
          for (const [layer, hex] of Object.entries(n.layerOverrides || {})) legacy[layer] = hex;
          n.legacyLayerColors = legacy;
        }
        delete n.layerRoles; delete n.layerOverrides;
        if (!n.layerColors) n.layerColors = {};
      }
      if (n.children) { n.children = dropSwatches(n.children); walk(n.children); }
    });
    cv.children = dropSwatches(cv.children || []);
    walk(cv.children);
    cv.background = cv.background || (roles && roles.background) || '#FFFFFF';   // old canvases were white (not the new #EDEDEE default)
    delete cv.roles;
  }
}

// Upgrades the font model: canvases used to hold one font per text type (canvas.fonts) plus an optional per-block
// override. Now every text block stores its OWN font (block.font), so each block gets the font it showed before:
// its override, else its canvas's font for that type, else the default font, Space Grotesk (those blocks used to show a gray
// placeholder). canvas.fonts and fontOverride are removed.
function migrateFontRoles(canvases) {
  for (const cv of canvases) {
    const roles = cv.fonts || {};
    const walk = (list) => list.forEach((n) => {
      if (isTextType(n.type)) {
        if (!n.font) n.font = n.fontOverride || roles[n.type] || DEFAULT_FONT_ID;
        delete n.fontOverride;
      }
      if (n.children) walk(n.children);
    });
    walk(cv.children || []);
    delete cv.fonts;
  }
}

// Second half of the vector upgrade (needs the SVG loaded, so it runs after the media files load, see app.js).
// Old layer colors were stored under Illustrator layer names; they now belong to first-level layer indexes.
// A layer takes the color of the old named layer it is (or contains); an old "whole drawing" color ('*') fills the rest.
export function resolveLegacyLayerColors() {
  let changed = false;
  const walk = (list) => list.forEach((n) => {
    if (n.type === 'vector' && n.legacyLayerColors) {
      const layers = layerInfo(n.mediaId);
      if (layers.length) {
        const legacy = n.legacyLayerColors;
        n.layerColors = {};
        layers.forEach((layer, i) => {
          const hit = layer.ids.find((id) => id in legacy);
          const hex = hit ? legacy[hit] : legacy['*'];
          if (hex) n.layerColors[i] = hex;
        });
        delete n.legacyLayerColors;
        changed = true;
      }
    }
    if (n.children) walk(n.children);
  });
  walk(state.session.canvases);
  if (changed) notify({ session: true });      // not an undo step: it just finishes the upgrade
}

// Called once at startup with whatever persistence loaded (null on first launch).
export function initState(library, session) {
  isFirstLaunch = !library && !session;
  migrateOldSaves(library, session);
  state.library = normalize(library, defaultLibrary());
  state.session = normalize(session, defaultSession());
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
  fixEmptyDynamicCanvases();       // an emptied dynamic canvas falls back to fixed 160×160 (same undo step)
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
// Media: vector/image blocks pointing at it. Colors/palettes/presets store copies, so they are never "in use".
export function usageCount(kind, ids) {
  const set = new Set(ids);
  let count = 0;
  for (const cv of state.session.canvases) {
    const walk = (list) => list.forEach((n) => {
      if (kind === 'font' && isTextType(n.type) && set.has(n.font)) count++;
      if (kind === 'media' && (n.type === 'vector' || n.type === 'image') && set.has(n.mediaId)) count++;
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
  const name = nextCanvasName(BASE_NAME);
  const canvas = structure ? canvasFromStructure(structure, name) : createCanvas({ name });
  change(() => {
    const list = state.session.canvases;
    list.splice(index === undefined ? list.length : index, 0, canvas);
    pick([canvas.id]);
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

// Drops a block type onto empty space: a new canvas containing that block (or just a canvas).
// A canvas created WITH content starts dynamic (it shrink-wraps the block plus padding 24).
export function addBlockToNewCanvas(type, extra = {}) {
  if (type === 'canvas') return addCanvas();
  const canvas = createCanvas({
    name: nextCanvasName(BASE_NAME),
    size: { mode: 'dynamic', width: EMPTY_SIZE, height: EMPTY_SIZE }, padding: DEFAULT_PADDING,
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
// Sets a canvas's background color.
export function setCanvasBackground(canvasId, hex) {
  const hit = findNode(canvasId);
  if (!hit || hit.node.type !== 'canvas') return;
  change(() => { hit.node.background = normalizeHex(hex); });
}

// Sets a text block's color.
export function setTextColor(blockId, hex) {
  const hit = findNode(blockId);
  if (!hit || !isTextType(hit.node.type)) return;
  change(() => { hit.node.color = normalizeHex(hex); });
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
export function setLayerColor(blockId, layer, hex) {
  const hit = findNode(blockId);
  if (!hit || hit.node.type !== 'vector') return;
  change(() => {
    if (!hit.node.layerColors) hit.node.layerColors = {};
    if (hex) hit.node.layerColors[layer] = normalizeHex(hex); else delete hit.node.layerColors[layer];
  });
}

// A color dropped on something (one undo step); it sets just that one thing:
// a text block -> its color; a vector block -> the layer under the pointer (`layer`, required: with no layer
// nothing happens); a canvas or any other block -> the canvas background.
export function dropColor(nodeId, hex, layer) {
  const hit = findNode(nodeId);
  if (!hit) return;
  const node = hit.node;
  if (node.type === 'vector' && layer === undefined) return;
  if (isTextType(node.type)) setTextColor(node.id, hex);
  else if (node.type === 'vector') setLayerColor(node.id, layer, hex);
  else setCanvasBackground(hit.canvas.id, hex);
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
    pruneEmptyGroups();                                       // the group it left may be empty now
  });
}

// Removes every group that has no children left (an empty group has nothing to show). Runs inside the same undo
// step as the move/delete that emptied it, then keeps the selection valid. Nested groups are handled bottom-up.
function pruneEmptyGroups() {
  const prune = (list) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      if (!n.children) continue;
      prune(n.children);
      if (n.type === 'group' && !n.children.length) list.splice(i, 1);
    }
  };
  state.session.canvases.forEach((cv) => prune(cv.children));
  state.session.selection = cleanSelection(state.session.selection);
}

// Wraps the selected blocks in a new group (right-click -> group, Ctrl+G), as ONE undo step; the new group becomes
// the selection. Canvases can't be grouped (they are ignored). The group sits where the first selected block (top of
// the tree) was, the blocks keep their tree order, and it copies the parent's layout so nothing shifts visually.
export function groupNodes(ids) {
  const hits = ids.map((id) => findNode(id)).filter((h) => h && h.node.type !== 'canvas');
  if (!hits.length) return null;
  const order = new Map(allNodes().map((n, i) => [n.id, i]));
  hits.sort((a, b) => order.get(a.node.id) - order.get(b.node.id));
  const first = hits[0];
  const group = createBlock('group', { name: numberedName('group', first.canvas), layout: { ...first.parent.layout } });
  change(() => {
    first.list.splice(first.index, 1, group);                 // the group takes the first block's slot
    group.children.push(first.node);
    for (const hit of hits.slice(1)) {
      const loc = findNode(hit.node.id);                      // looked up fresh: earlier removals shift the indexes
      loc.list.splice(loc.index, 1);
      group.children.push(hit.node);
    }
    pruneEmptyGroups();                                       // a group whose blocks all moved out disappears
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
    pruneEmptyGroups();                      // also keeps the selection valid
  });
}

// Duplicates every node in `ids` as ONE undo step; each copy goes right after its original and the copies become
// the selection. Canvases get the next free letter (lockup_B); blocks get "name copy", "name copy 2"...
export function duplicateNodes(ids) {
  const copies = [];
  change(() => {
    for (const id of ids) {
      const loc = findNode(id);
      if (!loc) continue;
      const copy = cloneWithNewIds(loc.node);
      copy.name = copy.type === 'canvas' ? nextCanvasName(loc.node.name) : copyName(loc.node.name, loc.canvas);
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
        copy.name = nextCanvasName(node.name);
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

// "clear canvas" in settings: removes every canvas and leaves one empty lockup_A. Undoable.
export function clearCanvases() {
  change(() => {
    state.session.canvases = [createCanvas({ name: `${BASE_NAME}_A` })];
    state.session.selection = [];
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

export function savePreset(canvasId, name) {
  const hit = findNode(canvasId);
  if (!hit || hit.node.type !== 'canvas') return null;
  const preset = { id: uid('pr'), name, addedAt: Date.now(), structure: structureFromCanvas(hit.node) };
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
