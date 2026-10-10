// svg.js: everything about imported SVGs (and the URL helper for imported media files).
//  - sanitizing SVGs (no scripts, event handlers, or external references)
//  - finding the FIRST-LEVEL LAYERS (the direct children of the SVG root: groups or shapes). No layer naming is needed.
//  - reading the colors each layer really uses, so the app can show "original" colors
//  - building the <svg> element the preview, library tiles and export all use. A layer keeps its original
//    colors until a color is given for it; then the whole layer becomes that one color.

const cache = new Map();   // media id -> { markup: prepared SVG string, layers: [{ name, colors, ids }] }

// Ids Illustrator invents when a layer was never named ("Layer_1", "Artboard_2", "XMLID_3_", "_x31_").
// Layers with such ids get the plain name "layer N" instead.
const GENERIC_ID = /^(layer|artboard)[_ ]?\d*$|^xmlid_\d+_$|^_x[0-9a-f]+_/i;

// Illustrator escapes special characters in ids as "_x20_" (a space). Turns them back into text for display.
export function displayLayerName(id) {
  return id.replace(/_x([0-9a-f]{2,4})_/gi, (m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// URL the renderer uses to load an imported file through the ssfile:// protocol.
export const mediaUrl = (item) => `ssfile://lib/media/${encodeURIComponent(item.fileName)}`;

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
// A "layer" is a direct child of the SVG root that draws something (a group or a shape). Things like
// <defs>, <style> and <title> are not layers.
const DRAWABLE = new Set(['g', 'path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'text', 'use']);
const isDrawable = (n) => DRAWABLE.has(n.nodeName.toLowerCase());

// Illustrator often wraps the whole drawing in ONE group. If the root has a single group that itself holds
// several drawable children, that wrapper is skipped and its children are the layers (otherwise a whole logo
// would be one single layer).
function findLayers(svg) {
  let layers = [...svg.children].filter(isDrawable);
  if (layers.length === 1 && layers[0].nodeName.toLowerCase() === 'g') {
    const inner = [...layers[0].children].filter(isDrawable);
    if (inner.length > 1) layers = inner;
  }
  return layers;
}

// The display name of a layer: Illustrator's real layer name (data-name, or a non-generic id), else null.
function nameOf(layer) {
  const raw = layer.getAttribute('data-name') || layer.getAttribute('id');
  if (!raw || GENERIC_ID.test(raw)) return null;
  return displayLayerName(raw);
}

// Every id found on the layer or the groups inside it. Only used to upgrade old saves, whose colors were
// stored under Illustrator layer names (see state.js resolveLegacyLayerColors).
function legacyIdsOf(layer) {
  return [layer, ...layer.querySelectorAll('g')].map((g) => g.getAttribute('id')).filter(Boolean);
}

// ---------- Style scoping ----------
// Rewrites a <style> block: drops at-rules and scopes every selector to this vector so classes like
// ".cls-1" from two different SVGs can never collide. The paint declarations are KEPT (original colors).
function scopeStyle(css, vid) {
  css = css.replace(/@[^{;]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  return css.replace(/([^{}]+)\{([^{}]*)\}/g, (m, selectors, body) => {
    const scoped = selectors.split(',').map((s) => `svg[data-vid="${vid}"] ${s.trim()}`).join(',');
    return `${scoped}{${body}}`;
  });
}

// ---------- Reading the real colors ----------
// Elements that actually draw paint. Their fill/stroke is what a layer color replaces.
const PAINTED = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'text', 'tspan', 'use']);

const toHex = (n) => Number(n).toString(16).padStart(2, '0').toUpperCase();

// "rgb(12, 34, 56)" (what getComputedStyle returns) -> "#0C2238". Fully transparent or unreadable -> null.
function rgbToHex(value) {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(value || '');
  if (!m || (m[4] !== undefined && parseFloat(m[4]) === 0)) return null;
  return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`;
}

// A computed fill/stroke value -> hex. Gradients ("url(#id)") use the color of their first stop.
function paintToHex(value, root) {
  const ref = /url\(\s*["']?#([^)"'\s]+)/.exec(value);
  if (ref) {
    const target = root.querySelector(`#${CSS.escape(ref[1])}`);
    const stop = target && target.querySelector('stop');
    return stop ? rgbToHex(getComputedStyle(stop).stopColor) : null;
  }
  return rgbToHex(value);
}

// Looks at every painted element in a layer (the SVG must be in the document so styles resolve).
// Marks them data-f (has a fill) / data-s (has a stroke) so a later recolor knows exactly what to paint,
// and returns the distinct colors the layer uses, in drawing order.
function analyzeLayer(layer, root) {
  const colors = [];
  const add = (hex) => { if (hex && !colors.includes(hex)) colors.push(hex); };
  for (const node of [layer, ...layer.querySelectorAll('*')]) {
    if (!PAINTED.has(node.nodeName.toLowerCase()) || node.closest('defs, clipPath, mask, pattern, marker')) continue;
    const cs = getComputedStyle(node);
    if (cs.display === 'none') continue;
    const tag = node.nodeName.toLowerCase();
    if (cs.fill !== 'none' && tag !== 'line') { node.setAttribute('data-f', '1'); add(paintToHex(cs.fill, root)); }
    if (cs.stroke !== 'none' && parseFloat(cs.strokeWidth) !== 0) { node.setAttribute('data-s', '1'); add(paintToHex(cs.stroke, root)); }
  }
  return colors;
}

// ---------- Main entry ----------
// Parses, sanitizes and prepares an SVG. Returns { markup, layers } where layers = [{ name, colors, ids }]
// (name: the layer's display name, colors: the hexes it really uses, ids: for upgrading old saves).
// Throws if the text isn't a valid SVG.
export function processSvg(text, vid) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const parsed = doc.documentElement;
  if (!parsed || parsed.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) throw new Error('not a valid svg');

  sanitize(parsed);
  const found = findLayers(parsed);
  const layers = found.map((g, i) => ({ name: nameOf(g) || `layer ${i + 1}`, colors: [], ids: legacyIdsOf(g) }));
  found.forEach((g, i) => g.setAttribute('data-layer', String(i)));

  // Prefix every id (clip paths, gradients, layers...) per vector and fix references to them.
  const idMap = new Map();
  parsed.querySelectorAll('[id]').forEach((n) => { const old = n.getAttribute('id'); idMap.set(old, `${vid}_${old}`); n.setAttribute('id', idMap.get(old)); });
  const fixRefs = (value) => value
    .replace(/url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g, (m, id) => (idMap.has(id) ? `url(#${idMap.get(id)})` : m));
  for (const node of [parsed, ...parsed.querySelectorAll('*')]) {
    for (const attr of Array.from(node.attributes)) {
      if ((attr.name === 'href' || attr.name === 'xlink:href') && idMap.has(attr.value.slice(1))) node.setAttribute(attr.name, `#${idMap.get(attr.value.slice(1))}`);
      else if (attr.value.includes('url(')) node.setAttribute(attr.name, fixRefs(attr.value));
    }
  }
  parsed.querySelectorAll('style').forEach((s) => { s.textContent = scopeStyle(fixRefs(s.textContent), vid); });

  // Sizing: guarantee a viewBox so CSS width alone scales it, then drop fixed width/height.
  if (!parsed.getAttribute('viewBox')) {
    const w = parseFloat(parsed.getAttribute('width')), h = parseFloat(parsed.getAttribute('height'));
    if (w > 0 && h > 0) parsed.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  parsed.removeAttribute('width');
  parsed.removeAttribute('height');
  parsed.setAttribute('data-vid', vid);
  parsed.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  // Read the real colors: mount the SVG off-screen so the browser resolves classes, <style> rules and
  // inheritance for us (the only reliable way to know the final fill/stroke of each shape).
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-99999px;top:0;width:200px;color:#000;visibility:hidden;pointer-events:none';
  const live = document.importNode(parsed, true);
  host.append(live);
  document.body.append(host);
  try {
    live.querySelectorAll('[data-layer]').forEach((g) => { layers[Number(g.getAttribute('data-layer'))].colors = analyzeLayer(g, live); });
  } finally {
    host.remove();
  }

  return { markup: new XMLSerializer().serializeToString(live), layers };
}

// ---------- Cache ----------
// `prepared` is what processSvg returned.
export function cacheMedia(id, prepared) { cache.set(id, prepared); }
export const hasMediaMarkup = (id) => cache.has(id);

// The layers of a loaded SVG media item: [{ name, colors, ids }]. Empty if it isn't loaded (or is a raster image).
export const layerInfo = (mediaId) => (cache.get(mediaId) || { layers: [] }).layers;

// Loads and prepares the SVG files for every media item in the list (call at startup and after import/restore).
export async function ensureMediaLoaded(media) {
  await Promise.all(media.filter((m) => m.kind === 'svg' && !cache.has(m.id)).map(async (m) => {
    try {
      const text = await window.api.readLibraryFile(`media/${m.fileName}`);
      cache.set(m.id, processSvg(text, m.id));
    } catch (err) {
      console.warn('could not load media', m.name, err);
    }
  }));
}

// ---------- Building colored elements ----------
// Returns a live <svg> element for an SVG media item. colorFor(layerKey) returns a hex to paint that whole
// layer with, or null/undefined to leave the layer in its original colors.
// Returns null if it isn't loaded (the caller then shows a gray placeholder).
// widthPx = fixed CSS width; omit it to let CSS size the element (library thumbnails).
export function buildVectorSvg(mediaId, colorFor, widthPx) {
  const prepared = cache.get(mediaId);
  if (!prepared) return null;
  const holder = document.createElement('div');
  holder.innerHTML = prepared.markup;
  const svg = holder.firstElementChild;
  if (!svg) return null;
  svg.querySelectorAll('[data-layer]').forEach((layer) => {
    const hex = colorFor(layer.getAttribute('data-layer'));
    if (!hex) return;
    // Only elements that really had a fill (data-f) or stroke (data-s) are repainted, so fill:none stays none.
    for (const node of [layer, ...layer.querySelectorAll('[data-f], [data-s]')]) {
      if (node.hasAttribute('data-f')) node.style.fill = hex;
      if (node.hasAttribute('data-s')) node.style.stroke = hex;
    }
  });
  if (widthPx) { svg.style.width = `${widthPx}px`; svg.style.height = 'auto'; }
  return svg;
}
