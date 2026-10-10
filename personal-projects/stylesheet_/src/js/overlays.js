// overlays.js: toasts (non-blocking notices), the confirm dialog, the help overlay, and the settings
// overlay (clear canvas, open library folder, default export scale, trash, version).

import { el, clear, $ } from './util.js';
import {
  state, subscribe, clearCanvases, setExport, setHelpSeen, restoreTrash, purgeTrash, trashFileOf, trashLabel,
} from './state.js';

// ---------- Toasts ----------
// A small notice at the bottom of the window that fades after a few seconds. Never blocks anything.
export function showToast(message, { warn = false, ms = 4500 } = {}) {
  const root = $('#overlay-root');
  let stack = $('.toast-stack', root);
  if (!stack) { stack = el('div', { class: 'toast-stack' }); root.append(stack); }
  const toast = el('div', { class: 'toast' + (warn ? ' warn' : ''), text: message });
  stack.append(toast);
  setTimeout(() => { toast.remove(); }, ms);
}

// ---------- Confirm dialog ----------
// Resolves true if the user confirms, false on cancel / Esc / clicking outside.
export function confirmDialog({ title, message, confirmLabel = 'confirm', danger = false }) {
  return new Promise((resolve) => {
    const finish = (value) => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
      else if (e.key === 'Enter') { e.stopPropagation(); finish(true); }
    };
    const confirmBtn = el('button', { class: 'btn' + (danger ? ' btn-danger' : ''), style: { height: '32px' }, text: confirmLabel, on: { click: () => finish(true) } });
    const backdrop = el('div', { class: 'modal-backdrop', on: { mousedown: (e) => { if (e.target === backdrop) finish(false); } } },
      el('div', { class: 'modal', style: { width: '400px' }, role: 'dialog' },
        el('div', { class: 'modal-head' }, el('span', { class: 'section-label', text: title })),
        el('div', { class: 'modal-body' }, el('p', { class: 'modal-text', text: message })),
        el('div', { class: 'modal-actions' },
          el('button', { class: 'btn', style: { height: '32px' }, text: 'cancel', on: { click: () => finish(false) } }),
          confirmBtn)));
    $('#overlay-root').append(backdrop);
    document.addEventListener('keydown', onKey, true);
    confirmBtn.focus();
  });
}

// ---------- Help overlay ----------
// Dims the app and shows four step cards in ONE centered row, always in the order 01, 02, 03, 04.
// The cards are no longer tied to the panels they describe; the row (flex, equal gaps, equal widths) is
// centered in the window by CSS. Its top edge is HELP_TOP below the top of the preview panel (unchanged height).
// Each card is only as tall as its own text (tops aligned). Below the row sits one wide IMPORT TIPS box
// (HELP_TIPS, three columns) whose edges line up with card 01 and card 04.
// Click anywhere or press Esc to close.
const HELP_TOP = 120;
const HELP_CALLOUTS = [
  { title: '01 — LIBRARY', text: 'Everything you bring in lives here. Use + import for media (svg, png, jpg) and fonts, and + add for colors and palettes. Files are copied into the app, so moving or deleting your originals won\'t break anything. Drag any card into the preview or onto a layer. Click a color to edit it. Right-click anything to delete it. Deleted items go to the trash in settings, where you can restore them.' },
  { title: '02 — PREVIEW', text: 'Drag a block or preset onto the grid to start a canvas. Each canvas is one option, labeled A, B, C, and they arrange themselves automatically. Drop a color onto text, onto one part of a vector, or onto the background to change just that one thing. Click to select. Use − / + or fit to zoom, and hold space or the middle mouse button to pan.' },
  { title: '03 — EDITOR', text: 'Layers shows every canvas and the blocks inside it. Drag rows to reorder, double-click to rename, and click the eye to hide. Ctrl+D duplicates, which is the fastest way to make another option. Properties changes the selected item, and its colors section only ever changes that one item: a canvas background, a text color, or one part of a vector.' },
  { title: '04 — EXPORT', text: 'Exports every visible canvas as one image. Hidden canvases are skipped. Style labels adds a strip listing the colors, fonts, and media you used. PNG can have a transparent background, JPEG can\'t. Use 2× or 4× for a sharper image.' },
];
// The three columns of the IMPORT TIPS box under the step cards.
const HELP_TIPS = [
  { title: 'MEDIA', text: 'Use + import in media for .svg, .png, and .jpg files. SVGs can be recolored part by part. PNG and JPG images can\'t be recolored, so use them for photos or textures.' },
  { title: 'SVG SETUP', text: 'Each top-level layer or group in your SVG becomes one part you can recolor, so put each piece you want to color separately on its own layer before exporting. No layer naming needed. Parts keep their original colors until you change them, and a recolored part becomes one solid color. Fit the artboard tightly to your artwork, with no extra space between the vector and the edge of the document. Convert any text to outlines first.' },
  { title: 'FONTS', text: 'Use + import in fonts for .ttf, .otf, .woff, or .woff2 files. Each file is one weight or style, so import every weight you want. Files from the same family group into one card, and you pick the weight in properties. Variable fonts import as a single weight. .ttf or .otf names read most reliably.' },
];

export function openHelp() {
  if ($('.help-overlay')) return;
  const overlay = el('div', { class: 'help-overlay' });
  const top = $('#preview').getBoundingClientRect().top + HELP_TOP;   // the row's vertical position
  const row = el('div', { class: 'help-row' },
    HELP_CALLOUTS.map((c) => el('div', { class: 'help-callout' }, el('b', { text: c.title }), c.text)));
  // The tips box reuses the .help-callout card look; .help-tips only sets its width.
  const tips = el('div', { class: 'help-callout help-tips' },
    el('b', { text: 'IMPORT TIPS' }),
    el('div', { class: 'help-tips-cols' },
      HELP_TIPS.map((t) => el('div', {}, el('h4', { text: t.title }), t.text))));
  const stack = el('div', { class: 'help-stack', style: { top: `${top}px` } }, row, tips);
  const footer = el('div', { class: 'help-footer', text: 'everything saves automatically · ctrl+z to undo · press ? anytime to reopen this · click anywhere to close' });
  overlay.append(stack, footer);
  const close = () => { document.removeEventListener('keydown', onKey, true); overlay.remove(); setHelpSeen(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  $('#overlay-root').append(overlay);
  // Fit check: on short windows the tips box could run into the footer line. Only then switch to the
  // compact look (slightly smaller padding and text, same words). 12px = minimum breathing room.
  if (tips.getBoundingClientRect().bottom + 12 > footer.getBoundingClientRect().top) overlay.classList.add('compact');
}

// ---------- Settings overlay ----------
export function openSettings() {
  if ($('.settings-modal')) return;
  let unsubscribe = null;
  const close = () => { document.removeEventListener('keydown', onKey, true); if (unsubscribe) unsubscribe(); backdrop.remove(); };
  const onKey = (e) => { if (e.key === 'Escape' && !$('.modal-backdrop ~ .modal-backdrop')) { e.stopPropagation(); close(); } };

  // Default export scale (the same setting the export bar uses).
  const scaleSeg = el('div', { class: 'seg' });
  const drawScale = () => {
    clear(scaleSeg);
    [1, 2, 4].forEach((s) => scaleSeg.append(el('button', {
      class: state.session.export.scale === s ? 'active' : '', text: `${s}×`, on: { click: () => setExport({ scale: s }) },
    })));
  };

  // "On launch": maximized | windowed. Stored in settings.json (main reads it before creating the window),
  // so it only takes effect the next time the app starts. The current window is not touched.
  const launchSeg = el('div', { class: 'seg' });
  const drawLaunch = (current) => {
    clear(launchSeg);
    ['maximized', 'windowed'].forEach((mode) => launchSeg.append(el('button', {
      class: current === mode ? 'active' : '', text: mode,
      on: { click: async () => { await window.api.saveSettings({ launch: mode }); drawLaunch(mode); } },
    })));
  };
  window.api.loadSettings().then((s) => drawLaunch(s.launch));

  // Trash: restore items one by one, or empty it for good.
  const trashList = el('div', { class: 'trash-list scroll-area' });
  const emptyBtn = el('button', { class: 'btn btn-danger', text: 'empty trash', on: { click: async () => {
    const n = state.library.trash.length;
    if (!n) return;
    const ok = await confirmDialog({ title: 'empty trash?', message: `${n} item${n === 1 ? '' : 's'} and their files will be deleted permanently. This can't be undone.`, confirmLabel: 'empty trash', danger: true });
    if (!ok) return;
    await window.api.purgeTrashFiles(state.library.trash.map(trashFileOf).filter(Boolean));   // delete files first
    purgeTrash();
  } } });
  const drawTrash = () => {
    clear(trashList);
    emptyBtn.disabled = !state.library.trash.length;
    if (!state.library.trash.length) { trashList.append(el('div', { class: 'trash-empty', text: 'trash is empty' })); return; }
    for (const entry of [...state.library.trash].reverse()) {
      trashList.append(el('div', { class: 'trash-item' },
        el('span', { class: 'name', text: trashLabel(entry) }),
        el('span', { class: 'kind', text: entry.kind.replace('_', ' ') }),
        el('button', { class: 'btn', style: { height: '24px' }, text: 'restore', on: { click: () => {
          if (!restoreTrash(entry.id)) showToast('can\'t restore: its palette was deleted', { warn: true });
        } } })));
    }
  };

  const versionText = el('span', { class: 'muted', text: '…' });
  window.api.getVersion().then((v) => { versionText.textContent = `v${v}`; });

  const row = (label, control) => el('div', { class: 'setting-row' }, el('span', { text: label }), control);
  const backdrop = el('div', { class: 'modal-backdrop', on: { mousedown: (e) => { if (e.target === backdrop) close(); } } },
    el('div', { class: 'modal settings-modal', role: 'dialog' },
      el('div', { class: 'modal-head' }, el('span', { class: 'section-label', text: 'settings' }),
        el('button', { class: 'link-btn', text: 'close', on: { click: close } })),
      el('div', { class: 'modal-body' },
        row('clear canvas', el('button', { class: 'btn btn-danger', text: 'clear', on: { click: async () => {
          const ok = await confirmDialog({ title: 'clear canvas?', message: 'This removes every canvas and leaves one empty canvas. Your library is untouched. You can undo it with Ctrl+Z.', confirmLabel: 'clear', danger: true });
          if (ok) { clearCanvases(); showToast('canvas cleared (Ctrl+Z to undo)'); }
        } } })),
        row('library folder', el('button', { class: 'btn', text: 'open', on: { click: () => window.api.openLibraryFolder() } })),
        row('default export scale', scaleSeg),
        row('on launch', launchSeg),
        el('div', { class: 'setting-row' }, el('span', { class: 'section-label', text: 'trash' }), emptyBtn),
        trashList,
        row('version', versionText))));

  unsubscribe = subscribe((meta) => { if (meta.library || meta.exportSettings || meta.history) { drawScale(); drawTrash(); } });
  drawScale();
  drawTrash();
  document.addEventListener('keydown', onKey, true);
  $('#overlay-root').append(backdrop);
}
