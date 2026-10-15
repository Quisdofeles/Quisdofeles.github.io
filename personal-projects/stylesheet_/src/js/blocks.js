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
  // A nested container. Added from the library / "+ block" (an EMPTY layout box, see LIBRARY_GROUP below) or made in
  // the layers tree by grouping layers (Ctrl+G; transparent and fit-sized, see groupNodes() in state.js).
  { type: 'group', glyph: '▢', kind: 'container' },
];
// The blocks the user can ADD, in this order, in both the library's blocks section and the editor's "+ block" menu
// (sortBlockTypes() in sorting.js). Edit this list to change what is offered.
export const OFFERED_BLOCKS = ['canvas', 'group', 'vector', 'image', 'heading', 'body'];
// The number shown for "blocks" in the library header AND the status bar: offered blocks + saved presets.
export const libraryBlockCount = (library) => OFFERED_BLOCKS.length + library.presets.length;
export const glyphFor = (type) => (BLOCK_TYPES.find((b) => b.type === type) || { glyph: '·' }).glyph;
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
// DYNAMIC (it shrink-wraps its content plus padding). `canvas.size = { mode, width, height }`, `canvas.padding` =
// px per side (see "Spacing" below). Empty canvases are fixed 160×160 (a dynamic canvas needs content to have a size at all).
export const EMPTY_SIZE = 160;
export const DEFAULT_PADDING = 24;
export const SIZE_LIMITS = { min: 100, max: 1600 };     // width/height slider range
export const PADDING_LIMITS = { min: 0, max: 200 };

// ---------- Spacing ----------
// Canvas `padding` and block `margin` are stored per side: { top, right, bottom, left } (px). `paddingLinked` /
// `marginLinked` = true means the properties show ONE slider that sets all four sides; false shows four sliders.
// Block `offset` = { x, y } (px): a visual nudge (CSS transform), so it never moves neighbours or resizes the canvas.
export const MARGIN_LIMITS = { min: 0, max: 200 };
export const OFFSET_LIMITS = { min: -200, max: 200 };
export const SIDES = ['top', 'right', 'bottom', 'left'];
// The same value on all four sides.
export const sides = (n) => ({ top: n, right: n, bottom: n, left: n });
// Per-side values as a CSS shorthand ("24px 0px 24px 0px"), for padding and margin.
export const sidesCss = (s) => SIDES.map((k) => `${s[k]}px`).join(' ');
// The spacing every new block starts with: no margin (linked), no offset.
const blockSpacing = () => ({ margin: sides(0), marginLinked: true, offset: { x: 0, y: 0 } });
// Corner radius of a canvas (`canvas.radius`, px). 8 = the rounding canvases always had.
export const DEFAULT_RADIUS = 8;
export const RADIUS_LIMITS = { min: 0, max: 120 };
const emptySize = () => ({ mode: 'fixed', width: EMPTY_SIZE, height: EMPTY_SIZE });

// ---------- Groups ----------
// A group's size: each axis has its own mode. `group.size = { widthMode, width, heightMode, height }`.
//   fixed = exactly `width` / `height` px;  fit = shrink-wraps its content plus padding (at least GROUP_EMPTY_MIN
//   when empty, so it stays visible and droppable);  fill = takes the remaining space along its parent's direction
//   (fill siblings share it equally) and stretches across the other axis. Fill needs a parent with a size of its
//   own on that axis: inside a dynamic board or a fit group it behaves like fit, except that an EMPTY group gets
//   EMPTY_SIZE (160px) on that axis instead of the 40px minimum (see preview.js).
export const GROUP_SIZE_MODES = ['fixed', 'fit', 'fill'];
export const GROUP_SIZE_LIMITS = { min: 20, max: 1600 };
export const GROUP_EMPTY_MIN = 40;
// A group from the library or "+ block": a visible empty layout box (a bit darker than a board, so it shows).
export const GROUP_BACKGROUND = '#D9D9DB';
const LIBRARY_GROUP = () => ({
  background: GROUP_BACKGROUND,
  bgImage: null,
  size: { widthMode: 'fill', width: EMPTY_SIZE, heightMode: 'fixed', height: EMPTY_SIZE },
  padding: sides(16), paddingLinked: true,
  radius: DEFAULT_RADIUS,
  layout: { direction: 'stack', gap: 16, align: 'center' },
  children: [],
});
// A group made by grouping layers in the tree (Ctrl+G): no background, fit × fit, no padding, square corners, so
// grouping never changes how things look. groupNodes() in state.js passes the parent's layout on top of this.
export const groupingDefaults = () => ({
  background: null,
  bgImage: null,
  size: { widthMode: 'fit', width: EMPTY_SIZE, heightMode: 'fit', height: EMPTY_SIZE },
  padding: sides(0), paddingLinked: true,
  radius: 0,
});
// True when a group clips its content (like a board): only a fit × fit group never clips, so Ctrl+G groups don't.
export const groupClips = (g) => !(g.size.widthMode === 'fit' && g.size.heightMode === 'fit');

// ---------- Background images (boards and groups) ----------
// `bgImage = null | { mediaId, fit: 'cover' | 'contain' }`. It is drawn above the background color and below the
// content, clipped to the corner radius. mediaId null (a preset slot, or a deleted media item) = a gray placeholder.
export const BG_IMAGE_FITS = ['cover', 'contain'];
// An image block with `fill: true` covers its parent (group or board) edge to edge instead of sitting in the flow.
export const isFillImage = (node) => node.type === 'image' && !!node.fill;

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

// True if a canvas (or group) has something that gives it a size: any visible block in the flow. A visible group
// counts even when empty (it is at least 40×40). A fill image doesn't count: it covers its parent instead of
// giving it a size. A dynamic canvas needs this (an empty one would have no size), see fixEmptyDynamicCanvases() in state.js.
export function hasVisibleContent(container) {
  return (container.children || []).some((n) => !n.hidden && !isFillImage(n));
}

// ---------- Factories ----------
// Default layout for a container.
const defaultLayout = () => ({ direction: 'stack', gap: 24, align: 'center' });

// Creates a new block of any non-canvas type (every block gets margin + offset). `extra` overrides defaults.
export function createBlock(type, extra = {}) {
  const base = { id: uid('b'), type, name: type, hidden: false, ...blockSpacing() };
  if (isTextType(type)) {
    const d = TEXT_DEFAULTS[type];
    // `font` = the block's OWN font (a library font id or a built-in one); new text starts in Space Grotesk.
    Object.assign(base, { text: type, size: d.size, color: DEFAULT_TEXT_COLOR, font: DEFAULT_FONT_ID });
  } else if (type === 'vector') {
    // layerColors: { "<first-level layer index>": hex }. A layer with no entry keeps its original colors.
    Object.assign(base, { mediaId: null, width: 120, layerColors: {} });
  } else if (type === 'image') {
    // fill: true = covers its parent edge to edge, behind the parent's other content (the width is then unused).
    Object.assign(base, { mediaId: null, width: 120, fill: false });
  } else if (type === 'group') {
    // The library group by default; groupNodes() overrides it with groupingDefaults() for Ctrl+G groups.
    Object.assign(base, LIBRARY_GROUP());
  }
  return Object.assign(base, extra);
}

// Creates a new empty canvas: fixed 160×160, padding 24 on every side (linked), radius 8 (pass `size` in `extra`
// for a canvas that starts with content). Canvases have no margin or offset.
export function createCanvas(extra = {}) {
  return {
    id: uid('cv'),
    type: 'canvas',
    name: `${BASE_NAME} 1`,
    background: DEFAULT_BACKGROUND,
    bgImage: null,                 // optional background image (see "Background images" above)
    layout: defaultLayout(),
    size: emptySize(),
    padding: sides(DEFAULT_PADDING),
    paddingLinked: true,
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
// A preset keeps block types, order, nesting, names, sizes, layout and spacing (margin, its linked state, offset),
// and drops every color, font, media reference and text. Groups also keep their size modes, padding and radius;
// image blocks keep `fill`. A background image only keeps its fit: it comes back as an empty (gray) slot.
function nodeToStructure(node) {
  const s = { type: node.type, name: node.name, margin: { ...node.margin }, marginLinked: node.marginLinked, offset: { ...node.offset } };
  if (isTextType(node.type)) s.size = node.size;
  if (node.type === 'vector' || node.type === 'image') s.width = node.width;
  if (node.type === 'image') s.fill = !!node.fill;
  if (node.type === 'group') {
    Object.assign(s, {
      groupSize: { ...node.size }, padding: { ...node.padding }, paddingLinked: node.paddingLinked, radius: node.radius,
      bgImage: emptyBgImage(node.bgImage),
    });
  }
  if (node.layout) s.layout = { ...node.layout };
  if (node.children) s.children = node.children.map(nodeToStructure);
  return s;
}
// A background image without its media (structure only): the slot and its fit, or null when there was none.
const emptyBgImage = (bi) => (bi ? { mediaId: null, fit: bi.fit } : null);

// The canvas's size settings (mode, width, height), padding (+ linked state) and corner radius are structure too,
// so a preset keeps them.
export function structureFromCanvas(canvas) {
  return {
    name: canvas.name, size: { ...canvas.size }, padding: { ...canvas.padding }, paddingLinked: canvas.paddingLinked,
    radius: canvas.radius, bgImage: emptyBgImage(canvas.bgImage), layout: { ...canvas.layout }, children: canvas.children.map(nodeToStructure),
  };
}

function structureToNode(s) {
  const extra = { name: s.name };
  if (isTextType(s.type)) extra.size = s.size;      // text and font come from createBlock: the type name, in Space Grotesk
  if (s.width) extra.width = s.width;
  if (s.type === 'image') extra.fill = !!s.fill;
  if (s.type === 'group') {
    // Every preset group comes back with the library group's gray background (Robert's choice), and its own
    // size modes, padding, radius and (empty) background image slot.
    Object.assign(extra, {
      background: GROUP_BACKGROUND, size: { ...s.groupSize }, padding: { ...s.padding }, paddingLinked: s.paddingLinked !== false,
      radius: s.radius, bgImage: s.bgImage ? { ...s.bgImage } : null,
    });
  }
  if (s.layout) extra.layout = { ...s.layout };
  if (s.margin) Object.assign(extra, { margin: { ...s.margin }, marginLinked: s.marginLinked !== false });
  if (s.offset) extra.offset = { ...s.offset };
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
    padding: structure.padding ? { ...structure.padding } : sides(DEFAULT_PADDING),
    paddingLinked: structure.paddingLinked !== false,
    radius: structure.radius ?? DEFAULT_RADIUS,
    bgImage: structure.bgImage ? { ...structure.bgImage } : null,   // an empty (gray) slot, never the old media
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
