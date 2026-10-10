// preview.js: the middle panel. Renders every visible canvas from state (auto grid, OPTION labels,
// each block's own colors, flex layout, gray placeholders), plus selection by clicking, zoom and pan.
// renderCanvasElement() is also used by export.js, so the exported image is drawn by the same code.

import { el, clear, $, contrastColor } from './util.js';
import {
  state, subscribe, isFirstLaunch, visibleCanvases, selectNode, toggleSelect, selectIds, setGroupCollapsed, setView, getFont, getMedia, addCanvas,
} from './state.js';
import { fontCss, DEFAULT_FONT_ID } from './fonts.js';
import { buildVectorSvg, mediaUrl } from './svg.js';
import { isTextType } from './blocks.js';

const MIN_ZOOM = 0.25, MAX_ZOOM = 4;
// Where the canvas grid's top-left sits inside the stage at pan (0, 0): below the floating top bar.
const ORIGIN = { x: 24, y: 100 };
// Space the floating bars use. bottom = 24 inset + 98 two-row export bar + 20 breathing room.
const FIT_RESERVED = { left: 24, right: 24, top: 100, bottom: 142 };

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

// Builds the DOM for one block. Colors and fonts are the block's own.
// Returns null for hidden blocks (they are not rendered at all).
function renderBlock(block, canvas, selectedIds) {
  if (block.hidden) return null;
  const node = el('div', { class: `block block-${block.type}` + (selectedIds.has(block.id) ? ' selected' : ''), dataset: { id: block.id } });

  if (isTextType(block.type)) {
    // Every text block has its own font. A font that was deleted from the library falls back to Space Grotesk (the default) so the
    // text never disappears (it re-links if the font is restored). Cleared text shows the block's type name, faded.
    const font = getFont(block.font) || getFont(DEFAULT_FONT_ID);
    node.classList.add('block-text');
    node.textContent = block.text || block.type;
    if (!block.text) node.classList.add('is-empty');
    Object.assign(node.style, { ...fontCss(font), fontSize: `${block.size}px`, color: block.color });
  } else if (block.type === 'vector') {
    // A layer with no stored color keeps the original colors from the file.
    const colorFor = (layer) => (block.layerColors || {})[layer] || null;
    const svg = getMedia(block.mediaId) && buildVectorSvg(block.mediaId, colorFor, block.width);
    node.append(svg || placeholder('box', 'vector', block.width));
  } else if (block.type === 'image') {
    const vec = getMedia(block.mediaId);
    node.append(vec ? el('img', { src: mediaUrl(vec), alt: vec.name, style: { width: `${block.width}px` }, draggable: false }) : placeholder('box', 'image', block.width));
  } else if (block.type === 'spacer') {
    node.style.width = node.style.height = `${block.size}px`;
  } else if (block.type === 'group') {
    applyLayout(node, block.layout, 'flex-start');
    block.children.forEach((child) => { const c = renderBlock(child, canvas, selectedIds); if (c) node.append(c); });
  }
  return node;
}

// Builds one canvas card. `interactive` adds the selection outline (the export passes false).
export function renderCanvasElement(canvas, index, { interactive = true } = {}) {
  // Every selected node (canvas or block) gets the selected outline; a canvas is outlined only when it is itself selected.
  const selectedIds = new Set(interactive ? state.session.selection : []);
  const bg = canvas.background;
  const card = el('div', {
    class: 'canvas' + (selectedIds.has(canvas.id) ? ' selected' : ''),
    dataset: { id: canvas.id },
    style: { background: bg, aspectRatio: String(canvas.aspect || 8 / 9) },
  });
  // The "canvas labels" export setting hides the OPTION label in the preview AND the export (both use this function).
  // The label is absolutely positioned, so leaving it out never moves or resizes anything.
  if (state.session.export.canvasLabels) {
    card.append(el('div', { class: 'canvas-label', text: optionLabel(index), style: { color: contrastColor(bg), opacity: '0.6' } }));
  }
  const content = el('div', { class: 'canvas-content' });
  applyLayout(content, canvas.layout, 'center');
  canvas.children.forEach((child) => { const c = renderBlock(child, canvas, selectedIds); if (c) content.append(c); });
  card.append(content);
  return card;
}

// ---------- Grid + view ----------
let lastCount = null;
let zoomEditing = false;   // true while the zoom percent is an input

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
  // Same values as CSS variables, for the wider dot grid used when the glass panels are on (end of preview.css).
  stage.style.setProperty('--dot-size', `${18 * zoom}px`);
  stage.style.setProperty('--dot-x', `${x}px`);
  stage.style.setProperty('--dot-y', `${y}px`);
  if (!zoomEditing) $('#zoom-val').textContent = `${Math.round(zoom * 100)}%`;   // don't wipe the input while typing
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

// ---------- Typed zoom ----------
// Double-clicking the percent swaps it for a small input (digits only). Enter / click away applies it,
// Esc cancels. The value is clamped to 25-400 and zooms around the center of the preview.
function startZoomEdit() {
  if (zoomEditing) return;
  zoomEditing = true;
  const label = $('#zoom-val');
  const input = el('input', { type: 'text', class: 'zoom-input', inputMode: 'numeric', maxLength: 3, spellcheck: false });
  input.value = String(Math.round(state.session.zoom * 100));
  label.textContent = '';
  label.append(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = (apply) => {
    if (finished) return;
    finished = true;
    zoomEditing = false;
    const n = parseInt(input.value, 10);
    input.remove();
    if (apply && !Number.isNaN(n)) {                      // empty / invalid just cancels
      const c = stageCenter();
      zoomAt(Math.min(400, Math.max(25, n)) / 100, c.x, c.y);
    }
    applyView();                                           // puts the plain "NN%" text back
  };
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, ''); });   // digits only
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();                                   // typing must not trigger app shortcuts
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

// ---------- Interaction ----------
const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

function initInteraction() {
  const stage = $('#stage');
  let spaceDown = false;
  let pan = null;          // { startX, startY, origin: {x, y} } while dragging
  let didPan = false;      // so the click that ends a pan doesn't also deselect
  let didMarquee = false;  // same for the click that ends a drag-select box

  // Mouse wheel zooms around the cursor, with or without Ctrl (a trackpad pinch arrives as Ctrl + wheel, so it works too).
  // Listening on the whole preview panel means the floating bars don't swallow the wheel, but they are never scaled
  // themselves (only the canvas grid is transformed). Multiplicative steps: one standard wheel notch (100px)
  // is x1.1, and smaller deltas from trackpads / hi-res wheels scale down proportionally instead of jumping.
  $('#preview').addEventListener('wheel', (e) => {
    e.preventDefault();
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 33;          // wheel reports "lines": convert to roughly pixels
    else if (e.deltaMode === 2) delta *= 400;    // "pages"
    delta = Math.max(-300, Math.min(300, delta)); // cap so one fast flick can't zoom wildly
    const r = stage.getBoundingClientRect();
    zoomAt(state.session.zoom * Math.pow(1.1, -delta / 100), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  // The +/- buttons step 10% around the middle of the stage.
  const step = (delta) => { const c = stageCenter(); zoomAt(Math.round((state.session.zoom + delta) * 100) / 100, c.x, c.y); };
  $('#zoom-in').addEventListener('click', () => step(0.1));
  $('#zoom-out').addEventListener('click', () => step(-0.1));
  $('#zoom-fit').addEventListener('click', fit);
  $('#zoom-val').addEventListener('dblclick', startZoomEdit);

  // Empty-state button: adds one empty canvas (same as dropping the canvas block on the empty grid; one undo step).
  $('#btn-add-canvas').addEventListener('click', (e) => {
    e.stopPropagation();                 // don't let the stage's click handler deselect the new canvas right away
    addCanvas();
  });

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

  // Drag-select: press anywhere on the stage (not for panning) and drag to draw a dashed box. Whatever the box touches
  // is selected, following the multi-select rules: touching two or more canvases selects just those canvases;
  // inside one canvas it selects the blocks the box touches (or the canvas itself if it touches no block).
  // The selection updates live while dragging. Blocks can't be dragged on the canvas (layout is flexbox), so a
  // drag that starts on a block is free to be a box too.
  const DRAG_THRESHOLD = 4;   // px of movement before a press counts as a drag (below that it is still a click)
  const touches = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const idsInBox = (box) => {
    const hitCanvases = [...stage.querySelectorAll('.canvas[data-id]')].filter((c) => touches(box, c.getBoundingClientRect()));
    if (hitCanvases.length > 1) return hitCanvases.map((c) => c.dataset.id);
    if (!hitCanvases.length) return [];
    const blocks = [...hitCanvases[0].querySelectorAll('.block[data-id]')].filter((b) => touches(box, b.getBoundingClientRect()));
    return blocks.length ? blocks.map((b) => b.dataset.id) : [hitCanvases[0].dataset.id];
  };
  stage.addEventListener('pointerdown', (e) => {
    didMarquee = false;                                           // forget any drag from before
    if (e.button !== 0 || spaceDown || e.target.closest('button')) return;
    const startX = e.clientX, startY = e.clientY;
    let box = null;                                               // the dashed rectangle element once the drag starts
    const onMove = (ev) => {
      if (!box && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return;
      if (!box) { box = el('div', { class: 'marquee' }); document.body.append(box); }
      const rect = { left: Math.min(startX, ev.clientX), top: Math.min(startY, ev.clientY), right: Math.max(startX, ev.clientX), bottom: Math.max(startY, ev.clientY) };
      Object.assign(box.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.right - rect.left}px`, height: `${rect.bottom - rect.top}px` });
      selectIds(idsInBox(rect));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (box) { box.remove(); didMarquee = true; }               // the click that follows must not undo the selection
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });

  // Double-click a text block: select it and put the cursor in the properties text box with the text selected, so you
  // can type straight away (the text is edited in the properties panel, not on the canvas).
  stage.addEventListener('dblclick', (e) => {
    const textEl = e.target.closest('.block-text[data-id]');
    if (!textEl || e.ctrlKey || e.metaKey || e.shiftKey) return;
    selectNode(textEl.dataset.id);
    if (state.session.collapsedGroups.block) setGroupCollapsed('block', false);   // the text box lives in the (collapsed?) block group
    const input = document.querySelector('#props .text-input');
    if (input) { input.focus(); input.select(); }
  });

  // Click a block -> select it; click a canvas -> select the canvas; click the dot grid -> deselect.
  // Ctrl+click or Shift+click adds the block/canvas to the selection (or removes it if it is already in).
  stage.addEventListener('click', (e) => {
    if (didMarquee) { didMarquee = false; return; }
    if (didPan) { didPan = false; return; }
    if (spaceDown) return;
    const blockEl = e.target.closest('.block[data-id]');
    const canvasEl = e.target.closest('.canvas[data-id]');
    const id = blockEl ? blockEl.dataset.id : canvasEl ? canvasEl.dataset.id : null;
    if (e.ctrlKey || e.metaKey || e.shiftKey) { if (id) toggleSelect(id); return; }   // a modifier-click on empty grid keeps the selection
    selectNode(id);
  });
  // Middle-click shouldn't trigger the browser's auxclick behaviours.
  stage.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
}

export function initPreview() {
  initInteraction();
  renderGrid();
  if (isFirstLaunch) fit(); else applyView();
  applyView();

  // Remembers whether the canvases were last drawn with OPTION labels, so the one export setting that
  // affects the preview ("canvas labels") redraws it, while the other export settings don't.
  let labelsShown = state.session.export.canvasLabels;
  subscribe((meta) => {
    if (meta.view) { applyView(); return; }
    if (meta.ui) return;
    if (meta.exportSettings && state.session.export.canvasLabels === labelsShown) return;
    labelsShown = state.session.export.canvasLabels;
    renderGrid();
    applyView();
  });
  // The window can be resized; keep things where they are (no re-fit), but nothing else to do.
}
