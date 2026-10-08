// properties.js: the properties area below the layers tree (an addition to the CLAUDE.md file list; editor.js
// would have passed ~400 lines). Shows controls for whatever is selected: the canvas's roles and fonts,
// layout, and the selected block's own settings, plus the pinned "save as preset" button.
// Every control calls a state.js function, so the preview and these controls can never disagree.

import { el, clear, $, slug } from './util.js';
import {
  state, subscribe, selectedNode, selectedCanvas, findNode, getFont, getVector,
  setRole, setCanvasFont, updateNode, updateLayout, setLayerColor, endGesture, setGroupCollapsed, savePreset,
} from './state.js';
import { ROLE_NAMES, TEXT_ROLES, isContainer, isTextType, TEXT_TYPES } from './blocks.js';
import { groupFamilies } from './fonts.js';
import { displayLayerName } from './svg.js';
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
  // One line: label, slider, value (keeps the properties area compact).
  return el('div', { class: 'prop-row slider-row' }, el('span', { class: 'label', text: label }), input, val);
}

// A segmented toggle. options: [[value, label]]
function segmented(options, current, onPick) {
  return el('div', { class: 'seg full' }, options.map(([value, label]) => el('button', {
    class: value === current ? 'active' : '', text: label, on: { click: () => onPick(value) },
  })));
}

// Family button + weight/style selector for a font choice. onPick(fontId | null).
function fontControls(currentId, onPick) {
  const font = getFont(currentId);
  const label = font ? font.family : currentId ? 'missing' : 'none';
  const familyBtn = el('button', { class: 'mini-btn font-label', title: 'choose font family', text: `${label} ▾`, on: { click: () => openFontPicker(familyBtn, { currentId, onPick }) } });
  const nodes = [familyBtn];
  if (font) {
    const fam = groupFamilies(state.library.fonts).find((g) => g.family === font.family).fonts;
    const select = el('select', { class: 'mini-select', title: 'weight / style' },
      fam.map((f) => el('option', { value: f.id, text: `${f.weight}${f.style === 'italic' ? ' italic' : ''}` })));
    select.value = font.id;
    select.disabled = fam.length < 2;
    select.addEventListener('change', () => onPick(select.value));
    nodes.push(select);
  }
  return nodes;
}

// A color swatch button that opens the color picker. `hex` may be null (shows "from role").
function colorButton(hex, onPick, emptyLabel = 'from role') {
  const btn = el('button', { class: 'mini-btn', title: 'choose color' },
    hex ? el('span', { class: 'dot', style: { background: hex } }) : null, hex || emptyLabel);
  btn.addEventListener('click', () => openColorPicker(btn, { current: hex, onPick }));
  return btn;
}
const resetLink = (onClick) => el('button', { class: 'reset-link', text: 'reset', on: { click: onClick } });

// ---------- Groups ----------
function rolesBody(canvas) {
  const body = el('div', { class: 'prop-body roles-grid' });
  for (const role of ROLE_NAMES) {
    const hex = canvas.roles[role];
    const btn = el('button', { class: 'prop-row role-btn', dataset: { dropRole: role, canvasId: canvas.id }, title: `${role} ${hex}` },
      el('span', { class: 'swatch', style: { background: hex } }),
      el('span', { class: 'label', text: role }),
      el('span', { class: 'hex', text: hex }));
    btn.addEventListener('click', () => openColorPicker(btn, { current: hex, onPick: (h) => setRole(canvas.id, role, h) }));
    body.append(btn);
  }
  return body;
}

// One row per text role (title, caption...) actually used in this canvas.
function textTypesIn(canvas) {
  const used = new Set();
  const walk = (list) => list.forEach((n) => { if (isTextType(n.type)) used.add(n.type); if (n.children) walk(n.children); });
  walk(canvas.children);
  return TEXT_TYPES.filter((t) => used.has(t));
}
function typeBody(canvas, types) {
  const body = el('div', { class: 'prop-body' });
  types.forEach((type) => {
    const r = row(type, ...fontControls(canvas.fonts[type], (id) => setCanvasFont(canvas.id, type, id)));
    Object.assign(r.dataset, { dropType: type, canvasId: canvas.id });     // a font can be dropped on this row
    body.append(r);
  });
  return body;
}

function layoutBody(target) {
  const l = target.layout;
  // Direction and alignment share one line; the gap slider sits under them.
  return el('div', { class: 'prop-body' },
    el('div', { class: 'split-row' },
      segmented([['stack', 'stack'], ['row', 'row']], l.direction, (v) => updateLayout(target.id, { direction: v })),
      segmented([['start', 'start'], ['center', 'center'], ['end', 'end']], l.align, (v) => updateLayout(target.id, { align: v }))),
    sliderRow('gap', l.gap, 0, 120, 'px', (v) => updateLayout(target.id, { gap: v }, { live: true })));
}

function textBody(block) {
  const text = el('input', { type: 'text', class: 'text-input', placeholder: 'text', spellcheck: false });
  text.value = block.text;
  text.addEventListener('input', () => updateNode(block.id, { text: text.value }, { live: true }));
  text.addEventListener('change', endGesture);
  text.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') text.blur(); });

  // Overrides beat the canvas roles. Each shows a small "reset" link once set.
  const fontOverride = block.fontOverride
    ? [...fontControls(block.fontOverride, (id) => updateNode(block.id, { fontOverride: id })), resetLink(() => updateNode(block.id, { fontOverride: null }))]
    : [colorlessButton('font', (btn) => openFontPicker(btn, { currentId: null, onPick: (id) => updateNode(block.id, { fontOverride: id }), noneLabel: 'use canvas font' }))];
  const colorOverride = block.colorOverride
    ? [colorButton(block.colorOverride, (h) => updateNode(block.id, { colorOverride: h })), resetLink(() => updateNode(block.id, { colorOverride: null }))]
    : [colorButton(null, (h) => updateNode(block.id, { colorOverride: h }), 'color')];

  return el('div', { class: 'prop-body' }, text,
    sliderRow('size', block.size, 8, 200, 'px', (v) => updateNode(block.id, { size: v }, { live: true })),
    segmented(TEXT_ROLES.map((r) => [r, r]), block.colorOverride ? null : block.colorRole, (r) => updateNode(block.id, { colorRole: r, colorOverride: null })),
    el('div', { class: 'prop-row override-row', title: 'overrides beat the canvas roles' },
      el('span', { class: 'label', text: 'override' }), el('div', { class: 'value' }, ...fontOverride, ...colorOverride)));
}

// A plain mini button that gets itself passed to the click handler (used to anchor a popover).
function colorlessButton(label, onClick) {
  const btn = el('button', { class: 'mini-btn', text: `${label} ▾` });
  btn.addEventListener('click', () => onClick(btn));
  return btn;
}

function vectorBody(block) {
  const vec = getVector(block.vectorId);
  const body = el('div', { class: 'prop-body' },
    sliderRow('width', block.width, 20, 360, 'px', (v) => updateNode(block.id, { width: v }, { live: true })));
  if (!vec) { body.append(el('div', { class: 'lib-empty', text: 'no vector: drop one from the library' })); return body; }
  const layers = vec.layers.length ? vec.layers : ['*'];
  layers.forEach((layer) => {
    const override = block.layerOverrides[layer];
    const select = el('select', { class: 'mini-select', title: 'role this layer uses' },
      ROLE_NAMES.map((r) => el('option', { value: r, text: r })));
    select.value = block.layerRoles[layer] || 'primary';
    select.addEventListener('change', () => setLayerColor(block.id, layer, { role: select.value }));
    body.append(row(layer === '*' ? 'whole vector' : displayLayerName(layer), select,
      colorButton(override || null, (h) => setLayerColor(block.id, layer, { hex: h }), 'override'),
      override ? resetLink(() => setLayerColor(block.id, layer, { reset: true })) : null));
  });
  return body;
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
function renderProps() {
  const props = clear($('#props'));
  const sel = selectedNode();
  const canvas = selectedCanvas();
  if (!sel || !canvas) {
    props.append(el('div', { class: 'lib-empty', text: 'select a canvas or a block to edit it' }));
    return;
  }
  props.append(group('roles', 'roles', rolesBody(canvas)));
  const types = textTypesIn(canvas);
  if (types.length) props.append(group('type', 'type', typeBody(canvas, types)));

  // Layout belongs to a container: the selection itself, or the container around the selected block.
  const layoutTarget = isContainer(sel) ? sel : (findNode(sel.id).parent || canvas);
  props.append(group('layout', 'layout', layoutBody(layoutTarget)));

  const specific = blockGroup(sel);
  if (specific) props.append(specific);
}

// The pinned "save as preset" button; turns into a name input when clicked.
function renderPresetFoot() {
  const foot = clear($('#preset-foot'));
  const canvas = selectedCanvas();
  if (!(namingPreset && canvas)) {
    namingPreset = false;
    foot.append(el('button', {
      class: 'dashed-btn', text: 'save as preset ▣', disabled: !canvas,
      title: canvas ? 'save this canvas structure as a preset' : 'select a canvas first',
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
