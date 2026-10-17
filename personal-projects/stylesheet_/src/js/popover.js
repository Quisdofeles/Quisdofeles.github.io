// popover.js: small floating panels anchored to a button or a point (an addition to the CLAUDE.md file list).
// One popover is open at a time. Contains the generic popover + context menu, and the specific ones:
// color picker (library colors, palettes, hex input, alpha slider), font picker (family + weight), block-type menu,
// media picker, and the small name/hex/alpha editor used for palette swatches. alphaRow() is the shared alpha slider.

import { el, clear, isHex, normalizeHex, slug, $, icon, alphaOf, withAlpha, hexLabel, swatchBg } from './util.js';
import { state, allFonts, endGesture, requestRender } from './state.js';
import { sortBlockTypes, sortMedia } from './sorting.js';
import { typeLabel } from './blocks.js';
import { mediaUrl } from './svg.js';
import { groupFamilies, closestTo400, familySummary, fontCss, fitFontSample } from './fonts.js';

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

// ---------- Alpha slider ----------
// A small "alpha" row (0–100%): label, slider, value. onInput(pct) fires on every tick; set(pct) moves the slider
// without firing (e.g. when a hex is typed). Used by the color picker and both color edit menus (library color card,
// palette swatch editor). `range` is the slider element, for callers that need its 'change' event.
export function alphaRow(value, onInput) {
  const range = el('input', { type: 'range', min: '0', max: '100', step: '1', title: 'alpha (100% = fully opaque)' });
  const val = el('span', { class: 'alpha-val' });
  const set = (pct) => { range.value = pct; range.style.setProperty('--pct', `${pct}%`); val.textContent = `${pct}%`; };
  set(value);
  range.addEventListener('input', () => { set(Number(range.value)); onInput(Number(range.value)); });
  const row = el('div', { class: 'alpha-row' }, el('span', { class: 'alpha-label', text: 'alpha' }), range, val);
  return { row, range, set };
}

// ---------- Color picker ----------
// Lists library colors and palettes plus a hex input and an alpha slider. onPick(hex, opts) gets an uppercase
// "#RRGGBB" or "#RRGGBBAA" (6 digits typed = opaque, 8 digits keep their alpha). opts:
//   { name }       a library color/swatch was clicked (its name; the palette block shows it), the popover closes;
//   { name: null } a hex was typed and applied, the popover closes;
//   { live: true } the alpha slider moved: the CURRENT color gets that alpha right away and the popover stays open
//                  (one undo step per drag; a library color's own alpha is used as stored when it is clicked).
// `noneLabel` (optional, used by group backgrounds) adds a first row that calls onPick(null) = no color (transparent).
export function openColorPicker(anchor, { current: currentHex, onPick, noneLabel = null }) {
  const pick = (hex, name = null) => { closePopover(); onPick(normalizeHex(hex), { name }); };
  const body = scroller();
  const lib = state.library;
  if (noneLabel) {
    body.append(el('button', { class: 'menu-item', on: { click: () => { closePopover(); onPick(null); } } },
      el('span', { class: 'chip' }), noneLabel, currentHex ? null : el('span', { class: 'sub', text: '✓' })));
  }
  if (lib.colors.length) {
    body.append(el('div', { class: 'pop-title', text: 'colors' }));
    lib.colors.forEach((c) => body.append(el('button', { class: 'menu-item', on: { click: () => pick(c.hex, c.name) } },
      el('span', { class: 'chip', style: { background: swatchBg(c.hex) } }), c.name, el('span', { class: 'sub', text: hexLabel(c.hex) }))));
  }
  lib.palettes.forEach((p) => {
    body.append(el('div', { class: 'pop-title', text: p.name }));
    body.append(el('div', { class: 'pop-palette' }, p.colors.map((c) => el('button', {
      class: 'chip-btn', title: `${c.name} ${hexLabel(c.hex)}`, style: { background: swatchBg(c.hex) }, on: { click: () => pick(c.hex, c.name) },
    }))));
  });

  const input = el('input', { type: 'text', value: currentHex || '', placeholder: '#RRGGBB', spellcheck: false });
  const apply = () => { if (isHex(input.value)) pick(input.value); else input.classList.add('invalid'); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
  // Typing a hex moves the slider to its alpha (6 digits = 100%).
  input.addEventListener('input', () => { input.classList.remove('invalid'); if (isHex(input.value)) alpha.set(alphaOf(input.value)); });

  // Live alpha: the typed hex (or the current color) at the slider's alpha. With no color at all (a transparent
  // group) there is nothing to fade, so the slider does nothing.
  const alpha = alphaRow(currentHex && isHex(currentHex) ? alphaOf(currentHex) : 100, (pct) => {
    const base = isHex(input.value) ? input.value : currentHex;
    if (!base) return;
    input.value = withAlpha(base, pct);
    input.classList.remove('invalid');
    onPick(normalizeHex(input.value), { live: true });
  });
  // Drag finished: the next drag is a new undo step, and the panels redraw (live ticks skip the properties panel).
  alpha.range.addEventListener('change', () => { endGesture(); requestRender(); });

  const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0 } }, body,
    el('div', { class: 'hex-row' }, input, el('button', { class: 'btn', text: 'apply', on: { click: apply } })),
    el('div', { class: 'pop-alpha' }, alpha.row));
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
    // The family name in its own typeface. A font whose glyphs would spill out of the 30px row (huge built-in
    // metrics) is scaled down to fit and centered in it (fitFontSample in fonts.js; menu text is 13px).
    const nameText = el('span', { text: fam.family });
    const name = el('span', { style: fontCss(sample) }, nameText);
    fitFontSample(name, nameText, sample, { size: 13, boxH: 30 });
    body.append(el('button', { class: 'menu-item', on: { click: () => pick(sample.id) } },
      name,
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
  // Alpha: the slider rewrites the hex input (8 digits below 100%); typing a hex moves the slider (6 digits = 100%).
  // Nothing is saved until "save" / Enter, like the name and hex.
  const alpha = alphaRow(isHex(hex.value) ? alphaOf(hex.value) : 100, (pct) => {
    if (!isHex(hex.value)) return;
    hex.value = withAlpha(hex.value, pct);
    hex.classList.remove('invalid');
  });
  hex.addEventListener('input', () => { if (isHex(hex.value)) alpha.set(alphaOf(hex.value)); });
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
    alpha.row,
    el('div', { style: { display: 'flex', gap: '6px', justifyContent: 'space-between' } },
      onDelete ? el('button', { class: 'btn', text: 'delete', on: { click: () => { closePopover(); onDelete(); } } }) : el('span'),
      el('button', { class: 'btn', style: { height: '28px' }, text: 'save', on: { click: save } })));
  openPopover(anchor, body);
  name.select();
}
