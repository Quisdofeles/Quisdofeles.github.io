// editor.js: the LAYERS tree in the editor panel (the properties below it live in properties.js),
// plus the keyboard shortcuts for the selected node (Delete, Ctrl+D) and undo/redo.
// The tree and the preview are two views of the same state: both call the same state.js functions.

import { el, clear, $, icon } from './util.js';
import {
  state, subscribe, selectNode, toggleHidden, updateNode, setNodeCollapsed, removeNode, duplicateNode,
  addBlock, addBlockToNewCanvas, findNode, getVector, undo, redo, selectedNode,
} from './state.js';
import { glyphFor, isContainer } from './blocks.js';
import { openBlockMenu } from './popover.js';

let renamingId = null;      // which row is showing its inline rename input

// The muted tag on the right of a row: "canvas", "3 layers", "title"...
function tagFor(node) {
  if (node.type === 'vector') {
    const vec = getVector(node.vectorId);
    if (!vec) return 'empty';
    return vec.layers.length ? `${vec.layers.length} layers` : '1 color';
  }
  return node.type;
}

// Builds the row for one node, then recurses into its children (unless collapsed).
function appendRows(list, node, depth) {
  const sel = state.session.selectedId === node.id;
  const container = isContainer(node);
  const collapsed = !!state.session.collapsedNodes[node.id];

  const caret = container
    ? el('span', {
      class: 'layer-caret', text: collapsed ? '▸' : '▾',
      on: { click: (e) => { e.stopPropagation(); setNodeCollapsed(node.id, !collapsed); } },
    })
    : el('span', { class: 'layer-caret' });

  let nameNode;
  if (renamingId === node.id) {
    nameNode = el('input', { type: 'text', class: 'layer-name-input', value: node.name, spellcheck: false });
    const done = (save) => {
      if (renamingId !== node.id) return;
      renamingId = null;
      const v = nameNode.value.trim();
      if (save && v && v !== node.name) updateNode(node.id, { name: v }); else renderLayers();
    };
    nameNode.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    nameNode.addEventListener('blur', () => done(true));
    nameNode.addEventListener('click', (e) => e.stopPropagation());
    setTimeout(() => { nameNode.focus(); nameNode.select(); }, 0);
  } else {
    nameNode = el('span', { class: 'layer-name', text: node.name, on: { dblclick: (e) => { e.stopPropagation(); renamingId = node.id; renderLayers(); } } });
  }

  const eye = el('button', {
    class: 'layer-eye', title: node.hidden ? 'show' : 'hide',
    on: { click: (e) => { e.stopPropagation(); toggleHidden(node.id); } },
  }, icon(node.hidden ? 'eyeOff' : 'eye'));

  const row = el('div', {
    class: 'layer-row' + (sel ? ' selected' : '') + (node.hidden ? ' dimmed' : ''),
    dataset: { id: node.id, nodeType: node.type, dragKind: 'node', dragId: node.id },
    draggable: renamingId === node.id ? 'false' : 'true',
    style: { paddingLeft: `${8 + depth * 20}px` },
    on: { click: () => selectNode(node.id) },
  }, caret, el('span', { class: 'layer-glyph', text: glyphFor(node.type) }), nameNode, el('span', { class: 'layer-tag', text: tagFor(node) }), eye);
  list.append(row);

  if (container && !collapsed) node.children.forEach((child) => appendRows(list, child, depth + 1));
}

function renderLayers() {
  const list = $('#layers');
  const top = list.scrollTop;
  clear(list);
  state.session.canvases.forEach((cv) => appendRows(list, cv, 0));
  list.scrollTop = top;
  const selected = list.querySelector('.layer-row.selected');
  if (selected) selected.scrollIntoView({ block: 'nearest' });
}

// When the selection moves (e.g. a click on the preview), expand any collapsed ancestors so the row is visible.
function expandAncestorsOfSelection() {
  let hit = findNode(state.session.selectedId);
  while (hit && hit.parent) {
    if (state.session.collapsedNodes[hit.parent.id]) setNodeCollapsed(hit.parent.id, false);
    hit = findNode(hit.parent.id);
  }
}

// "+ block" menu: adds the chosen block to the selected container (or the container around the selected block).
// With nothing selected, the block goes into a new canvas.
function addBlockFromMenu(type) {
  const sel = selectedNode();
  if (type === 'canvas' || !sel) { addBlockToNewCanvas(type); return; }
  if (isContainer(sel)) { addBlock(type, sel.id); return; }
  const hit = findNode(sel.id);
  addBlock(type, hit.parent.id, hit.index + 1);
}

// ---------- Keyboard shortcuts ----------
const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (isTyping(e.target)) return;                                  // let inputs keep their own keys
    if ($('.modal-backdrop') || $('.help-overlay')) return;           // overlays own the keyboard
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (ctrl && key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (ctrl && key === 'd') { e.preventDefault(); if (state.session.selectedId) duplicateNode(state.session.selectedId); }
    else if (e.key === 'Delete' && state.session.selectedId) { e.preventDefault(); removeNode(state.session.selectedId); }
  });
}

export function initEditor() {
  $('#btn-add-block').addEventListener('click', (e) => openBlockMenu(e.currentTarget, addBlockFromMenu));
  initShortcuts();
  subscribe((meta) => {
    if (meta.view || meta.exportSettings || meta.live) return;
    if (meta.selection) expandAncestorsOfSelection();
    renderLayers();
  });
  renderLayers();
}
