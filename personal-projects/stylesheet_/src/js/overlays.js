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
    const confirmBtn = el('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), style: { height: '32px' }, text: confirmLabel, on: { click: () => finish(true) } });
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
// Dims the app and places a short callout on each panel. Click anywhere or press Esc to close.
const HELP_CALLOUTS = [
  { target: '#library', title: '01 — library', text: 'Import fonts, SVGs and images. Make colors and palettes. Drag anything from here onto the preview or the layers.', side: 'right' },
  { target: '#preview', title: '02 — preview', text: 'Your canvases in an auto grid. Ctrl + scroll to zoom, space + drag to pan. Drop presets and blocks on the dots to start.', side: 'center' },
  { target: '#editor', title: '03 — editor', text: 'Layers on top, properties below. Change a role color once and everything in that canvas updates. Ctrl+D duplicates, Delete removes, Ctrl+Z undoes.', side: 'left' },
  { target: '#export-bar', title: 'export', text: 'Exports every visible canvas as one image, with optional style labels.', side: 'center-bottom' },
];

export function openHelp() {
  if ($('.help-overlay')) return;
  const overlay = el('div', { class: 'help-overlay' });
  for (const c of HELP_CALLOUTS) {
    const r = $(c.target).getBoundingClientRect();
    const box = el('div', { class: 'help-callout' }, el('b', { text: c.title }), c.text);
    // Place the callout inside the panel it describes.
    if (c.side === 'right') Object.assign(box.style, { left: `${r.left + 16}px`, top: `${r.top + 90}px` });
    else if (c.side === 'left') Object.assign(box.style, { left: `${r.left + 16}px`, top: `${r.top + 90}px` });
    else if (c.side === 'center') Object.assign(box.style, { left: `${r.left + r.width / 2 - 125}px`, top: `${r.top + 120}px` });
    else Object.assign(box.style, { left: `${r.left + r.width / 2 - 125}px`, top: `${r.top - 100}px` });
    overlay.append(box);
  }
  overlay.append(el('div', { class: 'help-rule', text: 'name your layers in Illustrator' }));
  overlay.append(el('div', { class: 'help-close', text: 'click anywhere or press Esc to close' }));
  const close = () => { document.removeEventListener('keydown', onKey, true); overlay.remove(); setHelpSeen(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  $('#overlay-root').append(overlay);
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

  // Trash: restore items one by one, or empty it for good.
  const trashList = el('div', { class: 'trash-list scroll-area' });
  const emptyBtn = el('button', { class: 'btn', text: 'empty trash', on: { click: async () => {
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
        row('clear canvas', el('button', { class: 'btn', text: 'clear', on: { click: async () => {
          const ok = await confirmDialog({ title: 'clear canvas?', message: 'This removes every canvas and leaves one empty canvas. Your library is untouched. You can undo it with Ctrl+Z.', confirmLabel: 'clear', danger: true });
          if (ok) { clearCanvases(); showToast('canvas cleared (Ctrl+Z to undo)'); }
        } } })),
        row('library folder', el('button', { class: 'btn', text: 'open', on: { click: () => window.api.openLibraryFolder() } })),
        row('default export scale', scaleSeg),
        el('div', { class: 'setting-row' }, el('span', { class: 'section-label', text: 'trash' }), emptyBtn),
        trashList,
        row('version', versionText))));

  unsubscribe = subscribe((meta) => { if (meta.library || meta.exportSettings || meta.history) { drawScale(); drawTrash(); } });
  drawScale();
  drawTrash();
  document.addEventListener('keydown', onKey, true);
  $('#overlay-root').append(backdrop);
}
