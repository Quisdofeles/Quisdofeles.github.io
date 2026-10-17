// app.js: entry point. Loads data, wires the modules together, and does the first render.

import { state, subscribe, requestRender, pathTo, selectNode, allFonts, isFirstLaunch, seedMedia, projectName, isProjectDirty } from './state.js';
import { loadAll, startPersistence, whenTrashSynced } from './persistence.js';
import { initTopbar, renderBreadcrumb, renderProjectButton } from './topbar.js';
import { initProject, openProjectMenu, ensureHashes } from './project.js';
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
import { $, uid, isEditingText } from './util.js';

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
  // A font that just finished loading must redraw the panels: the library's "Aa" samples are measured in their
  // own font (fitFontSample), and before the font loaded they were measured in a fallback font.
  const newFonts = (await registerFonts(state.library.fonts)).some(Boolean);
  await ensureMediaLoaded(state.library.media);
  if (missingMedia || newFonts) requestRender();
  ensureHashes();             // any font/media entry without a SHA-256 hash gets one (once for an older library)
}

// First launch only: copies the default media (src/defaults/media: the Stylesheet_ logo and wordmark) into the
// library folder and adds them to the library. Main hands them back in the order logo, wordmark; the logo gets the
// newer addedAt so it sorts first (media is newest-first). A failure here is logged and never blocks startup.
async function installDefaultMedia() {
  try {
    const files = await window.api.installDefaultMedia();
    const now = Date.now();
    seedMedia(files.map((f, i) => ({
      id: uid('v'), name: f.originalName, fileName: f.fileName, kind: 'svg', addedAt: now - i, hash: f.hash,
    })));
  } catch (err) {
    console.error('could not install the default media:', err);
  }
}

// Nothing in the app may be scrolled by the browser except the real scroll areas (library lists, layers, properties,
// popovers…). The page frame, panels and preview use overflow: clip (base.css), which can't be scrolled at all, but
// two kinds of element still could be: the window itself (the root element can't use clip), and everything that is
// overflow: hidden on purpose (boards, groups, palette sections: they stay "hidden" because "clip" would change how
// they size in a flex layout). The browser scrolls those from code, e.g. to keep a text cursor in view while
// typing on a board. This listener catches any such scroll and puts it straight back to 0.
// Rule: an axis set to overflow: hidden is never meant to scroll, so any scroll on that axis is undone. Real scroll
// areas are overflow: auto/scroll and are left alone; text inputs scroll their own text and are skipped.
function lockScrolling() {
  document.addEventListener('scroll', (e) => {
    const t = e.target;
    if (t === document || t === document.documentElement || t === document.body) {
      if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
      if (document.body.scrollLeft || document.body.scrollTop) { document.body.scrollLeft = 0; document.body.scrollTop = 0; }
      return;
    }
    if (!(t instanceof Element) || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
    const cs = getComputedStyle(t);
    if (cs.overflowX === 'hidden' && t.scrollLeft) t.scrollLeft = 0;
    if (cs.overflowY === 'hidden' && t.scrollTop) t.scrollTop = 0;
  }, true);   // capture: scroll events don't bubble, so this is the only way to see every element's scroll
}

async function start() {
  lockScrolling();            // before anything renders: the browser may never scroll the app sideways/up
  await loadAll();            // library.json + session.json -> state
  startPersistence();         // autosave
  if (isFirstLaunch) await installDefaultMedia();   // brand-new install: add the logo + wordmark (saved like any library change)
  await syncLoadedFiles();    // fonts + media markup must be ready before the first render
  await initTopbar({ onHelp: openHelp, onSettings: openSettings, onProject: openProjectMenu });
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

  // The project button follows the project's name and unsaved state (it only redraws when one of them changed).
  const drawProject = () => renderProjectButton(projectName(), isProjectDirty());
  subscribe(drawProject);
  drawProject();
  await initProject();        // shortcuts, the unsaved-changes prompt on close, and a .S_ file the app was started with

  // Help: "?" key opens it (except while editing text, including typing on a board: isEditingText in util.js; a clicked
  // slider, checkbox or select doesn't block it), and it shows automatically on first launch.
  document.addEventListener('keydown', (e) => {
    if (e.key === '?' && !isEditingText(e.target)) openHelp();
  });
  if (!state.session.helpSeen) openHelp();
}

start().catch((err) => console.error('startup failed:', err));

