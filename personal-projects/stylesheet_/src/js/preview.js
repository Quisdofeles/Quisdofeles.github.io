// preview.js: the middle panel. Renders every visible canvas ("board" on screen) from state (auto grid, name labels,
// each block's own colors, flex layout, gray placeholders, transforms, text styling), plus selection by clicking,
// zoom and pan, and editing text in place on the board (double-click a text block).
// renderCanvasElement() is also used by export.js, so the exported image is drawn by the same code.

import { el, clear, $, cssColor, contrastColor, hexLabel } from './util.js';
import {
  state, subscribe, isFirstLaunch, visibleCanvases, selectNode, toggleSelect, selectIds, setView, getFont, getMedia, addCanvas,
  findNode, updateNode, endGesture, requestRender,
} from './state.js';
import { fontCss, DEFAULT_FONT_ID } from './fonts.js';
import { buildVectorSvg, mediaUrl } from './svg.js';
import { isTextType, sidesCss, isFillImage, hasVisibleContent, groupClips, opacityOf, blockTransform, GROUP_EMPTY_MIN, EMPTY_SIZE } from './blocks.js';

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
  applyOpacity(node, block);
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

// Opacity (every block, 0–100%): CSS opacity on the block's element, so the whole block fades, children included.
// 100% sets nothing, so a fully opaque block renders exactly as before.
function applyOpacity(node, block) {
  const o = opacityOf(block);
  if (o < 100) node.style.opacity = String(o / 100);
}

// A palette block: a bar of equal color sections (side by side, or stacked when vertical), clipped to its radius.
// Each section is tagged data-section="<index>" so a color can be dropped on exactly one section (dragdrop.js) and
// outlined (outline.js). Labels (the hex and/or the library name) use small IBM Plex Mono text in a dark or light
// color that reads on the section (contrastColor; the alpha is ignored for that choice).
function renderPaletteBar(node, block) {
  Object.assign(node.style, {
    width: `${block.width}px`, height: `${block.height}px`, borderRadius: `${block.radius}px`,
    flexDirection: block.orientation === 'vertical' ? 'column' : 'row',
  });
  block.sections.forEach((s, i) => {
    const sec = el('div', { class: 'palette-section', dataset: { section: String(i) }, style: { background: cssColor(s.hex), color: contrastColor(s.hex) } });
    if (block.names && s.name) sec.append(el('span', { class: 'palette-section-label', text: s.name }));
    if (block.hexLabels) sec.append(el('span', { class: 'palette-section-label', text: hexLabel(s.hex) }));
    node.append(sec);
  });
}

// The text styling of a text block as CSS: tracking (thousandths of an em -> letter-spacing), line height, alignment
// of the lines, case (text-transform: display only, the stored text is unchanged), underline, and wrap:
//   fit   = white-space: pre, no max width: one line per line break, never wraps (a board clips what sticks out);
//   fixed = white-space: pre-wrap inside wrapWidth px (still capped at the container's width, like other blocks).
const CASE_CSS = { none: 'none', upper: 'uppercase', lower: 'lowercase', title: 'capitalize' };
function textStyleCss(b) {
  const fixed = b.wrap === 'fixed';
  return {
    letterSpacing: `${(b.tracking || 0) / 1000}em`,
    lineHeight: String(b.lineHeight || 1.2),
    textAlign: b.textAlign || 'left',
    textTransform: CASE_CSS[b.textCase] || 'none',
    textDecoration: b.underline ? 'underline' : 'none',
    whiteSpace: fixed ? 'pre-wrap' : 'pre',
    width: fixed ? `${b.wrapWidth}px` : '',
    maxWidth: fixed ? '100%' : 'none',
  };
}

// Builds the DOM for one block. Colors and fonts are the block's own. `ctx` = its container (see groupSizing()).
// Hidden blocks are filtered out by renderChildren(), so this always returns an element.
function renderBlock(block, ctx, selectedIds) {
  const node = el('div', { class: `block block-${block.type}` + (selectedIds.has(block.id) ? ' selected' : ''), dataset: { id: block.id } });
  applyOpacity(node, block);
  // Spacing: margin is real layout space (pushes neighbours away in the stack/row). Offset, rotation and mirror are
  // one CSS transform (blockTransform() in blocks.js), so they only change how the block LOOKS: neighbours never
  // move and a dynamic canvas keeps its size. Rotation turns around the block's center.
  node.style.margin = sidesCss(block.margin);
  const transform = blockTransform(block);
  if (transform) node.style.transform = transform;

  if (isTextType(block.type)) {
    // Every text block has its own font. A font that was deleted from the library falls back to Space Grotesk (the default) so the
    // text never disappears (it re-links if the font is restored). Cleared text shows the block's type name, faded.
    const font = getFont(block.font) || getFont(DEFAULT_FONT_ID);
    node.classList.add('block-text');
    node.textContent = block.text || block.type;
    if (!block.text) node.classList.add('is-empty');
    Object.assign(node.style, { ...fontCss(font), fontSize: `${block.size}px`, color: cssColor(block.color), ...textStyleCss(block) });
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
      background: cssColor(block.background), borderRadius: `${block.radius}px`, padding: sidesCss(block.padding),   // cssColor(null) = transparent
    });
    if (groupClips(block)) node.classList.add('clips');
    const inner = groupSizing(node, block, ctx);
    renderChildren(block, node, node, inner, selectedIds);
  } else if (block.type === 'palette') {
    renderPaletteBar(node, block);
  }
  return node;
}

// Builds one canvas card. `interactive` adds the selection outline (the export passes false).
export function renderCanvasElement(canvas, index, { interactive = true } = {}) {
  // Every selected node (canvas or block) gets the selected outline; a canvas is outlined only when it is itself selected.
  const selectedIds = new Set(interactive ? state.session.selection : []);
  const bg = cssColor(canvas.background);       // a background with alpha becomes rgba()
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

// ---------- On-canvas text editing ----------
// Double-clicking a text block makes that block's element editable right where it is (contenteditable
// "plaintext-only": a real blinking cursor and normal text selection, no formatting). Every keystroke updates the
// block's text live (updateNode with live: true, so the WHOLE edit is ONE undo step) and the properties text box.
//   Enter or clicking away -> commit;  Shift+Enter -> a new line;  Esc -> commit and stop editing.
// While editing, the app's shortcuts ignore the keys (they all skip contenteditable targets), and a press inside the
// block never starts a drag-select box. The preview is NOT redrawn on these live ticks (that would throw the cursor
// away); it redraws once when the edit ends (requestRender), which also brings back the faded type name if the text
// was cleared.
let editing = null;      // { id, el } while a text block is being edited on the board

function startTextEdit(id) {
  const hit = findNode(id);
  const elx = document.querySelector(`#canvas-grid .block-text[data-id="${id}"]`);
  if (!hit || !elx) return;
  const block = hit.node;
  editing = { id, el: elx };
  elx.classList.remove('is-empty');
  elx.textContent = block.text;                       // a cleared block showed its faded type name: edit the real (empty) text
  elx.classList.add('editing');
  elx.style.minHeight = `${block.lineHeight || 1.2}em`;   // an empty line keeps its height, so the cursor stays visible
  elx.contentEditable = 'plaintext-only';
  elx.spellcheck = false;
  elx.focus();
  const range = document.createRange();               // start with all the text selected, so typing replaces it
  range.selectNodeContents(elx);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  elx.addEventListener('input', () => {
    const text = elx.textContent;
    updateNode(id, { text }, { live: true });
    const box = document.querySelector(`#props .text-input[data-block="${id}"]`);   // keep the properties box in sync
    if (box) { box.value = text; box.rows = Math.min(4, Math.max(1, text.split('\n').length)); }
  });
  elx.addEventListener('keydown', (e) => {
    e.stopPropagation();                              // nothing reaches the app shortcuts while typing here
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); document.execCommand('insertLineBreak'); }   // a "\n" in plaintext-only
    else if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); finishTextEdit(); }
  });
  elx.addEventListener('blur', finishTextEdit);       // clicking away commits
}

// Ends the edit: the text was already saved live, so this just closes the undo step and redraws.
function finishTextEdit() {
  if (!editing) return;
  const { el: elx } = editing;
  editing = null;
  endGesture();
  elx.contentEditable = 'false';
  elx.blur();
  requestRender();
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
    if (editing && editing.el.contains(e.target)) return;         // inside the text being edited: select text, no box
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

  // Double-click a text block: select it and edit its text IN PLACE on the board (see startTextEdit below).
  stage.addEventListener('dblclick', (e) => {
    const textEl = e.target.closest('.block-text[data-id]');
    if (!textEl || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (editing && editing.id === textEl.dataset.id) return;     // already editing it: the double-click selects a word
    selectNode(textEl.dataset.id);
    startTextEdit(textEl.dataset.id);
  });

  // Click a block -> select it; click a canvas -> select the canvas; click the dot grid -> deselect.
  // Ctrl+click or Shift+click adds the block/canvas to the selection (or removes it if it is already in).
  stage.addEventListener('click', (e) => {
    if (editing && editing.el.contains(e.target)) return;       // clicks inside the text being edited only move the cursor
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
    if (editing && meta.live) return;      // typing on the board: the edited element already shows the text (keeps the cursor)
    if (meta.exportSettings && state.session.export.canvasLabels === labelsShown) return;
    labelsShown = state.session.export.canvasLabels;
    renderGrid();
    applyView();
    // Safety: something else redrew the board in the middle of an edit (the edited element is gone): end the edit.
    if (editing && !document.contains(editing.el)) { editing = null; endGesture(); }
  });
  // The window can be resized; keep things where they are (no re-fit), but nothing else to do.
}
