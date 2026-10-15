// eyedropper.js: the ONE eyedropper tool of the app (this file is an addition to the CLAUDE.md file list).
// Four buttons use it, but only one can run at a time:
//   - SECTION HEADER eyedroppers (colors, palettes) create something NEW from the picked color
//     (addEyedropperButton: the button toggles the tool and shows the "on" look while it is the one running);
//   - EDIT MENU eyedroppers (a color card in edit mode, the palette swatch popover) change the ONE thing being
//     edited (startEyedropper with an onCancel, so the edit menu can come back when nothing was picked).
// While on, click any color on a canvas in the preview: the exact on-screen pixel is read (window.api.samplePixel,
// which works for images, vectors, text and backgrounds alike) and handed to the caller's onPick(hex).
//
// The tool switches OFF (and the caller's onCancel runs, if it has one) when:
//   - the user clicks negative space in the preview (the dot grid or the floating bars' background, not a canvas),
//   - Esc is pressed,
//   - the user presses anywhere outside the preview panel (any other function), or clicks its header button again,
//   - another eyedropper is started (starting one always switches the running one off first).
// A successful pick also switches it off (then onPick runs instead of onCancel).
// While it is on, zooming (wheel, the zoom buttons) and panning (space/middle-drag) still work, so you can zoom
// in on a small detail before picking.

import { $ } from './util.js';
import { showToast } from './overlays.js';

let session = null;         // the running eyedropper: { button, onPick, onCancel }, or null when the tool is off
let swallowClick = false;   // the click that follows a handled pointerdown must not also select/deselect in preview.js

// Switches the tool off and clears its look; returns the session that was running (or null).
function finish() {
  const s = session;
  session = null;
  if (s && s.button) s.button.classList.remove('on');
  $('#stage').classList.remove('eyedropping');
  return s;
}

// Switches the tool off WITHOUT a pick and tells the caller (edit menus reopen with their old values).
// `replaced` = true when it stops because ANOTHER eyedropper is being started; the caller then gets
// onCancel(true), so e.g. the swatch popover doesn't pop back open on top of the new pick.
export function stopEyedropper(replaced = false) {
  const s = finish();
  if (s && s.onCancel) s.onCancel(replaced);
}

// Starts the tool for one caller. `button` (optional) gets the "on" look while this session runs and is the
// button whose own click toggles it (header buttons). Any other running eyedropper is switched off first.
// Every eyedropper button carries the class .eyedropper-btn (see the pointerdown listener in initEyedropper).
export function startEyedropper({ button = null, onPick, onCancel = null }) {
  if (session) stopEyedropper(true);
  session = { button, onPick, onCancel };
  if (button) button.classList.add('on');
  $('#stage').classList.add('eyedropping');   // crosshair cursor + no selection outlines (preview.css)
}

// True while the tool is running for this button.
const runningFor = (button) => !!session && session.button === button;

// A section-header eyedropper: clicking toggles the tool for this button. onPick(hex) creates the new thing.
export function addEyedropperButton(button, onPick) {
  button.classList.add('eyedropper-btn');
  button.addEventListener('click', () => {
    if (runningFor(button)) stopEyedropper();
    else startEyedropper({ button, onPick });
  });
}

// Reads the pixel under the pointer and hands it to the running session (or explains why nothing happened).
// The tool is switched off only AFTER sampling: switching off brings the selection outlines back, and they
// must not be on screen when the pixel is read.
async function pick(x, y) {
  const s = session;
  let hex = null;
  try { hex = await window.api.samplePixel(x, y); } catch (err) { console.error(err); }
  if (session !== s) return;   // switched off (or another eyedropper started) while the pixel was being read
  finish();
  if (hex) { s.onPick(hex); return; }
  showToast('could not read that color', { warn: true });
  if (s.onCancel) s.onCancel();   // an edit menu comes back unchanged
}

// Wires the global listeners once (library.js calls this before adding any eyedropper button).
export function initEyedropper() {
  const preview = $('#preview');
  const stage = $('#stage');

  // Clicks inside the preview. Capture phase on #preview runs BEFORE preview.js's own stage handlers, so a pick
  // never starts a drag-select box, and clicking negative space only switches the tool off.
  preview.addEventListener('pointerdown', (e) => {
    swallowClick = false;
    if (!session || e.button !== 0) return;                       // middle-drag panning keeps working
    if (stage.classList.contains('space-ready')) return;          // space + drag panning keeps working
    if (e.target.closest('button, input, select, label')) return; // zoom / export controls keep working
    e.preventDefault();
    e.stopPropagation();
    swallowClick = true;
    if (e.target.closest('.canvas[data-id]')) pick(e.clientX, e.clientY);   // a color on a canvas
    else stopEyedropper();                                                    // negative space
  }, true);
  preview.addEventListener('click', (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation();
  }, true);

  // Any press outside the preview panel (library, editor, top bar...) switches the tool off. The press itself
  // still does its normal job. The running session's own button is excluded: its click handler toggles it.
  // A press on ANOTHER eyedropper button counts as "replaced" (its click then starts that eyedropper).
  document.addEventListener('pointerdown', (e) => {
    if (!session || preview.contains(e.target)) return;
    if (session.button && session.button.contains(e.target)) return;
    stopEyedropper(!!e.target.closest('.eyedropper-btn'));
  }, true);

  // Esc switches it off (and is used up, so it doesn't also clear the selection or cancel an edit).
  document.addEventListener('keydown', (e) => {
    if (session && e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); stopEyedropper(); }
  }, true);
}
