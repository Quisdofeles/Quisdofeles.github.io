// library.js: renders the Library panel (media, fonts, colors, palettes, blocks + presets) from state,
// and handles importing files, adding colors/palettes, inline editing, and right-click delete.
// Drag-and-drop out of the library is wired generically in dragdrop.js through data-drag-* attributes.
// Every list is sorted for display only (see sorting.js); the saved data keeps its own order.

import { el, clear, $, uid, slug, isHex, normalizeHex, icon } from './util.js';
import { initEyedropper } from './eyedropper.js';
import {
  state, subscribe, addColor, updateColor, addPalette, renamePalette, addPaletteColor,
  addFonts, addMedia, trashItems, usageCount, allFonts,
} from './state.js';
import { groupFamilies, familySummary, closestTo400, cssFamily, fontCss, registerFonts, describeFont } from './fonts.js';
import { processSvg, cacheMedia, buildVectorSvg, mediaUrl, layerInfo } from './svg.js';
import { libraryBlockCount } from './blocks.js';
import { sortMedia, sortColors, sortPalettes, sortPresets, sortBlockTypes } from './sorting.js';
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
    ? `"${label}" is used by ${used} block${used === 1 ? '' : 's'}. After deleting, ${used === 1 ? 'that block falls' : 'those blocks fall'} back to ${kind === 'font' ? 'Space Grotesk' : 'the gray placeholder'}. ${how}`
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

// ---------- Media ----------
// The small muted line under a media card's name: the file type ("svg", "png", "jpg").
function fileType(item) {
  if (item.kind === 'svg') return 'svg';
  const ext = (item.name.split('.').pop() || '').toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
}

function renderMedia() {
  redraw($('#list-media'), (list) => {
    if (!state.library.media.length) list.append(el('div', { class: 'lib-empty', text: 'import an svg or image' }));
    for (const item of sortMedia(state.library.media)) {   // newest added first
      const thumbContent = item.kind === 'image'
        ? el('img', { src: mediaUrl(item), alt: item.name })
        : buildVectorSvg(item.id, () => '#D5D5DA') || el('span', { class: 'muted', text: '…' });
      const card = el('div', {
        class: 'card-row' + (usageCount('media', [item.id]) ? ' in-use' : ''),
        title: item.name + (layerInfo(item.id).length ? `  ·  ${layerInfo(item.id).length} layers` : ''),
        ...draggable('media', item.id),
      },
      el('span', { class: 'media-thumb' }, thumbContent),
      el('div', { class: 'card-text' },
        el('span', { class: 'card-title', text: item.name }),
        el('span', { class: 'card-sub', text: fileType(item) })));
      list.append(withDeleteMenu(card, 'media', [item.id], item.name));
    }
  });
}

// ---------- Fonts ----------
// The built-in fonts (Space Grotesk, IBM Plex Mono) are shown as cards too, sorted in with the imported ones.
// They can be dragged like any font, but have no right-click menu: they can't be deleted.
function renderFonts() {
  redraw($('#list-fonts'), (list) => {
    const families = groupFamilies(allFonts());   // built-in + library, already alphabetical, case-insensitive
    if (!families.length) list.append(el('div', { class: 'lib-empty', text: 'import .ttf .otf .woff .woff2' }));
    for (const fam of families) {
      const sample = closestTo400(fam.fonts);   // the card previews, and drags, the weight closest to 400
      // A built-in font is drawn with its real family + font-weight (fontCss); an imported one by its own CSS family.
      const aaStyle = sample.builtin ? fontCss(sample) : { fontFamily: `'${cssFamily(sample)}'` };
      const deletable = fam.fonts.filter((f) => !f.builtin);   // only imported files can go to the trash
      const card = el('div', {
        class: 'card-row', title: deletable.length ? fam.family : `${fam.family} (built-in font, can't be deleted)`,
        ...draggable('font', sample.id),
      },
      el('span', { class: 'font-aa', text: 'Aa', style: aaStyle }),
      el('div', { class: 'card-text' },
        el('span', { class: 'card-title', text: fam.family }),
        el('span', { class: 'card-sub', text: familySummary(fam.fonts) })));
      list.append(deletable.length ? withDeleteMenu(card, 'font', deletable.map((f) => f.id), fam.family) : card);
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
    for (const color of sortColors(state.library.colors)) list.append(colorCard(color));   // grouped by hue
  });
}

// ---------- Palettes ----------
function renderPalettes() {
  redraw($('#list-palettes'), (list) => {
    for (const pal of sortPalettes(state.library.palettes)) {   // alphabetical; swatches inside keep the user's order
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
          class: 'palette-swatch', style: { background: color.hex }, ...draggable('color', color.id),
        });
        attachSwatchTip(swatch, color);   // name + hex on hover (swatches have no visible label)
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

// ---------- Blocks + presets (one section) ----------
// Default blocks first (fixed order), then the saved presets (newest first, shipped defaults last).
// Both are single-column .card-row cards (same as fonts/colors): icon in a 34px slot, name, muted second line.
// Blocks show what kind of block they are ("text", "container", "media"...); presets show "preset" and a dashed border.
function renderBlocks() {
  redraw($('#list-blocks'), (list) => {
    for (const b of sortBlockTypes()) {
      list.append(el('div', { class: 'card-row', ...draggable('block', b.type) },
        el('span', { class: 'icon-slot', text: b.glyph }),
        el('div', { class: 'card-text' },
          el('span', { class: 'card-title', text: b.type }),
          el('span', { class: 'card-sub', text: b.kind }))));
    }
    for (const p of sortPresets(state.library.presets)) {
      const card = el('div', { class: 'card-row preset-card', title: p.name, ...draggable('preset', p.id) },
        el('span', { class: 'icon-slot', text: '▣' }),
        el('div', { class: 'card-text' },
          el('span', { class: 'card-title', text: p.name }),
          el('span', { class: 'card-sub', text: 'preset' })));
      list.append(withDeleteMenu(card, 'preset', [p.id], p.name));
    }
  });
}

// ---------- Section headers (ONE shared pattern for all five sections) ----------
// Left: "label · count" (same style everywhere). Right: a "+ add" button (data-add = its element id), a
// "+ import" button (data-import = its id; colors/palettes add, media/fonts import) or, with neither, the
// muted hint "drag in". Both buttons are the same .plus-btn. Built from the data-* attributes in index.html.
// The colors header also gets the eyedropper tool button (data-eyedropper) just left of its "+ add".
function buildHeaders() {
  for (const head of document.querySelectorAll('.lib-head')) {
    clear(head);
    const { label, add, import: importId, eyedropper } = head.dataset;
    const button = (id, text, title) => el('button', { class: 'plus-btn', id, title, text });
    const main = add ? button(add, '+ add', `add ${label.replace(/s$/, '')}`)
      : importId ? button(importId, '+ import', `import ${label}`)
        : el('span', { class: 'lib-hint', text: 'drag in' });
    // Same look as the export bar's transparent toggle (.icon-toggle), just header-sized (24px).
    const tool = eyedropper
      ? el('button', { class: 'icon-toggle tool-btn', id: eyedropper, title: 'eyedropper: click a color in the preview to add it' }, icon('eyedropper'))
      : null;
    head.append(
      el('span', { class: 'lib-label' }, label, el('span', { class: 'lib-count', dataset: { for: label } })),
      tool ? el('span', { class: 'lib-head-actions' }, tool, main) : main);
  }
}

// Live counts in the headers ("media · 3"). Blocks counts the offered blocks plus presets; fonts counts font FAMILIES
// (= the cards shown, built-in ones included), not files, so the number always matches what is on screen.
function renderMeta() {
  const l = state.library;
  const counts = { media: l.media.length, fonts: groupFamilies(allFonts()).length, colors: l.colors.length, palettes: l.palettes.length, blocks: libraryBlockCount(l) };
  for (const span of document.querySelectorAll('.lib-count')) span.textContent = ` · ${counts[span.dataset.for]}`;
}

// ---------- Palette swatch tooltip ----------
// One small floating tip (name + hex) shared by every palette swatch. It lives on <body> so the list's
// overflow can't clip it, and never takes pointer events.
let swatchTip = null;
function showSwatchTip(swatch, color) {
  hideSwatchTip();
  swatchTip = el('div', { class: 'swatch-tip' }, el('span', { text: color.name }), el('span', { class: 'swatch-tip-hex', text: color.hex }));
  document.body.append(swatchTip);
  const r = swatch.getBoundingClientRect(), t = swatchTip.getBoundingClientRect();
  const left = Math.max(6, Math.min(window.innerWidth - t.width - 6, r.left + r.width / 2 - t.width / 2));
  const above = r.top - t.height - 6;
  swatchTip.style.left = `${left}px`;
  swatchTip.style.top = `${above >= 6 ? above : r.bottom + 6}px`;   // flips below if there is no room above
}
function hideSwatchTip() { if (swatchTip) { swatchTip.remove(); swatchTip = null; } }
function attachSwatchTip(swatch, color) {
  swatch.addEventListener('mouseenter', () => showSwatchTip(swatch, color));
  for (const ev of ['mouseleave', 'dragstart', 'click', 'contextmenu']) swatch.addEventListener(ev, hideSwatchTip);
}

export function renderLibrary() {
  renderMeta();
  renderMedia();
  renderFonts();
  renderColors();
  renderPalettes();
  renderBlocks();
}

// ---------- Import ----------
// Opens the file dialog for one section ('font' or 'media'; the dialog only offers that section's file
// types), then turns each copied file into a library entry.
async function importFlow(type) {
  const files = await window.api.importFiles(type);
  if (!files.length) return;
  const fontEntries = [];
  const mediaEntries = [];
  const now = Date.now();     // addedAt for sorting; +i keeps files imported together in order

  for (const [i, f] of files.entries()) {
    if (f.kind === 'font') {
      const res = await fetch(`ssfile://lib/fonts/${encodeURIComponent(f.fileName)}`);
      const info = await describeFont(await res.arrayBuffer(), f.originalName);
      fontEntries.push({ id: uid('f'), family: info.family, fileName: f.fileName, style: info.style, weight: info.weight });
    } else if (f.ext === '.svg') {
      const id = uid('v');
      try {
        const text = await window.api.readLibraryFile(`media/${f.fileName}`);
        cacheMedia(id, processSvg(text, id));   // sanitizes + reads the first-level layers and their colors
        mediaEntries.push({ id, name: f.originalName, fileName: f.fileName, kind: 'svg', addedAt: now + i });
      } catch {
        showToast(`${f.originalName} isn't a valid svg and was skipped.`, { warn: true });
      }
    } else {
      mediaEntries.push({ id: uid('m'), name: f.originalName, fileName: f.fileName, kind: 'image', addedAt: now + i });
    }
  }

  if (fontEntries.length) { await registerFonts(fontEntries); addFonts(fontEntries); }
  if (mediaEntries.length) addMedia(mediaEntries);
  const bits = [];
  if (fontEntries.length) bits.push(`${fontEntries.length} font${fontEntries.length === 1 ? '' : 's'}`);
  if (mediaEntries.length) bits.push(`${mediaEntries.length} media file${mediaEntries.length === 1 ? '' : 's'}`);
  if (bits.length) showToast(`imported ${bits.join(' and ')}`);
}

// ---------- Setup ----------
export function initLibrary() {
  buildHeaders();   // must run first: it creates the "+ add" buttons wired below
  const runImport = (type) => importFlow(type).catch((err) => { console.error(err); showToast('import failed', { warn: true }); });
  $('#btn-import-fonts').addEventListener('click', () => runImport('font'));
  $('#btn-import-media').addEventListener('click', () => runImport('media'));
  $('#btn-add-color').addEventListener('click', () => { editingColorId = addColor({ name: 'new_color', hex: '#888888' }).id; renderColors(); });
  // Eyedropper: a picked color is added exactly like "+ add", but with the picked hex already filled in.
  // The new card opens in edit mode with the name selected, so the user just types a name and presses Enter.
  initEyedropper($('#btn-eyedropper'), (hex) => {
    editingColorId = addColor({ name: 'new_color', hex }).id;
    renderColors();
  });
  $('#btn-add-palette').addEventListener('click', () => {
    renamingPaletteId = addPalette(`palette_${state.library.palettes.length + 1}`).id;
    renderPalettes();
  });

  // Re-render when the library or canvases change (media cards show an "in use" border). Skip pure view/selection updates.
  subscribe((meta) => {
    if (meta.view || meta.selection || meta.ui || meta.exportSettings || meta.live) return;
    renderLibrary();
  });
  renderLibrary();
}
