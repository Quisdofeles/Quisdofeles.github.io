// outline.js: the accent outline that shows EXACTLY what a color or font is about to change.
// It is shown while a color/font is dragged over a target and while a color row in the properties panel is
// hovered. It only decorates the live preview DOM (CSS classes + one temporary clone), never the state, and the
// export builds its own DOM, so an outline can never appear in an exported image.
//
// A target is one of:
//   { type: 'canvas', canvasId }               -> the canvas edge (its background)
//   { type: 'text',   blockId }                -> the glyphs of that text block
//   { type: 'text',   blockIds: [...] }        -> the glyphs of several text blocks at once (a font dropped on a multi-selection)
//   { type: 'layer',  blockId, layer }         -> the shapes of one first-level layer of a vector block

import { $ } from './util.js';

let active = null;     // { key, node, undo } for the outline currently shown (node = the element carrying it)

// A string that identifies a target (so asking for the same outline again does nothing).
const keyOf = (t) => `${t.type}:${t.canvasId || ''}:${t.blockId || (t.blockIds || []).join(',')}:${t.layer === undefined ? '' : t.layer}`;

const grid = () => $('#canvas-grid');

// Removes whatever outline is showing.
export function clearOutline() {
  if (active) { active.undo(); active = null; }
}

// Shows the outline for `target` (replacing any other). Does nothing if the target isn't on screen.
export function showOutline(target) {
  if (!target) { clearOutline(); return; }
  const key = keyOf(target);
  // Same target and its element is still on screen: nothing to do. (If the preview was redrawn since, the old
  // element is gone, so the outline is applied again to the new one.)
  if (active && active.key === key && active.node.isConnected) return;
  clearOutline();
  const applied = apply(target);
  if (applied) active = { key, ...applied };
}

// Applies the outline. Returns { node, undo } (undo removes it), or null if the target wasn't found.
function apply(t) {
  if (t.type === 'canvas') {
    const card = grid().querySelector(`.canvas[data-id="${t.canvasId}"]`);
    if (!card) return null;
    card.classList.add('pick-bg');                      // draws an accent frame just inside the canvas edge
    return { node: card, undo: () => card.classList.remove('pick-bg') };
  }

  if (t.type === 'text') {
    // One block or several. Each gets an accent stroke around every character (see preview.css).
    const blocks = (t.blockIds || [t.blockId]).map((id) => grid().querySelector(`.block[data-id="${id}"]`)).filter(Boolean);
    if (!blocks.length) return null;
    blocks.forEach((b) => b.classList.add('pick-text'));
    return { node: blocks[0], undo: () => blocks.forEach((b) => b.classList.remove('pick-text')) };
  }

  const block = grid().querySelector(`.block[data-id="${t.blockId}"]`);
  if (!block) return null;

  if (t.type === 'layer') {
    const layer = block.querySelector(`svg [data-layer="${t.layer}"]`);
    if (!layer) return null;
    // A copy of the layer, placed right after it (so it gets the same transforms), with every fill removed and
    // every shape stroked in the accent color. See .pick-layer in preview.css.
    const copy = layer.cloneNode(true);
    copy.removeAttribute('data-layer');
    copy.classList.add('pick-layer');
    layer.after(copy);
    return { node: copy, undo: () => copy.remove() };
  }
  return null;
}
