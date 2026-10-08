// blocks.js: block type definitions, factory functions, default values, the default presets,
// and the starter colors/palettes used on first launch.
// Pure data + functions: this file never touches the DOM or the state object.

import { uid, clone } from './util.js';

// ---------- Constants ----------
// The library's "blocks" list, in the order from CLAUDE.md. `glyph` is the small lime icon.
export const BLOCK_TYPES = [
  { type: 'title', glyph: 'T' },
  { type: 'heading', glyph: 'T' },
  { type: 'subheading', glyph: 't' },
  { type: 'body', glyph: '¶' },
  { type: 'caption', glyph: 't' },
  { type: 'vector', glyph: '◇' },
  { type: 'image', glyph: '▨' },
  { type: 'swatch', glyph: '▤' },
  { type: 'canvas', glyph: '▣' },
  { type: 'spacer', glyph: '↕' },
  { type: 'group', glyph: '▢' },
];
export const glyphFor = (type) => (BLOCK_TYPES.find((b) => b.type === type) || { glyph: '·' }).glyph;

export const TEXT_TYPES = ['title', 'heading', 'subheading', 'body', 'caption'];
export const ROLE_NAMES = ['background', 'primary', 'secondary', 'accent'];
export const TEXT_ROLES = ['primary', 'secondary', 'accent'];   // roles a text block may use (not the background)

export const DEFAULT_ROLES = { background: '#F3F0E8', primary: '#1B1B1B', secondary: '#E4572E', accent: '#2E86AB' };
export const DEFAULT_ASPECT = 8 / 9;      // canvas width / height; matches the mockup's slightly tall canvases
export const BASE_NAME = 'lockup';        // canvases are auto-named lockup_A, lockup_B ...

const TEXT_DEFAULTS = {
  title: { size: 32, text: 'Your Title' },
  heading: { size: 24, text: 'Heading' },
  subheading: { size: 18, text: 'Subheading' },
  body: { size: 14, text: 'Body text goes here' },
  caption: { size: 12, text: 'Caption' },
};

export const isTextType = (type) => TEXT_TYPES.includes(type);
export const isContainer = (node) => node.type === 'canvas' || node.type === 'group';

// ---------- Factories ----------
// Default layout for a container.
const defaultLayout = () => ({ direction: 'stack', gap: 24, align: 'center' });

// Which role each named layer uses by default: cycles primary, secondary, accent.
// A vector with no named layers is colored as one piece, stored under the key '*'.
export function defaultLayerRoles(layers = []) {
  if (!layers.length) return { '*': 'primary' };
  const roles = {};
  layers.forEach((name, i) => { roles[name] = TEXT_ROLES[i % TEXT_ROLES.length]; });
  return roles;
}

// Creates a new block of any non-canvas type. `extra` overrides defaults.
export function createBlock(type, extra = {}) {
  const base = { id: uid('b'), type, name: type, hidden: false };
  if (isTextType(type)) {
    const d = TEXT_DEFAULTS[type];
    Object.assign(base, { text: d.text, size: d.size, colorRole: 'primary', fontOverride: null, colorOverride: null });
  } else if (type === 'vector') {
    Object.assign(base, { vectorId: null, width: 120, layerRoles: {}, layerOverrides: {} });
  } else if (type === 'image') {
    Object.assign(base, { vectorId: null, width: 120 });
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
    roles: { ...DEFAULT_ROLES },
    fonts: { title: null, heading: null, subheading: null, body: null, caption: null },   // library font ids
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
// A preset keeps block types, order, nesting, names, sizes, layout and role pointers,
// and drops every hex value, font, vector reference and text override.
function nodeToStructure(node) {
  const s = { type: node.type, name: node.name };
  if (isTextType(node.type)) { s.size = node.size; s.colorRole = node.colorRole; }
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
  if (isTextType(s.type)) Object.assign(extra, { size: s.size, colorRole: s.colorRole || 'primary', text: '' });   // empty text -> gray placeholder
  if (s.width) extra.width = s.width;
  if (s.type === 'spacer') extra.size = s.size;
  if (s.layout) extra.layout = { ...s.layout };
  const block = createBlock(s.type, extra);
  if (s.children) block.children = s.children.map(structureToNode);
  return block;
}

// Builds a fresh canvas from a preset structure: default roles, no fonts, empty slots (gray placeholders).
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
      { type: 'title', name: 'title', size: 32, colorRole: 'primary' },
      { type: 'caption', name: 'caption', size: 12, colorRole: 'primary' },
    ] },
  },
  {
    id: 'preset_horizontal_lockup', name: 'horizontal_lockup',
    structure: { name: 'horizontal_lockup', aspect: DEFAULT_ASPECT, layout: row(18), children: [
      { type: 'vector', name: 'vector', width: 90 },
      { type: 'group', name: 'text', layout: stack(4, 'start'), children: [
        { type: 'title', name: 'title', size: 24, colorRole: 'primary' },
        { type: 'caption', name: 'caption', size: 11, colorRole: 'primary' },
      ] },
    ] },
  },
  {
    id: 'preset_type_hierarchy', name: 'type_hierarchy',
    structure: { name: 'type_hierarchy', aspect: DEFAULT_ASPECT, layout: stack(12, 'start'), children: [
      { type: 'title', name: 'title', size: 32, colorRole: 'primary' },
      { type: 'heading', name: 'heading', size: 24, colorRole: 'primary' },
      { type: 'subheading', name: 'subheading', size: 18, colorRole: 'secondary' },
      { type: 'body', name: 'body', size: 14, colorRole: 'primary' },
      { type: 'caption', name: 'caption', size: 12, colorRole: 'accent' },
    ] },
  },
  {
    id: 'preset_business_card', name: 'business_card',
    structure: { name: 'business_card', aspect: 1.75, layout: row(16), children: [
      { type: 'vector', name: 'vector', width: 70 },
      { type: 'group', name: 'details', layout: stack(4, 'start'), children: [
        { type: 'title', name: 'title', size: 22, colorRole: 'primary' },
        { type: 'caption', name: 'caption', size: 10, colorRole: 'secondary' },
        { type: 'body', name: 'body', size: 10, colorRole: 'primary' },
      ] },
    ] },
  },
  {
    id: 'preset_social_post', name: 'social_post',
    structure: { name: 'social_post', aspect: 0.8, layout: stack(18), children: [
      { type: 'vector', name: 'vector', width: 90 },
      { type: 'title', name: 'title', size: 34, colorRole: 'primary' },
      { type: 'body', name: 'body', size: 14, colorRole: 'primary' },
      { type: 'caption', name: 'caption', size: 11, colorRole: 'secondary' },
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
