# CLAUDE.md — Stylesheet_ by HALFWIT Studios

This file is the source of truth for the Stylesheet_ project. Read it fully before every task. If a request conflicts with this file, ask before deviating.

---

## 1. What this app is

**Stylesheet_** (displayed exactly like that, with the trailing underscore) is a Windows desktop app made by HALFWIT Studios. It is a fast brand sketchbook that sits next to Figma and Illustrator. It does not replace them.

The user imports finished vectors (SVGs from Illustrator), fonts, and colors, arranges them into simple block-based layouts, duplicates those layouts into side-by-side variations with different palettes or fonts, and exports flat PNG/JPEG/WebP reference images to send to clients or to color-pick from in Figma/Illustrator.

Core use case (a client logo job):
1. Designer builds a logo mark in Illustrator (any SVG works; no layer naming is needed). The wordmark is NOT baked into the SVG.
2. Imports the SVG into Stylesheet_. Drops it on the empty preview (a canvas that sizes itself to its content), then adds a heading block (wordmark) and a body block (tagline).
3. Duplicates the canvas ~5 times, gives each a different set of colors. Exports with style labels. Client replies "Option C".
4. Locks in C's colors on every canvas, swaps the heading font on each instead. Exports again. Client picks.
5. Builds the final, exports large (4×) as a reference for the real brand work elsewhere.

It will be offered as a **free download** on the HALFWIT Studios website, so it must work for people other than the author.

---

## 2. How to work with Robert (the developer)

- Robert is a strong designer and knows HTML and CSS well. He is still building JavaScript fluency. **Code must be readable by him.**
- Vanilla HTML, CSS, and JavaScript only in the renderer. **No React, no Vue, no TypeScript.**
- **Comment generously.** Every file starts with a short header comment explaining what it does. Every function gets a one-line comment. Non-obvious logic gets an explanation of *why*.
- When something breaks, **explain the root cause first**, then the fix.
- Don't make design decisions silently. If the spec doesn't cover something, pick the simplest option that matches the existing look and **say what you assumed**.
- Never declare a phase "done" without it actually running via `npm start`.
- Version control is done by Robert in **GitHub Desktop**. Do not run git commands, commit, or push.
- Keep dependencies minimal. Each new npm package needs a one-line justification.
- **Keep this file current.** Anything built that differs from, or adds to, what this file says must be written here in the same task (file structure, data model, `window.api`, behaviors, assumptions). Section 13 lists decisions made where the original spec was silent. If code and this file disagree, fix whichever is wrong and tell Robert.
- **Windows tooling gotcha:** never rewrite source files with PowerShell `Get-Content`/`Set-Content` (it mangles `·`, `—`, `×` into mojibake). Use the Edit/Write tools for source files.

---

## 3. Stack

- **Electron** (latest stable) — main process + preload + renderer
- **Vanilla JS** with ES modules in the renderer (`<script type="module">`)
- **Plain CSS** split by panel, using CSS custom properties for tokens
- **electron-builder** for the Windows `.exe` installer (NSIS target)
- **html-to-image** (vendored as a single file in `src/vendor/`) for exporting the preview to PNG/JPEG (and to a canvas that the browser encodes as WebP) at 1×/2×/4×. This is the only runtime library allowed in the renderer. It is installed as a devDependency only so its dist file can be copied into `src/vendor/` (refresh by copying `node_modules/html-to-image/dist/html-to-image.js` and deleting the trailing `sourceMappingURL` comment).
- **npm packages** (all devDependencies; nothing ships at runtime): `electron` (the app shell; also renders the app icon, see `build/make-icon.js`), `electron-builder` (builds the NSIS installer), `html-to-image` (source of the vendored file). The icon generator needs no extra package.

---

## 4. File structure

```
stylesheet/
├─ CLAUDE.md
├─ package.json            # scripts (start, dist, icon) + electron-builder config (NSIS, appId, icon, installer/uninstaller icon)
├─ .gitignore              # node_modules/ and dist/
├─ main.js                 # Electron main process: window, IPC, file system, protocol, trash, settings (incl. dialog folder memory), dev hooks
├─ preload.js              # Secure bridge: exposes window.api to the renderer
├─ reference/
│  └─ ui-mockup.png        # The approved UI mockup. Match it.
├─ build/                  # electron-builder's buildResources folder (not shipped inside the app)
│  ├─ icon.svg             # THE app icon source (1000×1000, the final S_ mark). Edit only this file
│  ├─ icon.ico             # GENERATED from icon.svg (16, 24, 32, 48, 64, 128, 256): exe, installer, uninstaller, window + taskbar
│  └─ make-icon.js         # Regenerates icon.ico from icon.svg: run `npm run icon` after changing the SVG
├─ dist/                   # (generated by `npm run dist`; not committed) Stylesheet_-Setup-<version>.exe + win-unpacked/
└─ src/
   ├─ index.html           # The one and only page (static skeleton + CSP meta tag)
   ├─ fonts/               # UI fonts (OFL): IBMPlexMono-Regular/Medium/Bold.ttf, SpaceGrotesk-Variable.ttf
   ├─ defaults/
   │  └─ media/            # first-launch media, saved exactly as designed: Stylesheet_Logo.svg, Stylesheet_Wordmark.svg
   │                       # (copied into the library on first launch by window.api.installDefaultMedia; ships via "src/**/*")
   ├─ vendor/
   │  └─ html-to-image.js  # classic UMD script (defines window.htmlToImage), copied from npm, source map stripped
   ├─ styles/
   │  ├─ tokens.css        # Colors, fonts, radii, spacing as CSS variables + @font-face for UI fonts
   │  ├─ base.css          # Reset, page frame, scrollbars, buttons, inputs, segmented toggles, sliders, status bar
   │  ├─ topbar.css
   │  ├─ library.css
   │  ├─ preview.css       # Stage, floating bars, canvases/blocks, placeholders, drop outline, export sheet
   │  ├─ editor.css        # Layers tree, property controls, compact (<=820px tall) overrides
   │  └─ overlays.css      # Help, settings, confirm, popovers/menus, trash list, notifications (log button, toasts, log list)
   └─ js/
      ├─ app.js            # Entry point: loads data, first-launch default media, wires modules, first render, status bar (counts + version), breadcrumb, help-on-first-launch
      ├─ state.js          # THE single source of truth + subscribe/notify + undo history + library trash (soft delete)
      ├─ persistence.js    # Load/save library.json and session.json via window.api; autosave; keeps trash folder in sync
      ├─ topbar.js         # Window controls, help/settings buttons, breadcrumb rendering
      ├─ library.js        # Renders the Library panel, import flow, add color/palette, inline edit, right-click delete
      ├─ preview.js        # Renders canvas cells (OPTION label + canvas; also used by export), auto grid layout (applyGridLayout), zoom/pan/fit, selection + drag-select on canvas
      ├─ editor.js         # Layers tree (multi-select clicks, right-click menu) + keyboard shortcuts (Delete, Ctrl+D, Ctrl+C/V, Esc, Ctrl+Z/Y)
      ├─ properties.js     # (added) Properties area below the layers tree: colors, layout, size (canvas), block controls incl. font, save as preset
      ├─ dragdrop.js       # All drag-and-drop logic (library → preview / layers / editor rows, reordering)
      ├─ blocks.js         # Block type definitions, OFFERED_BLOCKS, factories, defaults (canvas size/padding/background), LEGACY_PRESETS, starter colors/palettes
      ├─ sorting.js        # (added) Display-only sort order for every Library section (media, fonts, colors, palettes, blocks + presets)
      ├─ svg.js            # SVG sanitizing, first-level layer detection, reading each layer's original colors, building (re)colored <svg> elements
      ├─ eyedropper.js     # (added) The colors-header eyedropper tool: on/off state, picking a canvas pixel, switching off
      ├─ outline.js        # (added) The accent "what is about to change" outline (text glyphs / one vector layer / canvas edge); preview DOM only
      ├─ fonts.js          # Built-in fonts (Space Grotesk, IBM Plex Mono), reading font metadata, FontFace registration, family grouping, "closest to 400" picking
      ├─ export.js         # Export bar + offscreen render to PNG/JPEG/WebP + style label strip + font embedding
      ├─ overlays.js       # Notifications (toasts + notification log), confirm dialog, help overlay, settings overlay (incl. trash)
      ├─ popover.js        # (added) Popovers and menus: context menu, block menu, color picker, font picker, color editor
      └─ util.js           # (added) el() DOM builder, icons, id/slug/hex/contrast helpers, debounce
```

Keep this structure. There is no file length limit.

---

## 5. Architecture rules

### 5.1 Single source of truth
All app data lives in **one state object** in `state.js`. Nothing else holds its own copy.

- Modules **read** state and **render** from it.
- Modules **change** state only through functions exported by `state.js` (e.g. `addBlock()`, `updateBlock()`, `selectNode()`), which then notify subscribers.
- After any change, every panel that depends on it re-renders. Simple full re-renders of a panel are fine — performance is not a concern at this scale. Clarity is.
- The preview and the layers tree are two views of the same data. Dragging onto the preview and editing in the editor both call the same state functions. **They can never disagree.**

### 5.2 Undo
`state.js` keeps a history stack of state snapshots (max 50). A snapshot is a deep copy of **the canvases, the selection (the whole list of selected ids; restored through the same selection rules, so ids that no longer exist drop out), and the whole library (including the trash list)**. Multi-item actions (delete, duplicate, paste, `+ block` on several canvases) are ONE history entry; the copy/paste clipboard is in memory only and is not part of history, so deleting a library item is undoable. Zoom/pan, export settings and UI collapse state are NOT part of history. `Ctrl+Z` undoes, `Ctrl+Shift+Z` / `Ctrl+Y` redoes (ignored while typing in an input). Slider drags and text typing push one history entry per gesture (the first tick), and the next gesture starts a new one (`endGesture()` on the input's `change` event). Because undo/redo replace `state.library` and `state.session.canvases` wholesale, modules must never cache those objects.

Subscribers receive a `meta` object: `{ library, session, live, view, selection, ui, exportSettings, history, refresh }`. Panels skip re-rendering for irrelevant flags (e.g. `view` only updates the zoom transform; `live` slider ticks don't rebuild the properties panel). `requestRender()` redraws everything without changing data (used after fonts/media finish loading). "Empty trash" is not undoable and clears the history.

### 5.3 Electron security
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- The renderer never touches Node or `fs` directly. Everything goes through `window.api` defined in `preload.js` using `contextBridge` + `ipcRenderer.invoke`.
- Imported files are served to the renderer through a custom protocol **`ssfile://`** registered in `main.js` (privileged, `supportFetchAPI: true`, `standard: true`, `secure: true`, plus `corsEnabled: true` so `fetch()` from the `file://` page can read imported files) that maps only into the app's library folder. Reject any path that resolves outside it. URL form: `ssfile://lib/fonts/<fileName>` and `ssfile://lib/media/<fileName>` (the host is always `lib`; responses carry `access-control-allow-origin: *`).
- `index.html` has a Content-Security-Policy meta tag: only the app's own files and `ssfile:` (scripts: self only).

### 5.4 window.api (preload)
```
window.api = {
  loadLibrary(), saveLibrary(data),
  loadSession(), saveSession(data),
  loadSettings(), saveSettings(data), // userData/settings.json: { launch: 'maximized' | 'windowed', lastFolders: { fonts, media, export } } (default maximized, no folders); read by main before the window is created. saveSettings only takes `launch`; lastFolders is written by main itself
  importFiles(type),           // type 'font' | 'media': opens a file dialog limited to that type (starting in that type's last import folder), copies chosen files into the library folder, returns metadata
  readLibraryFile(relPath),    // returns text (used for SVG contents)
  saveExport(dataUrl, format), // format 'png' | 'jpeg' | 'webp': opens save dialog (starting in the last export folder), writes the image
  openLibraryFolder(),
  window: { minimize(), toggleMaximize(), close(), isMaximized(), onMaximizeChange(cb) },
  onBeforeQuit(cb)             // lets the renderer flush the autosave before the app closes (cb may return a promise)

  // Added beyond the original spec:
  syncTrash(files),            // files = [{subdir, fileName}] that SHOULD be in library/trash; main moves files so disk matches (also moves unlisted trash files back = restore/undo)
  purgeTrashFiles(files),      // permanently deletes those files from library/trash (empty trash)
  readBundledFont(name),       // base64 of a bundled UI font in src/fonts (whitelisted ttf names) so exports can embed IBM Plex Mono and Space Grotesk
  getVersion(),                // app version from package.json
  samplePixel(x, y),           // eyedropper: "#RRGGBB" of the window pixel at (x, y) in CSS px (webContents.capturePage of a 1×1 rect), or null
  installDefaultMedia()        // first launch only: copies src/defaults/media/* (logo, then wordmark) into library/media; returns importFiles()-style metadata
}
```
`importFiles()` returns `[{kind:'font'|'media', subdir, fileName, originalName, ext}]`; stored file names are `<timestamp><rand>_<original name>` so two files with the same name never collide.

---

## 6. Persistence (no projects, no file names)

There are **no projects, no Save As, no file names.** The app holds one working session.

App data lives in Electron's `app.getPath('userData')`:
```
userData/
├─ library.json        # fonts, colors, palettes, media, presets
├─ session.json        # canvases, selection, zoom/pan, export settings
├─ settings.json       # app settings read by main BEFORE the window exists: { launch: 'maximized' | 'windowed', lastFolders: { fonts, media, export } }
└─ library/
   ├─ fonts/           # copied font files
   ├─ media/           # copied SVGs and raster images
   └─ trash/           # soft-deleted files (trash/fonts/, trash/media/); the list of trashed items lives in library.json
```

- **Importing copies files in.** The user's originals can be moved or deleted without breaking anything.
- **Autosave:** session saves 1 second after the last change (debounced), and always on close (the window's `close` event is held until the renderer flushes both files, with a 2-second timeout fallback). Library saves immediately on change.
- **Soft delete (trash):** every library delete (right-click → delete, always behind a confirm dialog) moves the item into `library.trash` and, for fonts and media, moves its file into `library/trash/`. Nothing is permanently removed until the user chooses "empty trash" in Settings. Undo (Ctrl+Z) or "restore" in Settings puts it back. `persistence.js` keeps the folder in sync with the list after every library change (and on startup, to self-heal), and the app waits for that sync before reloading restored files.
- **settings.json** holds app-level settings: `launch` and `lastFolders`. It is separate from session.json because `main.js` needs it before creating the window. A missing/invalid file means `maximized` and no remembered folders. Changing `launch` never resizes the current window; it applies on the next launch. `main.js` keeps the one live copy in memory (`getSettings()`), so the renderer's `launch` saves and the folder updates never overwrite each other; `cleanSettings()` sanitizes every load and save (only absolute path strings survive in `lastFolders`).
- **Dialog folder memory (`lastFolders`):** the fonts `+ import` dialog, the media `+ import` dialog and the export save dialog each remember their OWN last folder (`fonts`, `media`, `export`). After an import that copied at least one file, the folder the files came from is stored; after a successful export, the folder it was saved to. A cancelled dialog changes nothing. The next time that dialog opens it starts there (export: that folder + the usual default file name). If the stored folder no longer exists, the dialog falls back to the old default (Windows' default for imports, Pictures for export).
- Write JSON atomically (write to a `.tmp` file, then rename) so a crash never corrupts data (settings.json too).
- **Never bundle user fonts in the installer.** The installer ships no user data. It does ship the default media files (`src/defaults/media/`, included by electron-builder's `src/**/*`); on first launch (no library.json and no session.json) `app.js` asks main to copy them into `library/media/` and adds them to the library (not an undo step). Existing libraries never get them added.

---

## 7. Data model

```js
library = {
  fonts:    [{ id, family, fileName, style, weight }],   // one entry per font FILE; UI groups by family. style: 'normal'|'italic'; weight: number (e.g. 700)
  colors:   [{ id, name, hex }],                          // name is lowercase_with_underscores by default
  palettes: [{ id, name, colors: [{ id, name, hex }] }],  // any number of colors
  media:    [{ id, name, fileName, kind: 'svg'|'image', addedAt }],   // name = original file name (e.g. mark.svg); addedAt = Date.now() at import (newest-first sorting). An SVG's layers are NOT stored: svg.js reads them from the file every time it is loaded (layerInfo(mediaId))
  presets:  [{ id, name, addedAt, structure: <canvas without any assigned fonts/colors/media> }],   // addedAt: 0 for presets an older version shipped (LEGACY_PRESETS); new installs start with []
  trash:    [{ id, kind: 'font'|'color'|'palette'|'media'|'preset'|'palette_color', item, deletedAt }]
            // soft-deleted items; `item` is the original entry (palette_color: {paletteId, index, color})
}

session = {
  canvases: [canvas, ...],
  selection: [nodeId, ...],              // LIST of selected node ids (empty = nothing). Always one of: blocks that all live in ONE canvas, or canvases (see "Selection rules" in 8.7). Old saves with a single `selectedId` are upgraded to [selectedId] on load.
  zoom: 1, pan: { x: 0, y: 0 },          // pan is an offset from where the grid sits at rest (24px in, 100px down)
  export: { styleLabels: true, canvasLabels: true, format: 'png'|'jpeg'|'webp', transparent: false, scale: 1 },   // new-session defaults shown; canvasLabels: show OPTION labels (old saves without it = true)
  collapsedGroups: { colors: true, ... }, // editor property groups the user collapsed (colors, layout, size, block)
  collapsedNodes: { <nodeId>: true },     // layers-tree nodes the user collapsed
  helpSeen: false                         // false until the help overlay has been shown once
}

canvas = {
  id, type: 'canvas', name: 'lockup_A',
  background: '#EDEDEE',                                     // hex; new canvases are #EDEDEE (DEFAULT_BACKGROUND in blocks.js; older ones keep theirs)
  layout: { direction: 'stack'|'row', gap: 24, align: 'center' },
  size: { mode: 'fixed'|'dynamic', width: 160, height: 160 },   // px at 100% zoom. fixed = exactly width × height (overflow clipped);
                                                             // dynamic = shrink-wraps its content + padding (width/height are then unused)
  padding: 24,                                               // px between the content and the canvas edge, all four sides (0–200)
  hidden: false,
  children: [block, ...]
}

block = {
  id, type, name, hidden: false,
  // text blocks (heading, body; title, subheading, caption still exist in old saves/presets but are no longer offered):
  text: 'NORTHFIELD', size: 32, color: '#000000',            // color: this block's own text color (new text is black). New text starts as its type name ("title", "heading"...)
  font: 'builtin_spacegrotesk_700',                           // THIS block's own font: a library font id (family + weight + style) or a built-in id (builtin_spacegrotesk_400/500/700, builtin_plexmono_400/500/700). There are no canvas-wide font settings.
  // vector block:
  mediaId, width: 120, layerColors: { "0": '#D9FF43' },       // keyed by FIRST-LEVEL LAYER INDEX (0, 1, 2…); a layer with no entry keeps the original colors from the file
  // image block: mediaId (kind 'image'), width. Raster images have no colors.
  // spacer block: size
  // group block (a nested container): layout + children (the text blocks inside keep their own fonts). NOT creatable from the library or "+ block":
  // it is made in the layers tree (select layers -> right-click -> group). Groups live only inside a canvas and may nest.
}
```

There is no swatch block.

### Canvas size (fixed / dynamic) and padding
`aspect` no longer exists (old saves are upgraded, see section 13). Constants live in `blocks.js` (`EMPTY_SIZE` 160, `DEFAULT_PADDING` 24, `SIZE_LIMITS` 100–1600, `PADDING_LIMITS` 0–200).
- **Empty new canvases start fixed 160×160, padding 24:** the canvas block (drop or `+ block`), the `+ add canvas` button, and `clear canvas`'s fresh `lockup_A` (`createCanvas()`). (A first launch has no canvas at all.)
- **Canvases created with content start dynamic, padding 24:** a block or media item dropped on the empty grid (`addBlockToNewCanvas()` / `addMediaToNewCanvas()`), `+ block` with nothing selected, and a preset whose structure is dynamic.
- **A dynamic canvas requires content** (a visible block, or a visible group that shows something: `hasVisibleContent()` in `blocks.js`). With none, `dynamic` is disabled in the properties. If a dynamic canvas loses its last visible block (deleted, hidden, dragged out…), `fixEmptyDynamicCanvases()` in `state.js` (run at the end of every `change()`) switches it to fixed 160×160 inside the same undo step.
- **Switching dynamic → fixed** stores the canvas's current rendered size at 100% zoom (measured from the preview, rounded, not clamped to the slider range) so nothing jumps; fixed → dynamic only changes the mode.
- Duplicates, copy/paste and presets keep the size settings (they are deep copies / structure).

### Colors: every colorable thing stores its own (no roles)
There are **no color roles**. A color belongs to exactly one thing and a change to it never touches any other block:
- the **canvas background** (`canvas.background`),
- each **text block's color** (`block.color`),
- each **first-level layer of a vector block** (`block.layerColors[index]`).

A **first-level layer** is a direct child of the SVG root (a group or a shape; `<defs>`, `<style>`, `<title>` etc. are not layers). If the root holds exactly one group that itself holds several drawable children (Illustrator's usual wrapper), the wrapper is skipped and its children are the layers. **No layer naming is required: every SVG works.** A layer's display name is Illustrator's real name when it has one (`data-name`, or a non-generic `id`), else `layer 1, 2, 3…`.

A vector shows **the colors that are actually in the file**. A layer keeps its original colors (even several inside it) until the user gives it a color; then the whole layer becomes that one color. Removing the entry (`reset` in the colors section) returns the layer to its original colors. Library colors are copied in as plain hexes (a later edit of the library color does not change blocks).

### Fonts: every text block has its own font
There are no canvas-wide font settings and no font roles. Each text block stores its own `font`, so two titles in one canvas can use different fonts, and copies/duplicates/pastes keep the font of the block they came from.
- **Built-in fonts:** **Space Grotesk** (the default) and IBM Plex Mono, each at 400, 500 and 700, are the UI fonts that ship in `src/fonts` (`BUILTIN_FONTS` / `DEFAULT_FONT_ID` in `fonts.js`, ids `builtin_spacegrotesk_<weight>` / `builtin_plexmono_<weight>`, `builtin: true`). They are NOT in `library.fonts`, can't be deleted, appear as (undeletable) cards in the library's fonts section (since the first-run defaults pass; see 8.5), but are listed in every font picker (`allFonts()` in `state.js` = built-in + library). Every new text block (from `+ block`, a drop, or a preset) starts in Space Grotesk 700 (Bold), so text is never a placeholder waiting for a font.
- A block whose font was deleted from the library shows the properties font button as `missing ▾` and renders in the default font, Space Grotesk (it re-links if the font is restored).
- Each library font file is registered under its own CSS family `ssf-<fontId>` and rendered at `font-weight: normal` (the weight lives in the file), so there is never faux bold. Built-in fonts are drawn with the real family and `font-weight` (Space Grotesk is one variable file, so any weight 300–700 works) (`fontCss()` in `fonts.js` returns the right CSS for either kind).
- **Font choice = family + weight/style.** The font picker lists families (including the built-in IBM Plex Mono and Space Grotesk); choosing one (or dropping a family card) assigns the weight **closest to 400** (normal style preferred, a tie goes to the heavier weight). A weight/style selector next to the picker then switches among that family's files. Fonts are shown as `Space Grotesk 700` / `DM Serif Display 400 italic` / `IBM Plex Mono 500`.
- **Old saves** are upgraded by `migrateFontRoles()` in `state.js`: each text block gets the font it used to show (its override, else its canvas's font for its type, else Space Grotesk), and `canvas.fonts` / `fontOverride` are removed. It can be deleted once all old saves are gone.

### Presets
"Save as preset" stores the selected canvas's **structure only**: block types, order, nesting, names, sizes and layout, plus the canvas's `size` (mode, width, height) and `padding`. It strips all colors, font names, media references, and text. A canvas made from a preset starts #EDEDEE with black text in Space Grotesk. When a preset is dropped in, empty media slots render as **gray placeholders** (a gray box where the vector goes), and text blocks show their type name as ordinary, editable text (`heading`, `body`…).

**The app ships NO default presets** (a new library starts with an empty preset list; "save as preset" still works). Older versions shipped five; they now live in `LEGACY_PRESETS` in `blocks.js` only so libraries that still hold them keep working (sort order, addedAt backfill, the canvas-size upgrade). What they were, for reference: `symmetrical_logo` (vector over title over caption, stacked, centered), `horizontal_lockup` (vector left of a stacked title + caption, row), `type_hierarchy` (title, heading, subheading, body, caption stacked, left aligned), `business_card`, `social_post`. (`business_card` = row with vector + stacked title/caption/body, fixed 384×219, padding 28; `social_post` = stack with vector, title, body, caption, fixed 384×480, padding 28: the sizes they had as aspect 1.75 / 0.8. `symmetrical_logo`, `horizontal_lockup` and `type_hierarchy` are dynamic, padding 24. Their exact structures were invented and can be revised.) Preset-created text blocks start with their type name as text (not empty), in Space Grotesk 700.

First launch (no library.json and no session.json) starts with (`STARTER_COLORS` / `STARTER_PALETTES` in `blocks.js`, `defaultLibrary()` / `defaultSession()` in `state.js`):
- **blocks offered:** canvas, vector, image, heading, body, spacer (`OFFERED_BLOCKS`); **no presets**.
- **media:** `Stylesheet_Logo.svg` and `Stylesheet_Wordmark.svg` (from `src/defaults/media/`; the logo has the newer `addedAt`, so it sorts first).
- **fonts:** only the built-in Space Grotesk and IBM Plex Mono (shown as cards, see 8.5); `library.fonts` is empty.
- **colors:** `pure_black` #000000, `pure_white` #FFFFFF, `pure_red` #FF0000 (the `defaults` palette's red), `neon_lime` #D9FF43.
- **palettes:** `defaults` (`white` #FFFFFF, `black` #000000, `red` #FF0000) and `stylesheet_` (five UI tokens: `panel` #0F0F11, `card` #141417, `line` #26262B, `line_2` #33333A, `accent` #D9FF43).
- **no canvases:** the preview opens on its empty state (the dashed `+ add canvas` button, see 8.6); `session.canvases` starts as `[]`.
- **export:** style labels on, canvas labels on, PNG, transparent off, 1×. **Launch:** maximized (settings.json default).
Existing libraries and sessions are never changed by these defaults.

---

## 8. UI specification

**Match `reference/ui-mockup.png` exactly in layout, spacing, type, and color.**

### 8.1 Design tokens (`tokens.css`)
```
--bg:        #0A0A0B   app background, dot grid ground
--panel:     #0F0F11   library + editor panel background
--card:      #141417   cards, inputs
--card-line: #1E1E22   card borders
--line:      #26262B   dividers, outlines
--line-2:    #33333A   dashed borders
--text:      #EDEDEE
--muted:     #9A9AA2
--dot:       #2C2C33   preview dot grid
--accent:    #D9FF43   lime. USED SPARINGLY: primary actions, selection, active states only
--danger:    #C42B1C   close button hover
--radius-sm: 4px   --radius: 6px   --radius-lg: 10px
--font-ui:   'IBM Plex Mono', ui-monospace, monospace   (all UI text, 13px base)
--font-brand:'Space Grotesk', sans-serif                  (wordmark only, 700)
```
Section labels are 11px, uppercase, letter-spacing 2px, muted: `01 — LIBRARY`, `02 — PREVIEW`, `03 — EDITOR`. Everything else is lowercase with underscores (`lockup_A`, `pure_black`, `new_color`).

### 8.2 Window
- Frameless (`frame: false`). Custom top bar is the drag region (`-webkit-app-region: drag`); every button inside it is `no-drag`.
- `minWidth: 1280`, `minHeight: 720`. **Opens maximized by default** (settings `on launch: maximized | windowed`; see 8.9). The window is created with `show: false` and, on `ready-to-show`, is maximized (if the setting says so) and then shown, so there is no flash of a small window. `windowed` uses 1440×1000, centered.
- **The window never scrolls, and the panels never scroll.** `html, body { height: 100%; overflow: hidden; }`. The only things allowed to scroll are the **list areas inside sections** (each library section's list, the layers list, and the properties area). Everything must fit at the minimum window size of 1280×720 (which is also what a 1080p laptop at 150% Windows scaling gives you).
- Background color set on the BrowserWindow to `#0A0A0B` so there is no white flash on launch.

### 8.3 Top bar
- Left: wordmark `Stylesheet` in Space Grotesk 700 ~22px, followed by a real `_` character in the accent color (`<span class="underscore">_</span>`) as the underscore. There is no separate bar element. The top bar is **48px** tall.
- Next to it: a **live breadcrumb** of the current selection, e.g. `/ lockup_A / tagline`. Parents muted, the last item white. Nothing selected → no breadcrumb. Clicking a breadcrumb segment selects that node. With more than one item selected it shows just `/ N selected` (not clickable).
- Right: `?` icon (help overlay), gear/cog icon (settings overlay; same 16px, 1.3 stroke, muted color and hover as the `?` icon), a thin vertical divider, then minimize, maximize/restore, close. All are bare icons (no box), muted gray, `#1A1A1E` background on hover; close turns `--danger` with white icon on hover. Maximize icon swaps to a "restore" icon when maximized.

### 8.4 Layout
Three columns, full height between top bar and status bar:
- **Library** — fixed 280px, left, `--panel`, border-right
- **Preview** — fills remaining width, middle
- **Editor** — fixed 320px, right, `--panel`, border-left, flush to the window edge (no gap)

**Glass panels (switchable):** while `<body class="glass-panels">` is set in `index.html` (on by default), the library and editor panels are the same glass as the floating bars (`rgba(15,15,17,.88)` + `backdrop-filter: blur(6px)`, `z-index: 6`), and the preview's dot grid and canvases continue **behind** them. Nothing moves: the panels keep their place, widths and spacing, and the preview keeps its box, so zoom, fit, clicks and the empty-state button behave exactly as before; canvases only show behind a panel when panned/zoomed there. How: `#preview` becomes `overflow-x: visible; overflow-y: clip` (still clipped by the top bar and status bar), `#stage` drops its own dot background, and `#stage::before` draws the dot grid widened by 281px left / 321px right (panel width + 1px border) using CSS variables `--dot-size/--dot-x/--dot-y` that `applyView()` in `preview.js` sets. All rules are in one block at the end of `preview.css`. **To go back to the previous solid panels, remove the `glass-panels` class from `<body>`**; the CSS variables are then unused and harmless.

Library and editor panels **never scroll as a whole.** They are flex columns that exactly fill the available height. When the window gets shorter, the list areas inside sections shrink (showing fewer items before their own scrollbar kicks in); the panel itself stays put. **No horizontal scrolling anywhere.**

### 8.5 Library panel (left)
Header row: just the `01 — LIBRARY` label. There is **no global import button**: importing happens per section (see the `+ import` buttons on media and fonts below).

Sections, in this order: **blocks, media, fonts, colors, palettes** (blocks first because adding a block is the first thing you do; the status bar lists counts in the same order). Each has the shared header described below (label · count left; a `+ import` button on media and fonts, a `+ add` button on colors and palettes, the muted `drag in` hint on blocks) and **its own scroll area** (vertical only). The header row is 28px tall with an 8px gap below it (the header sits outside the scrolling list, so the `+ add` buttons never touch or overlap cards, even when a list is scrolled).

**Height rule:** the five sections share the panel's height **equally** using flex. Each section is `display: flex; flex-direction: column; min-height: 0; flex: 1 1 0` (one rule in `library.css`, no per-section weights). Its 28px header never shrinks, so the list areas (`flex: 1; min-height: 40px` = one row; `overflow-y: auto`) all get the same height and grow/shrink together with the window (77px each at 1280×720, 161px at 2048×1152). The library panel itself never scrolls.

**Sorting (display only; `sorting.js`; the saved arrays are never reordered, and every edit re-renders so renamed/edited items re-sort):**
- media: newest added first (`addedAt` timestamp set on import; items saved before it existed were backfilled with their position so they keep their relative order and count as older than new imports).
- fonts: alphabetical by family, case-insensitive (`groupFamilies()` in `fonts.js`).
- colors: pure black `#000000` first, pure white `#FFFFFF` second, then every color with saturation ≥ 10% by hue (red → orange → yellow → green → blue → purple → back toward red; hues are bucketed in 15° steps, shifted so reds on both sides of 0° share a bucket, and lightness dark→light orders colors inside a bucket), then the low-saturation colors (grays, browns; saturation < 10%) last, dark to light.
- palettes: alphabetical by name, case-insensitive. Swatches inside a palette keep the order the user made.
- blocks section: the offered blocks in a fixed order (`OFFERED_BLOCKS` in `blocks.js`, used as `BLOCK_ORDER` / `sortBlockTypes()` in `sorting.js`: `canvas`, `vector`, `image`, `heading`, `body`, `spacer`), then presets newest first (each saved preset has `addedAt`); presets an older version shipped (`LEGACY_PRESETS`) count as oldest and keep their shipped order at the end. The editor's `+ block` menu shows exactly the same list in the same order (`sortBlockTypes()`).

Section details (on screen the order is blocks, media, fonts, colors, palettes):
- **media** — `+ import` button in the header (opens a file dialog that only accepts `.svg .png .jpg .jpeg`). Long cards styled exactly like the color cards: a 34px square thumbnail on the left (same size as the color swatch), the file name beside it (truncated with an ellipsis, never wrapped), and a muted line under it with the file type (`svg`, `png`, `jpg`). A card in use by a block gets a lime border. Empty state: "import an svg or image". (The internal data key, folder, drag kind and block field are all `media`; the *block types* named `vector` and `image` keep their names.)
- **fonts** — `+ import` button in the header (file dialog only accepts `.ttf .otf .woff .woff2`). Long cards: `Aa` rendered in that font (20px), family name, and weight/style count (e.g. `5 weights`; `2 styles` when only styles differ; `1 weight`). Fonts are grouped by family (one card per family; the `Aa` and the drag payload use the weight closest to 400). Right-click deletes the whole family (all its files) after a confirm. **The built-in fonts (Space Grotesk, IBM Plex Mono) are shown as cards too** (`allFonts()`: `3 weights` each), sorted alphabetically with the imported families and draggable like them. They **can't be deleted: right-click shows no menu at all**, and the card's tooltip says "built-in font, can't be deleted". (If an imported family has the same name as a built-in one, they share a card and its delete only removes the imported files.) The fonts count in the header and status bar counts font **families** (= the cards shown, built-in ones included: `groupFamilies(allFonts()).length`), not files, so a new install shows `fonts · 2`, and an imported family adds 1 however many weights it has.
- **colors** — `+ add` button in header, with an **eyedropper tool button** just left of it (see below). Long cards matching the font cards: 34px swatch square on the left, name above, hex below in muted. Click a card to edit name/hex inline (Enter or clicking away saves, Esc cancels; names are slugged to `lowercase_with_underscores`); right-click → delete.
- **palettes** — `+ add` button in header (creates `palette_N` with one gray color and starts renaming). Each palette is a card: name on top (double-click to rename), then a **6-column grid of 26px square swatches (`aspect-ratio: 1`, smaller than the 34px color-card swatch) that wraps** to new rows for any number of colors, ending in a `+` tile of the same square size that adds a color. Palette swatches behave **exactly like single colors** (draggable, clickable → small name/hex editor popover, right-click → delete that color). A whole palette is never dragged as a unit; right-click the card to delete the palette.
- **blocks** (listed first on screen) — one section (there is no separate presets section), a single column of the same long cards as fonts/colors (same height, padding, border, radius, spacing): a lime icon centered in a 34px square slot (same size as the color swatch) on the left; the name on the right with a muted second line. Default blocks (`canvas`, `vector`, `image`, `heading`, `body`, `spacer`; `title`, `subheading` and `caption` are **no longer offered** anywhere, but stay in `BLOCK_TYPES` so old saves, old presets and pasted blocks that contain them still render and edit normally; there is **no `group` block**, groups are made in the layers tree, see 8.7) have a solid border and show their kind on the second line (`kind` in `BLOCK_TYPES`: title/heading/subheading/body/caption = `text`, vector/image = `media`, canvas = `container`, spacer = `layout`). Presets come after them with a **dashed border**, a lime `▣` icon and the second line `preset`. Presets drag into the preview, right-click → delete (confirm, soft delete to trash), and "save as preset" adds a new one here.

**Eyedropper (`eyedropper.js`, colors header):** adds a library color by picking it from the preview. The button (`#btn-eyedropper`, created by `buildHeaders()` from `data-eyedropper` in `index.html`) is an `.icon-toggle` like the export bar's transparent toggle, sized 24px to match the header buttons, showing an eyedropper icon (`icon('eyedropper')`): off = normal button, hover = accent icon, on = accent border + accent icon. Click it to switch on. While on, the cursor is a crosshair over canvases and the selection outlines are hidden (so they can't be picked). Clicking anywhere on a canvas reads **the exact on-screen pixel** under the pointer (`window.api.samplePixel`, main-process `capturePage`), so it works on images, vectors, text and backgrounds alike, and at any zoom. The picked color is added like `+ add` (name `new_color`, the picked hex filled in) and the card opens in edit mode with the name selected: type a name, press Enter. The tool switches off when: a color is picked; the user clicks negative space in the preview (dot grid or the floating bars' background); `Esc` (consumed, so it doesn't also clear the selection); any press outside the preview panel (which still does its normal job); or the button is clicked again. While on, wheel zoom, the zoom/fit buttons and space/middle-drag panning still work (the clicks of a pick never select or start a drag-select box).

**Palette hover:** the palette card is not draggable, so it has no hover effect. Each swatch is draggable, so on hover it gets an accent border and the grab cursor, plus a small floating tooltip with its name and hex (one shared `.swatch-tip` element on `<body>`, so the list's overflow can't clip it; it flips below the swatch if there's no room above and hides on leave, drag, click and right-click).

**Shared section header (one pattern for all five sections):** `.lib-head` elements in `index.html` are empty skeletons with `data-label` (and `data-add` / `data-import` = the id of the button to create); `library.js` `buildHeaders()` fills every one with the same structure. Left: `label · count` in one style (`.lib-label`, 13px muted; counts are live; a new install shows `blocks · 6` (offered blocks + presets), `media · 2`, `fonts · 2` (families), `colors · 4`, `palettes · 2`). Right: a `+ import` button on media and fonts (`data-import`), a `+ add` button on colors and palettes (`data-add`), otherwise the muted `drag in` hint (blocks only). Both buttons are the same `.plus-btn` (24px tall; look comes from the shared button style, see 8.10). All headers are 28px tall. The lists reserve the scrollbar space always (`scrollbar-gutter: stable`, `--list-pad` 8px + `--scroll-gutter` 6px) and the header's right padding is the same sum, so the right-side hint/button ends exactly at the cards' right edge whether or not a scrollbar shows.

Scrollbars: 6px, thumb `#3A3A41`, transparent track. The thumb stays gray at rest AND on hover; it turns lime **only while it is pressed/dragged** (`::-webkit-scrollbar-thumb:active`, pure CSS in `base.css`, no JS or hover-class logic). Applies to every scroll area (library lists, layers, properties, popovers, settings trash list).

**Deleting library items (any section):** right-click → `delete` → **always a confirm dialog**. If the item is in use, the dialog says how many blocks use it (fonts: text blocks resolving to that font; media: vector/image blocks). Confirming moves the item to the trash (see section 6); blocks that used it fall back to their gray placeholder (and re-link if the item is restored). Deletes are one undo step (Ctrl+Z). Colors, palettes and presets store copies of values, so they are never "in use" and deleting them changes no canvas.

**SVG import rule:** on import, parse the SVG and sanitize it: remove `<script>`, `<foreignObject>`, event handler attributes, and external references. **No layer naming is needed and no notice is shown:** every SVG works, and it appears with the colors that are in the file. The layers are the first-level layers (see "Colors" in section 7).

Implementation details (`svg.js`): first-level layers are the drawable direct children of the SVG root (`g path rect circle ellipse polygon polyline line text use`); a single wrapper group holding several drawable children is skipped. Generic Illustrator ids (`Layer_1`, `Artboard_2`, `XMLID_3_`, `_x31_`…) don't count as names. Also removed: `<iframe>`, `<object>`, `<embed>`, `<image>`, audio/video, `javascript:` values, and any `href`/`url()` that isn't an in-file `#id`. The original file on disk is never modified: sanitizing and preparing happens **every time an SVG is loaded** (cached in memory per media id, together with `layerInfo(mediaId)` = `[{ name, colors, ids }]`). Preparation: layers get `data-layer="<index>"`; `<style>` rules are scoped per vector (`svg[data-vid="…"] .cls-1`) so classes from different SVGs can't collide (their paint declarations are **kept**, that is the original color); all ids are prefixed per vector; a `viewBox` is guaranteed and fixed width/height removed. **Reading the original colors:** the prepared SVG is mounted off-screen once and `getComputedStyle` gives each painted shape's final fill/stroke (so classes, `<style>` blocks and inheritance are all resolved; gradients use their first stop). Shapes that really have a fill get `data-f`, shapes that really have a stroke get `data-s`, and the distinct colors per layer (drawing order) become `layerInfo().colors`. **Recoloring a layer** (`buildVectorSvg`) sets inline `fill` on that layer's `data-f` shapes and inline `stroke` on its `data-s` shapes, so `fill="none"` shapes stay unfilled and one layer becomes one flat color. Layer display names decode Illustrator's `_x20_` escapes. Raster images (`kind: 'image'`) render as `<img>` and have no colors.

**Font import:** family, weight and style are read from the font's own `name` and `OS/2` tables (TTF, OTF, WOFF; WOFF is inflated with `DecompressionStream`). WOFF2 can't be read in the browser and falls back to guessing from the file name. A variable font imports as one entry at its default weight.

### 8.6 Preview panel (middle)
- Background: `--bg` with a dot grid (`radial-gradient(var(--dot) 1px, transparent 1.2px)`, 18px spacing).
- **Floating top bar** (rounded 10px, `--line` border, semi-opaque `--panel`, soft shadow, inset ~24px from the panel edges): `02 — PREVIEW`, `auto grid · N canvases`, and on the right `zoom` with `−` / `100%` / `+` and a `fit` button.
- **Canvases** are laid out in an **auto grid** calculated from the number of visible canvases: 1 → 1 column, 2 → 2×1, 3–4 → 2×2, 5–6 → 3×2, 7–9 → 3×3 (10+: `ceil(sqrt(n))` columns). Never set manually. **Canvases can be different sizes** (fixed width × height, or dynamic = content + padding; see "Canvas size" in section 7). Each grid column is as wide as its widest canvas and each row as tall as its tallest, with every canvas centered in its cell and a 20px gap. This is plain CSS grid (`auto` tracks, `place-items: center`, `width: max-content` so the window width never squeezes dynamic canvases), set by `applyGridLayout()` in `preview.js`, which the export calls too. `fit`, zoom, pan, drag-select and the dot grid all work from the real rendered sizes (fit measures the grid element). Canvas labels are `OPTION A/B/C…` by position among visible canvases. When the number of visible canvases changes, the view auto-`fit`s (not on ordinary edits). `fit` never zooms past 100%.
- Each canvas: rounded 8px card filled with its `background` color, soft shadow. The `OPTION A/B/C…` label sits **outside the canvas, just above it, aligned to its left edge** (6px gap; IBM Plex Mono 11px, letter-spacing 2px; `--muted` on the dot grid, `#777` on the export sheet), so it never overlaps content whatever the padding. Each grid cell is a `.canvas-cell` (label + card, built by `renderCanvasCell()` in `preview.js`, used by preview and export alike; `renderCanvasElement()` builds only the card). The label is only drawn while the export bar's `canvas labels` checkbox is on (`session.export.canvasLabels`); turning it off removes the label AND its row, so the canvases move up by that much. Every selected canvas gets a 2px lime outline (a canvas is outlined only when it is itself selected, not when one of its blocks is).
- Canvas contents render with flexbox from `layout` (`direction`, `gap`, `align`), inset by `canvas.padding` on all four sides. A fixed canvas clips content that doesn't fit at its edge (`overflow: hidden`); a dynamic canvas (`.canvas.dynamic`) has no size of its own and shrink-wraps its content. (The OPTION label is outside the canvas, above it; see the previous point.)
- **Zoom & pan:** the **mouse wheel zooms around the cursor** anywhere over the preview panel (Ctrl is not needed; Ctrl + wheel / trackpad pinch does the same thing). The point under the cursor stays under the cursor. Steps are multiplicative: `zoom × 1.1^(−deltaY/100)`, so one standard notch (100px) is ×1.1 and small trackpad / hi-res deltas scale down proportionally; `deltaY` is capped at ±300 per event and line/page delta modes are converted to pixels. `+`/`−` buttons step 10% around the center. **Double-click the zoom percent to type a value:** it becomes an inline input (same font/size, shows the current number, selected, digits only, max 3 digits). Enter or clicking away applies it, Esc cancels, empty/invalid cancels, below 25 becomes 25, above 400 becomes 400, and it zooms around the center of the preview. Range 25%–400%. Pan with **space + drag** or **middle-mouse drag**. `fit` resets to fit all canvases. Zoom/pan transform only the canvas grid; the floating bars stay put.
- Clicking a block on a canvas selects it (same as clicking it in the layers tree); clicking a canvas selects the canvas. **Ctrl+click or Shift+click** a block or canvas adds it to the selection, or removes it if it is already in (a modifier-click on empty grid does nothing). **Drag-select:** press and drag anywhere in the preview (not while holding space, which pans) to draw a **dashed accent rectangle** (`.marquee`, 1px, fixed-position, `pointer-events: none`); everything the box touches is selected live while dragging. Same rules as the tree: touching two or more canvases selects just those canvases; inside one canvas it selects the blocks the box touches (a block inside a touched group is covered by the group), or the canvas itself if it touches no block. A drag always replaces the selection (Ctrl/Shift don't add to it). Clicking empty dot grid (no modifier) or pressing `Esc` clears the selection. Every selected block gets a thin dashed lime outline. The dot grid zooms and pans with the canvases.
- **Empty state:** with no visible canvases (including every first launch) the preview shows a dashed **`+ add canvas`** button (`#btn-add-canvas`, the same `.dashed-btn` style as `save as preset`, sized to its text) instead of a message. Clicking it adds one empty canvas (`addCanvas()`, fixed 160×160, padding 24; one undo step, same as dropping the canvas block). Dropping a block, media item or preset on the empty grid still works as before (the wrapper ignores pointer events; only the button is clickable).
- Empty media slots/missing media render as **gray placeholders** (a gray box for vector/image). Text has no placeholder box: a text block always renders its text in its font (Space Grotesk by default); if its text is cleared it shows the block's type name at 40% opacity (`.is-empty`).
- **Double-click a text block** on a canvas: it is selected and the cursor jumps into the properties text box with the text selected, so you can type straight away (the text is edited in the properties panel, not on the canvas).
- **Floating export bar** at the bottom, same glass style (`.float-bar`: semi-opaque `--panel` + `backdrop-filter: blur`), width and inset as the top bar, but **two rows** tall (10px padding, two 34px rows 8px apart; 98px with the border). It is two columns (`.export-col`, 28px apart), each with two stacked rows:
  - **Column 1 (labels):** the `style labels` checkbox, and under it the `canvas labels` checkbox (same style; default on; hides the OPTION labels in preview and export).
  - **Column 2 (file):** `format` PNG|JPEG|WEBP joined segmented toggle with the **transparent background icon toggle** right of it (checkerboard icon; lime border + lime icon when on, gray when off; disabled and shown off only when JPEG is selected, since JPEG can't be transparent; PNG and WebP can); under it `scale` 1×|2×|4× segmented toggle. The `format` / `scale` captions share one width (`6ch`) so both toggles start on one edge, and they are always shown.
  - The `export` button keeps its normal 36px height and sits at the **top right** of the bar (the bar is `align-items: flex-start`) (the one unique button: normal at rest, solid accent background AND border with dark text on hover/press; see 8.10).
  - **Above the export bar's right edge** floats the notifications group (`#notify`, see 8.9): the log button (right edge = the bar's right edge, bottom 134px = 12px above the bar), with the toasts or the expanded log to its left. `fit` reserves 142px at the bottom (`FIT_RESERVED` in `preview.js`) so canvases never land under the bar. If the bar height changes, change `#notify`'s bottom (overlays.css) and `FIT_RESERVED`.

### 8.7 Editor panel (right)
Header: `03 — EDITOR`.

**Height rule:** the editor is a flex column: `03 — EDITOR` header, `.editor-body`, pinned `save as preset`. The body holds two parts. `.props-part` (divider, a `properties` header that uses the same `.layers-head` class as `layers`, nothing on its right, then `#props`) takes its natural height up to **`max-height: 60%`** of the body; beyond that `#props` scrolls inside itself. `.layers-part` (`layers` header + `#layers` list) takes the rest, so at least 40%, and its list scrolls inside itself. Both headers and `save as preset` are always visible (also with nothing or several items selected); the panel never scrolls. (Measured: at 1280×720 the body is 560px, so properties max 336px; at 2048×1152, 962px and 577px.) 

**Property groups:** compact control rows (36px, `--row-h`); each group (`colors`, `layout`, `size` for canvases, and the block-specific group named after the block type) has a collapsible header with a 15px ▾/▸ chevron (all open by default, collapse state saved in `session.collapsedGroups`; the layers tree uses the same 15px chevrons). Slider rows are one line (label, slider, value); slider labels are at least 44px wide and grow for longer words (`padding`). Direction and align toggles share one line. At window heights ≤820px the row height drops to 26px and spacing tightens (`@media (max-height: 820px)` in `editor.css`).

**layers** (with `+ block` on the right, which opens a small menu of block types):
- A tree. Canvases at the top level with ▾/▸ carets to expand/collapse. Children indented 20px per level.
- Each row: icon glyph + name, and a muted tag on the right (`canvas`, `3 layers`, `heading`, `body`…).
- Selected row: `#1A1A1E` background, 1px lime outline, its tag turns lime. Every selected row has this style.
- **Selection rules (multi-select).** Plain click selects one row; **Ctrl+click** toggles a row; **Shift+click** selects the rows on screen between the last plainly/Ctrl-clicked row (the anchor) and this one. `Esc` clears. The selection is either **blocks that all live in one canvas, or canvases, never a mix**: a pick that doesn't fit the current selection (a block from another canvas, a canvas while blocks are selected, a block while canvases are selected, or a Shift-range crossing canvases) **switches the selection to just the newly picked item(s)**. It never turns into canvases, so Delete can't remove whole canvases by accident. A block inside another selected block (a group) is dropped: the outer one wins. These rules live in `cleanSelection()` in `state.js`.
- **Groups.** There is no `group` block to add. Select blocks (not canvases), then right-click → `group` (or `Ctrl+G`): the blocks are wrapped in a new group named `group 1`, `group 2`… (renameable like any row). The group sits where the first selected block (top of the tree) was, the blocks keep their tree order, and the group **copies its parent's layout** (direction, gap, align) so nothing shifts visually; it then has its own layout controls in the properties. One layer can be grouped, groups can contain groups, canvases can't be grouped. `ungroup` (right-click when the selection includes a group, or `Ctrl+Shift+G`) replaces each selected group with its children in the same spot; the freed blocks become the selection. A group left **empty** (its last child dragged out or deleted) is removed automatically in the same undo step. Groups drag, reorder and move into other groups/canvases like any row. Both actions are one undo step. Saved presets, the legacy presets (`horizontal_lockup`, `business_card`) and old saves can contain groups and work unchanged.
- **Right-click a row** opens a menu (same popover menu as library deletes): `copy`, `paste` (only when the clipboard has something), `duplicate`, `group` (blocks only), `ungroup` (when a group is selected), `delete`. If the row is not in the selection it is selected first; if it is, the menu acts on the whole selection. Delete is not confirmed (it is undoable, unlike library deletes).
- Hover shows an **eye icon** to hide/show the block (hidden blocks are dimmed in the tree and not rendered).
- Double-click a name to rename. Drag rows to reorder or move into another canvas/group (top/bottom quarter of a row = before/after, middle of a group row = into it; canvases only reorder among canvases).
- Shortcuts (all act on the **whole selection** as ONE undo step, and are ignored while typing in an input): `Delete` removes it; `Ctrl+D` duplicates it (each copy goes right after its original and becomes the selection; a canvas copies everything, including all its colors, and takes the first free letter, e.g. `lockup_B`; a block is named `heading 1 copy`, `heading 1 copy 2`…); `Ctrl+C` copies it; `Ctrl+V` pastes (see below); `Ctrl+G` groups the selected blocks and `Ctrl+Shift+G` ungroups the selected groups; `Esc` clears the selection.
- **Paste:** copied layers go right after the last selected layer, or to the end of each selected canvas (one copy per canvas); copied canvases go right after the last selected canvas (or at the end when nothing is selected) and take the next free letter. Pasted layers are named `<name> copy`, `<name> copy 2`… (unique inside the destination canvas). Pasting layers with nothing selected shows a notice. The pasted items become the selection.
- **Block names:** a block added without a name is numbered per canvas: `heading 1`, `heading 2`… (first free number). Vector/image blocks added from a library item keep the file name; preset-made blocks keep the preset's names.
- Selecting a node in the preview expands any collapsed ancestors in the tree. The `+ block` menu lists exactly the library's offered blocks in the same order: canvas, vector, image, heading, body, spacer (`sortBlockTypes()`). `+ block` adds **one new block to the end of every selected canvas** (or of the canvas that owns the selected blocks); the `canvas` item adds a new top-level canvas; with nothing selected it creates a new canvas containing the block.

**Properties** (below a divider) — contents depend on what's selected:
- **colors**: shows **only the colors of the currently selected item**, one full-width row each (swatch, name, hex or `original`). Canvas → one row `background`. Text block → one row `text`. Vector block → one row per first-level layer (the layer's name or `layer 1, 2, 3…`; the swatch shows the layer's original color(s), split into stripes when there are several, and the text says `original`; once a color is chosen the swatch and hex show it and a `reset` link returns the layer to its original colors). Image, group and spacer blocks have no colors section. Click a row to open the color picker popover (library colors and palettes plus a hex input). A library color can be dropped on a row. Every change affects only that one thing. **Hovering a row outlines in the preview exactly what it controls** (see "What-will-change outline" below). The vector's layers are not shown as rows in the layers tree; they live only in this section.
- **Typing exact numbers:** every number in the properties (the value at the right end of each slider row: `gap`, text `size`, vector/image `width`, spacer `size`, canvas `padding` / `width` / `height`) can be **double-clicked and typed**. It becomes a small input (digits only, selected); Enter or clicking away applies it clamped to that slider's own min/max (gap 0–120, text size 8–200, width 20–360, spacer 0–200, padding 0–200, canvas width/height 100–1600), Esc, an empty box or non-digits cancels. One undo step per typed value. All of them share one `sliderRow()` in `properties.js`, so new sliders get this automatically. (Other values are already typeable: text content is an input, colors have a hex input in the picker; family/weight/direction/align are choices, not numbers.)
- **layout** (canvas/group, or the container around a selected block): `stack` | `row` segmented toggle, align (start/center/end) on the same line as **icon buttons with tooltips** (`start`, `center`, `end`; three horizontal lines when the layout is a stack, three vertical bars when it is a row, since align then means vertical), `gap` slider (0–120px).
- **size** (canvas only, after layout; collapse key `size`): a `fixed` | `dynamic` segmented toggle (`dynamic` is disabled with the tooltip "add content first" while the canvas has no visible content), a `padding` slider (0–200), and, only when fixed, `width` and `height` sliders (100–1600). All are `sliderRow()`s (double-click to type, clamped to their own range, one undo step per gesture). Dynamic → fixed fills width/height with the canvas's current rendered size. Each selected canvas's section has its own size group.
- **Text block selected**: text content input (live, one undo step per edit), size slider (8–200), and a `font` row: a family button with ▾ (opens the family picker, the built-in fonts included) plus a weight/style selector (`400`, `700`, `400 italic`; disabled when the family has one file). A deleted font shows `missing ▾`. A library font can be dropped on the row (it changes only this block). (The text color is in the colors section. There is no separate `type` group any more.)
- **Vector block selected**: width slider (the layer colors are in the colors section). **Image** block: width. **Spacer**: size.

**What-will-change outline (`outline.js`).** In the accent color (`--accent`), the preview outlines the exact thing a color or font will change, not the whole block. It is shown while a library **color or font is dragged over a target** and while a **color row in the properties panel is hovered**. Text → a stroke around each character (`-webkit-text-stroke` + `paint-order: stroke fill`, so the fill stays visible; class `.pick-text`). Vector layer → a temporary copy of that layer placed right after it with all fills removed and every shape stroked in the accent color, so it follows the shapes of that layer only (`.pick-layer`). Canvas background → a frame just inside the canvas edge (`.pick-bg`). The old whole-block dashed `.drop-target` box is no longer used for color or font drops on the preview. The outline only decorates the live preview DOM (CSS classes and one temporary clone) and is removed when the drag/hover ends; the export builds its own DOM, so the outline can never appear in an export.
- **Several items selected:** the properties area shows **one section per selected item, stacked** (separated by a divider), each under a small header naming it (`lockup_A` for a canvas, `lockup_A / heading 1` for a block). Each section is that item's normal properties (colors, layout, size for a canvas, block controls incl. the text block's own font) and every control only edits the item of its own section. Group collapse state (`colors`, `layout`, `size`, `block`) is shared by all sections. The properties area scrolls inside itself when long; the layers header above and `save as preset` below stay put.
- Bottom: dashed `save as preset ▣` button (asks for a name in a small inline input). **Enabled only when exactly one canvas is selected** (a selected block no longer enables it).

### 8.8 Status bar
Thin bar at the bottom: left `library: 15 blocks · 6 media · 24 fonts · 38 colors · 5 palettes` (live counts, in the same order as the library sections; `blocks` is the same number as the blocks section header: default blocks + presets, via `libraryBlockCount()` in `blocks.js`; there is no separate presets count; `fonts` is the number of font families, the same number as the fonts section header and its cards), right `Stylesheet_ by HALFWIT Studios · v1.0.0` (the version is read from package.json at startup via `window.api.getVersion()`, so bump it only in package.json). It shares the top bar's background (`--bg`) and `--line` border, with muted 11px text.

### 8.9 Overlays
- **Help (`?`)**: dims the app and shows four step cards (`01 — LIBRARY`, `02 — PREVIEW`, `03 — EDITOR`, `04 — EXPORT`) in **one row, centered horizontally in the window, always in that order**, with equal 24px gaps (`.help-row`, flex, `align-items: flex-start`). The cards are not positioned relative to the panels they describe. All four have the same width, `min(330px, (100vw − 120px) / 4)` (290px at 1280; CSS variables `--help-card-w` / `--help-gap` on `.help-overlay`); their tops line up and each card is only as tall as its own text. The row's top is 120px below the top of the preview panel (`HELP_TOP` in `overlays.js`). The card text lives in `HELP_CALLOUTS` in `overlays.js` as a list of **points** per card, drawn as a `<ul class="help-points">` with a small lime dash per point (`pointList()`; styles in `overlays.css`). The cards cover (rewritten for the current app): **library** (offered blocks + saved presets, `+ import` copies files in, colors via `+ add` or the eyedropper, palettes, drag targets, right-click delete → trash); **preview** (`+ add canvas` / drops on the empty grid, OPTION letters and the auto-aligned grid, single-thing color drops with the lime outline, click / Ctrl/Shift+click / drag-select, double-click text, wheel zoom, space/middle-drag pan, fit, typed zoom); **editor** (layers tree actions, `+ block`, right-click menu and Ctrl+C/V/D/G/Delete, properties: colors, layout, size with padding, a text block's font, double-click numbers, save as preset); **export** (visible canvases only, canvas labels vs style labels, PNG/WebP transparency vs solid JPEG, 1×/2×/4×, the notification arrow button).
  - **Import tips box:** 24px below the tallest card sits one wide `IMPORT TIPS` box (`.help-callout.help-tips`, same card look and accent title), exactly `4 × card width + 3 × gap` wide, so its left edge lines up with card 01 and its right edge with card 04 at every window size (the row and box share a centered `.help-stack` column). Inside are three equal columns (`.help-tips-cols`, CSS grid) with small white uppercase headings; the text lives in `HELP_TIPS` in `overlays.js`:
    Each column is a list of points (same `pointList()` as the cards):
    - **MEDIA**: + import in media takes .svg, .png, .jpg · SVGs recolor part by part, PNG/JPG can't (photos, textures) · drop a media card on a vector/image block to swap it.
    - **SVG SETUP**: each top-level layer or group = one recolorable part, no naming needed, with the shipped Stylesheet_ logo as the example (background, S, underscore = three parts) · parts keep their original colors until changed, then become one solid color · tight artboard, text converted to outlines.
    - **FONTS**: + import in fonts takes .ttf, .otf, .woff, .woff2; Space Grotesk and IBM Plex Mono are built in · one file = one weight/style, a family shares one card, the weight is picked in the properties font row · variable fonts import as one weight; fonts are embedded in exports.
  - **Fit:** after opening, `openHelp()` measures; if the tips box would come within 12px of the footer line, it adds `.compact` to the overlay (card padding 9px 12px, text 11px, tighter point spacing; the words never change). If it still doesn't fit, the whole stack moves up by exactly the missing amount, but never higher than `HELP_TOP_MIN` (24px) below the top of the preview panel. Measured: at 1280×720 it goes compact and moves up 33px (row top 135, tips end exactly 12px above the footer); at 2048×1152 it stays normal at 120px with lots of room. One footer line sits at the bottom center: "everything saves automatically · ctrl+z to undo · press ? anytime to reopen this · click anywhere to close". Click anywhere or `Esc` to close. Also shown automatically on first launch (`session.helpSeen`). The `?` key (when not typing) opens it too.
- **Settings (gear)**: a centered panel with: `clear canvas` (confirm dialog, undoable; removes all canvases and leaves one empty `lockup_A`), `open library folder`, default export scale (the same value as the export bar's scale), `on launch` (`maximized` | `windowed` segmented toggle, default maximized; saved to settings.json immediately but only applies the next time the app starts; the open window is not resized), a **trash** list (each soft-deleted item with a `restore` button, plus `empty trash` behind a confirm that permanently deletes the files), and app version. Keep it simple.
- **Notices** (`showToast()` in `overlays.js`) are non-blocking. The confirm dialog resolves on Enter/Esc.
  - **Where:** `#notify` (static markup in `index.html`, inside `#preview`, `z-index: 5`), positioned `right: 24px; bottom: 134px`, so its right edge lines up with the export bar's and it sits 12px above it. Because it lives in the preview, dialogs and the help overlay cover and dim it like the rest of the app (notices that arrive meanwhile still go into the log).
  - **Log button (`#btn-log`):** an `.icon-toggle` (shared button style, 34px like the transparency toggle) showing a chevron: **up** = expand, **down** = collapse. Only this button opens/collapses the log (clicking elsewhere doesn't). There is no unread dot/badge (removed at your request).
  - **Toasts:** while the log is collapsed, each notice also shows as a toast directly LEFT of the button (8px gap, bottom-aligned with it). A toast is exactly the same entry as in the open log (`noticeEntry()` in `overlays.js`: `.toast.log-entry`, 34px tall like the button, message + muted time, 440px max), so toasts and log entries look, size and sit the same; only the log's scrollbar (more than 5 entries) pushes the open entries further left. Each toast is removed after a few seconds (4.5s by default) as before. Several stack upward, newest at the bottom (nearest the button). Opening the log clears the visible toasts (their notices are in the list).
  - **Expanded log (`#notify-log`):** not a panel, a gapped stack of toast-style entries (8px gaps) in the same spot as the toasts: directly LEFT of the button, bottom-aligned with it, growing upward (it sits in the same `.notify-row` as the toasts and the button). Newest at the bottom (nearest the button); each older entry is more transparent (opacity 1, .85, .7, .55, .4 … never below .25). At most **5 entries are visible** (34px each); older ones scroll. The scrollbar (standard 6px) and the 8px space before it (like the library lists) only exist when there are more than 5 entries (`.has-scroll`, set by `renderLog()`); with 5 or fewer, entries end 8px from the button, exactly where toasts do. The empty toast stack is `display: none` (`.toast-stack:empty`), otherwise the row gap counts twice and the open log sits 16px from the button. The list has 2px `padding-block` (cancelled by a −2px `margin-block`) so the newest entry's bottom border isn't lost to pixel rounding at Windows display scaling. Each entry is one line: the message (ellipsis if long, full text in the tooltip) plus a small muted time (`9:42`, 24-hour). While open, new notices go straight into the list (no toast) and stay until it is collapsed. Empty: a muted "no notifications yet".
  - **Memory:** the last **25** notices, in memory only (cleared when the app closes; not saved, not in undo).
  - **Never blocks the preview:** `#notify`, its row and the toast stack are `pointer-events: none`; only the button, the toasts and the open list take the mouse. The wheel over the open list scrolls it instead of zooming the preview.

### 8.10 Buttons (one shared style)
Every button and toggle button uses ONE look, defined only in `base.css` and based on the library's `+ import` button: `--card` background, 1px `--line` border, `--radius-sm` (4px) radius, `--text` color, IBM Plex Mono. The shared selector covers `.btn`, `.plus-btn`, `.seg button`, `.icon-toggle`, `.mini-btn` and `button.prop-row`; each class only adds its own size/layout in its own stylesheet (so heights stay where the layout depends on them). Never restyle the look per panel.
- **Hover:** accent border + accent text, background unchanged.
- **Press (`:active`):** background darkens slightly (`#0C0C0E`) with a quick 80ms transition. No movement, scale or bounce. Applies to all of them, including `+ import` / `+ add` (not `+ block`, which is a text-link style, see below).
- **Toggles:** unselected options look like the base button. The selected option (`.seg button.active`, `.icon-toggle.on`) has an accent border + accent text and keeps it (no white fill). **Segmented toggles (`.seg`) are one joined control:** buttons overlap by 1px (`margin-left: -1px`) so neighbours share one `--line` divider, only the outer corners are rounded, and unselected hover changes the text color only. The selected option gets `z-index: 1` so its accent border draws over the dividers; sizes never change, so nothing shifts. The zoom control (− | 100% | +) is also a joined `.seg`: the `100%` readout (`.seg-value`) is a non-clickable middle section drawn with the same border/background as the buttons. The transparent icon toggle is a single button, not a `.seg`. Icon-only options (align) use `icon()` glyphs in `util.js` (14px, `currentColor`) and a `title` tooltip.
- **Destructive exception (`.btn-danger`):** looks like a normal button at rest; on hover the background and border turn `--danger` and the text white; pressed is a darker red (`#9E2216`). Used by `clear canvas` and `empty trash` in settings and by the confirm button of any dialog called with `danger: true` (library deletes, clear canvas, empty trash). Cancel and `restore` stay normal.
- **`+ block`** (layers header) is deliberately not a `.plus-btn`: it uses `.link-btn`, the same styles as the settings overlay's `close` button (borderless, muted text, accent text on hover, no press state of its own).
- **Disabled:** 40% opacity, default cursor, no hover/press (e.g. the transparent toggle when JPEG is selected).
- **Not part of this:** the top bar buttons (`.win-btn`), the editor's `save as preset` (`.dashed-btn`), plain text links (`.link-btn`, `.reset-link`) and the export bar's `style labels` / `canvas labels` checkboxes. Menu rows (`.menu-item`) and color chips in popovers are list items, not buttons, and keep their own look.
- **The eyedropper button** in the library's colors header is the same `.icon-toggle` (24px instead of 34px) and behaves exactly like the transparent toggle below.
- **Transparent icon toggle (export bar)** behaves like the segmented toggles: off + hover = icon turns accent but the border stays normal; on = accent border + accent icon (also while hovered); off and not hovered = looks like an unclicked button. Disabled (JPEG) is dimmed with no hover.
- **Export button (`#btn-export`)** is the one unique button (36px tall, top right of the export bar): at rest it is the normal shared button; on hover it turns solid accent (background AND border `--accent`, text `#0A0A0B`), and pressed is a darker lime `#C4E63B` (my shade). Styled in `preview.css` with an ID selector so it beats the shared hover (which would make the text accent on an accent fill). While an export runs the button is disabled and reads `exporting…`; it keeps the solid accent look (`#btn-export.btn:disabled`, full opacity) instead of the dimmed disabled style.
- Apart from the export button's hover/press there is no filled-lime button (`.btn-primary` was removed). Red appears only on hover/press of `.btn-danger` (above).

---

## 9. Drag and drop

Uses native HTML5 drag and drop. The drag payload is `{ kind: 'font'|'color'|'media'|'block'|'preset'|'node', id }` (`node` = a row of the layers tree; `font` id = a specific library font file; `block` id = the block type name). Sources carry `data-drag-kind` / `data-drag-id`; `dragdrop.js` plans each drop (`planDrop`) and runs a single `state.js` call.

Drop targets and results:
| Dragged | Dropped on | Result |
|---|---|---|
| block type | empty dot grid | if `canvas`: new empty canvas (fixed 160×160). Otherwise: new **dynamic** canvas containing that block |
| block type | a canvas / group | adds the block to it (at the drop position in the flow) |
| preset | empty dot grid | new canvas from the preset structure (placeholders), with the preset's size mode, width/height and padding |
| media | empty dot grid | new **dynamic** canvas containing a vector/image block with that media item (added in the canvas-size pass) |
| media | a canvas | adds a vector/image block with that media item |
| media | a vector/image block | swaps its media item |
| font | a text block (preview or layers row) | sets that block's own font. If the block is one of **several selected text blocks**, it sets the font of ALL selected text blocks (one undo step) and every one of them gets the accent text outline. Dropping on an unselected block changes just that block |
| color | a canvas background area | sets that canvas's `background` (outline: the canvas edge) |
| color | a text block | sets that block's `color` (outline: the text) |
| color | a vector layer (the shape under the pointer) | sets just that one layer's color (outline: that layer's shapes). Empty space inside the vector is not a target |
| color | a row in the editor's colors section | sets that row's one thing (outline of it in the preview) |
| anything | a row in the layers tree | same as dropping on that node in the preview |

Additions beyond the table: a `canvas` block dropped on a canvas adds a new canvas after it; a preset dropped on any canvas also makes a new canvas; a media item dropped on a vector/image block only swaps if the types match (svg↔vector, image↔image), otherwise it is added to the container; a font can be dropped on the `font` row of a text block's section in the editor (changes only that block); a color dropped on any other block (image, group, spacer) sets the canvas background (`dropColor()`). Layer-row drops: `node` rows reorder/move, `block`/`media` on a leaf row insert after it; a color on a text row sets its color, on a canvas (or other) row sets the canvas background, and on a vector row does nothing (a vector has several layers: drop on one in the preview or in its colors section). The outline is the hovered valid target only (`.drop-target`, or `drop-into/before/after` on tree rows). **Color and font drops on the preview use no box at all**: a plan carries `outline` (`{type:'text'|'layer'|'canvas', …}`; text takes `blockId` or `blockIds: [...]` for several blocks at once) and `el: null`, and `outline.js` draws the accent outline of exactly what will change (see the editor section). Tree rows and editor rows keep their own drop highlight in addition to the preview outline. Dropping files from Explorer onto the window is ignored (use `+ import`).

Show a lime dashed outline on valid drop targets while dragging. Every drop is one undo step.

---

## 10. Export

- Exports **all visible canvases** as laid out in the auto grid (at 100% zoom, ignoring current pan/zoom, at their real sizes, in the same column/row cells as the preview via the shared `applyGridLayout()`), with their `OPTION` labels above each canvas when `canvas labels` is on (off: the labels and the row they take are left out; canvas sizes are unchanged).
- Rendered with **html-to-image** from an offscreen export container at `pixelRatio = scale`.
- **PNG** or **WebP** with transparent toggle on: the dot grid and app background are excluded; canvases keep their own backgrounds. **JPEG**: always on a solid background.
- **WebP**: html-to-image has no WebP function, so the sheet is rendered with `htmlToImage.toCanvas()` and encoded with `canvas.toDataURL('image/webp', 0.92)` (Chromium's built-in encoder; no extra package). Save dialog uses a `.webp` filter.
- **Style labels** checked: append a strip below the canvases listing, for everything used: a **colors** section with a small `OPTION A/B…` heading per canvas followed by one entry per colorable thing, each shown as its name plus the color chip(s) and hex(es) it uses **right now**: `background`; every visible text block with text and a font (by block name, e.g. `title`, in its current color, black by default); and every first-level layer of every vector (`<vector name> / <layer name>`; a layer still on its original colors lists every color it contains, a recolored layer its one color). A hex that matches a library color/palette swatch also shows that name. Then each font written **in its own typeface** with family + weight; each media item's name next to a **one-color black version** of it (section title `media`).
- The style-labels strip keeps its per-canvas `OPTION A/B…` headings even when `canvas labels` is off, so options can still be told apart.
- After rendering, `window.api.saveExport()` opens a save dialog (in the last export folder, see section 6) with a default name like `stylesheet_export_2026-10-07.png` (`.jpg` / `.webp` for the other formats).
- Imported fonts must be embedded in the export (make sure html-to-image can fetch them through `ssfile://`).

**As built:** the offscreen sheet is built into `#export-root` by `export.js` using the same `renderCanvasElement()` and `applyGridLayout()` as the preview (no selection outline, no shadow). Because dynamic canvases size themselves, the grid is laid out first and, after `document.fonts.ready`, the style-labels strip is made exactly as wide as the measured grid. The sheet has 24px padding; background is white for JPEG or when transparent is off, transparent otherwise (the style-labels strip is always a white card). `html-to-image` is called with `pixelRatio: scale` and a hand-built `fontEmbedCSS` (every used library font fetched through `ssfile://` and inlined as a data URI, plus the bundled IBM Plex Mono 400/500/700 and Space Grotesk variable files via `window.api.readBundledFont`), because a `file://` page cannot `fetch()` its own font files. The strip's colors section is built per canvas by `collectUsage()` (see above; original layer colors come from `layerInfo()`), each used font as `Family weight` in its own typeface, and each used media item as a black one-color version (rasters use `filter: brightness(0)`). `transparent` stays stored while JPEG is selected; the toggle just shows disabled/off.

---

## 11. Out of scope for v1
Do not build these unless asked: projects/multiple sessions, cloud sync, accounts, SVG export, free-form dragging/positioning of blocks on a canvas (layout is flexbox only), text effects, gradients, auto-update.

---

## 12. Gotchas to remember
- Frameless window: buttons inside the drag region must be `-webkit-app-region: no-drag` or they won't click.
- Illustrator often puts fills on paths or in a `<style>` block with classes. Never guess a shape's color from its attributes: mount the SVG and read `getComputedStyle` (that is how `svg.js` finds original colors and which shapes have a fill/stroke). To recolor a layer, set inline `fill`/`stroke` only on the shapes that really have one, so `fill="none"` shapes stay unfilled.
- The accent "what will change" outline must stay out of exports: it is only ever added to the live preview DOM by `outline.js`; the export renders from its own fresh DOM.
- Register imported fonts with the `FontFace` API using `ssfile://` URLs, and wait for `document.fonts.ready` before export.
- `position: sticky` breaks inside `overflow: hidden` ancestors — use flex layouts for panel headers.
- Decorative pseudo-elements need `pointer-events: none`.
- Save on quit: block the quit until the renderer confirms the session flush (with a short timeout fallback).
- Drop handlers must run the planned action **before** clearing the drag payload (the planned closures read the dragged id lazily).
- Restoring from trash: wait for the main-process trash sync (`whenTrashSynced()`) before reloading the file, or the read races the file move.
- Font table offsets differ by format: in a TTF/OTF directory entry the offset is at +8, in WOFF at +4.
- `html-to-image` copies the root's computed styles, so the offscreen export node must be `position: static` inside an off-screen wrapper (not itself positioned off-screen).
- A `file://` page can't `fetch()` local files; use `ssfile://` (library files) or a `window.api` call (bundled fonts).
- Dynamic canvases size from their content, so any code that needs a canvas's or the grid's size must **measure the DOM** (`offsetWidth/Height`, which ignore the zoom transform) after it is laid out, not compute it from data. The grid needs `width: max-content`, or the window width squeezes dynamic canvases and wraps their text.
- Every canvas must have `size` and `padding`; `fixEmptyDynamicCanvases()` and the renderer read `canvas.size.mode` without checks, and the migration guarantees it for old saves.

---

## 13. Decisions made where the spec was silent (assumptions log)

Add to this list whenever a new assumption is made.
- Fonts are stored as font **ids** (not family names) because the picker chooses weight/style too. Default weight = closest to 400. (Per-block now, see "Fonts" in section 7; this replaced the old per-canvas font roles in the font pass.)
- ~~Canvases have an `aspect` field (default 8/9); the grid cell size is fixed at 384px wide at 100% zoom.~~ Replaced by `size` + `padding` in the canvas-size pass (below).
- **Aspect → size upgrade:** `migrateCanvasSizes()` in `state.js` (runs on every load, only touches things without `size`) turns every saved canvas into **fixed 384 × round(384 / aspect), padding 28** and deletes `aspect`. The presets older versions shipped (matched by id, also in the trash) take their new settings from `LEGACY_PRESETS`; user-saved presets get the same fixed upgrade as canvases. It can be deleted once all old saves are gone (along with `legacySize`, `LEGACY_WIDTH`, `LEGACY_PADDING` in `blocks.js`, which the two fixed presets also use, so inline their values first).
- **Canvas-size pass assumptions:** the old content inset was 36px top / 28px sides and bottom, not the 48 in the brief, so old saves use padding **28** (your choice): content is exactly as wide as before, vertically centered content moves up about 4px. Heights are rounded to whole px (business_card 219 instead of 219.43). "Has content" = a visible block of any type (spacers count) or a visible group that shows something; a canvas whose only blocks are hidden is empty. Dynamic → fixed stores the measured size **unclamped** (a dynamic canvas smaller than 100 or bigger than 1600 keeps its size; the slider just shows its end until moved). A hidden canvas isn't measured; switching it to fixed uses its stored width/height. Dynamic canvases still store width/height (160×160 by default) but don't use them. The size group sits after layout so the existing groups don't move. Slider labels are `min-width: 44px` instead of a fixed 44px (your choice), so `padding` widens its own label column instead of overlapping its slider; its track starts a little further right than the other sliders. Dropping media on the empty grid didn't do anything before; the brief listed it, so it now makes a dynamic canvas containing it. `+ block` with nothing selected also makes a dynamic canvas (it goes through the same `addBlockToNewCanvas()`). The 160×160 fallback also applies on load (a saved dynamic canvas with no content).
- **Replaced in the font pass:** text blocks always render, in their own font (Space Grotesk by default; a deleted library font also falls back to it). New text starts as its type name; cleared text shows the type name at 40% opacity. Preset blocks start with the type name as text. (The old gray text placeholder is gone.)
- **Font pass assumptions (mine, from your answers):** the built-in fonts are Space Grotesk (the default, changed from IBM Plex Mono at your request; it's the variable file, offered at 400/500/700) and IBM Plex Mono at 400/500/700; they live in code (`BUILTIN_FONTS`), not in `library.fonts`, so it never appeared in the library panel (they do now, as undeletable cards) and can't be deleted, but it is in every font picker. Old-save blocks that had no font (they showed a gray placeholder) now show their text in Space Grotesk. Blocks that were already saved with IBM Plex Mono keep it (it can't be told apart from a deliberate choice). The `none` row is gone from the font picker (a block always has a font). Double-click focuses the text box with the text selected (so typing replaces it). Dropping a font on a selected text block changes the *directly selected* text blocks only (not text inside a selected group); dropping on the `font` row of a section changes just that section's block. Export always embeds IBM Plex Mono 400/500/700 and the Space Grotesk variable file.
- Library deletes: colors/palettes/presets are never "in use" (they hold copies). Deleting a font deletes the whole family. Palette-swatch deletes are trashed as `palette_color` and can only be restored if their palette still exists.
- Undo history includes the library (so deletes undo). Importing a file can be undone, but the copied file stays on disk (harmless; redo reuses it).
- "Clear canvas" = remove all canvases and leave one empty `lockup_A` (fixed 160×160, #EDEDEE). (A first launch, by contrast, has no canvas at all.)
- "Default export scale" in settings is `session.export.scale` (one value shared with the export bar).
- Canvas names auto-increment to the first free letter (`lockup_A` … `lockup_Z`).
- The grid re-fits when the visible canvas count changes; `fit` caps at 100%.
- Layout shown in the editor for a selected leaf block is its parent container's (group or canvas).
- Color/palette names are slugged to `lowercase_with_underscores` when edited.
- Default `symmetrical_logo` etc. structures and the `business_card` / `social_post` structures are my own designs.
- Media cards show a lime border when any block uses that media item.
- The library's `vectors` key/folder/ids were renamed to `media` (block field `vectorId` → `mediaId`, drag and trash kind `vector` → `media`, folders `library/vectors` → `library/media`). Old saves are upgraded automatically: `state.js` `migrateOldSaves()` (data) and `main.js` startup (folders). Those two blocks are the only places the word "vectors" still appears and can be deleted once all old saves are gone. The *block types* `vector` and `image` are unchanged.
- Block second-line labels (`text`, `media`, `container`, `color`, `layout`) are my wording; edit `kind` in `BLOCK_TYPES` to change them.
- The `drag in` hint now appears only on the blocks header (media and fonts show `+ import` instead).
- Palette swatch size (26px) and hue bucket size (15°) were chosen by me; both are single constants in `library.css` / `sorting.js`.
- Media/preset `addedAt` backfill for old saves: items get their array position (1, 2, 3…), shipped default presets get 0.
- Maximize happens in `ready-to-show` right before `show()` (calling `maximize()` on a hidden window would show it early). The saved setting wins over any remembered size; there is no remembered window bounds.
- `settings:save` sanitizes its input in `main.js` (anything but `windowed` becomes `maximized`), so a bad file or call can't break startup.
- The editor's weight/style `<select>` is not a button, but it gets the accent border on hover to match its neighbors.
- Pressed-button background `#0C0C0E` and the 80ms transition are my choices (a slightly darker `--card`).
- The old top "click anywhere or press Esc to close" line in the help overlay was folded into the new bottom footer line (one line, not two).
- `+ block` copies the settings `close` button's style by reusing `.link-btn` (which has no press state), so it has no press effect; it was originally a `.link-btn` and the 20px compact header fits it again.
- Align icon glyphs are my own drawings (3 lines / 3 bars, 1.3 stroke like the other icons); `row` direction swaps to the vertical-bar set.
- Overflow audit (static, by measuring widths, not visually) at 1280×720: nothing was found overflowing. The colors section rows are single full-width rows (no 2×2 grid any more), with the layer name truncated by an ellipsis.
- The joined segmented toggles are made of overlapping bordered buttons (not a bordered wrapper) so the selected accent border can sit exactly over a divider.
- Help cards (your spec): max 330px, 24px gaps, content-height cards with aligned tops; at 1280 they are 290px wide (4 cards + 3 gaps + 24px side margins). My choices: the import tips column headings are white (`--text`) 11px uppercase so they don't compete with the accent `IMPORT TIPS` title; the columns are 24px apart; the small-window fallback is a measured check (`.compact` class) rather than a fixed media query, so it only kicks in when the box would actually touch the footer (measured since the help rewrite: `.compact` applies at 1280×720, together with the move-up, see 8.9). The compact values (9px 12px padding, 11px text) are mine. The check runs once when the overlay opens, not on resize.
- Wheel zoom listens on the whole `#preview` panel (so the floating bars don't block it) but only the canvas grid is scaled; the 1.1-per-100px rate and the ±300 delta cap are my choices. Typed zoom has no `%` sign in the input and allows at most 3 digits; "center of the preview" means the center of the stage area (`stageCenter()`), not the visible gap between the floating bars.
- The empty-state button replaced the old "drag a preset or a block here to start" text entirely (the text is gone).
- The zoom `100%` readout is a non-clickable middle segment of the joined zoom control.
- **Per-item colors:** new canvases are white (since the first-run defaults pass: #EDEDEE), new text is black, new vectors show the file's own colors (your decisions). The `swatch` block was removed (your decision); old swatch blocks are deleted on upgrade.
- First-level layer = drawable direct child of the SVG root, with one assumed extra rule of mine: a single wrapper group holding several drawable children is skipped (Illustrator's usual `<g id="Layer_1">`). Layer key = its index (0, 1, 2…), which is stable because an imported file never changes.
- Original colors are read via `getComputedStyle` on an off-screen mount; a gradient's "color" is its first stop; fully transparent colors are ignored. Shapes inside `<defs>`, `<clipPath>`, `<mask>`, `<pattern>`, `<marker>` are never repainted, and a `<use>` of a `<symbol>` only gets the fill on the `use` element, so symbol content that declares its own fill keeps it (rare).
- Recoloring sets inline fill/stroke, so a stylesheet rule with `!important` could still win (rare in Illustrator exports).
- The vector outline is an accent stroke (2px, non-scaling) on every shape of the layer, including inner details, not a single merged silhouette; the text outline is a 3px glyph stroke (outer half visible). Both widths are single values in `preview.css`. The canvas outline is a 3px frame just inside the edge.
- Dropping a color on empty space inside a vector, or on a vector row of the layers tree, does nothing (there is no single layer to change). Dropping on an image/group/spacer sets the canvas background.
- Swapping a vector's media (dropping another SVG on it) resets all its layer colors to the new file's originals.
- The colors section group is saved under `collapsedGroups.colors` (the old `roles` key is ignored).
- Export style labels list a text block only when it has text (a cleared block shows only a faded type name, so it isn't listed). Block names are used as labels, so rename blocks to make the strip clearer.
- **Multi-select (your decisions):** the selection is a list and is either blocks in one canvas or canvases, never a mix; a conflicting pick switches the selection to just that new item (changed from "becomes the owning canvases" after testing: that could delete canvases by accident). A canvas is outlined only when it is itself selected. `+ block` adds to the end of the selected canvas(es); the `group` block was removed from the library and `+ block` in the group pass (groups are made in the layers tree now).
- **Group pass assumptions (mine, from your answers):** the `group` node type stays in the data (presets, old saves, preview, drag-into-group all use it), so no migration was needed; its icon `▢` now lives in `GROUP_GLYPH` in `blocks.js` because it's no longer in `BLOCK_TYPES`. A new group takes the parent's layout; empty groups are auto-removed (also pre-existing empty groups from old saves, the next time anything is moved or deleted); grouping blocks that sit in different parents puts the group at the first one's spot and pulls the rest in. Ungrouping a mix of groups and non-groups only affects the groups. Dragging a multi-selection in the tree still moves just the dragged row.
- **Drag-select assumptions (mine):** the box selects what it *touches* (not only what it fully contains); a drag may start on empty grid, a canvas or a block (blocks can't be dragged on a canvas); movement under 4px still counts as a click; the box ignores Ctrl/Shift; the selection updates live while dragging.
- **My assumptions for multi-select:** Shift+click in the preview works like Ctrl+click (toggle); in the tree Shift+click replaces the selection with the range (it does not add to it) and keeps the anchor. A modifier-click on empty dot grid does nothing. Ctrl-clicking a block while a canvas is selected selects just that block. After `+ block` or paste into several canvases, those canvases stay selected (blocks in different canvases can't be). Right-click menu and `Ctrl+C/V` exist in the layers tree only (not the preview). Delete from the menu has no confirm (undoable). Canvas copies/pastes use the next free letter (`lockup_B`), not "copy". Copy suffix format is `name copy`, `name copy 2`, `name copy 3` (copying a copy doesn't stack suffixes). Pasted blocks keep their own colors, text and font. Preset-made blocks keep the preset's plain names; only blocks added through `+ block`/drops get `type N` numbers, so a canvas can have an old `heading` next to a new `heading 1`.
- **Eyedropper assumptions (mine):** it samples the screen pixel (what you see, including anti-aliased edges and image pixels blended over the canvas background), not the underlying file data; the button is 24px (header size) rather than the export toggle's 34px; it sits left of `+ add`; the new color is named `new_color` with the name selected for typing (Esc keeps it as `new_color`, like `+ add`); zoom/pan and the floating-bar buttons stay usable without switching it off (they are in the preview); clicking a floating bar's empty background counts as negative space; keyboard shortcuts other than Esc don't switch it off; selection outlines are hidden while it is on; a negative-space click only switches the tool off (it doesn't also deselect). The icon is my own drawing.
- **Folder memory / two-row export bar / canvas labels / WebP pass (mine):** an import counts as "successful" (and updates its folder) only when at least one file was actually copied; the stored folder is the folder of the first chosen file. The renderer can't change `lastFolders` through `saveSettings` (main owns it). The dev `STYLESHEET_IMPORT` / `STYLESHEET_EXPORT_PATH` shortcuts also update the folders (harmless). (Revised by you: checkboxes stacked, `include style labels` renamed `style labels`, format+transparent stacked over scale, export button back to 36px at the top right.) My choices there: 28px between the two columns, the 6ch caption width. The `format` / `scale` captions are now always visible (the narrow-window rule that hid them was removed because each row has room). Toasts moved from 112px to 164px above the window bottom (12px clear of the bar; later replaced by the notification log group, which keeps that 12px gap), and `fit` now reserves 142px at the bottom instead of 102px so canvases don't fit under the taller bar. WebP quality is 0.92, as you suggested. The `canvas labels` checkbox is not in undo history, like the other export settings; toggling it only redraws the preview grid (other export settings still don't).
- **Glass panels (your request: nothing may move, easy to revert):** built as a `<body>` class switch rather than a layout change. Same glass values as the bars (your choice). My choices: panels at `z-index: 6` (above the stage and bars, below popovers/overlays); the dot grid under the panels is a wider pseudo-element so the preview's own coordinates never change. Known side effects: the drag-select box can reach canvases that are panned under a panel; clicks on a panel always go to the panel, never to a canvas behind it.
- **Notification log (your answers: chevron up/down icon, transparency-toggle size, a gapped list instead of a panel, older entries more transparent, max 5 visible, memory 25 (changed from 20), newest at the bottom, under the dim of dialogs/help; the unread accent dot from the original spec was removed at your request).** My choices: the opacity steps (−0.15 per entry, floor .25); entries are fixed-height single lines with an ellipsis + tooltip so exactly 5 fit; list max width 440px and entries stretch to the widest one (so there's no ragged empty space between them); the scrollbar space appears only when the list actually scrolls (your request), so when the 6th entry arrives the entries shift 14px left to make room for the 8px space + 6px scrollbar (8px row gap to the button stays); time is 24-hour `H:MM`; opening the log removes the toasts on screen; the button has no `.on` state (the chevron direction shows it); warn notices keep the accent border in the log too; toasts still disappear without an animation (as before). The wheel over a toast or the button still zooms the preview (only the open list scrolls). With the eyedropper on, the button works but clicking a toast/entry counts as negative space (turns it off), like the floating bars.
- **Help rewrite (mine):** the text is written as short points (a lime dash each) instead of paragraphs, so the extra detail stays scannable; the wording is mine. Because the longer text didn't fit at 1280×720 even in compact mode, compact windows may also move the help up (never above 24px below the preview top). There is room for roughly one more point per card at 1280×720 before the 24px limit is reached; beyond that the tips box would touch the footer.
- **First-run defaults pass (mine):** the `defaults` palette's color names (`white`, `black`, `red`) are mine (you gave only hexes). The built-in font cards have no right-click menu at all (rather than a disabled item). The fonts count counts font FAMILIES (your change, so it matches the cards; it used to count files). The red single color is named `pure_red` (my name, matching `pure_black` / `pure_white`; it replaced `danger_red`). Default media is added with `seedMedia()` (not an undo step, so Ctrl+Z can't remove the starter content); if copying fails it is logged and the app still starts. The logo file in `src/defaults/media/` is a byte copy of the already-verified `build/icon.svg` (identical artwork); the wordmark was typed in from your attachment and checked path by path. A deleted default media item goes to the trash like any import. "First launch" = no library.json AND no session.json (the existing `isFirstLaunch`), so deleting only one of them never re-adds the media. Old canvases that somehow had no background are still upgraded to white, not #EDEDEE. The old shipped presets were renamed `LEGACY_PRESETS` (they are still needed for existing libraries).
- **Labels outside the canvas (mine):** 6px gap between label and canvas; the label no longer takes the canvas's contrast color (it isn't on the canvas any more): muted gray in the preview, `#777` in the export; with `canvas labels` off the label row disappears (so toggling it shifts the canvases slightly) instead of leaving an empty gap in exports. A cell is as wide as the wider of label and canvas, so a canvas narrower than its label is left-aligned under it. Clicking or dropping on the label counts as the empty grid.
- **Panel space pass (mine):** the 60% includes the divider and the `properties` header (the whole properties part), measured against the space between the editor header and `save as preset`. The `properties` header reuses the `layers` header's class so the two can never drift apart. The library's per-section `--w` weights were removed from `index.html`.
- **App icon pass (mine):** `icon.ico` is generated by `build/make-icon.js` run through Electron (`npm run icon`), rather than a one-off script outside the repo, so it can be regenerated whenever `icon.svg` changes, with no new package. Sizes 16–128 are stored as classic 32-bit bitmaps with alpha (readable by every Windows tool, including NSIS), and 256 as PNG (the usual format for that size). No separate PNG file was needed: electron-builder and `BrowserWindow` both take the .ico. The NSIS `installerIcon` / `uninstallerIcon` are set explicitly to the same file (electron-builder would already default to it). The placeholder was replaced in place (same path), so there was no old file to delete. Each size is a straight downscale of the SVG; there is no hand-tuning or pixel snapping for 16/24px. The window icon (`main.js`) reads `build/icon.ico`, which only exists in dev; the packaged app takes the exe's embedded icon.
- **Upgrade of old saves:** `state.js` `migrateRolesToColors()` copies each canvas's role values into fixed colors (`background`, text `color`, vector `legacyLayerColors`) and removes `roles`, `colorRole`, `colorOverride`, `layerRoles`, `layerOverrides`, swatch blocks and `media.layers`. `resolveLegacyLayerColors()` (called from `app.js` after the SVGs load) turns `legacyLayerColors` (keyed by old Illustrator layer names) into `layerColors` (keyed by layer index): a new layer takes the color of the old named layer it is or contains, and an old whole-drawing color (`*`) fills the rest. Typical Illustrator files (named groups directly under the root) look identical. **Known difference:** if one first-level layer contains several old named layers with different colors, the whole layer takes the first one's color. Both blocks (and the `legacyLayerColors` field) can be deleted once all old saves are gone.

---

## 14. Dev and testing notes

- `npm start` runs the app; `npm run dist` builds `dist/Stylesheet_-Setup-<version>.exe` (NSIS, unsigned, so SmartScreen warns: "More info" → "Run anyway"). Packaged-app smoke test: `dist/win-unpacked/Stylesheet_.exe`. `npm run icon` regenerates `build/icon.ico` from `build/icon.svg`.
- **`npm start` and the installed app share ONE data folder** (`%APPDATA%\Stylesheet_`, from the productName). A dev launch therefore reads and writes the installed app's library/session. Use `STYLESHEET_USERDATA` for any test run, and to see the first-launch experience delete `%APPDATA%\Stylesheet_` (or point `STYLESHEET_USERDATA` at an empty folder). Uninstalling does not delete that folder.
- **Releasing a new version:** bump `version` in `package.json` (the status bar and settings read it; `package-lock.json`'s top two `version` fields should match), commit in GitHub Desktop, then `npm run dist`. The installer upgrades an existing install in place and keeps the user's data.
- If Electron launches as plain Node ("Cannot read properties of undefined (reading 'setPath')"), the shell has `ELECTRON_RUN_AS_NODE` set; unset it.
- **Dev-only environment variables** (honored only when the app is not packaged, except `STYLESHEET_USERDATA`): `STYLESHEET_USERDATA` (use a throwaway data folder; keep the path short, long paths break Chromium's cache), `STYLESHEET_DEBUG=1` (print renderer console messages to the terminal), `STYLESHEET_HARNESS=<file.js>` (a test harness that receives `{app, win, ipcMain}`), `STYLESHEET_IMPORT=<path;path>` (skip the import dialog), `STYLESHEET_EXPORT_PATH=<file>` (skip the save dialog). Test harness scripts are kept outside the repo.
- Automated checks done so far were scripted launches (screenshots, simulated drag events, close/reopen, export, trash flows, DOM measurements of the panel splits and help fit at 1280×720 and 2048×1152, first-run contents). Robert has looked at the first-launch experience in dev. Real mouse/keyboard dragging, native file dialogs and the v1.0.0 installer have not been verified by automated tests.

---

## 15. Status (v1.0.0, first public release) and known limitations

All eight build phases are implemented, plus the later passes logged in section 13 (multi-select, groups, eyedropper, notification log, glass panels, canvas size/padding, labels above canvases, equal library sections + 60/40 editor split, final app icon, first-run defaults, help rewrite). Version 1.0.0 is the first public release; all test data was deleted before building it, so the first install starts as a new user. Known gaps: variable fonts act as one weight; WOFF2 metadata comes from the file name; the editor properties area scrolls inside itself when long (many vector layers, or several stacked sections when many items are selected); the installer is unsigned.
