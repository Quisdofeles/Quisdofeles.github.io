// topbar.js: the top bar. Window buttons (minimize / maximize-restore / close), the help and
// settings buttons, and the live breadcrumb that follows the current selection.

import { icon, el, clear, $ } from './util.js';

// Wires the window control buttons and swaps the maximize icon to "restore" when maximized.
export async function initTopbar({ onHelp, onSettings } = {}) {
  const set = (id, name) => { const b = $(id); clear(b); b.append(icon(name)); };
  set('#btn-help', 'help');
  set('#btn-settings', 'gear');
  set('#btn-min', 'min');
  set('#btn-max', 'max');
  set('#btn-close', 'close');

  $('#btn-min').addEventListener('click', () => window.api.window.minimize());
  $('#btn-max').addEventListener('click', () => window.api.window.toggleMaximize());
  $('#btn-close').addEventListener('click', () => window.api.window.close());
  if (onHelp) $('#btn-help').addEventListener('click', onHelp);
  if (onSettings) $('#btn-settings').addEventListener('click', onSettings);

  const showMax = (isMax) => {
    const b = $('#btn-max');
    clear(b);
    b.append(icon(isMax ? 'restore' : 'max'));
    b.title = isMax ? 'restore' : 'maximize';
  };
  window.api.window.onMaximizeChange(showMax);
  showMax(await window.api.window.isMaximized());
}

// Draws the breadcrumb: "/ lockup_A / tagline". Parents muted, last item white, each clickable.
// `path` is an array of nodes from the canvas down to the selected node (empty = nothing selected).
// With more than one node selected (`count` > 1) it just says "/ N selected" (nothing to click).
export function renderBreadcrumb(path, onSelect, count = path.length ? 1 : 0) {
  const nav = clear($('#breadcrumb'));
  if (count > 1) {
    nav.append(el('span', { class: 'sep', text: '/' }));
    nav.append(el('span', { class: 'crumb last', text: `${count} selected` }));
    return;
  }
  path.forEach((node, i) => {
    nav.append(el('span', { class: 'sep', text: '/' }));
    nav.append(el('button', {
      class: 'crumb' + (i === path.length - 1 ? ' last' : ''),
      text: node.name,
      on: { click: () => onSelect(node.id) },
    }));
  });
}
