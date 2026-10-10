// persistence.js: loads and saves library.json and session.json through window.api.
// - The library saves immediately whenever it changes.
// - The session saves 1 second after the last change (debounced), and always on close.
// - It also keeps the trash FOLDER on disk matching the trash LIST in library.json
//   (soft-deleted font/media files move into library/trash/, and move back on restore/undo).

import { state, subscribe, initState, trashFileOf } from './state.js';
import { debounce } from './util.js';

const SESSION_SAVE_DELAY = 1000;
let trashChain = Promise.resolve();   // runs trash syncs one after another so they never overlap

// Loads both files (null on first launch) and hands them to state.js.
export async function loadAll() {
  const [library, session] = await Promise.all([window.api.loadLibrary(), window.api.loadSession()]);
  initState(library, session);
  await syncTrashFiles();   // self-heals if the app was closed in the middle of a delete
}

// Tells main which files belong in the trash folder; main moves files so the disk matches.
export function syncTrashFiles() {
  const files = state.library.trash.map(trashFileOf).filter(Boolean);
  trashChain = trashChain.then(() => window.api.syncTrash(files)).catch((err) => console.error('trash sync failed:', err));
  return trashChain;
}

// Resolves when every queued trash move has finished (so freshly restored files are really back in place).
export const whenTrashSynced = () => trashChain;

// Subscribes to state changes and saves accordingly. Call once after loadAll().
export function startPersistence() {
  const saveLibrary = () => window.api.saveLibrary(state.library);
  const saveSession = () => window.api.saveSession(state.session);
  const saveSessionSoon = debounce(saveSession, SESSION_SAVE_DELAY);

  subscribe((meta) => {
    if (meta.library) { saveLibrary(); syncTrashFiles(); }
    if (meta.session) saveSessionSoon();
  });

  // On close, main waits for this to finish before the window actually closes.
  window.api.onBeforeQuit(async () => {
    await Promise.all([saveSession(), saveLibrary()]);
  });
}
