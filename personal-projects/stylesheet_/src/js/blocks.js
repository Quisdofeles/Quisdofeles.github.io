// blocks.js: block type definitions, factory functions, default values, and the starter colors/palettes used on
// first launch.
// Pure data + functions: this file never touches the DOM or the state object.
//
// UI SAYS "BOARD", CODE SAYS "CANVAS": the user sees "board" everywhere, but the node type stays 'canvas'
// (session.canvases, createCanvas(), .canvas CSS classes...). typeLabel() below turns a type into its visible name.

import { uid, clone } from './util.js';
import { DEFAULT_FONT_ID } from './fonts.js';

// ---------- Constants ----------
// Every block type the app can render and edit. `glyph` is the small lime icon; `kind` is the muted second line on
// its library card ("text", "media", "container", ...). Not all of them are OFFERED (see OFFERED_BLOCKS below):
// title, subheading and caption are still real types (they render and edit), they just aren't offered.
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
// real node type (presets and the preview use them), so it keeps its icon here.
const GROUP_GLYPH = '▢';
// The blocks the user can ADD, in this order, in both the library's blocks section and the editor's "+ block" menu
// (sortBlockTypes() in sorting.js). Edit this list to change what is offered.
export const OFFERED_BLOCKS = ['canvas', 'vector', 'image', 'heading', 'body', 'spacer'];
// The number shown for "blocks" in the library header AND the status bar: offered blocks + saved presets.
export const libraryBlockCount = (library) => OFFERED_BLOCKS.length + library.presets.length;
export const glyphFor = (type) => (type === 'group' ? GROUP_GLYPH : (BLOCK_TYPES.find((b) => b.type === type) || { glyph: '·' }).glyph);
// The name the user SEES for a block type: the 'canvas' type is shown as "board"; every other type shows as itself.
// Used by the library cards, the "+ block" menu, the layers tree tags and the library search.
export const typeLabel = (type) => (type === 'canvas' ? 'board' : type);

export const TEXT_TYPES = ['title', 'heading', 'subheading', 'body', 'caption'];
// Colors are stored directly on the thing they paint (no roles): a canvas has `background`, a text block has `color`,
// a vector block has `layerColors`. New canvases are light gray (#EDEDEE, the app's --text color) and new text is black.
// Every way a canvas is made goes through createCanvas() below, so they all start with this background.
export const DEFAULT_BACKGROUND = '#EDEDEE';
export const DEFAULT_TEXT_COLOR = '#000000';
export const BASE_NAME = 'Board';         // canvases are auto-named "Board 1", "Board 2"... (first free number, see state.js)

// Canvas size. A canvas is either FIXED (the user sets width × height, content that doesn't fit is clipped) or
// DYNAMIC (it shrink-wraps its content plus padding). `canvas.size = { mode, width, height }`, `canvas.padding` = px
// on all four sides. Empty canvases are fixed 160×160 (a dynamic canvas needs content to have a size at all).
export const EMPTY_SIZE = 160;
export const DEFAULT_PADDING = 24;
export const SIZE_LIMITS = { min: 100, max: 1600 };     // width/height slider range
export const PADDING_LIMITS = { min: 0, max: 200 };
// Corner radius of a canvas (`canvas.radius`, px). 8 = the rounding canvases always had.
export const DEFAULT_RADIUS = 8;
export const RADIUS_LIMITS = { min: 0, max: 120 };
const emptySize = () => ({ mode: 'fixed', width: EMPTY_SIZE, height: EMPTY_SIZE });

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

// True if a canvas (or group) shows anything: a visible block, or a visible group that itself shows something.
// A dynamic canvas needs this (an empty one would have no size), see fixEmptyDynamicCanvases() in state.js.
export function hasVisibleContent(container) {
  return (container.children || []).some((n) => !n.hidden && (n.type !== 'group' || hasVisibleContent(n)));
}

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

// Creates a new empty canvas: fixed 160×160, padding 24, radius 8 (pass `size` in `extra` for a canvas that starts with content).
export function createCanvas(extra = {}) {
  return {
    id: uid('cv'),
    type: 'canvas',
    name: `${BASE_NAME} 1`,
    background: DEFAULT_BACKGROUND,
    layout: defaultLayout(),
    size: emptySize(),
    padding: DEFAULT_PADDING,
    radius: DEFAULT_RADIUS,
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

// The canvas's size settings (mode, width, height, padding) and corner radius are structure too, so a preset keeps them.
export function structureFromCanvas(canvas) {
  return {
    name: canvas.name, size: { ...canvas.size }, padding: canvas.padding, radius: canvas.radius,
    layout: { ...canvas.layout }, children: canvas.children.map(nodeToStructure),
  };
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
// Size, padding and radius come from the preset (a structure without them would be dynamic, padding 24, radius 8).
export function canvasFromStructure(structure, name) {
  return createCanvas({
    name,
    size: structure.size ? { ...structure.size } : { mode: 'dynamic', width: EMPTY_SIZE, height: EMPTY_SIZE },
    padding: structure.padding ?? DEFAULT_PADDING,
    radius: structure.radius ?? DEFAULT_RADIUS,
    layout: { ...structure.layout },
    children: structure.children.map(structureToNode),
  });
}

// ---------- Starter content for first launch ----------
// What a brand-new library starts with (only used when there is no library.json yet). The default media files are
// in src/defaults/media/ and are copied in by app.js on first launch.
export const STARTER_COLORS = [
  { name: 'pure_black', hex: '#000000' },
  { name: 'pure_white', hex: '#FFFFFF' },
  { name: 'pure_red', hex: '#FF0000' },      // the same red as the "defaults" palette
  { name: 'neon_lime', hex: '#D9FF43' },
];
// Each palette lists its own colors (name + hex), in the order they appear in the palette.
export const STARTER_PALETTES = [
  { name: 'defaults', colors: [
    { name: 'white', hex: '#FFFFFF' },
    { name: 'black', hex: '#000000' },
    { name: 'red', hex: '#FF0000' },
  ] },
  // A few of the app's own UI colors, named after their tokens in tokens.css.
  { name: 'stylesheet_', colors: [
    { name: 'panel', hex: '#0F0F11' },
    { name: 'card', hex: '#141417' },
    { name: 'line', hex: '#26262B' },
    { name: 'line_2', hex: '#33333A' },
    { name: 'accent', hex: '#D9FF43' },
  ] },
];
