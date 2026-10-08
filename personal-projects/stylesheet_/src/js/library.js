// library.js: renders the Library panel (vectors, fonts, colors, palettes, blocks, presets) from state,
// and handles importing files, adding colors/palettes, inline editing, and right-click delete.
// Drag-and-drop out of the library is wired generically in dragdrop.js through data-drag-* attributes.

import { el, clear, $, uid, slug, isHex, normalizeHex } from './util.js';
import {
  state, subscribe, addColor, updateColor, addPalette, renamePalette, addPaletteColor,
  addFonts, addVectors, trashItems, usageCount,
} from './state.js';
import { BLOCK_TYPES } from './blocks.js';
import { groupFamilies, familySummary, closestTo400, cssFamily, registerFonts, describeFont } from './fonts.js';
import { processSvg, cacheVector, buildVectorSvg, vectorUrl } from './svg.js';
import { openMenuAt, openColorEditor } from './popover.js';
import { confirmDialog, showToast } from './overlays.js';

// Small bits of UI state that live only in this module (not saved).
let editingColorId = null;        // which color card is in inline-edit mode
let renamingPaletteId = null;     // which palette name is being renamed
let pendingSwatchEditId = null;   // a just-added palette swatch that should open its editor

// Sets draggable + the payload attributes dragdrop.js reads on dragstart.
const draggable = (kind, id) => ({ draggable: 'true', dataset: { dragKind: kind, dragId: id } });

// Redraws one list area but keeps its scroll position.
function redraw(list, build) {
  const top = list.scrollTop;
  clear(list);
  build(list);
  list.scrollTop = top;
}

// ---------- Delete (always asks first) ----------
// Asks for confirmation, says how many blocks use the item, then moves it to the trash (undoable).
async function deleteWithConfirm(kind, ids, label) {
  const used = usageCount(kind, ids);
  const how = 'You can restore it from settings → trash, or press Ctrl+Z.';
  const message = used
    ? `"${label}" is used by ${used} block${used === 1 ? '' : 's'}. After deleting, ${used === 1 ? 'that block falls' : 'those blocks fall'} back to the gray placeholder. ${how}`
    : `"${label}" will move to the trash. ${how}`;
  const ok = await confirmDialog({ title: `delete ${label}?`, message, confirmLabel: 'delete', danger: true });
  if (ok) trashItems(kind, ids);
}

// Attaches a right-click → delete menu to a library element.
function withDeleteMenu(node, kind, ids, label) {
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openMenuAt(e.clientX, e.clientY, [{ label: 'delete', danger: true, onClick: () => deleteWithConfirm(kind, ids, label) }]);
  });
  return node;
}

// ---------- Vectors ----------
function renderVectors() {
  redraw($('#list-vectors'), (list) => {
    if (!state.library.vectors.length) list.append(el('div', { class: 'lib-empty', style: { gridColumn: '1 / -1' }, text: 'import an svg or image' }));
    for (const vec of state.library.vectors) {
      const thumb = vec.kind === 'image'
        ? el('img', { src: vectorUrl(vec), alt: vec.name })
        : buildVectorSvg(vec.id, () => '#D5D5DA') || el('span', { class: 'muted', text: '…' });
      const tile = el('div', {
        class: 'vector-tile' + (usageCount('vector', [vec.id]) ? ' in-use' : ''),
        title: vec.name + (vec.layers.length ? `  ·  ${vec.layers.length} layers` : ''),
        ...draggable('vector', vec.id),
      }, thumb);
      list.append(withDeleteMenu(tile, 'vector', [vec.id], vec.name));
    }
  });
}

// ---------- Fonts ----------
function renderFonts() {
  redraw($('#list-fonts'), (list) => {
    const families = groupFamilies(state.library.fonts);
    if (!families.length) list.append(el('div', { class: 'lib-empty', text: 'import .ttf .otf .woff .woff2' }));
    for (const fam of families) {
      const sample = closestTo400(fam.fonts);   // the card previews, and drags, the weight closest to 400
      const card = el('div', { class: 'card-row', title: fam.family, ...draggable('font', sample.id) },
        el('span', { class: 'font-aa', text: 'Aa', style: { fontFamily: `'${cssFamily(sample)}'` } }),
        el('div', { class: 'card-text' },
          el('span', { class: 'card-title', text: fam.family }),
          el('span', { class: 'card-sub', text: familySummary(fam.fonts) })));
      list.append(withDeleteMenu(card, 'font', fam.fonts.map((f) => f.id), fam.family));
    }
  });
}

// ---------- Colors ----------
// Commits an inline edit of a color card (name + hex).
function commitColorEdit(color, nameInput, hexInput) {
  editingColorId = null;
  if (!isHex(hexInput.value)) { renderColors(); return; }
  updateColor(color.id, { name: slug(nameInput.value) || color.name, hex: normalizeHex(hexInput.value) });
  renderColors();
}

function colorCard(color) {
  const swatch = el('span', { class: 'swatch-sq', style: { background: color.hex } });
  if (editingColorId !== color.id) {
    const card = el('div', {
      class: 'card-row', ...draggable('color', color.id),
      on: { click: () => { editingColorId = color.id; renderColors(); } },
    }, swatch, el('div', { class: 'card-text' },
      el('span', { class: 'card-title', text: color.name }),
      el('span', { class: 'card-sub', text: color.hex })));
    return withDeleteMenu(card, 'color', [color.id], color.name);
  }
  // Edit mode: two small inputs replace the text. Enter or leaving the card saves, Esc cancels.
  const nameInput = el('input', { type: 'text', value: color.name, spellcheck: false });
  const hexInput = el('input', { type: 'text', value: color.hex, spellcheck: false });
  const card = el('div', { class: 'card-row', style: { cursor: 'default' } }, swatch, el('div', { class: 'color-edit' }, nameInput, hexInput));
  for (const input of [nameInput, hexInput]) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commitColorEdit(color, nameInput, hexInput);
      if (e.key === 'Escape') { editingColorId = null; renderColors(); }
    });
    input.addEventListener('input', () => {
      const ok = isHex(hexInput.value);
      hexInput.classList.toggle('invalid', !ok);
      if (ok) swatch.style.background = normalizeHex(hexInput.value);
    });
  }
  card.addEventListener('focusout', (e) => { if (!card.contains(e.relatedTarget) && editingColorId === color.id) commitColorEdit(color, nameInput, hexInput); });
  setTimeout(() => { nameInput.focus(); nameInput.select(); }, 0);
  return card;
}

function renderColors() {
  redraw($('#list-colors'), (list) => {
    for (const color of state.library.colors) list.append(colorCard(color));
  });
}

// ---------- Palettes ----------
function renderPalettes() {
  redraw($('#list-palettes'), (list) => {
    for (const pal of state.library.palettes) {
      // Name: plain text (double-click to rename) or an input while renaming.
      let nameNode;
      if (renamingPaletteId === pal.id) {
        nameNode = el('input', { type: 'text', class: 'palette-name-input', value: pal.name, spellcheck: false });
        const done = (save) => {
          renamingPaletteId = null;
          if (save && nameInput().value.trim()) renamePalette(pal.id, slug(nameInput().value));
          renderPalettes();
        };
        const nameInput = () => nameNode;
        nameNode.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
        nameNode.addEventListener('blur', () => { if (renamingPaletteId === pal.id) done(true); });
        setTimeout(() => { nameNode.focus(); nameNode.select(); }, 0);
      } else {
        nameNode = el('span', { class: 'palette-name', text: pal.name, title: 'double-click to rename',
          on: { dblclick: () => { renamingPaletteId = pal.id; renderPalettes(); } } });
      }

      // Swatches act exactly like single colors: draggable, clickable (opens the editor), right-click delete.
      const grid = el('div', { class: 'palette-grid' });
      for (const color of pal.colors) {
        const swatch = el('button', {
          class: 'palette-swatch', title: `${color.name} ${color.hex}`, style: { background: color.hex }, ...draggable('color', color.id),
        });
        swatch.addEventListener('click', () => openColorEditor(swatch, color, {
          onSave: (patch) => updateColor(color.id, patch),
          onDelete: () => deleteWithConfirm('palette_color', [color.id], color.name),
        }));
        withDeleteMenu(swatch, 'palette_color', [color.id], color.name);
        grid.append(swatch);
        if (pendingSwatchEditId === color.id) { pendingSwatchEditId = null; setTimeout(() => swatch.click(), 0); }
      }
      grid.append(el('button', { class: 'palette-add', text: '+', title: 'add color', on: { click: () => { pendingSwatchEditId = addPaletteColor(pal.id).id; renderPalettes(); } } }));

      const card = el('div', { class: 'palette-card' }, nameNode, grid);
      list.append(withDeleteMenu(card, 'palette', [pal.id], pal.name));
    }
  });
}

// ---------- Blocks + presets ----------
function renderBlocks() {
  redraw($('#list-blocks'), (list) => {
    for (const b of BLOCK_TYPES) {
      list.append(el('div', { class: 'block-card', ...draggable('block', b.type) },
        el('span', { class: 'glyph', text: b.glyph }), b.type));
    }
  });
}

function renderPresets() {
  redraw($('#list-presets'), (list) => {
    if (!state.library.presets.length) list.append(el('div', { class: 'lib-empty', text: 'select a canvas, then "save as preset"' }));
    for (const p of state.library.presets) {
      const row = el('div', { class: 'preset-row', title: p.name, ...draggable('preset', p.id) }, el('span', { text: '▣' }), el('span', { text: p.name }));
      list.append(withDeleteMenu(row, 'preset', [p.id], p.name));
    }
  });
}

// Section header counts (live).
function renderMeta() {
  const l = state.library;
  $('#meta-vectors').textContent = l.vectors.length;
  $('#meta-fonts').textContent = l.fonts.length;
  $('#meta-colors').textContent = l.colors.length;
  $('#meta-palettes').textContent = l.palettes.length;
  $('#meta-presets').textContent = l.presets.length;
}

export function renderLibrary() {
  renderMeta();
  renderVectors();
  renderFonts();
  renderColors();
  renderPalettes();
  renderBlocks();
  renderPresets();
}

// ---------- Import ----------
// Opens the file dialog, then turns each copied file into a library entry.
async function importFlow() {
  const files = await window.api.importFiles();
  if (!files.length) return;
  const fontEntries = [];
  const vectorEntries = [];

  for (const f of files) {
    if (f.kind === 'font') {
      const res = await fetch(`ssfile://lib/fonts/${encodeURIComponent(f.fileName)}`);
      const info = await describeFont(await res.arrayBuffer(), f.originalName);
      fontEntries.push({ id: uid('f'), family: info.family, fileName: f.fileName, style: info.style, weight: info.weight });
    } else if (f.ext === '.svg') {
      const id = uid('v');
      try {
        const text = await window.api.readLibraryFile(`vectors/${f.fileName}`);
        const { markup, layers } = processSvg(text, id);   // sanitizes + finds named layers
        cacheVector(id, markup);
        vectorEntries.push({ id, name: f.originalName, fileName: f.fileName, kind: 'svg', layers });
        if (!layers.length) showToast(`${f.originalName}: no named layers found — this vector will take one color.`, { warn: true, ms: 7000 });
      } catch {
        showToast(`${f.originalName} isn't a valid svg and was skipped.`, { warn: true });
      }
    } else {
      vectorEntries.push({ id: uid('v'), name: f.originalName, fileName: f.fileName, kind: 'image', layers: [] });
    }
  }

  if (fontEntries.length) { await registerFonts(fontEntries); addFonts(fontEntries); }
  if (vectorEntries.length) addVectors(vectorEntries);
  const bits = [];
  if (fontEntries.length) bits.push(`${fontEntries.length} font${fontEntries.length === 1 ? '' : 's'}`);
  if (vectorEntries.length) bits.push(`${vectorEntries.length} vector${vectorEntries.length === 1 ? '' : 's'}`);
  if (bits.length) showToast(`imported ${bits.join(' and ')}`);
}

// ---------- Setup ----------
export function initLibrary() {
  $('#btn-import').addEventListener('click', () => importFlow().catch((err) => { console.error(err); showToast('import failed', { warn: true }); }));
  $('#btn-add-color').addEventListener('click', () => { editingColorId = addColor({ name: 'new_color', hex: '#888888' }).id; renderColors(); });
  $('#btn-add-palette').addEventListener('click', () => {
    renamingPaletteId = addPalette(`palette_${state.library.palettes.length + 1}`).id;
    renderPalettes();
  });

  // Re-render when the library or canvases change (vectors show an "in use" border). Skip pure view/selection updates.
  subscribe((meta) => {
    if (meta.view || meta.selection || meta.ui || meta.exportSettings || meta.live) return;
    renderLibrary();
  });
  renderLibrary();
}
