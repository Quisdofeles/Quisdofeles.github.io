// popover.js: small floating panels anchored to a button or a point (an addition to the CLAUDE.md file list).
// One popover is open at a time. Contains the generic popover + context menu, and the specific ones:
// color picker (library colors, palettes, hex input), font picker (family + weight), block-type menu, media picker,
// and the small name/hex editor used for palette swatches.

import { el, clear, isHex, normalizeHex, slug, $, icon } from './util.js';
import { state, allFonts } from './state.js';
import { sortBlockTypes, sortMedia } from './sorting.js';
import { typeLabel } from './blocks.js';
import { mediaUrl } from './svg.js';
import { groupFamilies, cssFamily, closestTo400, familySummary } from './fonts.js';

let current = null;               // { pop, cleanup }
let lastToggle = { anchor: null, at: 0 };

export function closePopover() {
  if (!current) return;
  current.cleanup();
  current.pop.remove();
  current = null;
}

// Opens `content` in a popover under `anchor` (or at opts.x / opts.y). Returns the popover element.
// Clicking the same anchor again closes it (toggle) instead of reopening.
export function openPopover(anchor, content, opts = {}) {
  closePopover();
  if (anchor && lastToggle.anchor === anchor && performance.now() - lastToggle.at < 250) return null;

  const pop = el('div', { class: 'popover' }, content);
  $('#overlay-root').append(pop);

  const rect = anchor ? anchor.getBoundingClientRect() : null;
  if (rect) pop.style.minWidth = `${Math.max(200, Math.min(rect.width, 300))}px`;
  let left = opts.x !== undefined ? opts.x : rect.left;
  let top = opts.y !== undefined ? opts.y : rect.bottom + 4;
  const { width, height } = pop.getBoundingClientRect();
  if (left + width > window.innerWidth - 8) left = window.innerWidth - 8 - width;
  if (top + height > window.innerHeight - 8) top = rect ? rect.top - height - 4 : window.innerHeight - 8 - height;
  pop.style.left = `${Math.max(8, left)}px`;
  pop.style.top = `${Math.max(8, top)}px`;

  const onDown = (e) => {
    if (pop.contains(e.target)) return;
    if (anchor && anchor.contains(e.target)) lastToggle = { anchor, at: performance.now() };
    closePopover();
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePopover(); } };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', closePopover);
  current = {
    pop,
    cleanup: () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', closePopover);
    },
  };
  return pop;
}

// A scrolling list container for popover content.
const scroller = (...kids) => el('div', { class: 'pop-scroll scroll-area' }, ...kids);

// ---------- Context menu ----------
// items: [{ label, onClick, danger, glyph, sub }]
export function openMenuAt(x, y, items) {
  const list = el('div', { class: 'pop-scroll' }, items.map((item) => el('button', {
    class: 'menu-item' + (item.danger ? ' danger' : ''),
    on: { click: () => { closePopover(); item.onClick(); } },
  }, item.glyph ? el('span', { class: 'glyph', text: item.glyph }) : null, item.label, item.sub ? el('span', { class: 'sub', text: item.sub }) : null)));
  openPopover(null, list, { x, y });
}

// ---------- Block type menu (the "+ block" button) ----------
// Offers exactly the blocks the library offers, in the same order (sortBlockTypes() in sorting.js).
// Shows typeLabel() ("board" for the canvas type) but hands the real type name to onPick.
export function openBlockMenu(anchor, onPick) {
  const list = scroller(sortBlockTypes().map((b) => el('button', {
    class: 'menu-item',
    on: { click: () => { closePopover(); onPick(b.type); } },
  }, el('span', { class: 'glyph', text: b.glyph }), typeLabel(b.type))));
  openPopover(anchor, list);
}

// ---------- Color picker ----------
// Lists library colors and palettes plus a hex input. onPick(hex) is called with an uppercase "#RRGGBB".
// `noneLabel` (optional, used by group backgrounds) adds a first row that calls onPick(null) = no color (transparent).
export function openColorPicker(anchor, { current: currentHex, onPick, noneLabel = null }) {
  const pick = (hex) => { closePopover(); onPick(normalizeHex(hex)); };
  const body = scroller();
  const lib = state.library;
  if (noneLabel) {
    body.append(el('button', { class: 'menu-item', on: { click: () => { closePopover(); onPick(null); } } },
      el('span', { class: 'chip' }), noneLabel, currentHex ? null : el('span', { class: 'sub', text: '✓' })));
  }
  if (lib.colors.length) {
    body.append(el('div', { class: 'pop-title', text: 'colors' }));
    lib.colors.forEach((c) => body.append(el('button', { class: 'menu-item', on: { click: () => pick(c.hex) } },
      el('span', { class: 'chip', style: { background: c.hex } }), c.name, el('span', { class: 'sub', text: c.hex }))));
  }
  lib.palettes.forEach((p) => {
    body.append(el('div', { class: 'pop-title', text: p.name }));
    body.append(el('div', { class: 'pop-palette' }, p.colors.map((c) => el('button', {
      class: 'chip-btn', title: `${c.name} ${c.hex}`, style: { background: c.hex }, on: { click: () => pick(c.hex) },
    }))));
  });

  const input = el('input', { type: 'text', value: currentHex || '', placeholder: '#RRGGBB', spellcheck: false });
  const apply = () => { if (isHex(input.value)) pick(input.value); else input.classList.add('invalid'); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
  input.addEventListener('input', () => input.classList.remove('invalid'));
  const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0 } }, body,
    el('div', { class: 'hex-row' }, input, el('button', { class: 'btn', text: 'apply', on: { click: apply } })));
  openPopover(anchor, wrap);
  input.select();
}

// ---------- Font picker ----------
// Lists the font FAMILIES, each written in its own typeface. Picking a family selects the weight closest
// to 400 (the user then changes weight/style with the weight selector next to the picker).
// Includes the built-in Space Grotesk and IBM Plex Mono. onPick(fontId); a "none" row only appears when `noneLabel` is given (then onPick(null)).
export function openFontPicker(anchor, { currentId, onPick, noneLabel = null }) {
  const body = scroller();
  const pick = (id) => { closePopover(); onPick(id); };
  const currentFamily = (allFonts().find((f) => f.id === currentId) || {}).family;
  if (noneLabel) body.append(el('button', { class: 'menu-item', on: { click: () => pick(null) } }, noneLabel));
  const families = groupFamilies(allFonts());
  families.forEach((fam) => {
    const sample = closestTo400(fam.fonts);
    body.append(el('button', { class: 'menu-item', on: { click: () => pick(sample.id) } },
      el('span', { style: { fontFamily: `'${cssFamily(sample)}'` }, text: fam.family }),
      fam.family === currentFamily ? el('span', { class: 'sub', text: '✓' }) : el('span', { class: 'sub', text: familySummary(fam.fonts) })));
  });
  openPopover(anchor, body);
}

// ---------- Media picker (a board's / group's background image) ----------
// Lists the library's media (newest first, like the library), each with a small thumbnail. onPick(mediaId).
export function openMediaPicker(anchor, { currentId, onPick }) {
  const body = scroller();
  const media = sortMedia(state.library.media);
  if (!media.length) body.append(el('div', { class: 'pop-title', text: 'no media yet: + import in the library' }));
  media.forEach((m) => body.append(el('button', { class: 'menu-item', title: m.name, on: { click: () => { closePopover(); onPick(m.id); } } },
    el('img', { class: 'chip media-chip', src: mediaUrl(m), alt: '', draggable: false }),
    el('span', { class: 'media-name', text: m.name }),
    el('span', { class: 'sub', text: m.id === currentId ? '✓' : (m.kind === 'svg' ? 'svg' : 'image') }))));
  openPopover(anchor, body);
}

// ---------- Name + hex editor for a palette swatch ----------
// `draft` ({ name, hex }, optional) fills the inputs instead of the saved values (used when the popover comes back
// after its eyedropper). `onEyedropper(draft)` (optional) adds an eyedropper button next to the hex input: clicking it
// closes the popover and hands over what is typed right now, so the caller can start the tool and reopen it later.
export function openColorEditor(anchor, color, { onSave, onDelete, onEyedropper, draft }) {
  const name = el('input', { type: 'text', value: draft ? draft.name : color.name, spellcheck: false });
  const hex = el('input', { type: 'text', value: draft ? draft.hex : color.hex, spellcheck: false });
  // Same icon + .icon-toggle look as the colors header eyedropper, sized to the 28px popover inputs.
  const eye = onEyedropper ? el('button', {
    class: 'icon-toggle tool-btn edit-eye eyedropper-btn', title: 'eyedropper: click a color in the preview to use it',
    on: { click: () => { const now = { name: name.value, hex: hex.value }; closePopover(); onEyedropper(now); } },
  }, icon('eyedropper')) : null;
  const save = () => {
    if (!isHex(hex.value)) { hex.classList.add('invalid'); return; }
    closePopover();
    onSave({ name: slug(name.value), hex: normalizeHex(hex.value) });
  };
  for (const input of [name, hex]) {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    input.addEventListener('input', () => input.classList.remove('invalid'));
  }
  const body = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '2px' } },
    el('div', { class: 'pop-title', text: 'edit color' }), name,
    el('div', { class: 'edit-hex-row' }, hex, eye),
    el('div', { style: { display: 'flex', gap: '6px', justifyContent: 'space-between' } },
      onDelete ? el('button', { class: 'btn', text: 'delete', on: { click: () => { closePopover(); onDelete(); } } }) : el('span'),
      el('button', { class: 'btn', style: { height: '28px' }, text: 'save', on: { click: save } })));
  openPopover(anchor, body);
  name.select();
}
