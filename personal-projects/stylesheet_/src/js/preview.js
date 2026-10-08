// preview.js: the middle panel. Renders every visible canvas from state (auto grid, OPTION labels,
// the roles cascade, flex layout, gray placeholders), plus selection by clicking, zoom and pan.
// renderCanvasElement() is also used by export.js, so the exported image is drawn by the same code.

import { el, clear, $, contrastColor } from './util.js';
import {
  state, subscribe, isFirstLaunch, visibleCanvases, selectedCanvas, selectNode, setView, getFont, getVector,
} from './state.js';
import { cssFamily } from './fonts.js';
import { buildVectorSvg, vectorUrl } from './svg.js';
import { isTextType, ROLE_NAMES } from './blocks.js';

const MIN_ZOOM = 0.25, MAX_ZOOM = 4;
// Where the canvas grid's top-left sits inside the stage at pan (0, 0): below the floating top bar.
const ORIGIN = { x: 24, y: 100 };
const FIT_RESERVED = { left: 24, right: 24, top: 100, bottom: 102 };   // space the floating bars use

// Auto grid: 1 -> 1 col, 2 -> 2, 3-4 -> 2, 5-6 -> 3, 7-9 -> 3 (never set manually). Beyond 9 we keep it square-ish.
export function gridColumns(n) {
  if (n <= 1) return 1;
  if (n <= 4) return 2;
  if (n <= 9) return 3;
  return Math.ceil(Math.sqrt(n));
}

// "OPTION A", "OPTION B"... by position among visible canvases.
export const optionLabel = (index) => `OPTION ${String.fromCharCode(65 + (index % 26))}`;

const ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end' };

// Applies a layout ({direction, gap, align}) to a container element using flexbox.
function applyLayout(node, layout, justify) {
  node.style.display = 'flex';
  node.style.flexDirection = layout.direction === 'row' ? 'row' : 'column';
  node.style.gap = `${layout.gap}px`;
  node.style.alignItems = ALIGN[layout.align] || 'center';
  node.style.justifyContent = justify;
  node.classList.add(`align-${layout.align || 'center'}`);
}

// ---------- Blocks ----------
// A gray placeholder for an empty slot (nothing assigned, or its font/vector was deleted).
const placeholder = (kind, label, widthPx) => el('div', {
  class: `placeholder ${kind}`, text: label, style: widthPx ? { width: `${widthPx}px` } : {},
});

// Builds the DOM for one block. Colors and fonts come from the canvas ROLES unless the block has an override.
// Returns null for hidden blocks (they are not rendered at all).
function renderBlock(block, canvas, selectedId) {
  if (block.hidden) return null;
  const node = el('div', { class: `block block-${block.type}` + (block.id === selectedId ? ' selected' : ''), dataset: { id: block.id } });

  if (isTextType(block.type)) {
    const font = getFont(block.fontOverride || canvas.fonts[block.type]);
    if (!font || !block.text) {
      node.append(placeholder('text', block.type));
    } else {
      node.classList.add('block-text');
      node.textContent = block.text;
      Object.assign(node.style, {
        fontFamily: `'${cssFamily(font)}'`, fontWeight: 'normal', fontStyle: 'normal',   // weight/style live in the font file itself
        fontSize: `${block.size}px`, color: block.colorOverride || canvas.roles[block.colorRole],
      });
    }
  } else if (block.type === 'vector') {
    const colorFor = (layer) => block.layerOverrides[layer] || canvas.roles[block.layerRoles[layer] || 'primary'];
    const svg = getVector(block.vectorId) && buildVectorSvg(block.vectorId, colorFor, block.width);
    node.append(svg || placeholder('box', 'vector', block.width));
  } else if (block.type === 'image') {
    const vec = getVector(block.vectorId);
    node.append(vec ? el('img', { src: vectorUrl(vec), alt: vec.name, style: { width: `${block.width}px` }, draggable: false }) : placeholder('box', 'image', block.width));
  } else if (block.type === 'swatch') {
    node.append(el('div', { class: 'block-swatches' }, ROLE_NAMES.map((r) => el('span', { class: 'chip', style: { background: canvas.roles[r] }, title: r }))));
  } else if (block.type === 'spacer') {
    node.style.width = node.style.height = `${block.size}px`;
  } else if (block.type === 'group') {
    applyLayout(node, block.layout, 'flex-start');
    block.children.forEach((child) => { const c = renderBlock(child, canvas, selectedId); if (c) node.append(c); });
  }
  return node;
}

// Builds one canvas card. `interactive` adds the selection outline (the export passes false).
export function renderCanvasElement(canvas, index, { interactive = true } = {}) {
  const selectedId = interactive ? state.session.selectedId : null;
  const owner = interactive ? selectedCanvas() : null;
  const bg = canvas.roles.background;
  const card = el('div', {
    class: 'canvas' + (owner && owner.id === canvas.id ? ' selected' : ''),
    dataset: { id: canvas.id },
    style: { background: bg, aspectRatio: String(canvas.aspect || 8 / 9) },
  });
  card.append(el('div', { class: 'canvas-label', text: optionLabel(index), style: { color: contrastColor(bg), opacity: '0.6' } }));
  const content = el('div', { class: 'canvas-content' });
  applyLayout(content, canvas.layout, 'center');
  canvas.children.forEach((child) => { const c = renderBlock(child, canvas, selectedId); if (c) content.append(c); });
  card.append(content);
  return card;
}

// ---------- Grid + view ----------
let lastCount = null;

function renderGrid() {
  const grid = $('#canvas-grid');
  const visible = visibleCanvases();
  grid.style.gridTemplateColumns = `repeat(${gridColumns(visible.length)}, 384px)`;
  clear(grid);
  visible.forEach((cv, i) => grid.append(renderCanvasElement(cv, i)));
  $('#grid-info').textContent = `auto grid · ${visible.length} canvas${visible.length === 1 ? '' : 'es'}`;
  $('#stage-empty').style.display = visible.length ? 'none' : 'block';
  // When canvases are added/removed the grid changes shape, so re-fit it (not on ordinary edits).
  if (lastCount !== null && lastCount !== visible.length) fit();
  lastCount = visible.length;
}

// Applies zoom + pan to the grid and to the dot-grid background (dots scale and move with the canvases).
function applyView() {
  const { zoom, pan } = state.session;
  const x = ORIGIN.x + pan.x, y = ORIGIN.y + pan.y;
  $('#canvas-grid').style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
  const stage = $('#stage');
  stage.style.backgroundSize = `${18 * zoom}px ${18 * zoom}px`;
  stage.style.backgroundPosition = `${x}px ${y}px`;
  $('#zoom-val').textContent = `${Math.round(zoom * 100)}%`;
}

// Zooms to `newZoom`, keeping the point (cx, cy) (in stage pixels) fixed under the cursor.
function zoomAt(newZoom, cx, cy) {
  const { zoom, pan } = state.session;
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom));
  const wx = (cx - ORIGIN.x - pan.x) / zoom, wy = (cy - ORIGIN.y - pan.y) / zoom;   // world point under the cursor
  setView(z, { x: cx - wx * z - ORIGIN.x, y: cy - wy * z - ORIGIN.y });
}

const stageCenter = () => { const r = $('#stage').getBoundingClientRect(); return { x: r.width / 2, y: r.height / 2 }; };

// Scales and centers the grid so every canvas is visible between the floating bars (never zooms past 100%).
export function fit() {
  const stage = $('#stage'), grid = $('#canvas-grid');
  const gw = grid.offsetWidth, gh = grid.offsetHeight;
  if (!gw || !gh) { setView(1, { x: 0, y: 0 }); return; }
  const availW = stage.clientWidth - FIT_RESERVED.left - FIT_RESERVED.right;
  const availH = stage.clientHeight - FIT_RESERVED.top - FIT_RESERVED.bottom;
  const zoom = Math.max(MIN_ZOOM, Math.min(1, availW / gw, availH / gh));
  const x = FIT_RESERVED.left + (availW - gw * zoom) / 2;
  const y = FIT_RESERVED.top + (availH - gh * zoom) / 2;
  setView(zoom, { x: x - ORIGIN.x, y: y - ORIGIN.y });
}

// ---------- Interaction ----------
const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

function initInteraction() {
  const stage = $('#stage');
  let spaceDown = false;
  let pan = null;          // { startX, startY, origin: {x, y} } while dragging
  let didPan = false;      // so the click that ends a pan doesn't also deselect

  // Ctrl + scroll zooms around the cursor.
  stage.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomAt(state.session.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  // The +/- buttons step 10% around the middle of the stage.
  const step = (delta) => { const c = stageCenter(); zoomAt(Math.round((state.session.zoom + delta) * 100) / 100, c.x, c.y); };
  $('#zoom-in').addEventListener('click', () => step(0.1));
  $('#zoom-out').addEventListener('click', () => step(-0.1));
  $('#zoom-fit').addEventListener('click', fit);
  $('#zoom-val').addEventListener('dblclick', () => { const c = stageCenter(); zoomAt(1, c.x, c.y); });

  // Pan: space + drag, or middle mouse drag.
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || isTyping(e.target) || e.repeat) return;
    spaceDown = true;
    stage.classList.add('space-ready');
    e.preventDefault();
  });
  document.addEventListener('keyup', (e) => {
    if (e.code !== 'Space') return;
    spaceDown = false;
    stage.classList.remove('space-ready');
  });
  stage.addEventListener('pointerdown', (e) => {
    if (!(e.button === 1 || (e.button === 0 && spaceDown))) return;
    e.preventDefault();                       // also stops Windows' middle-click autoscroll
    stage.setPointerCapture(e.pointerId);
    pan = { startX: e.clientX, startY: e.clientY, origin: { ...state.session.pan } };
    didPan = false;
    stage.classList.add('panning');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pan) return;
    const dx = e.clientX - pan.startX, dy = e.clientY - pan.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) didPan = true;
    setView(state.session.zoom, { x: pan.origin.x + dx, y: pan.origin.y + dy });
  });
  const endPan = () => { pan = null; stage.classList.remove('panning'); };
  stage.addEventListener('pointerup', endPan);
  stage.addEventListener('pointercancel', endPan);

  // Click a block -> select it; click a canvas -> select the canvas; click the dot grid -> deselect.
  stage.addEventListener('click', (e) => {
    if (didPan) { didPan = false; return; }
    if (spaceDown) return;
    const blockEl = e.target.closest('.block[data-id]');
    const canvasEl = e.target.closest('.canvas[data-id]');
    selectNode(blockEl ? blockEl.dataset.id : canvasEl ? canvasEl.dataset.id : null);
  });
  // Middle-click shouldn't trigger the browser's auxclick behaviours.
  stage.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
}

export function initPreview() {
  initInteraction();
  renderGrid();
  if (isFirstLaunch) fit(); else applyView();
  applyView();

  subscribe((meta) => {
    if (meta.view) { applyView(); return; }
    if (meta.ui || meta.exportSettings) return;
    renderGrid();
    applyView();
  });
  // The window can be resized; keep things where they are (no re-fit), but nothing else to do.
}
