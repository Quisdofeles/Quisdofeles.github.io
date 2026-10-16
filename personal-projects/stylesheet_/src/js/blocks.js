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
  // A bar of color sections (copies of a library palette's colors, or 3 grays). See "Palette block" below.
  { type: 'palette', glyph: '▤', kind: 'color' },
];
// The blocks the user can ADD, in this order, in both the library's blocks section and the editor's "+ block" menu
// (sortBlockTypes() in sorting.js). Edit this list to change what is offered.
export const OFFERED_BLOCKS = ['canvas', 'group', 'vector', 'image', 'heading', 'body', 'palette'];
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

// ---------- Opacity ----------
// Every block (not boards) has `opacity`: 0–100 (%), default 100. It fades the whole block, children included.
export const OPACITY_LIMITS = { min: 0, max: 100 };
// A block's opacity, with 100 for a block that has none stored.
export const opacityOf = (node) => (typeof node.opacity === 'number' ? node.opacity : 100);

// ---------- Transform (content blocks: text, vector, image, palette) ----------
// `rotation` (degrees, −180–180, default 0), `mirrorX` (flip left↔right) and `mirrorY` (flip top↔bottom). Like the
// offset, it is a CSS transform: purely visual, so the layout around the block never changes. Groups don't have it.
export const ROTATION_LIMITS = { min: -180, max: 180 };
export const hasTransform = (node) => isTextType(node.type) || node.type === 'vector' || node.type === 'image' || node.type === 'palette';
const transformDefaults = () => ({ rotation: 0, mirrorX: false, mirrorY: false });
// The CSS transform of a block: its offset, then its rotation (around its center), then its mirror. '' = none.
export function blockTransform(node) {
  const parts = [];
  const o = node.offset || { x: 0, y: 0 };
  if (o.x || o.y) parts.push(`translate(${o.x}px, ${o.y}px)`);
  if (node.rotation) parts.push(`rotate(${node.rotation}deg)`);
  if (node.mirrorX || node.mirrorY) parts.push(`scale(${node.mirrorX ? -1 : 1}, ${node.mirrorY ? -1 : 1})`);
  return parts.join(' ');
}

// ---------- Text styling (text blocks) ----------
// tracking: thousandths of an em (like Illustrator), −200–1000; lineHeight: a multiplier, 0.8–3.0; textAlign: the
// lines inside the block (left | center | right); textCase: none | upper | lower | title (display only: the stored
// text keeps what was typed); underline; wrap: 'fit' (one line per line break, never wraps) or 'fixed' (wraps inside
// wrapWidth px, 40–1600).
export const TRACKING_LIMITS = { min: -200, max: 1000 };
export const LINE_HEIGHT_LIMITS = { min: 0.8, max: 3 };
export const WRAP_WIDTH_LIMITS = { min: 40, max: 1600 };
const textStyleDefaults = () => ({
  tracking: 0, lineHeight: 1.2, textAlign: 'left', textCase: 'none', underline: false, wrap: 'fit', wrapWidth: 320,
});
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
// `made` remembers how a group was created ('library' | 'grouping'), so a preset can give it back the right default
// background (library: GROUP_BACKGROUND; Ctrl+G: none).
const LIBRARY_GROUP = () => ({
  made: 'library',
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
  made: 'grouping',
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

// ---------- Palette block ----------
// A bar of equal color sections: `sections = [{ hex, name }]` (name = the library color's name when the color came
// from the library, else null), `width` × `height` px, `orientation` 'horizontal' | 'vertical', corner `radius`,
// and two label toggles: `hexLabels` (each section's hex, on by default) and `names` (its name, off by default).
// Its colors are COPIES: editing the library palette later never changes the block.
export const PALETTE_GRAYS = ['#D9D9DB', '#9A9AA2', '#5A5A60'];   // a new palette block from "+ block" / the block card
export const SECTION_GRAY = '#888888';                             // a section added with "+ add section"
export const PALETTE_WIDTH_LIMITS = { min: 40, max: 1600 };
export const PALETTE_HEIGHT_LIMITS = { min: 20, max: 800 };
const grays = (count) => Array.from({ length: count }, (_, i) => ({ hex: PALETTE_GRAYS[i % PALETTE_GRAYS.length], name: null }));

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

// Creates a new block of any non-canvas type (every block gets margin + offset and opacity 100). `extra` overrides defaults.
export function createBlock(type, extra = {}) {
  const base = { id: uid('b'), type, name: type, hidden: false, opacity: 100, ...blockSpacing() };
  if (hasTransform(base)) Object.assign(base, transformDefaults());   // rotation + mirror (content blocks only)
  if (isTextType(type)) {
    const d = TEXT_DEFAULTS[type];
    // `font` = the block's OWN font (a library font id or a built-in one); new text starts in Space Grotesk.
    Object.assign(base, { text: type, size: d.size, color: DEFAULT_TEXT_COLOR, font: DEFAULT_FONT_ID, ...textStyleDefaults() });
  } else if (type === 'vector') {
    // layerColors: { "<first-level layer index>": hex }. A layer with no entry keeps its original colors.
    Object.assign(base, { mediaId: null, width: 120, layerColors: {} });
  } else if (type === 'image') {
    // fill: true = covers its parent edge to edge, behind the parent's other content (the width is then unused).
    Object.assign(base, { mediaId: null, width: 120, fill: false });
  } else if (type === 'group') {
    // The library group by default; groupNodes() overrides it with groupingDefaults() for Ctrl+G groups.
    Object.assign(base, LIBRARY_GROUP());
  } else if (type === 'palette') {
    // Three neutral grays; a palette dropped from the library passes its own `sections` in `extra`.
    Object.assign(base, {
      sections: grays(PALETTE_GRAYS.length), width: 320, height: 64, orientation: 'horizontal',
      radius: DEFAULT_RADIUS, hexLabels: true, names: false,
    });
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
// A preset keeps ALL block-level structure and NO content. It starts from a full copy of each block and removes
// only the content fields (CONTENT_FIELDS below), so every structural setting is kept automatically: types, nesting,
// names, hidden, layout, sizing modes and sizes, spacing (padding, margin, offsets, linked states), radius, opacity,
// rotation/mirror, text size / tracking / line height / alignment / case / underline / wrap, palette orientation and
// label toggles, image fill, a group's `made`.
// Content goes back to the defaults when the preset is used (structureToNode): every color (text black, library
// groups #D9D9DB, Ctrl+G groups none; any alpha is gone with the color), fonts (Space Grotesk 700), text (the type
// name), media (gray placeholders), background images (an empty gray slot that keeps its fit) and palette section
// colors (neutral grays; only the NUMBER of sections is kept).
const CONTENT_FIELDS = ['id', 'text', 'font', 'color', 'background', 'mediaId', 'layerColors', 'sections'];
function nodeToStructure(node) {
  const s = clone(node);
  for (const key of CONTENT_FIELDS) delete s[key];
  if (node.type === 'palette') s.sectionCount = node.sections.length;
  if (node.bgImage !== undefined) s.bgImage = emptyBgImage(node.bgImage);
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

// A block from its structure: createBlock() gives it a fresh id and the DEFAULT content (type-name text in Space
// Grotesk 700, black; no media; no layer colors), then every saved structural field is laid on top. Only the content
// that depends on the kind of block is filled in here.
function structureToNode(s) {
  const { children, sectionCount, ...fields } = clone(s);
  if (s.type === 'group') fields.background = s.made === 'grouping' ? null : GROUP_BACKGROUND;   // how the group was made decides its default
  if (s.type === 'palette') fields.sections = grays(Math.max(1, sectionCount || PALETTE_GRAYS.length));   // same number of sections, all gray
  const block = createBlock(s.type, fields);
  if (children) block.children = children.map(structureToNode);
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
  // A few of the app's own UI colors (the --panel, --card, --line, --line-2 and --accent tokens in tokens.css),
  // named as colors, darkest first.
  { name: 'stylesheet_', colors: [
    { name: 'ink_black', hex: '#0F0F11' },
    { name: 'charcoal', hex: '#141417' },
    { name: 'graphite', hex: '#26262B' },
    { name: 'slate_grey', hex: '#33333A' },
    { name: 'lime_green', hex: '#D9FF43' },
  ] },
];
