// preview.js: the middle panel. Renders every visible canvas ("board" on screen) from state (auto grid, name labels,
// each block's own colors, flex layout, gray placeholders), plus selection by clicking, zoom and pan.
// renderCanvasElement() is also used by export.js, so the exported image is drawn by the same code.

import { el, clear, $ } from './util.js';
import {
  state, subscribe, isFirstLaunch, visibleCanvases, selectNode, toggleSelect, selectIds, setGroupCollapsed, setView, getFont, getMedia, addCanvas,
} from './state.js';
import { fontCss, DEFAULT_FONT_ID } from './fonts.js';
import { buildVectorSvg, mediaUrl } from './svg.js';
import { isTextType, sidesCss, isFillImage, hasVisibleContent, groupClips, GROUP_EMPTY_MIN, EMPTY_SIZE } from './blocks.js';

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

export const GRID_GAP = 20;     // px between canvases, in the preview and the export

// Lays out a grid element holding `count` canvases (used by the preview AND the export, so they always match).
// Canvases can be different sizes: CSS grid `auto` tracks make every column as wide as its widest canvas and every
// row as tall as its tallest one, and each canvas is centered in its cell. `max-content` stops the grid from being
// squeezed by the window width (that would wrap the text in dynamic canvases).
export function applyGridLayout(grid, count) {
  Object.assign(grid.style, {
    display: 'grid',
    gridTemplateColumns: `repeat(${gridColumns(count)}, auto)`,
    gap: `${GRID_GAP}px`,
    placeItems: 'center',
    width: 'max-content',
  });
}

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

// ---------- Container backgrounds (boards and groups) ----------
// Paint order inside a board or group, back to front:
//   1. its background color (on the element itself)
//   2. its background image (bgImage), then any fill images (image blocks with fill on), in layer order
//   3. its normal content (the flex flow)
// 2 lives in one .bg-layer: absolutely positioned over the whole element (padding ignored), clipped to the corner
// radius, at z-index -1. The board/group is `isolation: isolate` (preview.css), so -1 means "above my own
// background, below my content". Returns null when there is nothing to draw there.
function backgroundLayer(container, fillImages, selectedIds) {
  if (!container.bgImage && !fillImages.length) return null;
  const layer = el('div', { class: 'bg-layer' });
  const bi = container.bgImage;
  if (bi) {
    const item = getMedia(bi.mediaId);
    // SVGs are shown as the file is (original colors); a missing item (preset slot, deleted media) is gray.
    layer.append(item
      ? el('img', { class: 'bg-image', src: mediaUrl(item), alt: '', draggable: false, style: { objectFit: bi.fit } })
      : el('div', { class: 'placeholder bg-placeholder' }));
  }
  fillImages.forEach((b) => layer.append(renderFillImage(b, selectedIds)));
  return layer;
}

// An image block with fill on: covers its parent edge to edge (object-fit: cover). It is still a normal block
// (data-id), so it can be clicked/selected; its width, margin and offset are not used.
function renderFillImage(block, selectedIds) {
  const node = el('div', { class: 'block block-image fill-image' + (selectedIds.has(block.id) ? ' selected' : ''), dataset: { id: block.id } });
  const item = getMedia(block.mediaId);
  node.append(item
    ? el('img', { src: mediaUrl(item), alt: item.name, draggable: false })
    : el('div', { class: 'placeholder bg-placeholder', text: 'image' }));
  return node;
}

// Renders a container's children: fill images go into its background layer, everything else into `flow`.
// `ctx` describes the container for its children's sizing (see groupSizing()).
function renderChildren(container, host, flow, ctx, selectedIds) {
  const visible = container.children.filter((c) => !c.hidden);
  const layer = backgroundLayer(container, visible.filter(isFillImage), selectedIds);
  if (layer) host.prepend(layer);
  visible.filter((c) => !isFillImage(c)).forEach((child) => flow.append(renderBlock(child, ctx, selectedIds)));
}

// Group sizing. `ctx` = the parent container: { direction: 'stack' | 'row', defW, defH }, where defW/defH say whether
// the parent has a size of its own on that axis (a fixed board: yes; a dynamic board: no; a group: a fixed axis yes,
// a fill axis only if ITS parent's is, a fit axis no). Fill only works against a definite parent axis; otherwise it
// behaves like fit, except that an EMPTY group gets 160px on that axis (not the 40px minimum). Along the parent's direction fill = flex: 1 (fill siblings share the space equally); across
// it, fill = stretch. Returns the ctx for the group's own children.
function groupSizing(node, group, ctx) {
  const s = group.size;
  const empty = !hasVisibleContent(group);
  const axes = [
    { prop: 'width', mode: s.widthMode, value: s.width, def: ctx.defW, main: ctx.direction === 'row', min: 'minWidth' },
    { prop: 'height', mode: s.heightMode, value: s.height, def: ctx.defH, main: ctx.direction !== 'row', min: 'minHeight' },
  ];
  for (const a of axes) {
    if (a.mode === 'fixed') {
      node.style[a.prop] = `${a.value}px`;
      if (a.main) node.style.flexShrink = '0';                // a fixed size never gets squeezed by its neighbours
      continue;
    }
    if (a.mode === 'fill' && a.def) {
      if (a.main) { node.style.flex = '1 1 0'; node.style[a.min] = '0'; } else node.style.alignSelf = 'stretch';
    } else if (a.mode === 'fill' && empty) {
      // Fill can't resolve here (dynamic board or fit group) and there is no content to fit: use 160px on this
      // axis (like a fixed size) instead of collapsing to the 40px minimum. With content it fits the content.
      node.style[a.prop] = `${EMPTY_SIZE}px`;
      if (a.main) node.style.flexShrink = '0';
      continue;
    }
    if (empty) node.style[a.min] = `${GROUP_EMPTY_MIN}px`;   // an empty fit/fill group stays visible and droppable
  }
  return {
    direction: group.layout.direction,
    defW: s.widthMode === 'fixed' || (s.widthMode === 'fill' && ctx.defW),
    defH: s.heightMode === 'fixed' || (s.heightMode === 'fill' && ctx.defH),
  };
}

// Builds the DOM for one block. Colors and fonts are the block's own. `ctx` = its container (see groupSizing()).
// Hidden blocks are filtered out by renderChildren(), so this always returns an element.
function renderBlock(block, ctx, selectedIds) {
  const node = el('div', { class: `block block-${block.type}` + (selectedIds.has(block.id) ? ' selected' : ''), dataset: { id: block.id } });
  // Spacing: margin is real layout space (pushes neighbours away in the stack/row); offset is a transform, so it only
  // moves the block visually and never shifts neighbours or changes a dynamic canvas's size.
  node.style.margin = sidesCss(block.margin);
  if (block.offset.x || block.offset.y) node.style.transform = `translate(${block.offset.x}px, ${block.offset.y}px)`;

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
  } else if (block.type === 'group') {
    // Like a small board: its own background (null = transparent), corner radius, padding and layout. Content is
    // centered along the flow like a board's (only noticeable when the group is bigger than its content).
    // Only a fit × fit group (e.g. one made with Ctrl+G) lets content stick out; any other group clips it.
    applyLayout(node, block.layout, 'center');
    Object.assign(node.style, {
      background: block.background || 'transparent', borderRadius: `${block.radius}px`, padding: sidesCss(block.padding),
    });
    if (groupClips(block)) node.classList.add('clips');
    const inner = groupSizing(node, block, ctx);
    renderChildren(block, node, node, inner, selectedIds);
  }
  return node;
}

// Builds one canvas card. `interactive` adds the selection outline (the export passes false).
export function renderCanvasElement(canvas, index, { interactive = true } = {}) {
  // Every selected node (canvas or block) gets the selected outline; a canvas is outlined only when it is itself selected.
  const selectedIds = new Set(interactive ? state.session.selection : []);
  const bg = canvas.background;
  // Fixed: the card is exactly width × height (content that doesn't fit is clipped by .canvas overflow: hidden).
  // Dynamic: no size is set; the card shrink-wraps its content plus padding (.canvas.dynamic in preview.css).
  // The corner radius is the canvas's own (canvas.radius); overflow: hidden clips the content and, in a transparent
  // PNG/WebP export, leaves the area outside the rounded corners transparent.
  const dynamic = canvas.size.mode === 'dynamic';
  const look = { background: bg, borderRadius: `${canvas.radius}px` };
  const card = el('div', {
    class: 'canvas' + (dynamic ? ' dynamic' : '') + (selectedIds.has(canvas.id) ? ' selected' : ''),
    dataset: { id: canvas.id },
    style: dynamic ? look : { ...look, width: `${canvas.size.width}px`, height: `${canvas.size.height}px` },
  });
  // (The name label is not inside the card: renderCanvasCell() puts it above the canvas.)
  // Padding = the space between the content and the canvas edge, per side (top, right, bottom, left).
  const content = el('div', { class: 'canvas-content', style: { padding: sidesCss(canvas.padding) } });
  applyLayout(content, canvas.layout, 'center');
  card.append(content);
  // A fixed board has a definite width and height, so groups inside can fill it; a dynamic one has neither.
  const ctx = { direction: canvas.layout.direction, defW: !dynamic, defH: !dynamic };
  renderChildren(canvas, card, content, ctx, selectedIds);    // the background layer goes into the card, under the content
  return card;
}

// One grid cell: the canvas's NAME as a label ABOVE the canvas (exactly as typed, e.g. "Board 1"), left-aligned with its
// edge, then the canvas card. Used by the preview AND the export, so both match; renaming a canvas in the layers tree
// redraws both. The label sits outside the card so it never overlaps content, whatever the padding. The
// "board labels" export setting (session.export.canvasLabels) leaves it out (and the space it took) in both.
export function renderCanvasCell(canvas, index, opts = {}) {
  const cell = el('div', { class: 'canvas-cell' });
  if (state.session.export.canvasLabels) cell.append(el('div', { class: 'canvas-label', text: canvas.name }));
  cell.append(renderCanvasElement(canvas, index, opts));
  return cell;
}

// ---------- Grid + view ----------
let lastCount = null;
let zoomEditing = false;   // true while the zoom percent is an input

function renderGrid() {
  const grid = $('#canvas-grid');
  const visible = visibleCanvases();
  applyGridLayout(grid, visible.length);
  clear(grid);
  visible.forEach((cv, i) => grid.append(renderCanvasCell(cv, i)));
  $('#grid-info').textContent = `auto grid · ${visible.length} board${visible.length === 1 ? '' : 's'}`;
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
    if (state.session.collapsedGroups.text) setGroupCollapsed('text', false);   // the text box lives in the (collapsed?) text group
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

  // Remembers whether the canvases were last drawn with name labels, so the one export setting that
  // affects the preview ("board labels") redraws it, while the other export settings don't.
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
