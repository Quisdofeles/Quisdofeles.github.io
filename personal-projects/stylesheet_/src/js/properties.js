// properties.js: the properties area below the layers tree (an addition to the CLAUDE.md file list; editor.js
// would have passed ~400 lines). Shows controls for whatever is selected, in fixed groups (order: see itemGroups()):
// colors, appearance (background image), text, size, spacing (padding / margin per side, offsets), layout; plus the
// pinned "save as preset" button.
// Every control calls a state.js function, so the preview and these controls can never disagree.

import { el, clear, $, slug, icon } from './util.js';
import {
  state, subscribe, selectedNodes, findNode, getFont, allFonts, getMedia,
  setCanvasBackground, setGroupBackground, setTextColor, setLayerColor, setBgImage, updateNode, updateLayout, updateCanvasSize, setCanvasSizeMode,
  endGesture, setGroupCollapsed, savePreset,
} from './state.js';
import {
  isContainer, isTextType, isFillImage, hasVisibleContent, SIZE_LIMITS, PADDING_LIMITS, RADIUS_LIMITS, MARGIN_LIMITS, OFFSET_LIMITS,
  GROUP_SIZE_LIMITS, SIDES, sides,
} from './blocks.js';
import { groupFamilies } from './fonts.js';
import { layerInfo, mediaUrl } from './svg.js';
import { showOutline, clearOutline } from './outline.js';
import { openColorPicker, openFontPicker, openMediaPicker } from './popover.js';
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
  // A range that goes below 0 (offset x/y) also accepts one leading minus sign.
  const allowMinus = min < 0;
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
    box.addEventListener('input', () => {
      box.value = allowMinus
        ? box.value.replace(/[^\d-]/g, '').replace(/(?!^)-/g, '')   // digits plus one leading "-"
        : box.value.replace(/\D/g, '');                             // digits only
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
// `noneLabel` (optional) adds a "none" row to the picker that calls onPick(null) (group backgrounds can be transparent).
function colorRow({ name, swatch, text, current, drop, outline, title, onPick, onReset, noneLabel }) {
  const btn = el('button', { class: 'prop-row color-btn', dataset: drop, title: title || `${name} ${text}` },
    el('span', { class: 'swatch', style: { background: swatch } }),
    el('span', { class: 'label', text: name }),
    el('span', { class: 'hex', text }));
  btn.addEventListener('click', () => openColorPicker(btn, { current, onPick, noneLabel }));
  btn.addEventListener('mouseenter', () => showOutline(outline));
  btn.addEventListener('mouseleave', clearOutline);
  return el('div', { class: 'color-row' }, btn, onReset ? resetLink(onReset) : null);
}

// The colors of the SELECTED item only: a canvas -> its background; a group -> its background (or none); a text
// block -> its text color; a vector block -> one row per first-level layer. Images have no colors. Each change
// affects just that one thing.
function colorsBody(sel) {
  if (sel.type === 'canvas') {
    return [colorRow({
      name: 'background', swatch: sel.background, text: sel.background, current: sel.background,
      drop: { dropColor: 'canvas', nodeId: sel.id }, outline: { type: 'canvas', canvasId: sel.id },
      onPick: (h) => setCanvasBackground(sel.id, h),
    })];
  }
  if (sel.type === 'group') {
    // null = transparent ("none"). The picker has a "none" row, and reset also means none.
    const bg = sel.background;
    return [colorRow({
      name: 'background', swatch: bg || 'transparent', text: bg || 'none', current: bg,
      drop: { dropColor: 'group', nodeId: sel.id }, outline: { type: 'group', blockId: sel.id },
      noneLabel: 'none (transparent)',
      onPick: (h) => setGroupBackground(sel.id, h),
      onReset: bg ? () => setGroupBackground(sel.id, null) : null,
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

// ---------- Appearance (background image of a board or group) ----------
// One row: a thumbnail, "background image" and the file name. Click it to pick from the library's media; or drop a
// media item from the library on it (data-drop-media, see dragdrop.js). The × link removes it. When set, a "fit"
// toggle (cover | contain) follows. Hovering the row outlines the board/group edge in the preview.
function appearanceBody(node) {
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
  const body = el('div', { class: 'prop-body' }, el('div', { class: 'color-row' }, btn, remove));
  if (bi) {
    body.append(modeRow('fit', [
      ['cover', 'cover', 'fill the whole area (edges may be cut off)'],
      ['contain', 'contain', 'show the whole image'],
    ], bi.fit, (v) => updateNode(node.id, { bgImage: { ...bi, fit: v } })));
  }
  return body;
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
// (never empty or irrelevant). "transform" doesn't exist yet: a later batch adds it in its slot.
//   colors → appearance → text → transform → size → spacing → layout
// Collapse keys are the group names (saved in session.collapsedGroups, shared by every section with that group).
function itemGroups(sel, canvas) {
  const out = [];
  // colors: this item's own colors only (see colorsBody); none for images.
  const colorRows = colorsBody(sel);
  if (colorRows.length) out.push(group('colors', 'colors', el('div', { class: 'prop-body' }, ...colorRows)));
  // appearance: boards and groups (background image).
  if (isContainer(sel)) out.push(group('appearance', 'appearance', appearanceBody(sel)));
  // text: text blocks only (text, font size, font).
  if (isTextType(sel.type)) out.push(group('text', 'text', textBody(sel)));
  // (transform: not built yet)
  // size: a board's fixed/dynamic, radius, width/height; a group's width/height modes and radius; a vector's
  // width; an image's fill toggle and width.
  if (sel.type === 'canvas') out.push(group('size', 'size', canvasSizeBody(sel)));
  if (sel.type === 'group') out.push(group('size', 'size', groupSizeBody(sel)));
  if (sel.type === 'vector' || sel.type === 'image') out.push(group('size', 'size', mediaSizeBody(sel)));
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
