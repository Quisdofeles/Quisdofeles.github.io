// library.js: renders the Library panel (media, fonts, colors, palettes, blocks + presets) from state,
// and handles importing files, adding colors/palettes, inline editing, and right-click delete.
// Eyedroppers (eyedropper.js): the colors and palettes HEADERS create something new from a picked color; the color
// card's edit mode and the palette swatch editor have their own eyedropper that changes the color being edited.
// Drag-and-drop out of the library is wired generically in dragdrop.js through data-drag-* attributes (a palette
// card drags as a whole palette; its swatches drag as single colors).
// Colors may carry an alpha (#RRGGBBAA): shown as "#D9FF43 · 40%" over a checkerboard swatch, edited with an alpha slider.
// Every list is sorted for display only (see sorting.js); the saved data keeps its own order.
// Any one section can be expanded to fill the panel (session.expandedSection), which also shows a search box that
// filters that section's list (applyExpanded / buildSearch below).

import { el, clear, $, uid, slug, isHex, normalizeHex, icon, alphaOf, withAlpha, hexLabel, swatchBg } from './util.js';
import { initEyedropper, addEyedropperButton, startEyedropper, stopEyedropper } from './eyedropper.js';
import {
  state, subscribe, addColor, updateColor, addPalette, renamePalette, addPaletteColor, findColor,
  addFonts, addMedia, trashItems, usageCount, allFonts, setExpandedSection,
} from './state.js';
import { groupFamilies, familySummary, closestTo400, cssFamily, fontCss, registerFonts, describeFont } from './fonts.js';
import { processSvg, cacheMedia, buildVectorSvg, mediaUrl, layerInfo } from './svg.js';
import { libraryBlockCount, typeLabel } from './blocks.js';
import { sortMedia, sortColors, sortPalettes, sortPresets, sortBlockTypes } from './sorting.js';
import { openMenuAt, openColorEditor, alphaRow } from './popover.js';
import { confirmDialog, showToast } from './overlays.js';

// Small bits of UI state that live only in this module (not saved).
let editingColorId = null;        // which color card is in inline-edit mode
let colorDraft = null;            // { id, name, hex } typed in that card, kept while its edit-mode eyedropper runs
let pickingColorId = null;        // the color card whose edit-mode eyedropper is running right now
let renamingPaletteId = null;     // which palette name is being renamed
let pendingSwatchEditId = null;   // a just-added palette swatch that should open its editor
let searchText = '';              // the search box of the EXPANDED section (only one can be expanded); never saved

// ---------- Search (only shown in an expanded section) ----------
// Filtering only hides non-matches: the sort order and the header counts stay the same.
const query = () => searchText.trim().toLowerCase();
// True when the search is empty or any of `texts` contains it (case-insensitive, anywhere in the text).
function matches(...texts) {
  const q = query();
  return !q || texts.some((t) => String(t || '').toLowerCase().includes(q));
}
// Hex search ignores a leading # on both sides, so "d9ff" and "#d9ff" both find #D9FF43.
function hexMatches(hex) {
  return !query() || String(hex || '').toLowerCase().replace(/^#/, '').includes(query().replace(/^#/, ''));
}
const noMatches = () => el('div', { class: 'lib-empty', text: 'no matches' });

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
// Asks for confirmation, says how many blocks use the item, then moves it to the trash (undoable)
// and shows a "moved … to trash" notice. Cancelling shows nothing.
// `label` is the display name: file name (media), family (fonts), or the item's name.
async function deleteWithConfirm(kind, ids, label) {
  const used = usageCount(kind, ids);
  const how = 'You can restore it from settings → trash, or press Ctrl+Z.';
  const message = used
    ? `"${label}" is used by ${used} block${used === 1 ? '' : 's'}. After deleting, ${used === 1 ? 'that block falls' : 'those blocks fall'} back to ${kind === 'font' ? 'Space Grotesk' : 'the gray placeholder'}. ${how}`
    : `"${label}" will move to the trash. ${how}`;
  const ok = await confirmDialog({ title: `delete ${label}?`, message, confirmLabel: 'delete', danger: true });
  if (!ok) return;
  trashItems(kind, ids);
  showToast(`moved ${label} to trash`);
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
    const shown = sortMedia(state.library.media).filter((m) => matches(m.name));   // newest added first; search: file name
    if (!state.library.media.length) list.append(el('div', { class: 'lib-empty', text: 'import an svg or image' }));
    else if (!shown.length) list.append(noMatches());
    for (const item of shown) {
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
    const shown = families.filter((fam) => matches(fam.family));   // search: family name
    if (!families.length) list.append(el('div', { class: 'lib-empty', text: 'import .ttf .otf .woff .woff2' }));
    else if (!shown.length) list.append(noMatches());
    for (const fam of shown) {
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
  colorDraft = null;
  if (!isHex(hexInput.value)) { renderColors(); return; }
  updateColor(color.id, { name: slug(nameInput.value) || color.name, hex: normalizeHex(hexInput.value) });
  renderColors();
}

// Ends a color card's edit without saving (Esc).
function cancelColorEdit() {
  editingColorId = null;
  colorDraft = null;
  renderColors();
}

// The edit-mode eyedropper of a color card: changes THAT color's hex. While it runs the card stays in edit mode
// (pickingColorId stops the inputs' blur from saving or cancelling the edit) and what is typed is kept in colorDraft.
// Afterwards the card is drawn in edit mode again: with the picked hex (already saved, one undo step), or unchanged.
function startColorPick(color, button, nameInput, hexInput) {
  colorDraft = { id: color.id, name: nameInput.value, hex: hexInput.value };
  pickingColorId = color.id;
  const back = () => { pickingColorId = null; editingColorId = color.id; renderColors(); };
  startEyedropper({
    button,
    onPick: (hex) => { colorDraft.hex = normalizeHex(hex); updateColor(color.id, { hex }); back(); },
    // replaced = another eyedropper was started instead: the edit then simply ends unsaved (like Esc), so the card
    // doesn't pull the focus back while the other eyedropper runs.
    onCancel: (replaced) => { if (replaced) { pickingColorId = null; cancelColorEdit(); } else back(); },
  });
}

function colorCard(color) {
  // In edit mode the card shows what is typed (colorDraft) when the edit came back from its eyedropper.
  const draft = editingColorId === color.id && colorDraft && colorDraft.id === color.id ? colorDraft : null;
  const shownHex = draft && isHex(draft.hex) ? normalizeHex(draft.hex) : color.hex;
  // swatchBg: a color with alpha is drawn over a small checkerboard; the text then reads "#D9FF43 · 40%".
  const swatch = el('span', { class: 'swatch-sq', style: { background: swatchBg(shownHex) } });
  if (editingColorId !== color.id) {
    const card = el('div', {
      class: 'card-row', ...draggable('color', color.id),
      on: { click: () => { editingColorId = color.id; colorDraft = null; renderColors(); } },
    }, swatch, el('div', { class: 'card-text' },
      el('span', { class: 'card-title', text: color.name }),
      el('span', { class: 'card-sub', text: hexLabel(color.hex) })));
    return withDeleteMenu(card, 'color', [color.id], color.name);
  }
  // Edit mode: two small inputs replace the text, plus an alpha slider. Enter or leaving the card saves, Esc cancels.
  // The hex input has an eyedropper button next to it (same look as the header one, sized to the 22px inputs).
  // The hex input accepts 6 digits (opaque) or 8 (with alpha); the alpha slider rewrites its last two digits.
  const nameInput = el('input', { type: 'text', value: draft ? draft.name : color.name, spellcheck: false });
  const hexInput = el('input', { type: 'text', value: draft ? draft.hex : color.hex, spellcheck: false });
  const alpha = alphaRow(isHex(hexInput.value) ? alphaOf(hexInput.value) : 100, (pct) => {
    if (!isHex(hexInput.value)) return;
    hexInput.value = withAlpha(hexInput.value, pct);
    hexInput.classList.remove('invalid');
    swatch.style.background = swatchBg(hexInput.value);
  });
  const eye = el('button', {
    class: 'icon-toggle tool-btn edit-eye eyedropper-btn' + (pickingColorId === color.id ? ' on' : ''),
    title: 'eyedropper: click a color in the preview to use it',
  }, icon('eyedropper'));
  // preventDefault on press keeps the focus in the input, so starting the pick never blurs (= saves) the edit.
  eye.addEventListener('pointerdown', (e) => e.preventDefault());
  eye.addEventListener('mousedown', (e) => e.preventDefault());
  eye.addEventListener('click', () => {
    if (pickingColorId === color.id) stopEyedropper();   // clicking it again switches it off (= cancel)
    else startColorPick(color, eye, nameInput, hexInput);
  });
  const card = el('div', { class: 'card-row', style: { cursor: 'default' } }, swatch,
    el('div', { class: 'color-edit' }, nameInput, el('div', { class: 'color-edit-hex' }, hexInput, eye), alpha.row));
  // Enter / Esc also work while the alpha slider has the focus (it is part of the edit).
  for (const input of [nameInput, hexInput, alpha.range]) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commitColorEdit(color, nameInput, hexInput);
      if (e.key === 'Escape') cancelColorEdit();
    });
  }
  for (const input of [nameInput, hexInput]) {
    input.addEventListener('input', () => {
      const ok = isHex(hexInput.value);
      hexInput.classList.toggle('invalid', !ok);
      if (ok) { swatch.style.background = swatchBg(hexInput.value); alpha.set(alphaOf(hexInput.value)); }   // 6 digits = 100%
    });
  }
  // Leaving the card saves, except while its eyedropper runs (the click on the canvas moves the focus away) and
  // while the list is being redrawn (removing a focused input must never count as "leaving").
  card.addEventListener('focusout', (e) => {
    if (redrawingColors || pickingColorId === color.id) return;
    if (!card.contains(e.relatedTarget) && editingColorId === color.id) commitColorEdit(color, nameInput, hexInput);
  });
  if (pickingColorId !== color.id) setTimeout(() => { nameInput.focus(); nameInput.select(); }, 0);
  return card;
}

let redrawingColors = false;   // true while renderColors() rebuilds the list (see the focusout guard above)
function renderColors() {
  redrawingColors = true;
  try { drawColors(); } finally { redrawingColors = false; }
}
function drawColors() {
  redraw($('#list-colors'), (list) => {
    // Grouped by hue. Search: name or hex. The card being edited always stays visible (e.g. a just-picked eyedropper
    // color named "new_color" while the search says "blue"), so its name can still be typed.
    const shown = sortColors(state.library.colors).filter((c) => c.id === editingColorId || matches(c.name) || hexMatches(c.hex));
    if (state.library.colors.length && !shown.length) list.append(noMatches());
    for (const color of shown) list.append(colorCard(color));
  });
}

// ---------- Palettes ----------
// Opens the small name/hex editor of a palette swatch. Its eyedropper changes THAT swatch: the popover closes while
// the tool runs, then reopens on the same swatch, with the picked hex (saved, one undo step) or with the old values.
// `draft` = what was typed before the pick (the name typed but not saved yet is kept).
function openSwatchEditor(swatch, color, draft = null) {
  openColorEditor(swatch, color, {
    draft,
    onSave: (patch) => updateColor(color.id, patch),
    onDelete: () => deleteWithConfirm('palette_color', [color.id], color.name),
    onEyedropper: (typed) => startEyedropper({
      onPick: (hex) => { updateColor(color.id, { hex }); reopenSwatchEditor(color.id, { name: typed.name, hex: normalizeHex(hex) }); },
      // replaced = another eyedropper was started instead: then the popover stays closed (nothing changed anyway).
      onCancel: (replaced) => { if (!replaced) reopenSwatchEditor(color.id, typed); },
    }),
  });
}

// Finds the swatch on screen again (the palettes list may have been redrawn) and reopens its editor.
// Nothing opens if the swatch is gone or its section is hidden (another library section is expanded).
function reopenSwatchEditor(colorId, draft) {
  const swatch = document.querySelector(`#list-palettes .palette-swatch[data-drag-id="${colorId}"]`);
  const color = findColor(colorId);
  if (swatch && color && swatch.offsetParent) openSwatchEditor(swatch, color, draft);
}

function renderPalettes() {
  redraw($('#list-palettes'), (list) => {
    // Search: the palette's name, or any swatch's name or hex (a match shows the whole card). A palette being renamed,
    // or one with a just-added swatch, always stays visible.
    const shown = sortPalettes(state.library.palettes).filter((pal) => pal.id === renamingPaletteId
      || pal.colors.some((c) => c.id === pendingSwatchEditId)
      || matches(pal.name) || pal.colors.some((c) => matches(c.name) || hexMatches(c.hex)));
    if (state.library.palettes.length && !shown.length) list.append(noMatches());
    for (const pal of shown) {   // alphabetical; swatches inside keep the user's order
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
      // A swatch with alpha shows a small checkerboard behind its color.
      const grid = el('div', { class: 'palette-grid' });
      for (const color of pal.colors) {
        const swatch = el('button', {
          class: 'palette-swatch', style: { background: swatchBg(color.hex) }, ...draggable('color', color.id),
        });
        attachSwatchTip(swatch, color);   // name + hex on hover (swatches have no visible label)
        swatch.addEventListener('click', () => openSwatchEditor(swatch, color));
        withDeleteMenu(swatch, 'palette_color', [color.id], color.name);
        grid.append(swatch);
        if (pendingSwatchEditId === color.id) { pendingSwatchEditId = null; setTimeout(() => swatch.click(), 0); }
      }
      grid.append(el('button', { class: 'palette-add', text: '+', title: 'add color', on: { click: () => { pendingSwatchEditId = addPaletteColor(pal.id).id; renderPalettes(); } } }));

      // data-palette-id makes the whole card a drop target for colors (dragdrop.js planPalette).
      // The card itself is draggable as a WHOLE palette (drag kind 'palette': dropped on a board/group it adds a
      // palette block). Dragging a swatch still drags just that color: the swatch is the closest draggable element.
      // Not draggable while its name is being renamed (so selecting text in the input works).
      const renaming = renamingPaletteId === pal.id;
      const card = el('div', {
        class: 'palette-card', draggable: renaming ? 'false' : 'true',
        dataset: renaming ? { paletteId: pal.id } : { paletteId: pal.id, dragKind: 'palette', dragId: pal.id },
      }, nameNode, grid);
      list.append(withDeleteMenu(card, 'palette', [pal.id], pal.name));
    }
  });
}

// ---------- Blocks + presets (one section) ----------
// Default blocks first (fixed order), then the saved presets (newest first).
// Both are single-column .card-row cards (same as fonts/colors): icon in a 34px slot, name, muted second line.
// Blocks show what kind of block they are ("text", "container", "media"...); presets show "preset" and a dashed border.
// The card shows typeLabel() ("board" for the canvas type); the drag payload keeps the real type name.
function renderBlocks() {
  redraw($('#list-blocks'), (list) => {
    // Search: block names as shown (so "board" matches) and preset names.
    const blocks = sortBlockTypes().filter((b) => matches(typeLabel(b.type)));
    const presets = sortPresets(state.library.presets).filter((p) => matches(p.name));
    if (!blocks.length && !presets.length) list.append(noMatches());
    for (const b of blocks) {
      list.append(el('div', { class: 'card-row', ...draggable('block', b.type) },
        el('span', { class: 'icon-slot', text: b.glyph }),
        el('div', { class: 'card-text' },
          el('span', { class: 'card-title', text: typeLabel(b.type) }),
          el('span', { class: 'card-sub', text: b.kind }))));
    }
    for (const p of presets) {
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
// The colors and palettes headers also get an eyedropper tool button (data-eyedropper) just left of their "+ add".
// A HEADER eyedropper creates something new (a color / a palette); edit-menu eyedroppers change the thing being edited.
// EVERY header ends with the expand/collapse button, so all five line up in one column at the far right.
// Under every header sits a search box; CSS only shows it while that section is expanded.
function buildHeaders() {
  for (const head of document.querySelectorAll('.lib-head')) {
    clear(head);
    const { label, add, import: importId, eyedropper } = head.dataset;
    const button = (id, text, title) => el('button', { class: 'plus-btn', id, title, text });
    const main = add ? button(add, '+ add', `add ${label.replace(/s$/, '')}`)
      : importId ? button(importId, '+ import', `import ${label}`)
        : el('span', { class: 'lib-hint', text: 'drag in' });
    // Same look as the export bar's transparent toggle (.icon-toggle), just header-sized (24px).
    const toolTitle = label === 'palettes'
      ? 'eyedropper: click a color in the preview to start a new palette with it'
      : 'eyedropper: click a color in the preview to add it';
    const tool = eyedropper
      ? el('button', { class: 'icon-toggle tool-btn', id: eyedropper, title: toolTitle }, icon('eyedropper'))
      : null;
    // Expand/collapse: also an .icon-toggle; it shows the "on" look (accent border + icon) while its section is expanded.
    const expandBtn = el('button', {
      class: 'icon-toggle tool-btn expand-btn', dataset: { section: label },
      on: { click: () => setExpandedSection(state.session.expandedSection === label ? null : label) },
    });
    head.append(
      el('span', { class: 'lib-label' }, label, el('span', { class: 'lib-count', dataset: { for: label } })),
      el('span', { class: 'lib-head-actions' }, tool, main, expandBtn));
    head.after(buildSearch(label));
  }
}

// The search box under a section's header (visible only while that section is expanded). Filters live as you type;
// Esc clears it. Typing never reaches the app's shortcuts: they all ignore keys typed into inputs, and Esc is stopped
// here so it doesn't also clear the canvas selection.
function buildSearch(label) {
  const input = el('input', { type: 'text', class: 'lib-search', placeholder: `search ${label}…`, spellcheck: false, dataset: { section: label } });
  input.addEventListener('input', () => { searchText = input.value; RENDER[label](); });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    input.value = '';
    searchText = '';
    RENDER[label]();
  });
  return input;
}

// Shows the expanded section (or the normal equal layout): CSS hides the other sections and shows the search box.
// Any change of the expanded section clears the search (collapsing always starts the next search fresh).
let shownExpanded;    // the expanded section this was last drawn with (so the search is only cleared on a real change)
function applyExpanded() {
  const current = state.session.expandedSection || null;
  $('.library-body').classList.toggle('has-expanded', !!current);
  for (const section of document.querySelectorAll('.lib-section')) {
    const label = section.querySelector('.lib-head').dataset.label;
    const on = label === current;
    section.classList.toggle('expanded', on);
    const btn = section.querySelector('.expand-btn');
    btn.classList.toggle('on', on);
    btn.title = on ? 'collapse' : 'expand';
    clear(btn).append(icon(on ? 'collapse' : 'expand'));
  }
  if (shownExpanded !== undefined && shownExpanded !== current && searchText) {
    searchText = '';
    document.querySelectorAll('.lib-search').forEach((s) => { s.value = ''; });
    renderLibrary();
  }
  shownExpanded = current;
}

// Each section's render function, by its header label (used by the search box).
const RENDER = { blocks: () => renderBlocks(), media: () => renderMedia(), fonts: () => renderFonts(), colors: () => renderColors(), palettes: () => renderPalettes() };

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
  swatchTip = el('div', { class: 'swatch-tip' }, el('span', { text: color.name }), el('span', { class: 'swatch-tip-hex', text: hexLabel(color.hex) }));
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
  initEyedropper();   // the one shared eyedropper tool (all four eyedropper buttons use it; one runs at a time)
  // Colors header eyedropper: a picked color is added exactly like "+ add", but with the picked hex already filled in.
  // The new card opens in edit mode with the name selected, so the user just types a name and presses Enter.
  // (If another section is expanded the colors list is hidden; the color is still added, but not opened for editing,
  // because a hidden input can't take focus. The view does not switch sections.)
  addEyedropperButton($('#btn-eyedropper'), (hex) => {
    const id = addColor({ name: 'new_color', hex }).id;
    const hidden = state.session.expandedSection && state.session.expandedSection !== 'colors';
    editingColorId = hidden ? null : id;
    colorDraft = null;
    renderColors();
  });
  $('#btn-add-palette').addEventListener('click', () => {
    renamingPaletteId = addPalette(`palette_${state.library.palettes.length + 1}`).id;
    renderPalettes();
  });
  // Palettes header eyedropper: like "+ add" (new palette_N, renaming starts), but its one swatch is the picked
  // color, named new_color. One undo step. Same hidden-section rule as the colors one above.
  addEyedropperButton($('#btn-eyedropper-palette'), (hex) => {
    const id = addPalette(`palette_${state.library.palettes.length + 1}`, hex).id;
    const hidden = state.session.expandedSection && state.session.expandedSection !== 'palettes';
    renamingPaletteId = hidden ? null : id;
    renderPalettes();
  });

  // Re-render when the library or canvases change (media cards show an "in use" border). Skip pure view/selection
  // updates. A UI change may be the expanded section, so that only re-applies the expand layout.
  subscribe((meta) => {
    if (meta.ui) { applyExpanded(); return; }
    if (meta.view || meta.selection || meta.exportSettings || meta.live) return;
    renderLibrary();
  });
  renderLibrary();
  applyExpanded();   // restores the section that was expanded when the app was last closed
}
