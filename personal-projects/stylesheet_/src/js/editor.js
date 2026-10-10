// editor.js: the LAYERS tree in the editor panel (the properties below it live in properties.js),
// plus the keyboard shortcuts for the selection (Delete, Ctrl+D, Ctrl+C / Ctrl+V, Esc), the right-click menu on
// tree rows (copy / paste / duplicate / delete), and undo/redo.
// The tree and the preview are two views of the same state: both call the same state.js functions.

import { el, clear, $, icon } from './util.js';
import {
  state, subscribe, selectNode, toggleSelect, selectRange, clearSelection, isSelected, toggleHidden, updateNode,
  setNodeCollapsed, removeNodes, duplicateNodes, copyNodes, pasteClipboard, hasClipboard, groupNodes, ungroupNodes,
  addBlockToSelection, findNode, getMedia, undo, redo,
} from './state.js';
import { glyphFor, isContainer } from './blocks.js';
import { openBlockMenu, openMenuAt } from './popover.js';
import { showToast } from './overlays.js';
import { layerInfo } from './svg.js';

let renamingId = null;      // which row is showing its inline rename input
let visibleIds = [];        // the ids of the rows on screen, top to bottom (Shift+click selects a range of these)

// The muted tag on the right of a row: "canvas", "3 layers", "title"...
function tagFor(node) {
  if (node.type === 'vector') {
    const vec = getMedia(node.mediaId);
    if (!vec) return 'empty';
    const count = layerInfo(vec.id).length;
    return count ? `${count} layer${count === 1 ? '' : 's'}` : 'vector';
  }
  return node.type;
}

// Builds the row for one node, then recurses into its children (unless collapsed).
function appendRows(list, node, depth) {
  visibleIds.push(node.id);
  const sel = isSelected(node.id);
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
    on: { click: (e) => onRowClick(e, node.id), contextmenu: (e) => onRowContextMenu(e, node.id) },
  }, caret, el('span', { class: 'layer-glyph', text: glyphFor(node.type) }), nameNode, el('span', { class: 'layer-tag', text: tagFor(node) }), eye);
  list.append(row);

  if (container && !collapsed) node.children.forEach((child) => appendRows(list, child, depth + 1));
}

function renderLayers() {
  const list = $('#layers');
  const top = list.scrollTop;
  clear(list);
  visibleIds = [];
  state.session.canvases.forEach((cv) => appendRows(list, cv, 0));
  list.scrollTop = top;
  // Keep the most recently selected row in view.
  const ids = state.session.selection;
  const last = ids.length ? [...list.querySelectorAll('.layer-row')].find((r) => r.dataset.id === ids[ids.length - 1]) : null;
  if (last) last.scrollIntoView({ block: 'nearest' });
}

// Plain click selects one row; Ctrl+click adds/removes it; Shift+click selects the rows between the last-clicked row and this one.
function onRowClick(e, id) {
  if (e.ctrlKey || e.metaKey) toggleSelect(id);
  else if (e.shiftKey) selectRange(id, visibleIds);
  else selectNode(id);
}

// Pastes the clipboard, or explains why nothing happened.
function pasteWithToast() {
  if (!pasteClipboard()) showToast('select a canvas or a layer to paste into');
}

// Right-click on a row: act on the whole selection if the row is part of it, otherwise select just this row first.
function onRowContextMenu(e, id) {
  e.preventDefault();
  if (!isSelected(id)) selectNode(id);
  const ids = [...state.session.selection];
  const items = [{ label: 'copy', sub: 'ctrl+c', onClick: () => copyNodes(ids) }];
  if (hasClipboard()) items.push({ label: 'paste', sub: 'ctrl+v', onClick: pasteWithToast });
  items.push({ label: 'duplicate', sub: 'ctrl+d', onClick: () => duplicateNodes(ids) });
  // Grouping is for blocks (never canvases); ungroup shows when the selection includes a group.
  const nodes = ids.map((i) => (findNode(i) || {}).node).filter(Boolean);
  if (nodes.length && nodes.every((n) => n.type !== 'canvas')) items.push({ label: 'group', sub: 'ctrl+g', onClick: () => groupNodes(ids) });
  if (nodes.some((n) => n.type === 'group')) items.push({ label: 'ungroup', sub: 'ctrl+shift+g', onClick: () => ungroupNodes(ids) });
  items.push(
    { label: 'delete', sub: 'del', danger: true, onClick: () => removeNodes(ids) },     // undoable, so no confirm (unlike library deletes)
  );
  openMenuAt(e.clientX, e.clientY, items);
}

// When the selection moves (e.g. a click on the preview), expand any collapsed ancestors so the rows are visible.
function expandAncestorsOfSelection() {
  for (const id of state.session.selection) {
    let hit = findNode(id);
    while (hit && hit.parent) {
      if (state.session.collapsedNodes[hit.parent.id]) setNodeCollapsed(hit.parent.id, false);
      hit = findNode(hit.parent.id);
    }
  }
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
    // Everything below acts on the whole selection (one undo step each).
    else if (ctrl && key === 'd') { e.preventDefault(); if (state.session.selection.length) duplicateNodes([...state.session.selection]); }
    else if (ctrl && key === 'g') { e.preventDefault(); const ids = [...state.session.selection]; if (e.shiftKey) ungroupNodes(ids); else groupNodes(ids); }
    else if (ctrl && key === 'c') { if (state.session.selection.length) { e.preventDefault(); copyNodes([...state.session.selection]); } }
    else if (ctrl && key === 'v') { e.preventDefault(); pasteWithToast(); }
    else if (e.key === 'Delete' && state.session.selection.length) { e.preventDefault(); removeNodes([...state.session.selection]); }
    else if (e.key === 'Escape') clearSelection();
  });
}

export function initEditor() {
  $('#btn-add-block').addEventListener('click', (e) => openBlockMenu(e.currentTarget, addBlockToSelection));
  initShortcuts();
  subscribe((meta) => {
    if (meta.view || meta.exportSettings || meta.live) return;
    if (meta.selection) expandAncestorsOfSelection();
    renderLayers();
  });
  renderLayers();
}
