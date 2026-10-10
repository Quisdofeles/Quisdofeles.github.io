// properties.js: the properties area below the layers tree (an addition to the CLAUDE.md file list; editor.js
// would have passed ~400 lines). Shows controls for whatever is selected: the colors of the selected item, the
// canvas's type fonts, layout, and the selected block's own settings, plus the pinned "save as preset" button.
// Every control calls a state.js function, so the preview and these controls can never disagree.

import { el, clear, $, slug, icon } from './util.js';
import {
  state, subscribe, selectedNodes, findNode, getFont, allFonts, getMedia,
  setCanvasBackground, setTextColor, setLayerColor, updateNode, updateLayout, updateCanvasSize, setCanvasSizeMode,
  endGesture, setGroupCollapsed, savePreset,
} from './state.js';
import { isContainer, isTextType, hasVisibleContent, SIZE_LIMITS, PADDING_LIMITS } from './blocks.js';
import { groupFamilies } from './fonts.js';
import { layerInfo } from './svg.js';
import { showOutline, clearOutline } from './outline.js';
import { openColorPicker, openFontPicker } from './popover.js';
import { showToast } from './overlays.js';

let namingPreset = false;   // true while the "save as preset" name input is showing

// ---------- Small building blocks ----------
// A labelled 36px row: label on the left, controls on the right.
const row = (label, ...right) => el('div', { class: 'prop-row' },
  el('span', { class: 'label', text: label }), el('div', { class: 'value' }, ...right));

// A collapsible property group; its collapsed state is saved in the session.
function group(key, label, body) {
  const collapsed = !!state.session.collapsedGroups[key];
  const wrap = el('div', { class: 'prop-group' },
    el('button', { class: 'prop-head', on: { click: () => setGroupCollapsed(key, !collapsed) } },
      el('span', { class: 'caret', text: collapsed ? '▸' : '▾' }), label));
  if (!collapsed) wrap.append(body);
  return wrap;
}

// A slider row. onLive(value) fires on every tick (history is pushed once per drag by state.js).
function sliderRow(label, value, min, max, unit, onLive) {
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: '1' });
  input.value = value;
  const val = el('span', { class: 'val', text: `${value}${unit}` });
  const paint = () => input.style.setProperty('--pct', `${((input.value - min) / (max - min)) * 100}%`);
  paint();
  input.addEventListener('input', () => { paint(); val.textContent = `${input.value}${unit}`; onLive(Number(input.value)); });
  input.addEventListener('change', endGesture);       // drag finished: the next drag is a new undo step

  // Double-click the number to type an exact value. Enter or clicking away applies it (clamped to this slider's
  // min/max); Esc, an empty box or non-digits cancels. One undo step per typed value.
  val.title = 'double-click to type a value';
  val.addEventListener('dblclick', () => {
    const box = el('input', { type: 'text', class: 'val-input', inputMode: 'numeric', maxLength: 4, spellcheck: false });
    box.value = input.value;
    val.replaceWith(box);
    box.focus();
    box.select();
    let done = false;
    const finish = (apply) => {
      if (done) return;                                   // Enter then blur must not apply twice
      done = true;
      const n = parseInt(box.value, 10);
      box.replaceWith(val);
      if (!apply || Number.isNaN(n)) return;
      const clamped = Math.min(max, Math.max(min, n));
      input.value = clamped;
      paint();
      val.textContent = `${clamped}${unit}`;
      endGesture();                                       // typed values always start a new undo step...
      onLive(clamped);
      endGesture();                                       // ...and end it
    };
    box.addEventListener('input', () => { box.value = box.value.replace(/\D/g, ''); });   // digits only (every range starts at 0 or above)
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();                                // typing must not trigger app shortcuts (Delete, Ctrl+D...)
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    box.addEventListener('blur', () => finish(true));
  });
  // One line: label, slider, value (keeps the properties area compact).
  return el('div', { class: 'prop-row slider-row' }, el('span', { class: 'label', text: label }), input, val);
}

// A segmented toggle. options: [[value, label, title?, disabled?]]. `label` is text, or an icon element (then pass a
// title tooltip). A disabled option uses the shared disabled button style.
function segmented(options, current, onPick) {
  return el('div', { class: 'seg full' }, options.map(([value, label, title, disabled]) => el('button', {
    class: value === current ? 'active' : '', title: title || null, disabled: !!disabled, on: { click: () => onPick(value) },
  }, label)));
}

// Family button + weight/style selector for a font choice. onPick(fontId | null).
function fontControls(currentId, onPick) {
  const font = getFont(currentId);
  const label = font ? font.family : currentId ? 'missing' : 'none';     // "missing" = deleted from the library (the text falls back to Space Grotesk)
  const familyBtn = el('button', { class: 'mini-btn font-label', title: 'choose font family', text: `${label} ▾`, on: { click: () => openFontPicker(familyBtn, { currentId, onPick }) } });
  const nodes = [familyBtn];
  if (font) {
    const fam = groupFamilies(allFonts()).find((g) => g.family === font.family).fonts;
    const select = el('select', { class: 'mini-select', title: 'weight / style' },
      fam.map((f) => el('option', { value: f.id, text: `${f.weight}${f.style === 'italic' ? ' italic' : ''}` })));
    select.value = font.id;
    select.disabled = fam.length < 2;
    select.addEventListener('change', () => onPick(select.value));
    nodes.push(select);
  }
  return nodes;
}

const resetLink = (onClick) => el('button', { class: 'reset-link', text: 'reset', on: { click: onClick } });

// ---------- Colors ----------
// A swatch background for a list of colors: one color is flat, several are split into hard-edged stripes.
function stripes(colors) {
  if (!colors.length) return 'transparent';
  if (colors.length === 1) return colors[0];
  const n = colors.length;
  return `linear-gradient(90deg, ${colors.map((c, i) => `${c} ${(i * 100) / n}% ${((i + 1) * 100) / n}%`).join(', ')})`;
}

// One row of the colors section: swatch, name, hex (or "original"), plus a reset link when `onReset` is given.
// Clicking opens the color picker; a library color can be dropped on it (`drop` = its data-* attributes, read by
// dragdrop.js); hovering it outlines in the preview exactly what it controls (`outline`, see outline.js).
function colorRow({ name, swatch, text, current, drop, outline, title, onPick, onReset }) {
  const btn = el('button', { class: 'prop-row color-btn', dataset: drop, title: title || `${name} ${text}` },
    el('span', { class: 'swatch', style: { background: swatch } }),
    el('span', { class: 'label', text: name }),
    el('span', { class: 'hex', text }));
  btn.addEventListener('click', () => openColorPicker(btn, { current, onPick }));
  btn.addEventListener('mouseenter', () => showOutline(outline));
  btn.addEventListener('mouseleave', clearOutline);
  return el('div', { class: 'color-row' }, btn, onReset ? resetLink(onReset) : null);
}

// The colors of the SELECTED item only: a canvas -> its background; a text block -> its text color; a vector
// block -> one row per first-level layer. Anything else has no colors. Each change affects just that one thing.
function colorsBody(sel) {
  if (sel.type === 'canvas') {
    return [colorRow({
      name: 'background', swatch: sel.background, text: sel.background, current: sel.background,
      drop: { dropColor: 'canvas', nodeId: sel.id }, outline: { type: 'canvas', canvasId: sel.id },
      onPick: (h) => setCanvasBackground(sel.id, h),
    })];
  }
  if (isTextType(sel.type)) {
    return [colorRow({
      name: 'text', swatch: sel.color, text: sel.color, current: sel.color,
      drop: { dropColor: 'text', nodeId: sel.id }, outline: { type: 'text', blockId: sel.id },
      onPick: (h) => setTextColor(sel.id, h),
    })];
  }
  if (sel.type === 'vector') {
    return layerInfo(sel.mediaId).map((layer, i) => {
      const hex = (sel.layerColors || {})[i] || null;     // null = still the original colors from the file
      return colorRow({
        name: layer.name, swatch: hex || stripes(layer.colors), text: hex || 'original', current: hex || layer.colors[0],
        title: hex ? `${layer.name} ${hex}` : `${layer.name}: original colors ${layer.colors.join(' ') || '(none)'}`,
        drop: { dropColor: 'layer', nodeId: sel.id, layerKey: String(i) }, outline: { type: 'layer', blockId: sel.id, layer: String(i) },
        onPick: (h) => setLayerColor(sel.id, String(i), h),
        onReset: hex ? () => setLayerColor(sel.id, String(i), null) : null,
      });
    });
  }
  return [];
}

// ---------- Groups ----------

function layoutBody(target) {
  const l = target.layout;
  // Direction and alignment share one line; the gap slider sits under them.
  return el('div', { class: 'prop-body' },
    el('div', { class: 'split-row' },
      segmented([['stack', 'stack'], ['row', 'row']], l.direction, (v) => updateLayout(target.id, { direction: v })),
      // Align shows icons instead of words ("center" didn't fit). In a stack, align is horizontal (left/center/right lines);
      // in a row it is vertical (top/middle/bottom bars), so the glyphs follow the direction.
      segmented(['start', 'center', 'end'].map((a) => {
        const glyph = 'align' + (l.direction === 'row' ? 'V' : 'H') + a[0].toUpperCase() + a.slice(1);
        return [a, icon(glyph), a];
      }), l.align, (v) => updateLayout(target.id, { align: v }))),
    sliderRow('gap', l.gap, 0, 120, 'px', (v) => updateLayout(target.id, { gap: v }, { live: true })));
}

// The canvas's rendered size at 100% zoom, read from the preview (offsetWidth/Height ignore the zoom transform).
// A hidden canvas isn't in the preview, so its stored size is used.
function renderedSize(canvas) {
  const card = document.querySelector(`#canvas-grid .canvas[data-id="${canvas.id}"]`);
  return card ? { width: Math.round(card.offsetWidth), height: Math.round(card.offsetHeight) } : { width: canvas.size.width, height: canvas.size.height };
}

// The "size" group of a canvas: fixed | dynamic, padding, and (fixed only) width and height.
// Dynamic needs visible content, so it is disabled on an empty canvas. Going dynamic -> fixed keeps the current size.
function sizeBody(canvas) {
  const s = canvas.size;
  const canGrow = hasVisibleContent(canvas);
  const body = el('div', { class: 'prop-body' },
    segmented([
      ['fixed', 'fixed', 'fixed size: set width and height'],
      ['dynamic', 'dynamic', canGrow ? 'grow and shrink with the content' : 'add content first', !canGrow],
    ], s.mode, (v) => setCanvasSizeMode(canvas.id, v, v === 'fixed' ? renderedSize(canvas) : null)),
    sliderRow('padding', canvas.padding, PADDING_LIMITS.min, PADDING_LIMITS.max, 'px', (v) => updateNode(canvas.id, { padding: v }, { live: true })));
  if (s.mode === 'fixed') {
    body.append(
      sliderRow('width', s.width, SIZE_LIMITS.min, SIZE_LIMITS.max, 'px', (v) => updateCanvasSize(canvas.id, { width: v }, { live: true })),
      sliderRow('height', s.height, SIZE_LIMITS.min, SIZE_LIMITS.max, 'px', (v) => updateCanvasSize(canvas.id, { height: v }, { live: true })));
  }
  return body;
}

function textBody(block) {
  const text = el('input', { type: 'text', class: 'text-input', placeholder: 'text', spellcheck: false });
  text.value = block.text;
  text.addEventListener('input', () => updateNode(block.id, { text: text.value }, { live: true }));
  text.addEventListener('change', endGesture);
  text.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') text.blur(); });

  // This block's OWN font (family + weight). A library font can be dropped on the row (data-drop-font, see dragdrop.js).
  const fontRow = row('font', ...fontControls(block.font, (id) => updateNode(block.id, { font: id })));
  fontRow.dataset.dropFont = block.id;
  fontRow.classList.add('override-row');          // (old class name) keeps the tight spacing/muted label this row always had

  return el('div', { class: 'prop-body' }, text,
    sliderRow('size', block.size, 8, 200, 'px', (v) => updateNode(block.id, { size: v }, { live: true })),
    fontRow);
}

function vectorBody(block) {
  const vec = getMedia(block.mediaId);
  const body = el('div', { class: 'prop-body' },
    sliderRow('width', block.width, 20, 360, 'px', (v) => updateNode(block.id, { width: v }, { live: true })));
  if (!vec) body.append(el('div', { class: 'lib-empty', text: 'no media: drop one from the library' }));
  return body;     // the layer colors live in the "colors" section
}

// Chooses the block-specific group for a selected non-container block.
function blockGroup(node) {
  if (isTextType(node.type)) return group('block', node.type, textBody(node));
  if (node.type === 'vector') return group('block', 'vector', vectorBody(node));
  if (node.type === 'image') return group('block', 'image', el('div', { class: 'prop-body' }, sliderRow('width', node.width, 20, 360, 'px', (v) => updateNode(node.id, { width: v }, { live: true }))));
  if (node.type === 'spacer') return group('block', 'spacer', el('div', { class: 'prop-body' }, sliderRow('size', node.size, 0, 200, 'px', (v) => updateNode(node.id, { size: v }, { live: true }))));
  return null;
}

// ---------- Render ----------
// The normal property groups of ONE selected item (`canvas` = the canvas it lives in, or itself).
function itemGroups(sel, canvas) {
  const out = [];
  // Colors of this item only (see colorsBody). The panel scrolls inside itself when a vector has many layers.
  const colorRows = colorsBody(sel);
  if (colorRows.length) out.push(group('colors', 'colors', el('div', { class: 'prop-body' }, ...colorRows)));
  // Layout belongs to a container: the item itself, or the container around a selected block.
  const layoutTarget = isContainer(sel) ? sel : (findNode(sel.id).parent || canvas);
  out.push(group('layout', 'layout', layoutBody(layoutTarget)));
  // A canvas also has its size settings (after layout, so the existing groups stay where they were).
  if (sel.type === 'canvas') out.push(group('size', 'size', sizeBody(sel)));

  const specific = blockGroup(sel);
  if (specific) out.push(specific);
  return out;
}

// One selected item: its normal properties. With several items selected every item gets its own section under a
// small header ("lockup_A / title 1"), and each control only ever edits the item of its own section.
function renderProps() {
  const props = clear($('#props'));
  const nodes = selectedNodes();
  if (!nodes.length) {
    props.append(el('div', { class: 'lib-empty', text: 'select a canvas or a block to edit it' }));
    return;
  }
  const multi = nodes.length > 1;
  for (const sel of nodes) {
    const canvas = findNode(sel.id).canvas;
    const section = el('div', { class: 'prop-item' });
    if (multi) section.append(el('div', { class: 'prop-item-head', text: sel.type === 'canvas' ? sel.name : `${canvas.name} / ${sel.name}` }));
    section.append(...itemGroups(sel, canvas));
    props.append(section);
  }
}

// The pinned "save as preset" button; turns into a name input when clicked.
function renderPresetFoot() {
  const foot = clear($('#preset-foot'));
  // Only available when exactly one canvas is selected.
  const nodes = selectedNodes();
  const canvas = nodes.length === 1 && nodes[0].type === 'canvas' ? nodes[0] : null;
  if (!(namingPreset && canvas)) {
    namingPreset = false;
    foot.append(el('button', {
      class: 'dashed-btn', text: 'save as preset ▣', disabled: !canvas,
      title: canvas ? 'save this canvas structure as a preset' : 'select exactly one canvas',
      on: { click: () => { namingPreset = true; renderPresetFoot(); } },
    }));
    return;
  }
  const input = el('input', { type: 'text', placeholder: 'preset_name', value: slug(canvas.name), spellcheck: false });
  const finish = (save) => {
    namingPreset = false;
    if (save && input.value.trim()) {
      const name = slug(input.value);
      savePreset(canvas.id, name);
      showToast(`saved preset ${name}`);
    }
    renderPresetFoot();
  };
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
  input.addEventListener('blur', () => finish(false));
  foot.append(el('div', { class: 'preset-name-row' }, input));
  setTimeout(() => { input.focus(); input.select(); }, 0);
}

export function initProperties() {
  subscribe((meta) => {
    if (meta.view || meta.exportSettings || meta.live) return;
    renderProps();
    renderPresetFoot();
  });
  renderProps();
  renderPresetFoot();
}
