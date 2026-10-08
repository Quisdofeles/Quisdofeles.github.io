// util.js: small helpers shared by every module (this file is an addition to the CLAUDE.md file list).
// - el(): builds DOM elements without writing innerHTML strings
// - icon(): the inline SVG icons used across the UI
// - color helpers (hex validation, contrast), ids, naming, debounce

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
export const isHex = (text) => /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(text).trim());

// "abc" / "#ABC" / "aabbcc" -> "#AABBCC"
export function normalizeHex(text) {
  let h = String(text).trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return '#' + h.toUpperCase();
}

// Picks a readable label color (dark or light) for text sitting on `hex`.
export function contrastColor(hex) {
  const h = normalizeHex(hex).slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#1B1B1B' : '#F3F0E8';
}

// ---------- Icons ----------
const SVG = {
  help: '<circle cx="8" cy="8" r="6.2"/><path d="M6.2 6.2a1.9 1.9 0 1 1 2.6 1.8c-.5.3-.8.6-.8 1.2"/><circle cx="8" cy="11.6" r=".4" fill="currentColor"/>',
  gear: '<circle cx="8" cy="8" r="2.1"/><path d="M8 1.6v1.7M8 12.7v1.7M1.6 8h1.7M12.7 8h1.7M3.5 3.5l1.2 1.2M11.3 11.3l1.2 1.2M12.5 3.5l-1.2 1.2M4.7 11.3l-1.2 1.2"/>',
  min: '<path d="M3 8h10"/>',
  max: '<rect x="3.2" y="3.2" width="9.6" height="9.6" rx="1"/>',
  restore: '<rect x="3.2" y="5.2" width="7.6" height="7.6" rx="1"/><path d="M5.6 5.2V3.6a.9.9 0 0 1 .9-.9h5.9a.9.9 0 0 1 .9.9v5.9a.9.9 0 0 1-.9.9h-1.6"/>',
  close: '<path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/>',
  eye: '<path d="M1.5 8s2.3-4.5 6.5-4.5S14.5 8 14.5 8 12.2 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.8"/>',
  eyeOff: '<path d="M1.5 8s2.3-4.5 6.5-4.5S14.5 8 14.5 8 12.2 12.5 8 12.5 1.5 8 1.5 8z" opacity=".45"/><path d="M2.5 13.5l11-11"/>',
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
