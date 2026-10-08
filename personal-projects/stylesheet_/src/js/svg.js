// svg.js: everything about imported vectors.
//  - sanitizing SVGs (no scripts, event handlers, or external references)
//  - detecting named layers (Illustrator exports layer names as <g id="...">)
//  - preparing the markup so each named layer can be recolored by role
//  - building the colored <svg> element the preview, library tiles and export all use

import { getVector } from './state.js';

const cache = new Map();   // vectorId -> prepared SVG markup (string)

// Ids Illustrator invents when a layer was never named ("Layer_1", "Artboard_2", "XMLID_3_", "_x31_").
const GENERIC_ID = /^(layer|artboard)[_ ]?\d*$|^xmlid_\d+_$|^_x[0-9a-f]+_/i;

// Illustrator escapes special characters in ids as "_x20_" (a space). Turns them back into text for display.
export function displayLayerName(id) {
  return id.replace(/_x([0-9a-f]{2,4})_/gi, (m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// URL the renderer uses to load an imported file through the ssfile:// protocol.
export const vectorUrl = (vector) => `ssfile://lib/vectors/${encodeURIComponent(vector.fileName)}`;

// ---------- Sanitizing ----------
const BAD_ELEMENTS = ['script', 'foreignObject', 'iframe', 'object', 'embed', 'image', 'audio', 'video'];

// Removes anything that could run code or reach outside the file. Works in place on a parsed SVG.
function sanitize(svg) {
  for (const tag of BAD_ELEMENTS) svg.querySelectorAll(tag).forEach((n) => n.remove());
  for (const node of [svg, ...svg.querySelectorAll('*')]) {
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) { node.removeAttribute(attr.name); continue; }                       // onclick, onload...
      if ((name === 'href' || name === 'xlink:href') && !attr.value.trim().startsWith('#')) node.removeAttribute(attr.name);   // external refs
      if (/javascript:/i.test(attr.value)) node.removeAttribute(attr.name);
      if (name === 'style') node.setAttribute('style', stripExternalUrls(attr.value));
    }
  }
  svg.querySelectorAll('style').forEach((s) => { s.textContent = stripExternalUrls(s.textContent.replace(/@import[^;]*;?/g, '')); });
}

// url(...) that doesn't point at an in-file #id becomes "none".
function stripExternalUrls(css) {
  return css.replace(/url\(\s*(?!['"]?#)[^)]*\)/gi, 'none');
}

// ---------- Layer detection ----------
// Outermost named <g> groups are the layers. If the whole drawing sits in one wrapper group that
// itself contains several named groups, the wrapper is skipped and its children are the layers.
function findLayers(svg) {
  const named = (n) => n.nodeName === 'g' && n.getAttribute('id') && !GENERIC_ID.test(n.getAttribute('id'));
  const collect = (parent) => {
    const out = [];
    for (const child of parent.children) {
      if (named(child)) out.push(child);
      else if (child.nodeName === 'g') out.push(...collect(child));
    }
    return out;
  };
  let layers = collect(svg);
  if (layers.length === 1) {
    const inner = collect(layers[0]);
    if (inner.length > 1) layers = inner;
  }
  return layers;
}

// ---------- Paint handling ----------
// To recolor a layer we put fill (and `color`) on its group, so every shape inside must STOP
// declaring its own colors: fills are removed (fill:none is kept) and strokes become currentColor.
function fixDeclarations(css) {
  return css.split(';').map((decl) => decl.trim()).filter(Boolean).map((decl) => {
    const i = decl.indexOf(':');
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim().toLowerCase();
    if (prop === 'fill') return value === 'none' ? decl : null;
    if (prop === 'stroke') return value === 'none' ? decl : 'stroke:currentColor';
    return decl;
  }).filter(Boolean).join(';');
}

function neutralizePaint(node) {
  const fill = node.getAttribute('fill');
  if (fill !== null && fill.trim().toLowerCase() !== 'none') node.removeAttribute('fill');
  const stroke = node.getAttribute('stroke');
  if (stroke !== null && stroke.trim().toLowerCase() !== 'none') node.setAttribute('stroke', 'currentColor');
  if (node.hasAttribute('style')) node.setAttribute('style', fixDeclarations(node.getAttribute('style')));
}

// Rewrites a <style> block: drops at-rules, strips paint declarations, and scopes every selector to
// this vector so classes like ".cls-1" from two different SVGs can never collide.
function scopeStyle(css, vid) {
  css = css.replace(/@[^{;]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  return css.replace(/([^{}]+)\{([^{}]*)\}/g, (m, selectors, body) => {
    const scoped = selectors.split(',').map((s) => `svg[data-vid="${vid}"] ${s.trim()}`).join(',');
    return `${scoped}{${fixDeclarations(body)}}`;
  });
}

// ---------- Main entry ----------
// Parses, sanitizes and prepares an SVG. Returns { markup, layers } where `layers` are the named layer ids.
// Throws if the text isn't a valid SVG.
export function processSvg(text, vid) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) throw new Error('not a valid svg');

  sanitize(svg);
  const layers = findLayers(svg);
  const layerIds = layers.map((g) => g.getAttribute('id'));

  // Mark layers with data-layer (and drop their id so ids can't collide between vectors).
  layers.forEach((g) => { g.setAttribute('data-layer', g.getAttribute('id')); g.removeAttribute('id'); });

  // Neutralize paint inside layers (or the whole drawing when there are no layers).
  const painted = layers.length ? layers : [svg];
  painted.forEach((root) => [root, ...root.querySelectorAll('*')].forEach(neutralizePaint));

  // Prefix remaining ids (clip paths, gradients...) and fix references to them.
  const idMap = new Map();
  svg.querySelectorAll('[id]').forEach((n) => { const old = n.getAttribute('id'); idMap.set(old, `${vid}_${old}`); n.setAttribute('id', idMap.get(old)); });
  const fixRefs = (value) => value
    .replace(/url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g, (m, id) => (idMap.has(id) ? `url(#${idMap.get(id)})` : m));
  for (const node of [svg, ...svg.querySelectorAll('*')]) {
    for (const attr of Array.from(node.attributes)) {
      if ((attr.name === 'href' || attr.name === 'xlink:href') && idMap.has(attr.value.slice(1))) node.setAttribute(attr.name, `#${idMap.get(attr.value.slice(1))}`);
      else if (attr.value.includes('url(')) node.setAttribute(attr.name, fixRefs(attr.value));
    }
  }
  svg.querySelectorAll('style').forEach((s) => { s.textContent = scopeStyle(fixRefs(s.textContent), vid); });

  // Sizing: guarantee a viewBox so CSS width alone scales it, then drop fixed width/height.
  if (!svg.getAttribute('viewBox')) {
    const w = parseFloat(svg.getAttribute('width')), h = parseFloat(svg.getAttribute('height'));
    if (w > 0 && h > 0) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.setAttribute('data-vid', vid);
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  return { markup: new XMLSerializer().serializeToString(svg), layers: layerIds };
}

// ---------- Cache ----------
export function cacheVector(vid, markup) { cache.set(vid, markup); }
export const hasVectorMarkup = (vid) => cache.has(vid);

// Loads and prepares the SVG files for every vector in the list (call at startup and after import/restore).
export async function ensureVectorsLoaded(vectors) {
  await Promise.all(vectors.filter((v) => v.kind === 'svg' && !cache.has(v.id)).map(async (v) => {
    try {
      const text = await window.api.readLibraryFile(`vectors/${v.fileName}`);
      cache.set(v.id, processSvg(text, v.id).markup);
    } catch (err) {
      console.warn('could not load vector', v.name, err);
    }
  }));
}

// ---------- Building colored elements ----------
// Returns a live <svg> element for a vector, with every layer colored by `colorFor(layerId)`.
// Returns null if the vector isn't loaded (the caller then shows a gray placeholder).
// widthPx = fixed CSS width; omit it to let CSS size the element (library tiles).
export function buildVectorSvg(vectorId, colorFor, widthPx) {
  const markup = cache.get(vectorId);
  if (!markup) return null;
  const holder = document.createElement('div');
  holder.innerHTML = markup;
  const svg = holder.firstElementChild;
  if (!svg) return null;
  const layers = svg.querySelectorAll('[data-layer]');
  const paint = (node, hex) => { node.setAttribute('fill', hex); node.style.color = hex; };
  if (layers.length) layers.forEach((g) => paint(g, colorFor(g.getAttribute('data-layer'))));
  else paint(svg, colorFor('*'));
  if (widthPx) { svg.style.width = `${widthPx}px`; svg.style.height = 'auto'; }
  return svg;
}

// For tiles/labels: the same lookup but from a vector id that might be missing from the library.
export const vectorExists = (id) => !!getVector(id);
