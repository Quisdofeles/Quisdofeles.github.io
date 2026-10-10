// blocks.js: block type definitions, factory functions, default values, the default presets,
// and the starter colors/palettes used on first launch.
// Pure data + functions: this file never touches the DOM or the state object.

import { uid, clone } from './util.js';
import { DEFAULT_FONT_ID } from './fonts.js';

// ---------- Constants ----------
// The block types. `glyph` is the small lime icon; `kind` is the muted second line on its library card
// ("text", "media", "container", ...). (The order blocks appear in the LIBRARY panel is separate: see
// BLOCK_ORDER in sorting.js. This order is used by the editor's "+ block" menu.)
export const BLOCK_TYPES = [
  { type: 'title', glyph: 'T', kind: 'text' },
  { type: 'heading', glyph: 'T', kind: 'text' },
  { type: 'subheading', glyph: 't', kind: 'text' },
  { type: 'body', glyph: '¶', kind: 'text' },
  { type: 'caption', glyph: 't', kind: 'text' },
  { type: 'vector', glyph: '◇', kind: 'media' },
  { type: 'image', glyph: '▨', kind: 'media' },
  { type: 'canvas', glyph: '▣', kind: 'container' },
  { type: 'spacer', glyph: '↕', kind: 'layout' },
];
// "group" is NOT in the list above on purpose: it can't be created from the library or the "+ block" menu. Groups are
// made in the layers tree (select layers, right-click -> group; see groupNodes() in state.js), but they are still a
// real node type (presets, old saves and the preview use them), so it keeps its icon here.
const GROUP_GLYPH = '▢';
// The number shown for "blocks" in the library header AND the status bar: default blocks + saved presets.
export const libraryBlockCount = (library) => BLOCK_TYPES.length + library.presets.length;
export const glyphFor = (type) => (type === 'group' ? GROUP_GLYPH : (BLOCK_TYPES.find((b) => b.type === type) || { glyph: '·' }).glyph);

export const TEXT_TYPES = ['title', 'heading', 'subheading', 'body', 'caption'];
// Colors are stored directly on the thing they paint (no roles): a canvas has `background`, a text block has `color`,
// a vector block has `layerColors`. New canvases are white and new text is black.
export const DEFAULT_BACKGROUND = '#FFFFFF';
export const DEFAULT_TEXT_COLOR = '#000000';
export const DEFAULT_ASPECT = 8 / 9;      // canvas width / height; matches the mockup's slightly tall canvases
export const BASE_NAME = 'lockup';        // canvases are auto-named lockup_A, lockup_B ...

// New text starts as its own type name ("title", "heading"...): a real, editable text value, not a placeholder.
const TEXT_DEFAULTS = {
  title: { size: 32 },
  heading: { size: 24 },
  subheading: { size: 18 },
  body: { size: 14 },
  caption: { size: 12 },
};

export const isTextType = (type) => TEXT_TYPES.includes(type);
export const isContainer = (node) => node.type === 'canvas' || node.type === 'group';

// ---------- Factories ----------
// Default layout for a container.
const defaultLayout = () => ({ direction: 'stack', gap: 24, align: 'center' });

// Creates a new block of any non-canvas type. `extra` overrides defaults.
export function createBlock(type, extra = {}) {
  const base = { id: uid('b'), type, name: type, hidden: false };
  if (isTextType(type)) {
    const d = TEXT_DEFAULTS[type];
    // `font` = the block's OWN font (a library font id or a built-in one); new text starts in Space Grotesk.
    Object.assign(base, { text: type, size: d.size, color: DEFAULT_TEXT_COLOR, font: DEFAULT_FONT_ID });
  } else if (type === 'vector') {
    // layerColors: { "<first-level layer index>": hex }. A layer with no entry keeps its original colors.
    Object.assign(base, { mediaId: null, width: 120, layerColors: {} });
  } else if (type === 'image') {
    Object.assign(base, { mediaId: null, width: 120 });
  } else if (type === 'spacer') {
    Object.assign(base, { size: 24 });
  } else if (type === 'group') {
    Object.assign(base, { layout: { ...defaultLayout(), gap: 8 }, children: [] });
  }
  return Object.assign(base, extra);
}

// Creates a new empty canvas.
export function createCanvas(extra = {}) {
  return {
    id: uid('cv'),
    type: 'canvas',
    name: `${BASE_NAME}_A`,
    background: DEFAULT_BACKGROUND,
    layout: defaultLayout(),
    aspect: DEFAULT_ASPECT,
    hidden: false,
    children: [],
    ...extra,
  };
}

// Deep-copies a node and gives it and every descendant a fresh id (used by duplicate and presets).
export function cloneWithNewIds(node) {
  const copy = clone(node);
  const walk = (n) => { n.id = uid(n.type === 'canvas' ? 'cv' : 'b'); (n.children || []).forEach(walk); };
  walk(copy);
  return copy;
}

// ---------- Presets: structure only ----------
// A preset keeps block types, order, nesting, names, sizes and layout,
// and drops every color, font, media reference and text.
function nodeToStructure(node) {
  const s = { type: node.type, name: node.name };
  if (isTextType(node.type)) s.size = node.size;
  if (node.type === 'vector' || node.type === 'image') s.width = node.width;
  if (node.type === 'spacer') s.size = node.size;
  if (node.layout) s.layout = { ...node.layout };
  if (node.children) s.children = node.children.map(nodeToStructure);
  return s;
}

export function structureFromCanvas(canvas) {
  return { name: canvas.name, aspect: canvas.aspect || DEFAULT_ASPECT, layout: { ...canvas.layout }, children: canvas.children.map(nodeToStructure) };
}

function structureToNode(s) {
  const extra = { name: s.name };
  if (isTextType(s.type)) extra.size = s.size;      // text and font come from createBlock: the type name, in Space Grotesk
  if (s.width) extra.width = s.width;
  if (s.type === 'spacer') extra.size = s.size;
  if (s.layout) extra.layout = { ...s.layout };
  const block = createBlock(s.type, extra);
  if (s.children) block.children = s.children.map(structureToNode);
  return block;
}

// Builds a fresh canvas from a preset structure: default colors, default font, placeholder-named text, gray media slots.
export function canvasFromStructure(structure, name) {
  return createCanvas({
    name,
    aspect: structure.aspect || DEFAULT_ASPECT,
    layout: { ...structure.layout },
    children: structure.children.map(structureToNode),
  });
}

// ---------- Default presets (shipped with the installer) ----------
const stack = (gap, align = 'center') => ({ direction: 'stack', gap, align });
const row = (gap, align = 'center') => ({ direction: 'row', gap, align });

export const DEFAULT_PRESETS = [
  {
    id: 'preset_symmetrical_logo', name: 'symmetrical_logo',
    structure: { name: 'symmetrical_logo', aspect: DEFAULT_ASPECT, layout: stack(24), children: [
      { type: 'vector', name: 'vector', width: 120 },
      { type: 'title', name: 'title', size: 32 },
      { type: 'caption', name: 'caption', size: 12 },
    ] },
  },
  {
    id: 'preset_horizontal_lockup', name: 'horizontal_lockup',
    structure: { name: 'horizontal_lockup', aspect: DEFAULT_ASPECT, layout: row(18), children: [
      { type: 'vector', name: 'vector', width: 90 },
      { type: 'group', name: 'text', layout: stack(4, 'start'), children: [
        { type: 'title', name: 'title', size: 24 },
        { type: 'caption', name: 'caption', size: 11 },
      ] },
    ] },
  },
  {
    id: 'preset_type_hierarchy', name: 'type_hierarchy',
    structure: { name: 'type_hierarchy', aspect: DEFAULT_ASPECT, layout: stack(12, 'start'), children: [
      { type: 'title', name: 'title', size: 32 },
      { type: 'heading', name: 'heading', size: 24 },
      { type: 'subheading', name: 'subheading', size: 18 },
      { type: 'body', name: 'body', size: 14 },
      { type: 'caption', name: 'caption', size: 12 },
    ] },
  },
  {
    id: 'preset_business_card', name: 'business_card',
    structure: { name: 'business_card', aspect: 1.75, layout: row(16), children: [
      { type: 'vector', name: 'vector', width: 70 },
      { type: 'group', name: 'details', layout: stack(4, 'start'), children: [
        { type: 'title', name: 'title', size: 22 },
        { type: 'caption', name: 'caption', size: 10 },
        { type: 'body', name: 'body', size: 10 },
      ] },
    ] },
  },
  {
    id: 'preset_social_post', name: 'social_post',
    structure: { name: 'social_post', aspect: 0.8, layout: stack(18), children: [
      { type: 'vector', name: 'vector', width: 90 },
      { type: 'title', name: 'title', size: 34 },
      { type: 'body', name: 'body', size: 14 },
      { type: 'caption', name: 'caption', size: 11 },
    ] },
  },
];

// ---------- Starter content for first launch ----------
// A few colors + two palettes so the app isn't blank. (Names match the mockup.)
export const STARTER_COLORS = [
  { name: 'ink', hex: '#1B1B1B' },
  { name: 'paper', hex: '#F3F0E8' },
  { name: 'signal_orange', hex: '#E4572E' },
  { name: 'harbor_blue', hex: '#2E86AB' },
  { name: 'midnight', hex: '#0D1B2A' },
  { name: 'sun_gold', hex: '#F2B134' },
  { name: 'forest', hex: '#2F5D46' },
  { name: 'slate', hex: '#5B7684' },
];
export const STARTER_PALETTES = [
  { name: 'warm_signal', colors: ['paper', 'ink', 'signal_orange', 'harbor_blue'] },
  { name: 'night_harbor', colors: ['midnight', 'paper', 'sun_gold', 'slate', 'harbor_blue', 'forest'] },
];
