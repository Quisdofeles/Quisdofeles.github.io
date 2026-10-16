// util.js: small helpers shared by every module (this file is an addition to the CLAUDE.md file list).
// - el(): builds DOM elements without writing innerHTML strings
// - icon(): the inline SVG icons used across the UI
// - color helpers (hex validation incl. alpha, CSS colors, swatch backgrounds, contrast), ids, naming, debounce

// Builds an element. props: class, text, dataset {}, on {event: fn}, style {} or string; anything else becomes an attribute.
// children can be elements, strings, arrays, or null/false (skipped).
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'on') for (const [evt, fn] of Object.entries(value)) node.addEventListener(evt, fn);
    else if (key === 'style') {
      if (typeof value === 'string') node.style.cssText = value;
      else Object.assign(node.style, value);
    } else if (key in node && key !== 'list' && typeof value !== 'string') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

// Shortcut for document.querySelector.
export const $ = (selector, root = document) => root.querySelector(selector);

// Removes all children of a node (used before a full re-render of a panel).
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// ---------- Ids and names ----------
// Short unique id like "b_k3j9x0a".
export function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

// "Signal Orange!" -> "signal_orange" (names are lowercase_with_underscores everywhere).
export function slug(text) {
  return String(text).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'untitled';
}

// Deep copy of plain data (state is JSON-safe, so this is enough).
export const clone = (value) => JSON.parse(JSON.stringify(value));

// Returns a function that waits `ms` after the last call before running.
export function debounce(fn, ms) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
  wrapped.flush = () => { if (timer) { clearTimeout(timer); timer = null; fn(); } };
  return wrapped;
}

// ---------- Colors ----------
// Every color in the app is a hex string: "#RRGGBB" (fully opaque) or "#RRGGBBAA" (the last two digits = alpha).
// Typing 3 or 6 digits means opaque; 4 or 8 digits carries an alpha. An alpha of FF is stored as plain #RRGGBB,
// so an opaque color always looks exactly like it did before alpha existed.
export const isHex = (text) => /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(String(text).trim());

// "abc" / "#ABC" / "aabbcc" -> "#AABBCC";  "abcd" / "aabbccdd" -> "#AABBCCDD";  "#AABBCCFF" -> "#AABBCC"
export function normalizeHex(text) {
  let h = String(text).trim().replace('#', '');
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  h = h.toUpperCase();
  if (h.length === 8 && h.endsWith('FF')) h = h.slice(0, 6);      // fully opaque: store the short form
  return '#' + h;
}

// The color without its alpha: "#D9FF4366" -> "#D9FF43".
export const rgbHex = (hex) => normalizeHex(hex).slice(0, 7);

// The alpha of a hex as a whole percent (0–100). A 6-digit hex is 100.
export function alphaOf(hex) {
  const h = normalizeHex(hex);
  return h.length === 9 ? Math.round((parseInt(h.slice(7), 16) / 255) * 100) : 100;
}

// The same color at `pct` percent alpha: 100 gives "#RRGGBB", anything less "#RRGGBBAA".
export function withAlpha(hex, pct) {
  const rgb = rgbHex(hex);
  if (pct >= 100) return rgb;
  const a = Math.round((Math.max(0, pct) / 100) * 255);
  return rgb + a.toString(16).padStart(2, '0').toUpperCase();
}

// What a stored hex looks like in CSS: an opaque color stays "#RRGGBB"; a color with alpha becomes
// "rgba(r, g, b, a)" (works everywhere: backgrounds, text, and SVG fill/stroke). null -> "transparent".
export function cssColor(hex) {
  if (!hex || !isHex(hex)) return 'transparent';
  const h = normalizeHex(hex);
  if (h.length !== 9) return h;
  const [r, g, b, a] = [1, 3, 5, 7].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${+(a / 255).toFixed(3)})`;
}

// The text shown for a color: "#D9FF43" when opaque, "#D9FF43 · 40%" when it has alpha.
export function hexLabel(hex) {
  if (!hex || !isHex(hex)) return '';
  const a = alphaOf(hex);
  return a < 100 ? `${rgbHex(hex)} · ${a}%` : rgbHex(hex);
}

// A CSS background for a color swatch/chip: the flat color when opaque; with alpha, the color drawn over a small
// gray checkerboard, so you can see it is see-through. (Used for swatches only, never for real content.)
const CHECKER = 'repeating-conic-gradient(#BDBDC2 0% 25%, #7C7C84 0% 50%) 50% / 8px 8px';
export function swatchBg(hex) {
  if (!hex || !isHex(hex)) return 'transparent';
  if (alphaOf(hex) >= 100) return rgbHex(hex);
  const c = cssColor(hex);
  return `linear-gradient(${c}, ${c}), ${CHECKER}`;
}

// Picks a readable label color (dark or light) for text sitting on `hex` (its alpha is ignored).
export function contrastColor(hex) {
  const h = normalizeHex(hex).slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#1B1B1B' : '#F3F0E8';
}

// ---------- Icons ----------
const SVG = {
  help: '<circle cx="8" cy="8" r="6.2"/><path d="M6.2 6.2a1.9 1.9 0 1 1 2.6 1.8c-.5.3-.8.6-.8 1.2"/><circle cx="8" cy="11.6" r=".4" fill="currentColor"/>',
  // gear/cog: 8-tooth outline + center hole (the old circle-with-rays looked like a sun)
  gear: '<path d="M12.61 6.68L14.32 7L14.32 9L12.61 9.32L12.2 10.33L13.18 11.76L11.76 13.18L10.33 12.2L9.32 12.61L9 14.32L7 14.32L6.68 12.61L5.67 12.2L4.24 13.18L2.82 11.76L3.8 10.33L3.39 9.32L1.68 9L1.68 7L3.39 6.68L3.8 5.67L2.82 4.24L4.24 2.82L5.67 3.8L6.68 3.39L7 1.68L9 1.68L9.32 3.39L10.33 3.8L11.76 2.82L13.18 4.24L12.2 5.67Z"/><circle cx="8" cy="8" r="1.9"/>',
  min: '<path d="M3 8h10"/>',
  max: '<rect x="3.2" y="3.2" width="9.6" height="9.6" rx="1"/>',
  restore: '<rect x="3.2" y="5.2" width="7.6" height="7.6" rx="1"/><path d="M5.6 5.2V3.6a.9.9 0 0 1 .9-.9h5.9a.9.9 0 0 1 .9.9v5.9a.9.9 0 0 1-.9.9h-1.6"/>',
  close: '<path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/>',
  // Align glyphs. "h" = three horizontal lines (used when the layout is a stack: align is left/center/right);
  // "v" = three vertical bars (used when the layout is a row: align is top/middle/bottom).
  alignHStart: '<path d="M3 3.5h10M3 8h6M3 12.5h8"/>',
  alignHCenter: '<path d="M3 3.5h10M5 8h6M4 12.5h8"/>',
  alignHEnd: '<path d="M3 3.5h10M7 8h6M5 12.5h8"/>',
  alignVStart: '<path d="M3.5 3v10M8 3v6M12.5 3v8"/>',
  alignVCenter: '<path d="M3.5 3v10M8 5v6M12.5 4v8"/>',
  alignVEnd: '<path d="M3.5 3v10M8 7v6M12.5 5v8"/>',
  eye: '<path d="M1.5 8s2.3-4.5 6.5-4.5S14.5 8 14.5 8 12.2 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.8"/>',
  // eyedropper (pipette): angled tube with a collar and a rounded bulb at the top right
  eyedropper: '<path d="M8.4 3.6l4 4"/><path d="M9.6 4.8l2.6-2.6a1.35 1.35 0 0 1 1.9 1.9l-2.6 2.6"/><path d="M9.8 5.6L3.8 11.6 3.3 12.7 4.4 12.2 10.4 6.2"/>',
  // chevrons for the notification log button: up = expand the log, down = collapse it
  chevronUp: '<path d="M4 10l4-4 4 4"/>',
  chevronDown: '<path d="M4 6l4 4 4-4"/>',
  eyeOff: '<path d="M1.5 8s2.3-4.5 6.5-4.5S14.5 8 14.5 8 12.2 12.5 8 12.5 1.5 8 1.5 8z" opacity=".45"/><path d="M2.5 13.5l11-11"/>',
  // Library section expand/collapse: two diagonal arrows pointing OUT to the corners (expand) or IN toward the
  // center (collapse). Deliberately not the square maximize/restore icons of the top bar.
  expand: '<path d="M9.5 2.5h4v4M13.5 2.5L9.2 6.8M6.5 13.5h-4v-4M2.5 13.5L6.8 9.2"/>',
  collapse: '<path d="M9.2 3v3.8H13M9.2 6.8l4.3-4.3M6.8 13V9.2H3M6.8 9.2l-4.3 4.3"/>',
  // Padding / margin link toggle: two chain links joined by a bar (linked = all four sides equal) or pulled apart
  // with small break marks (unlinked = each side on its own slider).
  link: '<path d="M6.6 9.4l2.8-2.8"/><path d="M7.5 4.6l1.2-1.2a2.4 2.4 0 0 1 3.4 3.4l-1.2 1.2"/><path d="M8.5 11.4l-1.2 1.2a2.4 2.4 0 0 1-3.4-3.4l1.2-1.2"/>',
  unlink: '<path d="M7.5 4.6l1.2-1.2a2.4 2.4 0 0 1 3.4 3.4l-1.2 1.2"/><path d="M8.5 11.4l-1.2 1.2a2.4 2.4 0 0 1-3.4-3.4l1.2-1.2"/><path d="M10.6 12.6v1.4M12.6 10.6H14M5.4 3.4V2M3.4 5.4H2"/>',
  // Mirror toggles (transform group): a dashed axis with a solid triangle on one side and an outlined one on the
  // other. flipH = mirror left↔right (vertical axis); flipV = mirror top↔bottom (horizontal axis).
  flipH: '<path d="M8 2v12" stroke-dasharray="1.5 1.5"/><path d="M6 4L2 12h4z" fill="currentColor"/><path d="M10 4l4 8h-4z"/>',
  flipV: '<path d="M2 8h12" stroke-dasharray="1.5 1.5"/><path d="M4 6L12 2v4z" fill="currentColor"/><path d="M4 10l8 4v-4z"/>',
};

// Returns an <svg> element for a named icon.
export function icon(name) {
  const wrap = document.createElement('span');
  wrap.style.display = 'contents';
  wrap.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${SVG[name]}</svg>`;
  return wrap.firstChild;
}

// Checkerboard icon for the "transparent background" toggle.
export function checkerIcon() {
  const wrap = document.createElement('span');
  wrap.innerHTML = '<svg viewBox="0 0 20 20" width="20" height="20"><rect x="2" y="2" width="16" height="16" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="2.7" y="2.7" width="7.3" height="7.3" fill="currentColor"/><rect x="10" y="10" width="7.3" height="7.3" fill="currentColor"/></svg>';
  return wrap.firstChild;
}
