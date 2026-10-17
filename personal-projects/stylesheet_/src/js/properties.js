// properties.js: the properties area below the layers tree (an addition to the CLAUDE.md file list; editor.js
// would have passed ~400 lines). Shows controls for whatever is selected, in fixed groups (order: see itemGroups()):
// colors, appearance (background image, opacity), text, transform (rotation, mirror), size, spacing (padding / margin
// per side, offsets), layout; plus the pinned "save as preset" button.
// Every control calls a state.js function, so the preview and these controls can never disagree.

import { el, clear, $, slug, icon, swatchBg, hexLabel } from './util.js';
import {
  state, subscribe, selectedNodes, findNode, getFont, allFonts, getMedia,
  setCanvasBackground, setGroupBackground, setTextColor, setLayerColor, setBgImage, updateNode, updateLayout, updateCanvasSize, setCanvasSizeMode,
  setSectionColor, addSection, removeSection, endGesture, setGroupCollapsed, savePreset,
} from './state.js';
import {
  isContainer, isTextType, isFillImage, hasVisibleContent, hasTransform, opacityOf, SIZE_LIMITS, PADDING_LIMITS, RADIUS_LIMITS, MARGIN_LIMITS, OFFSET_LIMITS,
  GROUP_SIZE_LIMITS, OPACITY_LIMITS, PALETTE_WIDTH_LIMITS, PALETTE_HEIGHT_LIMITS, ROTATION_LIMITS, TRACKING_LIMITS, LINE_HEIGHT_LIMITS,
  WRAP_WIDTH_LIMITS, SIDES, sides,
} from './blocks.js';
import { groupFamilies, boldTarget, italicTarget, BOLD_MIN } from './fonts.js';
import { layerInfo, mediaUrl } from './svg.js';
import { showOutline, clearOutline } from './outline.js';
import { openColorPicker, openFontPicker, openMediaPicker } from './popover.js';
import { showToast } from './overlays.js';
import { playRipple } from './preview.js';

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
// `decimals` (optional, default 0) makes a slider with fractional steps (line height: 2 decimals, step 0.01); the
// value is shown with that many decimals and a typed value may contain a decimal point.
function sliderRow(label, value, min, max, unit, onLive, { decimals = 0 } = {}) {
  const step = decimals ? 1 / 10 ** decimals : 1;
  const show = (v) => `${Number(v).toFixed(decimals)}${unit}`;
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step) });
  input.value = value;
  const val = el('span', { class: 'val', text: show(value) });
  const paint = () => input.style.setProperty('--pct', `${((input.value - min) / (max - min)) * 100}%`);
  paint();
  input.addEventListener('input', () => { paint(); val.textContent = show(input.value); onLive(Number(input.value)); });
  input.addEventListener('change', endGesture);       // drag finished: the next drag is a new undo step

  // Double-click the number to type an exact value. Enter or clicking away applies it (clamped to this slider's
  // min/max); Esc, an empty box or non-digits cancels. One undo step per typed value.
  // A range that goes below 0 (offset x/y, rotation, tracking) also accepts one leading minus sign; a decimal slider
  // also accepts one decimal point.
  const allowMinus = min < 0;
  val.title = 'double-click to type a value';
  val.addEventListener('dblclick', () => {
    const box = el('input', { type: 'text', class: 'val-input', inputMode: decimals ? 'decimal' : 'numeric', maxLength: 5, spellcheck: false });
    box.value = input.value;
    val.replaceWith(box);
    box.focus();
    box.select();
    let done = false;
    const finish = (apply) => {
      if (done) return;                                   // Enter then blur must not apply twice
      done = true;
      const n = decimals ? parseFloat(box.value) : parseInt(box.value, 10);
      box.replaceWith(val);
      if (!apply || Number.isNaN(n)) return;
      const clamped = Math.min(max, Math.max(min, Math.round(n / step) * step));
      input.value = clamped;
      paint();
      val.textContent = show(clamped);
      endGesture();                                       // typed values always start a new undo step...
      onLive(Number(input.value));
      endGesture();                                       // ...and end it
    };
    box.addEventListener('input', () => {
      let v = box.value.replace(decimals ? /[^\d.-]/g : /[^\d-]/g, '');
      v = allowMinus ? v.replace(/(?!^)-/g, '') : v.replace(/-/g, '');   // at most one leading "-"
      if (decimals) v = v.replace(/(\..*)\./g, '$1');                    // at most one "."
      box.value = v;
    });
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

// A label followed by a segmented toggle on one line (group width/height modes, image fill, background image fit).
// The label lines up with the slider labels below it.
const modeRow = (label, options, current, onPick) => el('div', { class: 'mode-row' },
  el('span', { class: 'label', text: label }), segmented(options, current, onPick));

// A joined row of INDEPENDENT on/off toggles (each one switches by itself, unlike segmented()): mirror H/V, B/I/U.
// items: [{ label, title, on, disabled, onClick }]; `label` is text or an icon element.
const toggleSeg = (items) => el('div', { class: 'seg full' }, items.map((t) => el('button', {
  class: t.on ? 'active' : '', title: t.title, disabled: !!t.disabled, on: { click: t.onClick },
}, t.label)));

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
// (A file's original layer colors are always opaque.)
function stripes(colors) {
  if (!colors.length) return 'transparent';
  if (colors.length === 1) return colors[0];
  const n = colors.length;
  return `linear-gradient(90deg, ${colors.map((c, i) => `${c} ${(i * 100) / n}% ${((i + 1) * 100) / n}%`).join(', ')})`;
}

// One row of the colors section: swatch, name, hex (or "original"), plus a reset link when `onReset` is given, or a
// × link when `onRemove` is given (palette block sections). `swatch` is a CSS background: swatchBg(hex) shows a
// color with alpha over a small checkerboard. Clicking opens the color picker (onPick(hex, opts): opts.live = an
// alpha slider tick, opts.name = a library color's name); a library color can be dropped on it (`drop` = its data-*
// attributes, read by dragdrop.js); hovering it outlines in the preview exactly what it controls (`outline`, see outline.js).
// `noneLabel` (optional) adds a "none" row to the picker that calls onPick(null) (group backgrounds can be transparent).
function colorRow({ name, swatch, text, current, drop, outline, title, onPick, onReset, onRemove, noneLabel }) {
  const btn = el('button', { class: 'prop-row color-btn', dataset: drop, title: title || `${name} ${text}` },
    el('span', { class: 'swatch', style: { background: swatch } }),
    el('span', { class: 'label', text: name }),
    el('span', { class: 'hex', text }));
  btn.addEventListener('click', () => openColorPicker(btn, { current, onPick, noneLabel }));
  btn.addEventListener('mouseenter', () => showOutline(outline));
  btn.addEventListener('mouseleave', clearOutline);
  const remove = onRemove ? el('button', { class: 'reset-link clear-link', text: '×', title: 'remove this section', on: { click: onRemove } }) : null;
  return el('div', { class: 'color-row' }, btn, onReset ? resetLink(onReset) : null, remove);
}

// The colors of the SELECTED item only: a canvas -> its background; a group -> its background (or none); a text
// block -> its text color; a vector block -> one row per first-level layer; a palette block -> one row per section
// (+ "+ add section"). Images have no colors. Each change affects just that one thing.
// Every hex may carry an alpha: the row then reads "#D9FF43 · 40%" (hexLabel) over a checkerboard swatch.
function colorsBody(sel) {
  if (sel.type === 'canvas') {
    return [colorRow({
      name: 'background', swatch: swatchBg(sel.background), text: hexLabel(sel.background), current: sel.background,
      drop: { dropColor: 'canvas', nodeId: sel.id }, outline: { type: 'canvas', canvasId: sel.id },
      onPick: (h, o) => setCanvasBackground(sel.id, h, o),
    })];
  }
  if (sel.type === 'group') {
    // null = transparent ("none"). The picker has a "none" row, and reset also means none.
    const bg = sel.background;
    return [colorRow({
      name: 'background', swatch: swatchBg(bg), text: bg ? hexLabel(bg) : 'none', current: bg,
      drop: { dropColor: 'group', nodeId: sel.id }, outline: { type: 'group', blockId: sel.id },
      noneLabel: 'none (transparent)',
      onPick: (h, o) => setGroupBackground(sel.id, h, o),
      onReset: bg ? () => setGroupBackground(sel.id, null) : null,
    })];
  }
  if (isTextType(sel.type)) {
    return [colorRow({
      name: 'text', swatch: swatchBg(sel.color), text: hexLabel(sel.color), current: sel.color,
      drop: { dropColor: 'text', nodeId: sel.id }, outline: { type: 'text', blockId: sel.id },
      onPick: (h, o) => setTextColor(sel.id, h, o),
    })];
  }
  if (sel.type === 'vector') {
    return layerInfo(sel.mediaId).map((layer, i) => {
      const hex = (sel.layerColors || {})[i] || null;     // null = still the original colors from the file
      return colorRow({
        name: layer.name, swatch: hex ? swatchBg(hex) : stripes(layer.colors), text: hex ? hexLabel(hex) : 'original', current: hex || layer.colors[0],
        title: hex ? `${layer.name} ${hexLabel(hex)}` : `${layer.name}: original colors ${layer.colors.join(' ') || '(none)'}`,
        drop: { dropColor: 'layer', nodeId: sel.id, layerKey: String(i) }, outline: { type: 'layer', blockId: sel.id, layer: String(i) },
        onPick: (h, o) => setLayerColor(sel.id, String(i), h, o),
        onReset: hex ? () => setLayerColor(sel.id, String(i), null) : null,
      });
    });
  }
  if (sel.type === 'palette') {
    // One row per section: its library name (when it came from the library) or "section N". The × removes it
    // (hidden on the last one: a palette block keeps at least one section). Picking a library color also stores
    // its name; typing a hex clears the name.
    const rows = sel.sections.map((s, i) => colorRow({
      name: s.name || `section ${i + 1}`, swatch: swatchBg(s.hex), text: hexLabel(s.hex), current: s.hex,
      drop: { dropColor: 'section', nodeId: sel.id, layerKey: String(i) }, outline: { type: 'section', blockId: sel.id, section: i },
      onPick: (h, o) => setSectionColor(sel.id, i, h, o),
      onRemove: sel.sections.length > 1 ? () => { clearOutline(); removeSection(sel.id, i); } : null,
    }));
    rows.push(el('button', { class: 'reset-link add-section', text: '+ add section', on: { click: () => addSection(sel.id) } }));
    return rows;
  }
  return [];
}

// ---------- Appearance (background image of a board or group; opacity of every block) ----------
// Boards: the background image. Groups: the background image, then opacity. Every other block: opacity only.
function appearanceBody(node) {
  const body = el('div', { class: 'prop-body' });
  if (isContainer(node)) body.append(...bgImageRows(node));
  if (node.type !== 'canvas') body.append(opacityRow(node));
  return body;
}

// Opacity (0–100%) of a block: fades the whole block, children included. One undo step per drag / typed value.
const opacityRow = (node) => sliderRow('opacity', opacityOf(node), OPACITY_LIMITS.min, OPACITY_LIMITS.max, '%',
  (v) => updateNode(node.id, { opacity: v }, { live: true }));

// The background image of a board or group.
// One row: a thumbnail, "background image" and the file name. Click it to pick from the library's media; or drop a
// media item from the library on it (data-drop-media, see dragdrop.js). The × link removes it. When set, a "fit"
// toggle (cover | contain) follows. Hovering the row outlines the board/group edge in the preview.
function bgImageRows(node) {
  const bi = node.bgImage;
  const item = bi && getMedia(bi.mediaId);
  // "empty" = a slot without media (from a preset, or its media item was deleted): it draws a gray placeholder.
  const name = !bi ? 'none' : item ? item.name : 'empty';
  const outline = node.type === 'group' ? { type: 'group', blockId: node.id } : { type: 'canvas', canvasId: node.id };
  const thumb = item
    ? el('img', { class: 'bg-thumb', src: mediaUrl(item), alt: '', draggable: false })
    : el('span', { class: 'bg-thumb' + (bi ? ' empty' : '') });
  const btn = el('button', {
    class: 'prop-row color-btn bgimg-btn', dataset: { dropMedia: node.id },
    title: `background image: ${name}. Click to pick from the library, or drop a media item here`,
  }, thumb, el('span', { class: 'label', text: 'background image' }), el('span', { class: 'hex', text: name }));
  btn.addEventListener('click', () => openMediaPicker(btn, { currentId: bi ? bi.mediaId : null, onPick: (id) => setBgImage(node.id, id) }));
  btn.addEventListener('mouseenter', () => showOutline(outline));
  btn.addEventListener('mouseleave', clearOutline);
  const remove = bi ? el('button', {
    class: 'reset-link clear-link', text: '×', title: 'remove the background image',
    on: { click: () => updateNode(node.id, { bgImage: null }) },
  }) : null;
  const rows = [el('div', { class: 'color-row' }, btn, remove)];
  if (bi) {
    rows.push(modeRow('fit', [
      ['cover', 'cover', 'fill the whole area (edges may be cut off)'],
      ['contain', 'contain', 'show the whole image'],
    ], bi.fit, (v) => updateNode(node.id, { bgImage: { ...bi, fit: v } })));
  }
  return rows;
}

// ---------- Palette block ----------
// "text" group: hex labels (on by default) and names (off by default; a section only has a name when its color came
// from the library).
function paletteTextBody(p) {
  const onOff = (label, key, onTitle, offTitle) => modeRow(label, [['off', 'off', offTitle], ['on', 'on', onTitle]],
    p[key] ? 'on' : 'off', (v) => { if ((v === 'on') !== !!p[key]) updateNode(p.id, { [key]: v === 'on' }); });
  return el('div', { class: 'prop-body' },
    onOff('hex labels', 'hexLabels', 'show each section\'s hex', 'no hex labels'),
    onOff('names', 'names', 'show each section\'s library color name', 'no names'));
}

// "size" group: width and height sliders, horizontal | vertical, then the corner radius.
function paletteSizeBody(p) {
  return el('div', { class: 'prop-body' },
    sliderRow('width', p.width, PALETTE_WIDTH_LIMITS.min, PALETTE_WIDTH_LIMITS.max, 'px', (v) => updateNode(p.id, { width: v }, { live: true })),
    sliderRow('height', p.height, PALETTE_HEIGHT_LIMITS.min, PALETTE_HEIGHT_LIMITS.max, 'px', (v) => updateNode(p.id, { height: v }, { live: true })),
    segmented([
      ['horizontal', 'horizontal', 'sections side by side'],
      ['vertical', 'vertical', 'sections stacked'],
    ], p.orientation, (v) => { if (v !== p.orientation) updateNode(p.id, { orientation: v }); }),
    sliderRow('radius', p.radius, RADIUS_LIMITS.min, RADIUS_LIMITS.max, 'px', (v) => updateNode(p.id, { radius: v }, { live: true })));
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

// The "size" group of a canvas: fixed | dynamic, corner radius, and (fixed only) width and height.
// Dynamic needs visible content, so it is disabled on an empty canvas. Going dynamic -> fixed keeps the current size.
// (Padding lives in the "spacing" group.)
function canvasSizeBody(canvas) {
  const s = canvas.size;
  const canGrow = hasVisibleContent(canvas);
  const body = el('div', { class: 'prop-body' },
    segmented([
      ['fixed', 'fixed', 'fixed size: set width and height'],
      ['dynamic', 'dynamic', canGrow ? 'grow and shrink with the content' : 'add content to the board first', !canGrow],
    ], s.mode, (v) => setCanvasSizeMode(canvas.id, v, v === 'fixed' ? renderedSize(canvas) : null)),
    // Corner radius of the board (0 = square corners). Placed in "size" for now.
    sliderRow('radius', canvas.radius, RADIUS_LIMITS.min, RADIUS_LIMITS.max, 'px', (v) => updateNode(canvas.id, { radius: v }, { live: true })));
  if (s.mode === 'fixed') {
    body.append(
      sliderRow('width', s.width, SIZE_LIMITS.min, SIZE_LIMITS.max, 'px', (v) => updateCanvasSize(canvas.id, { width: v }, { live: true })),
      sliderRow('height', s.height, SIZE_LIMITS.min, SIZE_LIMITS.max, 'px', (v) => updateCanvasSize(canvas.id, { height: v }, { live: true })));
  }
  return body;
}

// The "size" group of a group: a width mode and a height mode (fixed | fit | fill), each followed by its slider
// when fixed, then the corner radius. Switching an axis to fixed keeps the group's current rendered size (measured
// in the preview, like a board going dynamic -> fixed), so nothing jumps.
function groupSizeBody(g) {
  const s = g.size;
  // Looked up when clicked (not now): the preview may redraw after this panel, which replaces the element.
  const box = () => document.querySelector(`#canvas-grid .block-group[data-id="${g.id}"]`);
  const MODES = [
    ['fixed', 'fixed', 'a set size: use the slider'],
    ['fit', 'fit', 'shrink-wrap the content plus padding'],
    ['fill', 'fill', 'take the remaining space in the parent (acts like fit inside a dynamic board or a fit group)'],
  ];
  const axis = (label, modeKey, key, measure) => {
    const rows = [modeRow(label, MODES, s[modeKey], (v) => {
      if (v === s[modeKey]) return;                                      // clicking the current mode is not an undo step
      const patch = { [modeKey]: v };
      const b = box();
      if (v === 'fixed' && b) patch[key] = Math.round(measure(b));       // offsetWidth/Height ignore the zoom
      updateNode(g.id, { size: { ...s, ...patch } });
    })];
    if (s[modeKey] === 'fixed') {
      rows.push(sliderRow(label, s[key], GROUP_SIZE_LIMITS.min, GROUP_SIZE_LIMITS.max, 'px',
        (v) => updateNode(g.id, { size: { ...findNode(g.id).node.size, [key]: v } }, { live: true })));
    }
    return rows;
  };
  return el('div', { class: 'prop-body' },
    ...axis('width', 'widthMode', 'width', (b) => b.offsetWidth),
    ...axis('height', 'heightMode', 'height', (b) => b.offsetHeight),
    sliderRow('radius', g.radius, RADIUS_LIMITS.min, RADIUS_LIMITS.max, 'px', (v) => updateNode(g.id, { radius: v }, { live: true })));
}

// ---------- Spacing (padding / margin per side, offsets) ----------
// Every slider row in the spacing group ends with a 22px slot: the link toggle on the first padding/margin row, an
// empty slot on the others, so all the sliders in the group end at the same x.
const linkSlot = () => el('span', { class: 'link-slot' });

// Padding (canvas) or margin (block), stored per side in item[key] = { top, right, bottom, left }.
// Linked (item[linkedKey] = true): ONE slider sets all four sides. Unlinked: four sliders (top, right, bottom, left).
// The link toggle at the end of the first row switches between them; going back to linked copies the top value to
// all four sides. Each change is one undo step (sliders: one per gesture).
function sidesControl(item, key, linkedKey, label, limits) {
  const linked = item[linkedKey] !== false;
  const current = () => findNode(item.id).node[key];          // read fresh on every tick (undo may swap the object)
  const toggle = el('button', {
    class: 'icon-toggle link-toggle' + (linked ? ' on' : ''),
    title: linked ? `all sides the same: click to set each side of the ${label}` : `each side separately: click to link all sides (uses top)`,
    on: { click: () => updateNode(item.id, linked ? { [linkedKey]: false } : { [linkedKey]: true, [key]: sides(item[key].top) }) },
  }, icon(linked ? 'link' : 'unlink'));
  if (linked) {
    const r = sliderRow(label, item[key].top, limits.min, limits.max, 'px', (v) => updateNode(item.id, { [key]: sides(v) }, { live: true }));
    r.append(toggle);
    return [r];
  }
  return SIDES.map((side, i) => {
    const r = sliderRow(side, item[key][side], limits.min, limits.max, 'px',
      (v) => updateNode(item.id, { [key]: { ...current(), [side]: v } }, { live: true }));
    r.append(i === 0 ? toggle : linkSlot());
    return r;
  });
}

// The "spacing" group. Canvas: padding. Group: padding, then margin and offsets. Other blocks (text, vector, image):
// margin, then offset x / offset y.
// Offsets are a visual nudge only (a transform): neighbours don't move and a dynamic canvas keeps its size.
function spacingBody(sel) {
  if (sel.type === 'canvas') return el('div', { class: 'prop-body' }, ...sidesControl(sel, 'padding', 'paddingLinked', 'padding', PADDING_LIMITS));
  const offsetRow = (axis) => {
    const r = sliderRow(`offset ${axis}`, sel.offset[axis], OFFSET_LIMITS.min, OFFSET_LIMITS.max, 'px',
      (v) => updateNode(sel.id, { offset: { ...findNode(sel.id).node.offset, [axis]: v } }, { live: true }));
    r.append(linkSlot());
    return r;
  };
  const padding = sel.type === 'group' ? sidesControl(sel, 'padding', 'paddingLinked', 'padding', PADDING_LIMITS) : [];
  return el('div', { class: 'prop-body' },
    ...padding, ...sidesControl(sel, 'margin', 'marginLinked', 'margin', MARGIN_LIMITS), offsetRow('x'), offsetRow('y'));
}

// The "text" group of a text block, top to bottom: the text, the font (family + exact weight), B / I / U next to
// the line alignment, size, tracking, line height, case, wrap (+ its width when fixed).
function textBody(block) {
  // data-block lets the on-canvas editor (preview.js) keep this box in sync while you type on the board.
  // A textarea (not a one-line input, which would drop line breaks) that is as tall as the text's lines (max 4, then
  // it scrolls). Same keys as on the board: Enter commits (leaves the box), Shift+Enter is a new line.
  const text = el('textarea', { class: 'text-input', placeholder: 'text', spellcheck: false, dataset: { block: block.id } });
  text.value = block.text;
  const fitRows = () => { text.rows = Math.min(4, Math.max(1, text.value.split('\n').length)); };
  fitRows();
  text.addEventListener('input', () => { fitRows(); updateNode(block.id, { text: text.value }, { live: true }); });
  text.addEventListener('change', endGesture);
  text.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); text.blur(); } });

  // This block's OWN font (family + weight). A library font can be dropped on the row (data-drop-font, see dragdrop.js).
  const setFont = (id) => updateNode(block.id, { font: id });
  const fontRow = row('font', ...fontControls(block.font, setFont));
  fontRow.dataset.dropFont = block.id;
  fontRow.classList.add('override-row');          // (old class name) keeps the tight spacing/muted label this row always had

  // B and I switch to ANOTHER FILE of the same family (never faux bold/italic), so each is only enabled when that
  // file exists (boldTarget / italicTarget in fonts.js). U is a plain underline, always available.
  const font = getFont(block.font);
  const fam = font ? allFonts().filter((f) => f.family === font.family) : [];
  const bold = font && boldTarget(font, fam), italic = font && italicTarget(font, fam);
  const isBold = !!font && font.weight >= BOLD_MIN, isItalic = !!font && font.style === 'italic';
  const biu = toggleSeg([
    { label: el('b', { text: 'B' }), on: isBold, disabled: !bold, onClick: () => setFont(bold.id),
      title: bold ? (isBold ? 'bold off' : `bold (${bold.weight})`) : 'this family has no bold file' },
    { label: el('i', { text: 'I' }), on: isItalic, disabled: !italic, onClick: () => setFont(italic.id),
      title: italic ? (isItalic ? 'italic off' : 'italic') : 'this family has no italic file' },
    { label: el('u', { text: 'U' }), on: !!block.underline, title: 'underline', onClick: () => updateNode(block.id, { underline: !block.underline }) },
  ]);
  // Line alignment inside the block (the block itself is placed by its container's align).
  const align = segmented(['left', 'center', 'right'].map((a, i) => [a, icon(['alignHStart', 'alignHCenter', 'alignHEnd'][i]), `align ${a}`]),
    block.textAlign || 'left', (v) => updateNode(block.id, { textAlign: v }));

  const body = el('div', { class: 'prop-body' }, text, fontRow,
    el('div', { class: 'split-row text-style-row' }, biu, align),
    sliderRow('size', block.size, 8, 200, 'px', (v) => updateNode(block.id, { size: v }, { live: true })),
    sliderRow('tracking', block.tracking || 0, TRACKING_LIMITS.min, TRACKING_LIMITS.max, '', (v) => updateNode(block.id, { tracking: v }, { live: true })),
    sliderRow('line height', block.lineHeight || 1.2, LINE_HEIGHT_LIMITS.min, LINE_HEIGHT_LIMITS.max, '',
      (v) => updateNode(block.id, { lineHeight: v }, { live: true }), { decimals: 2 }),
    modeRow('case', [
      ['none', 'none', 'as typed'], ['upper', 'UPPER', 'all capitals'], ['lower', 'lower', 'all lowercase'], ['title', 'Title', 'Capitalize Each Word'],
    ], block.textCase || 'none', (v) => updateNode(block.id, { textCase: v })),
    // Wrap: fit = one line per line break; fixed = wraps inside a width. Switching to fixed starts at the text's
    // current rendered width (measured in the preview, clamped to 40–1600), so nothing jumps.
    modeRow('wrap', [
      ['fit', 'fit', 'one line per line break, never wraps'],
      ['fixed', 'fixed', 'wrap inside a set width'],
    ], block.wrap || 'fit', (v) => {
      if (v === (block.wrap || 'fit')) return;
      const patch = { wrap: v };
      const node = document.querySelector(`#canvas-grid .block-text[data-id="${block.id}"]`);
      if (v === 'fixed' && node) patch.wrapWidth = Math.min(WRAP_WIDTH_LIMITS.max, Math.max(WRAP_WIDTH_LIMITS.min, Math.round(node.offsetWidth)));
      updateNode(block.id, patch);
    }));
  if (block.wrap === 'fixed') {
    body.append(sliderRow('width', block.wrapWidth, WRAP_WIDTH_LIMITS.min, WRAP_WIDTH_LIMITS.max, 'px', (v) => updateNode(block.id, { wrapWidth: v }, { live: true })));
  }
  return body;
}

// ---------- Transform (content blocks: text, vector, image, palette) ----------
// Rotation (−180–180°, around the block's center) and mirror horizontally / vertically. Visual only (a CSS transform
// combined with the offsets): the layout around the block never changes.
function transformBody(b) {
  return el('div', { class: 'prop-body' },
    sliderRow('rotation', b.rotation || 0, ROTATION_LIMITS.min, ROTATION_LIMITS.max, '°', (v) => updateNode(b.id, { rotation: v }, { live: true })),
    el('div', { class: 'mode-row' }, el('span', { class: 'label', text: 'mirror' }), toggleSeg([
      { label: icon('flipH'), title: 'mirror horizontally (left ↔ right)', on: !!b.mirrorX, onClick: () => updateNode(b.id, { mirrorX: !b.mirrorX }) },
      { label: icon('flipV'), title: 'mirror vertically (top ↔ bottom)', on: !!b.mirrorY, onClick: () => updateNode(b.id, { mirrorY: !b.mirrorY }) },
    ])));
}

// The "size" group of a vector or image block: its width (a vector with no media also says so here).
// An image also gets a fill toggle: on = it covers its parent edge to edge (behind the parent's other content), so
// the width slider is hidden.
function mediaSizeBody(block) {
  const body = el('div', { class: 'prop-body' });
  if (block.type === 'image') {
    body.append(modeRow('fill', [
      ['off', 'off', 'sits in the layout at its own width'],
      ['on', 'on', 'cover the parent (group or board) edge to edge, behind its other content'],
    ], block.fill ? 'on' : 'off', (v) => updateNode(block.id, { fill: v === 'on' })));
  }
  if (!isFillImage(block)) body.append(sliderRow('width', block.width, 20, 360, 'px', (v) => updateNode(block.id, { width: v }, { live: true })));
  if (block.type === 'vector' && !getMedia(block.mediaId)) body.append(el('div', { class: 'lib-empty', text: 'no media: drop one from the library' }));
  return body;     // a vector's layer colors live in the "colors" group
}

// ---------- Render ----------
// THE ORDER of property groups, top to bottom, for every item. A group only appears when it applies to the item
// (never empty or irrelevant).
//   colors → appearance → text → transform → size → spacing → layout
// Collapse keys are the group names (saved in session.collapsedGroups, shared by every section with that group).
function itemGroups(sel, canvas) {
  const out = [];
  // colors: this item's own colors only (see colorsBody); none for images; a palette block's sections.
  const colorRows = colorsBody(sel);
  if (colorRows.length) out.push(group('colors', 'colors', el('div', { class: 'prop-body' }, ...colorRows)));
  // appearance: every item (board: background image; group: background image + opacity; any other block: opacity).
  out.push(group('appearance', 'appearance', appearanceBody(sel)));
  // text: text blocks (text, font + B/I/U, alignment, size, tracking, line height, case, wrap); palette blocks (hex labels, names).
  if (isTextType(sel.type)) out.push(group('text', 'text', textBody(sel)));
  if (sel.type === 'palette') out.push(group('text', 'text', paletteTextBody(sel)));
  // transform: content blocks (text, vector, image, palette): rotation + mirror. Not on a fill image (it covers its
  // parent, so it can't turn), not on boards or groups.
  if (hasTransform(sel) && !isFillImage(sel)) out.push(group('transform', 'transform', transformBody(sel)));
  // size: a board's fixed/dynamic, radius, width/height; a group's width/height modes and radius; a vector's
  // width; an image's fill toggle and width; a palette's width, height, orientation and radius.
  if (sel.type === 'canvas') out.push(group('size', 'size', canvasSizeBody(sel)));
  if (sel.type === 'group') out.push(group('size', 'size', groupSizeBody(sel)));
  if (sel.type === 'vector' || sel.type === 'image') out.push(group('size', 'size', mediaSizeBody(sel)));
  if (sel.type === 'palette') out.push(group('size', 'size', paletteSizeBody(sel)));
  // spacing: every item (board: padding; group: padding + margin + offsets; block: margin + offsets), except a fill
  // image: it covers its parent, so margin and offsets don't apply to it.
  if (!isFillImage(sel)) out.push(group('spacing', 'spacing', spacingBody(sel)));
  // layout: belongs to a container: the item itself, or the container around a selected block.
  const layoutTarget = isContainer(sel) ? sel : (findNode(sel.id).parent || canvas);
  out.push(group('layout', 'layout', layoutBody(layoutTarget)));
  return out;
}

// One selected item: its normal properties. With several items selected every item gets its own section under a
// small header ("Board 1 / title 1"), and each control only ever edits the item of its own section.
function renderProps() {
  const props = clear($('#props'));
  const nodes = selectedNodes();
  if (!nodes.length) {
    props.append(el('div', { class: 'lib-empty', text: 'select a board or a block to edit it' }));
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
      title: canvas ? 'save this board structure as a preset' : 'select exactly one board',
      on: { click: () => { namingPreset = true; renderPresetFoot(); } },
    }));
    return;
  }
  const input = el('input', { type: 'text', placeholder: 'preset_name', value: slug(canvas.name), spellcheck: false });
  const finish = (save) => {
    // Runs once: saving redraws this footer, which removes the focused input and fires its blur -> finish again.
    // Without this guard that second call redrew the footer in the middle of the first redraw (a console error).
    if (!namingPreset) return;
    namingPreset = false;
    if (save && input.value.trim()) {
      const name = slug(input.value);
      // Saved: a notice, plus a ring of accent dots rippling out from the saved board (skipped with reduce motion).
      if (savePreset(canvas.id, name)) {
        showToast(`saved preset ${name}`);
        playRipple(canvas.id);
      }
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
