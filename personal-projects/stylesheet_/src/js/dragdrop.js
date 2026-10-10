// dragdrop.js: ALL drag-and-drop logic (native HTML5 drag and drop).
// Anything draggable carries data-drag-kind / data-drag-id (library items, layer rows).
// While dragging, planDrop() decides what a drop on the element under the pointer WOULD do and returns
// { el, cls, run }: the element to outline in lime, and the state.js call to make on drop.
// Every drop is a single state.js call, so every drop is one undo step.
//
// A plan may also carry `outline`: the exact thing a color/font drop will change (a text block's glyphs, one vector
// layer, a canvas edge), drawn in accent by outline.js. Color and font drops on the preview use ONLY that outline
// (el is null), not a box around the whole block.
//
// Payload kinds: font | color | media | block | preset | node (a row in the layers tree).

import { $ } from './util.js';
import {
  state, findNode, getMedia, findColor, addBlock, addBlockToNewCanvas, addCanvas, addCanvasFromPreset,
  addMediaBlock, addMediaToNewCanvas, swapMedia, setBlockFonts, fontTargets, dropColor, setCanvasBackground, setTextColor, setLayerColor, moveNode,
} from './state.js';
import { isContainer, isTextType } from './blocks.js';
import { showOutline } from './outline.js';

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
    case 'font': {
      if (!blockNode || !isTextType(blockNode.node.type)) return null;
      // Sets the font of that block, or of ALL selected text blocks when it is one of several selected. The outline marks every text it will change.
      const targets = fontTargets(blockNode.node.id);
      return { el: null, outline: { type: 'text', blockIds: targets }, run: () => setBlockFonts(targets, drag.id) };
    }
    case 'color': {
      // A color changes exactly one thing: a text block, ONE vector layer (the one under the pointer), or a canvas background.
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
      return { el: null, outline: { type: 'canvas', canvasId: canvasEl.dataset.id }, run: () => dropColor(canvasEl.dataset.id, hex) };
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
      if (node.type === 'vector') return null;                       // a vector has several layers: drop on one in the preview or in its colors section
      return { el: rowEl, cls: 'drop-into', outline: { type: 'canvas', canvasId: target.canvas.id }, run: () => dropColor(node.id, hex) };
    }
    default:
      return null;
  }
}

// ---------- Planning: any target ----------
function planDrop(e) {
  if (!drag) return null;
  const colorEl = e.target.closest('[data-drop-color]');               // a row in the editor's "colors" section
  if (colorEl) {
    const hex = drag.kind === 'color' ? hexOf(drag.id) : null;
    if (!hex) return null;
    const { dropColor: what, nodeId, layerKey: layer } = colorEl.dataset;       // what = 'canvas' | 'text' | 'layer'
    if (what === 'canvas') return { el: colorEl, cls: 'drop-target', outline: { type: 'canvas', canvasId: nodeId }, run: () => setCanvasBackground(nodeId, hex) };
    if (what === 'text') return { el: colorEl, cls: 'drop-target', outline: { type: 'text', blockId: nodeId }, run: () => setTextColor(nodeId, hex) };
    return { el: colorEl, cls: 'drop-target', outline: { type: 'layer', blockId: nodeId, layer }, run: () => setLayerColor(nodeId, layer, hex) };
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
    const plan = drag ? planDrop(e) : null;
    e.dataTransfer.dropEffect = plan ? (drag.kind === 'node' ? 'move' : 'copy') : 'none';
    setHot(plan);
  });

  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) setHot(null); });

  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const plan = drag ? planDrop(e) : null;
    // Run the action BEFORE clearing `drag`: the planned closures read the dragged id lazily.
    try { if (plan) plan.run(); } finally { endDrag(); }
  });

  document.addEventListener('dragend', endDrag);
}
