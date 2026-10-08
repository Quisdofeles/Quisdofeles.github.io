// export.js: the floating export bar and the rendering of the preview to a PNG/JPEG.
// The image is drawn from an OFFSCREEN copy of the canvas grid (at 100% zoom, ignoring the current
// zoom/pan), built with the same renderCanvasElement() the preview uses, then rasterized by html-to-image.
// Optional "style labels" strip below the canvases lists every color, font and vector used.

import { el, clear, $, checkerIcon, normalizeHex } from './util.js';
import { state, subscribe, setExport, visibleCanvases, getFont, getVector } from './state.js';
import { renderCanvasElement, gridColumns } from './preview.js';
import { cssFamily, fontUrl, fontLabel } from './fonts.js';
import { buildVectorSvg, vectorUrl } from './svg.js';
import { isTextType, ROLE_NAMES } from './blocks.js';
import { showToast } from './overlays.js';

const CANVAS_W = 384, GAP = 20, PAD = 24;      // must match the preview (see preview.css .canvas and #canvas-grid)
const INK = '#111111';

// ---------- The bar ----------
function renderBar() {
  const ex = state.session.export;
  const jpeg = ex.format === 'jpeg';
  $('#opt-labels').checked = ex.styleLabels;
  document.querySelectorAll('#seg-format button').forEach((b) => b.classList.toggle('active', b.dataset.format === ex.format));
  document.querySelectorAll('#seg-scale button').forEach((b) => b.classList.toggle('active', Number(b.dataset.scale) === ex.scale));
  const t = $('#opt-transparent');
  t.disabled = jpeg;                                   // JPEG can't be transparent: shown off and disabled
  t.classList.toggle('on', ex.transparent && !jpeg);
  t.title = jpeg ? 'JPEG has no transparency' : 'transparent background';
}

export function initExport() {
  $('#opt-transparent').append(checkerIcon());
  $('#opt-labels').addEventListener('change', (e) => setExport({ styleLabels: e.target.checked }));
  document.querySelectorAll('#seg-format button').forEach((b) => b.addEventListener('click', () => setExport({ format: b.dataset.format })));
  document.querySelectorAll('#seg-scale button').forEach((b) => b.addEventListener('click', () => setExport({ scale: Number(b.dataset.scale) })));
  $('#opt-transparent').addEventListener('click', () => setExport({ transparent: !state.session.export.transparent }));
  $('#btn-export').addEventListener('click', () => exportImage().catch((err) => { console.error(err); showToast('export failed: ' + err.message, { warn: true }); }));
  subscribe(renderBar);
  renderBar();
}

// ---------- Gathering what the canvases use ----------
// Walks every visible canvas and collects the colors, fonts and vectors actually in use.
function collectUsage(canvases) {
  const colors = new Map();     // hex -> Set of role names
  const fonts = new Map();      // fontId -> font
  const vectors = new Map();    // vectorId -> vector
  for (const cv of canvases) {
    for (const role of ROLE_NAMES) {
      const hex = normalizeHex(cv.roles[role]);
      if (!colors.has(hex)) colors.set(hex, new Set());
      colors.get(hex).add(role);
    }
    const walk = (list) => list.forEach((b) => {
      if (b.hidden) return;
      if (isTextType(b.type) && b.text) {
        const f = getFont(b.fontOverride || cv.fonts[b.type]);
        if (f) fonts.set(f.id, f);
      }
      if ((b.type === 'vector' || b.type === 'image') && getVector(b.vectorId)) vectors.set(b.vectorId, getVector(b.vectorId));
      if (b.children) walk(b.children);
    });
    walk(cv.children);
  }
  return { colors, fonts, vectors };
}

// The library name for a hex, if the user has a color (or palette swatch) with that value.
function libraryColorName(hex) {
  const all = [...state.library.colors, ...state.library.palettes.flatMap((p) => p.colors)];
  const hit = all.find((c) => normalizeHex(c.hex) === hex);
  return hit ? hit.name : null;
}

// ---------- The style labels strip ----------
function buildStrip(usage, width) {
  const section = (title, items) => el('div', { class: 'export-section' },
    el('div', { class: 'export-title', text: title }),
    el('div', { class: 'export-items' }, items));

  const colorItems = [...usage.colors.entries()].map(([hex, roles]) => el('div', { class: 'export-item' },
    el('span', { class: 'export-chip', style: { background: hex } }),
    el('div', { class: 'export-text' },
      el('span', { text: libraryColorName(hex) || [...roles].join(' / ') }),
      el('span', { class: 'export-sub', text: hex }))));

  const fontItems = [...usage.fonts.values()].map((f) => el('div', { class: 'export-item' },
    el('span', { class: 'export-font', style: { fontFamily: `'${cssFamily(f)}'`, fontWeight: 'normal', fontStyle: 'normal' }, text: fontLabel(f) })));

  const vectorItems = [...usage.vectors.values()].map((v) => {
    // A one-color black version of the vector, with its name beside it.
    const mark = v.kind === 'image'
      ? el('img', { src: vectorUrl(v), style: { height: '34px', width: 'auto', filter: 'brightness(0)' } })
      : buildVectorSvg(v.id, () => '#000000', 38) || el('span');
    return el('div', { class: 'export-item' }, mark, el('span', { text: v.name }));
  });

  const strip = el('div', { class: 'export-strip', style: { width: `${width}px` } });
  if (colorItems.length) strip.append(section('colors', colorItems));
  if (fontItems.length) strip.append(section('fonts', fontItems));
  if (vectorItems.length) strip.append(section('vectors', vectorItems));
  return strip;
}

// ---------- Embedding fonts ----------
// Turns bytes into base64 (in chunks, so large fonts don't overflow the call stack).
function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
const MIME = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };

// CSS with every used font (and the bundled IBM Plex Mono) inlined as data URIs, so the exported
// image never depends on files html-to-image can't fetch.
async function buildFontCss(fonts) {
  const faces = [];
  for (const f of fonts) {
    const buf = await (await fetch(fontUrl(f))).arrayBuffer();
    const mime = MIME[f.fileName.split('.').pop().toLowerCase()] || 'font/ttf';
    faces.push(`@font-face{font-family:'${cssFamily(f)}';src:url(data:${mime};base64,${toBase64(buf)});}`);
  }
  for (const [file, weight] of [['IBMPlexMono-Regular.ttf', 400], ['IBMPlexMono-Medium.ttf', 500]]) {
    faces.push(`@font-face{font-family:'IBM Plex Mono';font-weight:${weight};src:url(data:font/ttf;base64,${await window.api.readBundledFont(file)});}`);
  }
  return faces.join('\n');
}

// ---------- Export ----------
async function exportImage() {
  const canvases = visibleCanvases();
  if (!canvases.length) { showToast('nothing to export: add a canvas first', { warn: true }); return; }
  const { styleLabels, format, transparent, scale } = state.session.export;
  const solid = format === 'jpeg' || !transparent;           // JPEG is always on a solid background
  const btn = $('#btn-export');
  btn.disabled = true;
  btn.textContent = 'exporting…';
  const root = $('#export-root');

  try {
    // Build the sheet: the canvases in the auto grid, plus (optionally) the style labels strip.
    const cols = gridColumns(canvases.length);
    const gridWidth = cols * CANVAS_W + (cols - 1) * GAP;
    const grid = el('div', { class: 'export-grid', style: { gridTemplateColumns: `repeat(${cols}, ${CANVAS_W}px)`, gap: `${GAP}px`, width: `${gridWidth}px` } });
    canvases.forEach((cv, i) => {
      const card = renderCanvasElement(cv, i, { interactive: false });
      card.style.boxShadow = 'none';                          // shadows would be clipped at the sheet edge
      grid.append(card);
    });
    const usage = collectUsage(canvases);
    const sheet = el('div', { class: 'export-sheet', style: { padding: `${PAD}px`, background: solid ? '#FFFFFF' : 'transparent' } }, grid);
    if (styleLabels) sheet.append(buildStrip(usage, gridWidth));
    clear(root).append(sheet);

    await document.fonts.ready;
    const fontEmbedCSS = await buildFontCss([...usage.fonts.values()]);
    const options = { pixelRatio: scale, cacheBust: false, fontEmbedCSS, ...(solid ? { backgroundColor: '#FFFFFF' } : {}) };
    const dataUrl = format === 'jpeg'
      ? await window.htmlToImage.toJpeg(sheet, { ...options, quality: 0.95 })
      : await window.htmlToImage.toPng(sheet, options);

    const result = await window.api.saveExport(dataUrl, format);
    if (result.saved) showToast(`exported ${result.path.split(/[\\/]/).pop()}`);
  } finally {
    clear(root);
    btn.disabled = false;
    btn.textContent = 'export';
  }
}
