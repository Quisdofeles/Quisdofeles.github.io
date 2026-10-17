// topbar.js: the top bar. Window buttons (minimize / maximize-restore / close), the help and
// settings buttons, the project button (name + "*" when unsaved; opens the project menu), and the live breadcrumb
// that follows the current selection (its middle segments collapse to "…" when it doesn't fit).

import { icon, el, clear, $ } from './util.js';

// Wires the window control buttons and swaps the maximize icon to "restore" when maximized.
// onProject(anchor) opens the project menu under the project button.
export async function initTopbar({ onHelp, onSettings, onProject } = {}) {
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
  if (onProject) $('#btn-project').addEventListener('click', (e) => onProject(e.currentTarget));
  // A narrower window leaves the breadcrumb less room: collapse it again.
  window.addEventListener('resize', layoutBreadcrumb);

  const showMax = (isMax) => {
    const b = $('#btn-max');
    clear(b);
    b.append(icon(isMax ? 'restore' : 'max'));
    b.title = isMax ? 'restore' : 'maximize';
  };
  window.api.window.onMaximizeChange(showMax);
  showMax(await window.api.window.isMaximized());
}

// The project button: "saturn_coffee" (+ "*" while there are unsaved changes). The full name is the tooltip.
// Its width can change, so the breadcrumb is fitted again afterwards.
export function renderProjectButton(name, dirty) {
  const nameEl = $('#project-btn-name');
  if (nameEl.textContent === name && $('#project-btn-dirty').textContent === (dirty ? '*' : '')) return;
  nameEl.textContent = name;
  $('#project-btn-dirty').textContent = dirty ? '*' : '';
  $('#btn-project').title = `project: ${name}${dirty ? ' (unsaved changes)' : ''}`;
  layoutBreadcrumb();
}

// Draws the breadcrumb: "/ Board 1 / tagline". Parents muted, last item white, each clickable.
// `path` is an array of nodes from the canvas down to the selected node (empty = nothing selected).
// With more than one node selected (`count` > 1) it just says "/ N selected" (nothing to click).
let crumbs = { path: [], onSelect: () => {}, count: 0 };   // the last breadcrumb drawn (redrawn on resize)
export function renderBreadcrumb(path, onSelect, count = path.length ? 1 : 0) {
  crumbs = { path, onSelect, count };
  layoutBreadcrumb();
}

// Draws the breadcrumb with `hidden` segments taken out of the MIDDLE (shown as one "…"); the first and last
// segments always stay.
function drawCrumbs(hidden) {
  const { path, onSelect, count } = crumbs;
  const nav = clear($('#breadcrumb'));
  if (count > 1) {
    nav.append(el('span', { class: 'sep', text: '/' }));
    nav.append(el('span', { class: 'crumb last', text: `${count} selected` }));
    return;
  }
  // Which middle segments are hidden: a run of `hidden` segments around the middle of the path.
  const middle = path.length - 2;
  const from = 1 + Math.floor((middle - hidden) / 2);
  path.forEach((node, i) => {
    if (hidden && i >= from && i < from + hidden) {
      if (i === from) {
        nav.append(el('span', { class: 'sep', text: '/' }));
        nav.append(el('span', { class: 'crumb-gap', text: '…', title: path.slice(from, from + hidden).map((n) => n.name).join(' / ') }));
      }
      return;
    }
    nav.append(el('span', { class: 'sep', text: '/' }));
    nav.append(el('button', {
      class: 'crumb' + (i === path.length - 1 ? ' last' : ''),
      text: node.name, title: node.name,
      on: { click: () => onSelect(node.id) },
    }));
  });
}

// Fits the breadcrumb into the space between the wordmark and the project button: draws it in full, and while it is
// too wide, hides one more middle segment ("/ Board 1 / … / heading 1"). Measured with nothing allowed to shrink
// (.measuring); if even "first / … / last" is too wide, the crumbs then shrink and end with an ellipsis (CSS).
function layoutBreadcrumb() {
  const nav = $('#breadcrumb');
  nav.classList.add('measuring');
  const maxHidden = Math.max(0, crumbs.path.length - 2);
  for (let hidden = 0; hidden <= maxHidden; hidden++) {
    drawCrumbs(hidden);
    if (nav.scrollWidth <= nav.clientWidth) break;
  }
  nav.classList.remove('measuring');
}
