// dragdrop.js: ALL drag-and-drop logic (native HTML5 drag and drop).
// Anything draggable carries data-drag-kind / data-drag-id (library items, layer rows).
// While dragging, planDrop() decides what a drop on the element under the pointer WOULD do and returns
// { el, cls, run }: the element to outline in lime, and the state.js call to make on drop.
// Every drop is a single state.js call, so every drop is one undo step.
//
// Payload kinds: font | color | vector | block | preset | node (a row in the layers tree).

import { $ } from './util.js';
import {
  state, findNode, getVector, findColor, addBlock, addBlockToNewCanvas, addCanvas, addCanvasFromPreset,
  addVectorBlock, swapVector, setCanvasFont, dropColor, setRole, moveNode,
} from './state.js';
import { isContainer, isTextType } from './blocks.js';

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
    case 'vector': {
      const vec = getVector(drag.id);
      if (!vec) return null;
      const swappable = blockNode && ((blockNode.node.type === 'vector' && vec.kind === 'svg') || (blockNode.node.type === 'image' && vec.kind === 'image'));
      if (swappable) return { el: blockEl, cls: 'drop-target', run: () => swapVector(blockNode.node.id, drag.id) };
      if (!canvasEl) return null;
      const index = flowIndex(containerEl, e);
      return { el: containerEl, cls: 'drop-target', run: () => addVectorBlock(drag.id, containerEl.dataset.id, index) };
    }
    case 'font': {
      if (!blockNode || !isTextType(blockNode.node.type)) return null;
      // Sets that text role's font on the CANVAS, so every block of that role updates.
      return { el: blockEl, cls: 'drop-target', run: () => setCanvasFont(blockNode.canvas.id, blockNode.node.type, drag.id) };
    }
    case 'color': {
      const hex = hexOf(drag.id);
      if (!hex || !canvasEl) return null;
      const leaf = blockNode && (isTextType(blockNode.node.type) || blockNode.node.type === 'vector') ? blockNode : null;
      if (leaf) {
        const layer = (e.target.closest('[data-layer]') || { getAttribute: () => null }).getAttribute('data-layer');
        return { el: blockEl, cls: 'drop-target', run: () => dropColor(leaf.node.id, hex, layer) };
      }
      return { el: canvasEl, cls: 'drop-target', run: () => dropColor(canvasEl.dataset.id, hex) };
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
    case 'vector': {
      const vec = getVector(drag.id);
      if (!vec) return null;
      if ((node.type === 'vector' && vec.kind === 'svg') || (node.type === 'image' && vec.kind === 'image')) {
        return { el: rowEl, cls: 'drop-into', run: () => swapVector(node.id, drag.id) };
      }
      return { el: rowEl, cls: into.cls, run: () => addVectorBlock(drag.id, into.parentId, into.index) };
    }
    case 'font':
      if (!isTextType(node.type)) return null;
      return { el: rowEl, cls: 'drop-into', run: () => setCanvasFont(target.canvas.id, node.type, drag.id) };
    case 'color': {
      const hex = hexOf(drag.id);
      if (!hex) return null;
      return { el: rowEl, cls: 'drop-into', run: () => dropColor(node.id, hex) };
    }
    default:
      return null;
  }
}

// ---------- Planning: any target ----------
function planDrop(e) {
  if (!drag) return null;
  const roleEl = e.target.closest('[data-drop-role]');                 // a role button in the editor
  if (roleEl) {
    const hex = drag.kind === 'color' ? hexOf(drag.id) : null;
    return hex ? { el: roleEl, cls: 'drop-target', run: () => setRole(roleEl.dataset.canvasId, roleEl.dataset.dropRole, hex) } : null;
  }
  const typeEl = e.target.closest('[data-drop-type]');                 // a font row in the editor's "type" group
  if (typeEl) {
    return drag.kind === 'font' ? { el: typeEl, cls: 'drop-target', run: () => setCanvasFont(typeEl.dataset.canvasId, typeEl.dataset.dropType, drag.id) } : null;
  }
  const rowEl = e.target.closest('.layer-row[data-id]');
  if (rowEl) return planRow(rowEl, e);
  if (e.target.closest('#stage')) return planPreview(e);
  return null;
}

// ---------- Outline management ----------
function setHot(next) {
  if (hot && next && hot.el === next.el && hot.cls === next.cls) return;
  if (hot) hot.el.classList.remove(hot.cls);
  hot = next ? { el: next.el, cls: next.cls } : null;
  if (hot) hot.el.classList.add(hot.cls);
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
