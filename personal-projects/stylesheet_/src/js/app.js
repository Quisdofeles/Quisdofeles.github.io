// app.js: entry point. Loads data, wires the modules together, and does the first render.

import { state, subscribe, requestRender, pathTo, selectNode, resolveLegacyLayerColors } from './state.js';
import { loadAll, startPersistence, whenTrashSynced } from './persistence.js';
import { initTopbar, renderBreadcrumb } from './topbar.js';
import { initLibrary } from './library.js';
import { initPreview } from './preview.js';
import { initEditor } from './editor.js';
import { initProperties } from './properties.js';
import { initDragDrop } from './dragdrop.js';
import { initExport } from './export.js';
import { openHelp, openSettings } from './overlays.js';
import { registerFonts } from './fonts.js';
import { libraryBlockCount } from './blocks.js';
import { ensureMediaLoaded, hasMediaMarkup } from './svg.js';
import { $ } from './util.js';

// Updates the status bar counts from the library, in the same order as the library panel's sections
// (blocks, media, fonts, colors, palettes). "blocks" matches the blocks section header (blocks + presets).
function renderStatus() {
  const l = state.library;
  $('#status-counts').textContent =
    `library: ${libraryBlockCount(l)} blocks · ${l.media.length} media · ${l.fonts.length} fonts · ${l.colors.length} colors · ${l.palettes.length} palettes`;
}

// Makes sure every font/media item in the library is loaded from disk. Needed at startup and again whenever
// something returns to the library (restore from trash, undo of a delete). Redraws if anything new loaded.
async function syncLoadedFiles() {
  const missingMedia = state.library.media.some((m) => m.kind === 'svg' && !hasMediaMarkup(m.id));
  await whenTrashSynced();    // a restored file may still be moving back out of the trash folder
  await registerFonts(state.library.fonts);
  await ensureMediaLoaded(state.library.media);
  resolveLegacyLayerColors();   // finishes upgrading vectors saved before per-layer colors (needs the SVGs loaded)
  if (missingMedia) requestRender();
}

async function start() {
  await loadAll();            // library.json + session.json -> state
  startPersistence();         // autosave
  await syncLoadedFiles();    // fonts + media markup must be ready before the first render
  await initTopbar({ onHelp: openHelp, onSettings: openSettings });
  initLibrary();
  initPreview();
  initEditor();
  initProperties();
  initDragDrop();
  initExport();

  subscribe((meta) => { if (meta.library) syncLoadedFiles(); });
  subscribe(renderStatus);
  renderStatus();

  // The breadcrumb in the top bar follows the selection (and picks up renames).
  const drawBreadcrumb = () => {
    const ids = state.session.selection;
    renderBreadcrumb(ids.length === 1 ? pathTo(ids[0]) : [], selectNode, ids.length);   // several selected -> "N selected"
  };
  subscribe((meta) => { if (!meta.view && !meta.exportSettings && !meta.live) drawBreadcrumb(); });
  drawBreadcrumb();

  // Help: "?" key opens it (when not typing), and it shows automatically on first launch.
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (e.key === '?' && !(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'))) openHelp();
  });
  if (!state.session.helpSeen) openHelp();
}

start().catch((err) => console.error('startup failed:', err));

