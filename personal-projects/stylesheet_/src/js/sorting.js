// sorting.js: how each Library section is ordered on screen.
// Pure functions: each takes a list and returns a NEW sorted array. The saved data is never reordered,
// and because the library re-renders from state after every edit, renaming/editing an item re-sorts it.

import { DEFAULT_PRESETS, BLOCK_TYPES } from './blocks.js';

// The order the default blocks appear in the library (hardcoded; edit this list to change it):
// containers, then media, then text from biggest to smallest, then spacer.
export const BLOCK_ORDER = ['canvas', 'vector', 'image', 'title', 'heading', 'subheading', 'body', 'caption', 'spacer'];

// Block type entries in BLOCK_ORDER (any type missing from the list goes last, in its original order).
export function sortBlockTypes() {
  const rank = (t) => { const i = BLOCK_ORDER.indexOf(t.type); return i < 0 ? BLOCK_ORDER.length : i; };
  return [...BLOCK_TYPES].sort((a, b) => rank(a) - rank(b));
}

// Media: newest added first. Items without a timestamp count as oldest; ties keep the saved order (newer entries were pushed later).
export function sortMedia(media) {
  return media
    .map((m, i) => ({ m, i }))
    .sort((a, b) => ((b.m.addedAt || 0) - (a.m.addedAt || 0)) || (b.i - a.i))
    .map((x) => x.m);
}

// Font families: alphabetical, case-insensitive. (Takes the [{family, fonts}] groups from groupFamilies.)
export const sortFamilies = (families) =>
  [...families].sort((a, b) => a.family.toLowerCase().localeCompare(b.family.toLowerCase()));

// Palettes: alphabetical by name, case-insensitive. (Swatches inside a palette keep the user's order.)
export const sortPalettes = (palettes) =>
  [...palettes].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

// Presets: user presets newest first, then the default presets that ship with the app (oldest) in their shipped order.
export function sortPresets(presets) {
  const defaultIds = new Set(DEFAULT_PRESETS.map((p) => p.id));
  const user = presets.filter((p) => !defaultIds.has(p.id)).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  const shipped = presets.filter((p) => defaultIds.has(p.id));
  return [...user, ...shipped];
}

// ---------- Colors ----------
const GRAY_SATURATION = 0.10;   // below this saturation a color counts as a gray/brown and goes in the last group
const HUE_BUCKET = 15;          // degrees; hues within one bucket sort by lightness instead of by exact hue

// "#RRGGBB" -> { h: 0-360, s: 0-1, l: 0-1 }
export function hexToHsl(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s, l };
}

// Group number for a color: 0 = pure black, 1 = pure white, 2 = chromatic (by hue), 3 = grays/browns (dark to light).
function colorGroup(hex, hsl) {
  const up = hex.toUpperCase();
  if (up === '#000000') return 0;
  if (up === '#FFFFFF') return 1;
  return hsl.s < GRAY_SATURATION ? 3 : 2;
}

// Colors: pure black, pure white, then every saturated color by hue (red, orange, yellow, green, blue, purple, back toward red)
// with lightness deciding order inside a hue bucket, then the low-saturation colors sorted dark to light.
export function sortColors(colors) {
  const keyed = colors.map((c) => {
    const hsl = hexToHsl(c.hex);
    // Shift by half a bucket so reds on both sides of 0° land in the same bucket.
    const bucket = Math.floor(((hsl.h + HUE_BUCKET / 2) % 360) / HUE_BUCKET);
    return { c, hsl, group: colorGroup(c.hex, hsl), bucket };
  });
  keyed.sort((a, b) =>
    (a.group - b.group)
    || (a.group === 2 ? (a.bucket - b.bucket) : 0)
    || (a.hsl.l - b.hsl.l)
    || a.c.name.localeCompare(b.c.name));
  return keyed.map((k) => k.c);
}
