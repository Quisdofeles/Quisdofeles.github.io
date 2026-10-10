// eyedropper.js: the eyedropper tool in the library's colors header (this file is an addition to the CLAUDE.md file list).
// Click the button to switch it on (accent border), then click any color on a canvas in the preview: the
// exact on-screen pixel is read (window.api.samplePixel, which works for images, vectors, text and
// backgrounds alike) and handed to library.js, which adds it as a new library color ready to be named.
//
// The tool switches OFF when:
//   - a color is picked,
//   - the user clicks negative space in the preview (the dot grid or the floating bars' background, not a canvas),
//   - Esc is pressed,
//   - the user clicks anywhere outside the preview panel (any other function), or clicks the button again.
// While it is on, zooming (wheel, the zoom buttons) and panning (space/middle-drag) still work, so you can zoom
// in on a small detail before picking.

import { $ } from './util.js';
import { showToast } from './overlays.js';

let active = false;
let button = null;
let swallowClick = false;   // the click that follows a handled pointerdown must not also select/deselect in preview.js

// Turns the tool on or off and updates the button + the preview's look (crosshair cursor, no selection outlines).
function setActive(on) {
  active = on;
  button.classList.toggle('on', on);
  $('#stage').classList.toggle('eyedropping', on);
}

// Reads the pixel under the pointer and hands it to the library (or explains why nothing happened).
// The tool is switched off only AFTER sampling: switching off brings the selection outlines back, and they
// must not be on screen when the pixel is read.
async function pick(x, y, onPick) {
  let hex = null;
  try { hex = await window.api.samplePixel(x, y); } catch (err) { console.error(err); }
  setActive(false);
  if (hex) onPick(hex);
  else showToast('could not read that color', { warn: true });
}

// Wires the button and the global listeners. onPick(hex) is called with "#RRGGBB" after a successful pick.
export function initEyedropper(btn, onPick) {
  button = btn;
  const preview = $('#preview');
  const stage = $('#stage');

  button.addEventListener('click', () => setActive(!active));

  // Clicks inside the preview. Capture phase on #preview runs BEFORE preview.js's own stage handlers, so a pick
  // never starts a drag-select box, and clicking negative space only switches the tool off.
  preview.addEventListener('pointerdown', (e) => {
    swallowClick = false;
    if (!active || e.button !== 0) return;                        // middle-drag panning keeps working
    if (stage.classList.contains('space-ready')) return;          // space + drag panning keeps working
    if (e.target.closest('button, input, select, label')) return; // zoom / export controls keep working
    e.preventDefault();
    e.stopPropagation();
    swallowClick = true;
    if (e.target.closest('.canvas[data-id]')) pick(e.clientX, e.clientY, onPick);   // a color on a canvas
    else setActive(false);                                                            // negative space
  }, true);
  preview.addEventListener('click', (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation();
  }, true);

  // Any press outside the preview panel (library, editor, top bar...) switches the tool off. The press itself
  // still does its normal job. The eyedropper button is excluded: its own click handler toggles it.
  document.addEventListener('pointerdown', (e) => {
    if (active && !preview.contains(e.target) && !button.contains(e.target)) setActive(false);
  }, true);

  // Esc switches it off (and is used up, so it doesn't also clear the selection).
  document.addEventListener('keydown', (e) => {
    if (active && e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); setActive(false); }
  }, true);
}
