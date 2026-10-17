// dragdrop.js: ALL drag-and-drop logic (native HTML5 drag and drop).
// Anything draggable carries data-drag-kind / data-drag-id (library items, layer rows).
// While dragging, planDrop() decides what a drop on the element under the pointer WOULD do and returns
// { el, cls, run }: the element to outline in lime, and the state.js call to make on drop.
// Every drop is a single state.js call, so every drop is one undo step.
//
// A plan may also carry `outline`: the exact thing a color/font drop will change (a text block's glyphs, one vector
// layer, a canvas edge), drawn in accent by outline.js. Color and font drops on the preview use ONLY that outline
// (el is null), not a box around the whole block.
// A plan may also carry `insert` (palette drops only): where the accent insertion line goes between swatches.
//
// Payload kinds: font | color | media | block | preset | palette (a whole library palette card) | node (a row in the layers tree).

import { $ } from './util.js';
import {
  state, findNode, getMedia, findColor, addBlock, addBlockToNewCanvas, addCanvas, addCanvasFromPreset,
  addMediaBlock, addMediaToNewCanvas, swapMedia, setBlockFonts, fontTargets, dropColor, setCanvasBackground, setTextColor, setLayerColor, moveNode,
  insertPaletteColor, movePaletteColor, setGroupBackground, backgroundTargetOf, setBgImage,
  setSectionColor, addPaletteBlock, addPaletteToNewCanvas, getFont, addFontHeading, addFontHeadingToNewCanvas,
} from './state.js';
import { isContainer, isTextType } from './blocks.js';
import { showOutline } from './outline.js';
import { openDroppedFiles } from './project.js';

// The accent outline for a board's or group's background: its edge.
const bgOutline = (node) => (node.type === 'group' ? { type: 'group', blockId: node.id } : { type: 'canvas', canvasId: node.id });

let drag = null;          // { kind, id } of the drag in progress (dragover can't read dataTransfer, so we keep it here)
let hot = null;           // { el, cls } currently outlined

// ---------- Helpers ----------
// Where a drop lands among a container's children, based on the pointer position in the layout flow.
// Returns an index into the container NODE's children (hidden blocks are not in the DOM, so we map by id).
function flowIndex(containerEl, e) {
  const node = findNode(containerEl.dataset.id).node;
  const flow = containerEl.classList.contains('canvas') ? containerEl.querySelector(':scope > .canvas-content') : containerEl;
  const row = node.layout.direction === 'row';
  for (const child of flow.children) {
    if (!child.classList.contains('block') || !child.dataset.id) continue;
    const r = child.getBoundingClientRect();
    const mid = row ? r.left + r.width / 2 : r.top + r.height / 2;
    if ((row ? e.clientX : e.clientY) < mid) {
      const i = node.children.findIndex((c) => c.id === child.dataset.id);
      if (i >= 0) return i;
    }
  }
  return node.children.length;
}

const hexOf = (id) => (findColor(id) || {}).hex;
const nameOf = (id) => (findColor(id) || {}).name || null;       // a library color's name (a palette section keeps it)
const paletteExists = (id) => state.library.palettes.some((p) => p.id === id && p.colors.length);

// ---------- Planning: drops on the preview ----------
function planPreview(e) {
  const stage = $('#stage');
  const blockEl = e.target.closest('.block[data-id]');
  const canvasEl = e.target.closest('.canvas[data-id]');
  const containerEl = e.target.closest('.block-group[data-id], .canvas[data-id]');
  const blockNode = blockEl ? findNode(blockEl.dataset.id) : null;

  switch (drag.kind) {
    case 'block': {
      if (!canvasEl) return { el: stage, cls: 'drop-target', run: () => addBlockToNewCanvas(drag.id) };                 // empty dot grid
      if (drag.id === 'canvas') {
        const at = state.session.canvases.findIndex((c) => c.id === canvasEl.dataset.id) + 1;
        return { el: canvasEl, cls: 'drop-target', run: () => addCanvas({ index: at }) };
      }
      const index = flowIndex(containerEl, e);
      return { el: containerEl, cls: 'drop-target', run: () => addBlock(drag.id, containerEl.dataset.id, index) };
    }
    case 'preset':
      return { el: canvasEl || stage, cls: 'drop-target', run: () => addCanvasFromPreset(drag.id) };
    case 'media': {
      const vec = getMedia(drag.id);
      if (!vec) return null;
      const swappable = blockNode && ((blockNode.node.type === 'vector' && vec.kind === 'svg') || (blockNode.node.type === 'image' && vec.kind === 'image'));
      if (swappable) return { el: blockEl, cls: 'drop-target', run: () => swapMedia(blockNode.node.id, drag.id) };
      if (!canvasEl) return { el: stage, cls: 'drop-target', run: () => addMediaToNewCanvas(drag.id) };   // empty dot grid: a new (dynamic) canvas with it
      const index = flowIndex(containerEl, e);
      return { el: containerEl, cls: 'drop-target', run: () => addMediaBlock(drag.id, containerEl.dataset.id, index) };
    }
    case 'palette': {
      // A whole library palette: a palette block with copies of its colors, in the board/group under the pointer
      // (at the drop position in the flow), or a new (dynamic) board when dropped on the empty dot grid.
      if (!paletteExists(drag.id)) return null;
      if (!canvasEl) return { el: stage, cls: 'drop-target', run: () => addPaletteToNewCanvas(drag.id) };
      const index = flowIndex(containerEl, e);
      return { el: containerEl, cls: 'drop-target', run: () => addPaletteBlock(drag.id, containerEl.dataset.id, index) };
    }
    case 'font': {
      if (!getFont(drag.id)) return null;
      // On a text block: sets the font of that block, or of ALL selected text blocks when it is one of several
      // selected. The outline marks every text it will change.
      if (blockNode && isTextType(blockNode.node.type)) {
        const targets = fontTargets(blockNode.node.id);
        return { el: null, outline: { type: 'text', blockIds: targets }, run: () => setBlockFonts(targets, drag.id) };
      }
      // On top of any other block (vector, image incl. a fill image, palette): nothing. A group is not "a block on
      // top" here: its empty space counts as empty space inside a container (below).
      if (blockNode && blockNode.node.type !== 'group') return null;
      // Empty dot grid: a new (dynamic) board with a heading in this font. Empty space inside a board/group: a
      // heading in this font at the drop position in the flow.
      if (!canvasEl) return { el: stage, cls: 'drop-target', run: () => addFontHeadingToNewCanvas(drag.id) };
      const index = flowIndex(containerEl, e);
      return { el: containerEl, cls: 'drop-target', run: () => addFontHeading(drag.id, containerEl.dataset.id, index) };
    }
    case 'color': {
      // A color changes exactly one thing: a text block, ONE vector layer (the one under the pointer), or one
      // background: a group's (empty space inside it), an image's container's (group or board), or the board's.
      const hex = hexOf(drag.id);
      if (!hex || !canvasEl) return null;
      if (blockNode && isTextType(blockNode.node.type)) {
        return { el: null, outline: { type: 'text', blockId: blockNode.node.id }, run: () => dropColor(blockNode.node.id, hex) };
      }
      if (blockNode && blockNode.node.type === 'vector') {
        const layerEl = e.target.closest && e.target.closest('[data-layer]');
        if (!layerEl) return null;                                   // pointer is over empty space inside the vector
        const layer = layerEl.getAttribute('data-layer');
        return { el: null, outline: { type: 'layer', blockId: blockNode.node.id, layer }, run: () => dropColor(blockNode.node.id, hex, layer) };
      }
      if (blockNode && blockNode.node.type === 'palette') {
        // ONE section of a palette block: the one under the pointer (it also takes the library color's name).
        const secEl = e.target.closest && e.target.closest('[data-section]');
        if (!secEl) return null;
        const section = Number(secEl.dataset.section);
        const id = blockNode.node.id, name = nameOf(drag.id);
        return { el: null, outline: { type: 'section', blockId: id, section }, run: () => setSectionColor(id, section, hex, { name }) };
      }
      const targetId = blockNode ? blockNode.node.id : canvasEl.dataset.id;
      return { el: null, outline: bgOutline(backgroundTargetOf(targetId)), run: () => dropColor(targetId, hex) };
    }
    default:
      return null;
  }
}

// ---------- Planning: drops on rows of the layers tree ----------
function planRow(rowEl, e) {
  const target = findNode(rowEl.dataset.id);
  if (!target) return null;
  const node = target.node;
  const r = rowEl.getBoundingClientRect();
  const frac = (e.clientY - r.top) / r.height;     // 0 = top edge of the row, 1 = bottom edge

  // Insert position for blocks being added/moved next to or into `node`.
  const into = isContainer(node)
    ? { parentId: node.id, index: node.children.length, cls: 'drop-into' }
    : { parentId: target.parent.id, index: target.index + 1, cls: 'drop-after' };

  switch (drag.kind) {
    case 'node': {
      if (drag.id === node.id) return null;
      const moving = findNode(drag.id);
      if (!moving) return null;
      if (moving.node.type === 'canvas') {
        if (node.type !== 'canvas') return null;                                     // canvases only reorder among canvases
        const after = frac > 0.5;
        const index = target.index + (after ? 1 : 0);
        return { el: rowEl, cls: after ? 'drop-after' : 'drop-before', run: () => moveNode(drag.id, null, index) };
      }
      if (node.type === 'canvas') return { el: rowEl, cls: 'drop-into', run: () => moveNode(drag.id, node.id, node.children.length) };
      if (isContainer(node) && frac > 0.25 && frac < 0.75) return { el: rowEl, cls: 'drop-into', run: () => moveNode(drag.id, node.id, node.children.length) };
      const after = frac > 0.5;
      const index = target.index + (after ? 1 : 0);
      return { el: rowEl, cls: after ? 'drop-after' : 'drop-before', run: () => moveNode(drag.id, target.parent.id, index) };
    }
    case 'block':
      if (drag.id === 'canvas') return { el: rowEl, cls: 'drop-into', run: () => addCanvas() };
      return { el: rowEl, cls: into.cls, run: () => addBlock(drag.id, into.parentId, into.index) };
    case 'preset':
      return { el: rowEl, cls: 'drop-into', run: () => addCanvasFromPreset(drag.id) };
    case 'media': {
      const vec = getMedia(drag.id);
      if (!vec) return null;
      if ((node.type === 'vector' && vec.kind === 'svg') || (node.type === 'image' && vec.kind === 'image')) {
        return { el: rowEl, cls: 'drop-into', run: () => swapMedia(node.id, drag.id) };
      }
      return { el: rowEl, cls: into.cls, run: () => addMediaBlock(drag.id, into.parentId, into.index) };
    }
    case 'palette':
      // Same as a block: into a board/group row, or right after a leaf row.
      if (!paletteExists(drag.id)) return null;
      return { el: rowEl, cls: into.cls, run: () => addPaletteBlock(drag.id, into.parentId, into.index) };
    case 'font':
      if (!isTextType(node.type)) return null;
      {
        const targets = fontTargets(node.id);           // same rule as dropping on the preview
        return { el: rowEl, cls: 'drop-into', outline: { type: 'text', blockIds: targets }, run: () => setBlockFonts(targets, drag.id) };
      }
    case 'color': {
      const hex = hexOf(drag.id);
      if (!hex) return null;
      if (isTextType(node.type)) return { el: rowEl, cls: 'drop-into', outline: { type: 'text', blockId: node.id }, run: () => dropColor(node.id, hex) };
      if (node.type === 'vector' || node.type === 'palette') return null;   // several layers / sections: drop on one in the preview or in its colors section
      // A group row -> that group's background; an image row -> its container's; a board (or other) row -> the board's.
      return { el: rowEl, cls: 'drop-into', outline: bgOutline(backgroundTargetOf(node.id)), run: () => dropColor(node.id, hex) };
    }
    default:
      return null;
  }
}

// ---------- Planning: drops on a palette card in the library ----------
// A color (library color, or a swatch of ANOTHER palette) is copied in; a swatch of THIS palette is moved (reorder).
// Over a swatch, its left/right half means before/after it; in the gap between two swatches of one row, the nearest
// swatch decides. Anywhere else on the card (name, empty space, the "+" tile) means the end of the palette.
function planPalette(cardEl, e) {
  if (drag.kind !== 'color') return null;
  const palette = state.library.palettes.find((p) => p.id === cardEl.dataset.paletteId);
  const color = findColor(drag.id);
  if (!palette || !color) return null;
  const grid = cardEl.querySelector('.palette-grid');
  const swatches = [...grid.querySelectorAll('.palette-swatch')];   // same order as palette.colors

  // The swatch the pointer aims at: the one under it, or (in a gap of the grid) the nearest one in the same row.
  let over = e.target.closest('.palette-swatch');
  if (!over && e.target === grid) {
    let best = Infinity;
    for (const s of swatches) {
      const r = s.getBoundingClientRect();
      if (e.clientY < r.top || e.clientY > r.bottom) continue;      // other rows don't count
      const d = Math.abs(e.clientX - (r.left + r.width / 2));
      if (d < best) { best = d; over = s; }
    }
  }

  let index = palette.colors.length;    // default: the end
  let line;                             // where the insertion line is drawn: { ref, side }
  if (over) {
    const r = over.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    index = swatches.indexOf(over) + (after ? 1 : 0);
    line = { ref: over, side: after ? 'after' : 'before' };
  } else {
    line = swatches.length ? { ref: swatches[swatches.length - 1], side: 'after' } : { ref: grid.querySelector('.palette-add'), side: 'before' };
  }

  const own = palette.colors.some((c) => c.id === drag.id);
  return {
    el: cardEl, cls: 'drop-target', insert: { grid, ...line }, effect: own ? 'move' : 'copy',
    run: own
      ? () => movePaletteColor(palette.id, drag.id, index)
      : () => insertPaletteColor(palette.id, { name: color.name, hex: color.hex }, index),
  };
}

// ---------- Palette insertion line ----------
// One thin accent line, placed inside the hovered palette's grid between two swatches (or at a row's edge).
// It is absolutely positioned, so it never takes a grid cell, and ignores the pointer (library.css .palette-insert).
let insertLine = null;
function showInsertLine(insert) {
  if (!insert || !insert.ref) { if (insertLine) { insertLine.remove(); insertLine = null; } return; }
  if (!insertLine) { insertLine = document.createElement('div'); insertLine.className = 'palette-insert'; }
  if (insertLine.parentElement !== insert.grid) insert.grid.append(insertLine);
  const ref = insert.ref;
  // The neighbor on the other side of the line, if it sits in the same row: the line goes halfway between the two.
  const other = insert.side === 'after' ? ref.nextElementSibling : ref.previousElementSibling;
  const sameRow = other && other !== insertLine && other.offsetTop === ref.offsetTop;
  let x;
  if (insert.side === 'after') x = sameRow ? (ref.offsetLeft + ref.offsetWidth + other.offsetLeft) / 2 : ref.offsetLeft + ref.offsetWidth + 3;
  else x = sameRow ? (other.offsetLeft + other.offsetWidth + ref.offsetLeft) / 2 : ref.offsetLeft - 3;
  insertLine.style.left = `${Math.round(x - 1)}px`;     // the line is 2px wide; center it on x
  insertLine.style.top = `${ref.offsetTop}px`;
  insertLine.style.height = `${ref.offsetHeight}px`;
}

// ---------- Planning: any target ----------
function planDrop(e) {
  if (!drag) return null;
  const paletteEl = e.target.closest('.palette-card[data-palette-id]');   // a palette in the library
  if (paletteEl) return planPalette(paletteEl, e);
  const colorEl = e.target.closest('[data-drop-color]');               // a row in the editor's "colors" section
  if (colorEl) {
    const hex = drag.kind === 'color' ? hexOf(drag.id) : null;
    if (!hex) return null;
    const { dropColor: what, nodeId, layerKey: layer } = colorEl.dataset;       // what = 'canvas' | 'group' | 'text' | 'layer' | 'section'
    if (what === 'section') {
      const section = Number(layer), name = nameOf(drag.id);                   // a palette block section (layerKey = its index)
      return { el: colorEl, cls: 'drop-target', outline: { type: 'section', blockId: nodeId, section }, run: () => setSectionColor(nodeId, section, hex, { name }) };
    }
    if (what === 'canvas') return { el: colorEl, cls: 'drop-target', outline: { type: 'canvas', canvasId: nodeId }, run: () => setCanvasBackground(nodeId, hex) };
    if (what === 'group') return { el: colorEl, cls: 'drop-target', outline: { type: 'group', blockId: nodeId }, run: () => setGroupBackground(nodeId, hex) };
    if (what === 'text') return { el: colorEl, cls: 'drop-target', outline: { type: 'text', blockId: nodeId }, run: () => setTextColor(nodeId, hex) };
    return { el: colorEl, cls: 'drop-target', outline: { type: 'layer', blockId: nodeId, layer }, run: () => setLayerColor(nodeId, layer, hex) };
  }
  const mediaEl = e.target.closest('[data-drop-media]');               // the "background image" row of a board/group in the properties
  if (mediaEl) {
    const hit = findNode(mediaEl.dataset.dropMedia);
    if (drag.kind !== 'media' || !getMedia(drag.id) || !hit) return null;
    return { el: mediaEl, cls: 'drop-target', outline: bgOutline(hit.node), run: () => setBgImage(hit.node.id, drag.id) };
  }
  const fontEl = e.target.closest('[data-drop-font]');                 // the font row of a text block's section in the properties
  if (fontEl) {
    // That section edits only its own block, so only that block changes (and is outlined).
    const id = fontEl.dataset.dropFont;
    return drag.kind === 'font' ? { el: fontEl, cls: 'drop-target', outline: { type: 'text', blockIds: [id] }, run: () => setBlockFonts([id], drag.id) } : null;
  }
  const rowEl = e.target.closest('.layer-row[data-id]');
  if (rowEl) return planRow(rowEl, e);
  if (e.target.closest('#stage')) return planPreview(e);
  return null;
}

// ---------- Outline management ----------
// Shows the lime drop outline on plan.el (if any) and the accent "what will change" outline (if any).
function setHot(next) {
  const same = hot && next && hot.el === next.el && hot.cls === next.cls;
  if (!same) {
    if (hot && hot.el) hot.el.classList.remove(hot.cls);
    hot = next ? { el: next.el, cls: next.cls } : null;
    if (hot && hot.el) hot.el.classList.add(hot.cls);
  }
  showOutline(next ? next.outline : null);      // null clears it
  showInsertLine(next ? next.insert : null);    // palette drops: where the color will land (null removes it)
}
function endDrag() {
  setHot(null);
  drag = null;
  document.body.classList.remove('is-dragging');
}

// ---------- Wiring ----------
export function initDragDrop() {
  document.addEventListener('dragstart', (e) => {
    const src = e.target.closest && e.target.closest('[data-drag-kind]');
    if (!src) return;
    drag = { kind: src.dataset.dragKind, id: src.dataset.dragId };
    e.dataTransfer.setData('application/x-stylesheet', JSON.stringify(drag));
    e.dataTransfer.effectAllowed = 'copyMove';
    document.body.classList.add('is-dragging');
  });

  document.addEventListener('dragover', (e) => {
    e.preventDefault();                       // also stops files dragged from Explorer from navigating the window
    // Files from Explorer: only a .S_ project file does something (it opens). The file names can't be read until
    // the drop, so any file drag shows the "copy" cursor; other files are simply ignored on drop.
    if (!drag && e.dataTransfer.types.includes('Files')) { e.dataTransfer.dropEffect = 'copy'; return; }
    const plan = drag ? planDrop(e) : null;
    e.dataTransfer.dropEffect = plan ? (plan.effect || (drag.kind === 'node' ? 'move' : 'copy')) : 'none';
    setHot(plan);
  });

  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) setHot(null); });

  document.addEventListener('drop', (e) => {
    e.preventDefault();
    // A .S_ file dropped from Explorer opens as the project (after the unsaved-changes prompt); other files are ignored.
    if (!drag && e.dataTransfer.files.length) { openDroppedFiles(e.dataTransfer.files); return; }
    const plan = drag ? planDrop(e) : null;
    // Run the action BEFORE clearing `drag`: the planned closures read the dragged id lazily.
    try { if (plan) plan.run(); } finally { endDrag(); }
  });

  document.addEventListener('dragend', endDrag);
}
