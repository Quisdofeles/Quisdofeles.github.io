// export.js: the floating export bar (two rows) and the rendering of the preview to a PNG/JPEG/WebP.
// The image is drawn from an OFFSCREEN copy of the canvas grid (at 100% zoom, ignoring the current
// zoom/pan), built with the same renderCanvasCell() the preview uses, then rasterized by html-to-image.
// Optional "style labels" strip below the canvases lists every color, font and vector used.

import { el, clear, $, checkerIcon, normalizeHex } from './util.js';
import { state, subscribe, setExport, visibleCanvases, getFont, getMedia } from './state.js';
import { renderCanvasCell, applyGridLayout, optionLabel } from './preview.js';
import { cssFamily, fontCss, fontUrl, fontLabel, DEFAULT_FONT_ID } from './fonts.js';
import { buildVectorSvg, mediaUrl, layerInfo } from './svg.js';
import { isTextType } from './blocks.js';
import { showToast } from './overlays.js';

const PAD = 24;      // the sheet's padding around the grid (the grid itself is laid out by preview.js applyGridLayout())
const INK = '#111111';

// ---------- The bar ----------
function renderBar() {
  const ex = state.session.export;
  const jpeg = ex.format === 'jpeg';
  $('#opt-labels').checked = ex.styleLabels;
  $('#opt-canvas-labels').checked = ex.canvasLabels;
  document.querySelectorAll('#seg-format button').forEach((b) => b.classList.toggle('active', b.dataset.format === ex.format));
  document.querySelectorAll('#seg-scale button').forEach((b) => b.classList.toggle('active', Number(b.dataset.scale) === ex.scale));
  const t = $('#opt-transparent');
  t.disabled = jpeg;                                   // JPEG can't be transparent: shown off and disabled (PNG and WebP can)
  t.classList.toggle('on', ex.transparent && !jpeg);
  t.title = jpeg ? 'JPEG has no transparency' : 'transparent background';
}

export function initExport() {
  $('#opt-transparent').append(checkerIcon());
  $('#opt-labels').addEventListener('change', (e) => setExport({ styleLabels: e.target.checked }));
  // Hides/shows the OPTION A/B… label on every canvas (preview.js redraws when this changes).
  $('#opt-canvas-labels').addEventListener('change', (e) => setExport({ canvasLabels: e.target.checked }));
  document.querySelectorAll('#seg-format button').forEach((b) => b.addEventListener('click', () => setExport({ format: b.dataset.format })));
  document.querySelectorAll('#seg-scale button').forEach((b) => b.addEventListener('click', () => setExport({ scale: Number(b.dataset.scale) })));
  $('#opt-transparent').addEventListener('click', () => setExport({ transparent: !state.session.export.transparent }));
  $('#btn-export').addEventListener('click', () => exportImage().catch((err) => { console.error(err); showToast('export failed: ' + err.message, { warn: true }); }));
  subscribe(renderBar);
  renderBar();
}

// ---------- Gathering what the canvases use ----------
// Walks every visible canvas and collects the colors, fonts and media actually in use.
// colors = one group per canvas: { label: 'OPTION A', items: [{ name, colors: [hex, ...] }] }. Every colorable
// thing is listed by name with the color it uses RIGHT NOW: the background, each text block, and each first-level
// layer of each vector (a layer still on its original colors lists every color the file uses in it).
function collectUsage(canvases) {
  const colors = [];
  const fonts = new Map();      // fontId -> font
  const media = new Map();      // mediaId -> media item
  canvases.forEach((cv, index) => {
    const items = [{ name: 'background', colors: [normalizeHex(cv.background)] }];
    const walk = (list) => list.forEach((b) => {
      if (b.hidden) return;
      if (isTextType(b.type) && b.text) {
        const f = getFont(b.font) || getFont(DEFAULT_FONT_ID);      // same fallback the preview uses
        fonts.set(f.id, f);
        items.push({ name: b.name, colors: [normalizeHex(b.color)] });
      }
      if (b.type === 'vector' && getMedia(b.mediaId)) {
        layerInfo(b.mediaId).forEach((layer, i) => {
          const chosen = (b.layerColors || {})[i];
          const used = chosen ? [normalizeHex(chosen)] : layer.colors;
          if (used.length) items.push({ name: `${b.name} / ${layer.name}`, colors: used });
        });
      }
      if ((b.type === 'vector' || b.type === 'image') && getMedia(b.mediaId)) media.set(b.mediaId, getMedia(b.mediaId));
      if (b.children) walk(b.children);
    });
    walk(cv.children);
    colors.push({ label: optionLabel(index), items });
  });
  return { colors, fonts, media };
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

  // Colors: a small heading per canvas, then one entry per colorable thing (name + its color chip(s) and hex(es);
  // a hex that matches a library color also shows that color's name).
  const colorItems = usage.colors.flatMap((group) => [
    el('div', { class: 'export-canvas-title', text: group.label }),
    ...group.items.map((item) => el('div', { class: 'export-item' },
      el('div', { class: 'export-chips' + (item.colors.length > 1 ? ' multi' : '') },
        item.colors.map((hex) => el('span', { class: 'export-chip', style: { background: hex } }))),
      el('div', { class: 'export-text' },
        el('span', { text: item.name }),
        item.colors.map((hex) => el('span', { class: 'export-sub', text: libraryColorName(hex) ? `${libraryColorName(hex)} ${hex}` : hex }))))),
  ]);

  const fontItems = [...usage.fonts.values()].map((f) => el('div', { class: 'export-item' },
    el('span', { class: 'export-font', style: fontCss(f), text: fontLabel(f) })));

  const mediaItems = [...usage.media.values()].map((v) => {
    // A one-color black version of the media item, with its name beside it.
    const mark = v.kind === 'image'
      ? el('img', { src: mediaUrl(v), style: { height: '34px', width: 'auto', filter: 'brightness(0)' } })
      : buildVectorSvg(v.id, () => '#000000', 38) || el('span');   // every layer forced to black
    return el('div', { class: 'export-item' }, mark, el('span', { text: v.name }));
  });

  const strip = el('div', { class: 'export-strip', style: { width: `${width}px` } });
  if (colorItems.length) strip.append(section('colors', colorItems));
  if (fontItems.length) strip.append(section('fonts', fontItems));
  if (mediaItems.length) strip.append(section('media', mediaItems));
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
    if (f.builtin) continue;                  // the built-in fonts (Space Grotesk, IBM Plex Mono) are embedded below
    const buf = await (await fetch(fontUrl(f))).arrayBuffer();
    const mime = MIME[f.fileName.split('.').pop().toLowerCase()] || 'font/ttf';
    faces.push(`@font-face{font-family:'${cssFamily(f)}';src:url(data:${mime};base64,${toBase64(buf)});}`);
  }
  for (const [file, weight] of [['IBMPlexMono-Regular.ttf', 400], ['IBMPlexMono-Medium.ttf', 500], ['IBMPlexMono-Bold.ttf', 700]]) {
    faces.push(`@font-face{font-family:'IBM Plex Mono';font-weight:${weight};src:url(data:font/ttf;base64,${await window.api.readBundledFont(file)});}`);
  }
  // Space Grotesk is one variable file that covers weights 300-700.
  faces.push(`@font-face{font-family:'Space Grotesk';font-weight:300 700;src:url(data:font/ttf;base64,${await window.api.readBundledFont('SpaceGrotesk-Variable.ttf')});}`);
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
    // Build the sheet: the canvases in the auto grid (the same layout as the preview, real canvas sizes),
    // plus (optionally) the style labels strip.
    const grid = el('div', { class: 'export-grid' });
    applyGridLayout(grid, canvases.length);
    canvases.forEach((cv, i) => {
      const cell = renderCanvasCell(cv, i, { interactive: false });   // label above + canvas, same as the preview
      cell.querySelector('.canvas').style.boxShadow = 'none';         // shadows would be clipped at the sheet edge
      grid.append(cell);
    });
    const usage = collectUsage(canvases);
    const sheet = el('div', { class: 'export-sheet', style: { padding: `${PAD}px`, background: solid ? '#FFFFFF' : 'transparent' } }, grid);
    clear(root).append(sheet);

    await document.fonts.ready;
    // Dynamic canvases size themselves from their content, so the grid's width is only known once it is laid out
    // (after the fonts are ready). The strip is made exactly that wide.
    if (styleLabels) sheet.append(buildStrip(usage, grid.offsetWidth));
    const fontEmbedCSS = await buildFontCss([...usage.fonts.values()]);
    const options = { pixelRatio: scale, cacheBust: false, fontEmbedCSS, ...(solid ? { backgroundColor: '#FFFFFF' } : {}) };
    let dataUrl;
    if (format === 'jpeg') {
      dataUrl = await window.htmlToImage.toJpeg(sheet, { ...options, quality: 0.95 });
    } else if (format === 'webp') {
      // html-to-image has no WebP function: render to a <canvas>, then let the browser encode it (keeps transparency).
      const canvas = await window.htmlToImage.toCanvas(sheet, options);
      dataUrl = canvas.toDataURL('image/webp', 0.92);
    } else {
      dataUrl = await window.htmlToImage.toPng(sheet, options);
    }

    const result = await window.api.saveExport(dataUrl, format);
    if (result.saved) showToast(`exported ${result.path.split(/[\\/]/).pop()}`);
  } finally {
    clear(root);
    btn.disabled = false;
    btn.textContent = 'export';
  }
}
