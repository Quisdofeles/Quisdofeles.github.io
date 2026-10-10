// app.js: entry point. Loads data, wires the modules together, and does the first render.

import { state, subscribe, requestRender, pathTo, selectNode, resolveLegacyLayerColors, allFonts, isFirstLaunch, seedMedia } from './state.js';
import { loadAll, startPersistence, whenTrashSynced } from './persistence.js';
import { initTopbar, renderBreadcrumb } from './topbar.js';
import { initLibrary } from './library.js';
import { initPreview } from './preview.js';
import { initEditor } from './editor.js';
import { initProperties } from './properties.js';
import { initDragDrop } from './dragdrop.js';
import { initExport } from './export.js';
import { openHelp, openSettings, initNotifications } from './overlays.js';
import { registerFonts, groupFamilies } from './fonts.js';
import { libraryBlockCount } from './blocks.js';
import { ensureMediaLoaded, hasMediaMarkup } from './svg.js';
import { $, uid } from './util.js';

// Updates the status bar counts from the library, in the same order as the library panel's sections
// (blocks, media, fonts, colors, palettes). "blocks" matches the blocks section header (blocks + presets);
// "fonts" matches the fonts header (font families = cards shown, built-in ones included).
function renderStatus() {
  const l = state.library;
  $('#status-counts').textContent =
    `library: ${libraryBlockCount(l)} blocks · ${l.media.length} media · ${groupFamilies(allFonts()).length} fonts · ${l.colors.length} colors · ${l.palettes.length} palettes`;
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

// First launch only: copies the default media (src/defaults/media: the Stylesheet_ logo and wordmark) into the
// library folder and adds them to the library. Main hands them back in the order logo, wordmark; the logo gets the
// newer addedAt so it sorts first (media is newest-first). A failure here is logged and never blocks startup.
async function installDefaultMedia() {
  try {
    const files = await window.api.installDefaultMedia();
    const now = Date.now();
    seedMedia(files.map((f, i) => ({
      id: uid('v'), name: f.originalName, fileName: f.fileName, kind: 'svg', addedAt: now - i,
    })));
  } catch (err) {
    console.error('could not install the default media:', err);
  }
}

async function start() {
  await loadAll();            // library.json + session.json -> state
  startPersistence();         // autosave
  if (isFirstLaunch) await installDefaultMedia();   // brand-new install: add the logo + wordmark (saved like any library change)
  await syncLoadedFiles();    // fonts + media markup must be ready before the first render
  await initTopbar({ onHelp: openHelp, onSettings: openSettings });
  initLibrary();
  initPreview();
  initEditor();
  initProperties();
  initDragDrop();
  initExport();
  initNotifications();        // the log button above the export bar

  subscribe((meta) => { if (meta.library) syncLoadedFiles(); });
  subscribe(renderStatus);
  renderStatus();
  // Status bar version comes from package.json, so it can never disagree with the installer.
  window.api.getVersion().then((v) => { $('#status-brand').textContent = `Stylesheet_ by HALFWIT Studios · v${v}`; }).catch(() => {});

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

