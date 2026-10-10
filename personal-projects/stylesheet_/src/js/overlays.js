// overlays.js: notifications (toasts + the notification log), the confirm dialog, the help overlay, and the
// settings overlay (clear canvas, open library folder, default export scale, trash, version).

import { el, clear, $, icon } from './util.js';
import {
  state, subscribe, clearCanvases, setExport, setHelpSeen, restoreTrash, purgeTrash, trashFileOf, trashLabel,
} from './state.js';

// ---------- Notifications: toasts + log ----------
// Every notice goes into a small in-memory log (the last LOG_MAX, cleared when the app closes; not saved,
// not in undo). The markup (#notify) is static in index.html, so notices work even before initNotifications().
// - Log collapsed: the notice also shows as a toast left of the log button (removed after `ms`).
// - Log open: the notice goes straight into the open list (no toast).
const LOG_MAX = 25;
const notices = [];          // { message, warn, time }, oldest first
let logOpen = false;

// Shows a notice. Never blocks anything.
export function showToast(message, { warn = false, ms = 4500 } = {}) {
  notices.push({ message, warn, time: new Date() });
  if (notices.length > LOG_MAX) notices.shift();
  if (logOpen) { renderLog(); return; }
  const toast = noticeEntry(notices[notices.length - 1]);   // exactly the same entry the open log shows
  $('#toast-stack').append(toast);                 // appended last = newest at the bottom, nearest the button
  setTimeout(() => { toast.remove(); }, ms);
}

// "9:42" style clock time (24-hour, no leading zero on the hour).
const clockTime = (d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;

// One notice as a toast-style entry (message + muted time), 34px tall like the log button.
// Used for BOTH the fading toasts and the open log, so they always look and size the same.
function noticeEntry(n) {
  return el('div', {
    class: 'toast log-entry' + (n.warn ? ' warn' : ''),
    title: n.message,                              // full text on hover when the message is cut off
  }, el('span', { class: 'log-msg', text: n.message }), el('span', { class: 'log-time', text: clockTime(n.time) }));
}

// Draws the open log: newest at the bottom (nearest the button), each older entry a bit more transparent.
function renderLog() {
  const list = clear($('#notify-log'));
  list.classList.remove('has-scroll');
  if (!notices.length) { list.append(el('div', { class: 'log-empty', text: 'no notifications yet' })); return; }
  notices.forEach((n, i) => {
    const age = notices.length - 1 - i;            // 0 = newest
    const entry = noticeEntry(n);
    entry.style.opacity = String(Math.max(0.25, 1 - age * 0.15));   // 1, .85, .7, .55, .4, ... never below .25
    list.append(entry);
  });
  // Only show the scrollbar (and the space before it) when there is more than fits (more than 5 entries).
  list.classList.toggle('has-scroll', list.scrollHeight > list.clientHeight);
  list.scrollTop = list.scrollHeight;              // keep the newest in view
}

// Opens or collapses the log. Only the log button calls this (clicking elsewhere never collapses it).
function setLogOpen(open) {
  logOpen = open;
  const btn = $('#btn-log');
  $('#notify-log').classList.toggle('open', open);
  clear(btn).append(icon(open ? 'chevronDown' : 'chevronUp'));
  btn.title = open ? 'hide notifications' : 'show notifications';
  if (open) {
    clear($('#toast-stack'));                      // their notices are in the open list now
    renderLog();
  }
}

// Wires the log button (called once from app.js).
export function initNotifications() {
  $('#btn-log').addEventListener('click', () => setLogOpen(!logOpen));
  // The preview zooms on wheel; over the log the wheel should scroll the list instead.
  $('#notify-log').addEventListener('wheel', (e) => e.stopPropagation());
  setLogOpen(false);
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
const HELP_TOP_MIN = 24;   // short windows only: the highest the row may move up to fit (see the fit check in openHelp)
// Each step card is a short list of points (one <li> each), so a lot of detail stays easy to scan.
const HELP_CALLOUTS = [
  { title: '01 — LIBRARY', points: [
    'Blocks: drag canvas, vector, image, heading, body or spacer into the preview. Presets you save show up here too.',
    '+ import copies media (svg, png, jpg) and fonts into the app, so your originals can be moved or deleted.',
    'Colors: + add one, or use the eyedropper to pick any color straight off a canvas. Click a color to edit its name or hex.',
    'Palettes: + add a palette, then + for more swatches. A swatch works exactly like a color.',
    'Drag any card onto a canvas, a block or a layer. Right-click to delete; deleted items wait in settings → trash.',
  ] },
  { title: '02 — PREVIEW', points: [
    'Start with + add canvas, or drop a block, media or preset on the empty grid.',
    'Each canvas is one option (A, B, C…). The grid lines them up for you, whatever their sizes.',
    'Drop a color on text, on one part of a vector, or on a background: only that one thing changes. The lime outline shows what will change.',
    'Click to select, Ctrl/Shift+click to add more, or drag a box to select several. Double-click text to edit it.',
    'Scroll to zoom, hold space or the middle mouse button to pan, fit to see everything. Double-click the % to type a zoom.',
  ] },
  { title: '03 — EDITOR', points: [
    'Layers lists every canvas and its blocks. Drag rows to reorder or move them, double-click to rename, click the eye to hide.',
    '+ block adds a block to every selected canvas.',
    'Right-click a layer to copy, paste, duplicate, group, ungroup or delete. Keys: Ctrl+C / V, Ctrl+D, Ctrl+G, Delete.',
    'Properties edits what is selected: colors, layout, size (fixed or dynamic, with padding), and a text block\'s font. Double-click any number to type it.',
    'Save as preset keeps a canvas\'s layout to reuse.',
  ] },
  { title: '04 — EXPORT', points: [
    'Export saves every visible canvas as one image. Hidden canvases are skipped.',
    'Canvas labels puts OPTION A, B… above each canvas. Style labels adds a strip listing every color, font and media used.',
    'PNG and WebP can have a transparent background (the checkerboard button). JPEG is always solid.',
    'Use 1× to share quickly, 2× or 4× for a sharper reference.',
    'The arrow button above export opens your recent notifications.',
  ] },
];
// The three columns of the IMPORT TIPS box under the step cards (also lists of points).
const HELP_TIPS = [
  { title: 'MEDIA', points: [
    'Use + import in media for .svg, .png and .jpg files.',
    'SVGs can be recolored part by part. PNG and JPG can\'t be recolored, so use them for photos or textures.',
    'Drop a media card on a vector or image block to swap it.',
  ] },
  { title: 'SVG SETUP', points: [
    'Each top-level layer or group becomes one part you can recolor; no naming needed. The Stylesheet_ logo in media is an example: background, S and underscore are three parts.',
    'Parts keep their original colors until you change one; then that part becomes one solid color.',
    'Fit the artboard tightly to the artwork and convert text to outlines.',
  ] },
  { title: 'FONTS', points: [
    'Use + import in fonts for .ttf, .otf, .woff or .woff2. Space Grotesk and IBM Plex Mono are built in.',
    'Each file is one weight or style; files from one family share a card. Pick the weight in the font row in properties.',
    'Variable fonts import as one weight. Fonts are embedded in exports.',
  ] },
];
// A list of points as a <ul> (used by the step cards and the tips columns).
const pointList = (points) => el('ul', { class: 'help-points' }, points.map((p) => el('li', { text: p })));

export function openHelp() {
  if ($('.help-overlay')) return;
  const overlay = el('div', { class: 'help-overlay' });
  const top = $('#preview').getBoundingClientRect().top + HELP_TOP;   // the row's vertical position
  const row = el('div', { class: 'help-row' },
    HELP_CALLOUTS.map((c) => el('div', { class: 'help-callout' }, el('b', { text: c.title }), pointList(c.points))));
  // The tips box reuses the .help-callout card look; .help-tips only sets its width.
  const tips = el('div', { class: 'help-callout help-tips' },
    el('b', { text: 'IMPORT TIPS' }),
    el('div', { class: 'help-tips-cols' },
      HELP_TIPS.map((t) => el('div', {}, el('h4', { text: t.title }), pointList(t.points)))));
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
  const overflow = () => tips.getBoundingClientRect().bottom + 12 - footer.getBoundingClientRect().top;
  if (overflow() > 0) overlay.classList.add('compact');
  // Still too tall (e.g. 1280×720): move the whole stack up by just the missing amount, but never higher than
  // HELP_TOP_MIN below the top of the preview panel.
  if (overflow() > 0) {
    const highest = $('#preview').getBoundingClientRect().top + HELP_TOP_MIN;
    stack.style.top = `${Math.max(highest, top - overflow())}px`;
  }
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
