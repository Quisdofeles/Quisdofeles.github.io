// fonts.js: imported fonts.
//  - reads family / weight / style out of a font file (TTF, OTF, WOFF directly; WOFF2 falls back to the file name)
//  - registers each file with the FontFace API under its own unique CSS family name (via ssfile://)
//  - helpers for labels ("Space Grotesk 700"), grouping by family, "closest to 400" picking, and the B / I targets

const registered = new Set();   // font ids already added to document.fonts

// Built-in fonts: Space Grotesk (a variable font, so one file gives every weight) and IBM Plex Mono, the UI fonts that
// ship with the app (already loaded by @font-face in tokens.css, so nothing is imported or registered). They look
// like library fonts to the rest of the app (same fields), plus `builtin: true`, but they live here, not in
// library.fonts, so they can't be deleted and no save ever holds them. New text blocks start with DEFAULT_FONT_ID.
const builtin = (slug, family) => [400, 500, 700].map((weight) => (
  { id: `builtin_${slug}_${weight}`, family, weight, style: 'normal', builtin: true }
));
export const BUILTIN_FONTS = [...builtin('spacegrotesk', 'Space Grotesk'), ...builtin('plexmono', 'IBM Plex Mono')];
export const DEFAULT_FONT_ID = 'builtin_spacegrotesk_700';       // Space Grotesk Bold

// Every library font file gets its own CSS family name, so "Space Grotesk 700" and "Space Grotesk 400"
// can never be confused or faux-bolded by the browser. (A built-in font uses the real family + weight instead.)
export const cssFamily = (font) => (font.builtin ? font.family : `ssf-${font.id}`);
// The CSS that draws text in a font: library fonts carry their weight in the file (so weight stays normal);
// built-in Plex Mono picks its weight through font-weight.
export const fontCss = (font) => ({ fontFamily: `'${cssFamily(font)}'`, fontWeight: font.builtin ? String(font.weight) : 'normal', fontStyle: 'normal' });
export const fontUrl = (font) => `ssfile://lib/fonts/${encodeURIComponent(font.fileName)}`;

// "Space Grotesk 700" / "DM Serif Display 400 italic": the label shown in pickers and the trash.
export function fontLabel(font) {
  return `${font.family} ${font.weight}${font.style === 'italic' ? ' italic' : ''}`;
}

// ---------- Registering ----------
// Returns true only when the font was newly loaded (so the caller can redraw things that measure fonts).
export async function registerFont(font) {
  if (registered.has(font.id)) return false;
  registered.add(font.id);
  try {
    const face = new FontFace(cssFamily(font), `url("${fontUrl(font)}")`);
    await face.load();
    document.fonts.add(face);
    return true;
  } catch (err) {
    registered.delete(font.id);
    console.warn('could not load font', font.family, err);
    return false;
  }
}
export const registerFonts = (fonts) => Promise.all(fonts.map(registerFont));

// ---------- Font samples that always fit their box ----------
// Some fonts (display fonts with huge built-in metrics) draw their glyphs far bigger than their font-size, or far
// away from where the line box expects them, so a sample written in its own typeface can spill over its neighbors.
// fitFontSample() measures the REAL glyph outlines ("ink") with a canvas and, only when they would not fit, scales
// the text down and centers the ink in the box. Fonts that already fit are left exactly as the CSS draws them.
//   slot  = the box element (gets position: relative + overflow: hidden when fitted, so leftovers are clipped)
//   inner = the element holding the text, inside the slot (gets absolute position + a smaller font-size when fitted)
//   size  = the CSS font-size of the sample; boxH = the box's height (the line box the text is centered in)
//   boxW  = the box's width when the text is centered in a fixed-width slot (the library card); 0 = text starts at
//           the left and only the height is fitted (picker rows, the export strip)
//   pad   = px of breathing room kept around the ink when it has to be scaled down
const measureCtx = document.createElement('canvas').getContext('2d');
export function fitFontSample(slot, inner, font, { size, boxH, boxW = 0, pad = 0 }) {
  const css = fontCss(font);
  measureCtx.font = `${css.fontStyle} ${css.fontWeight} ${size}px ${css.fontFamily}`;
  const m = measureCtx.measureText(inner.textContent);
  // The ink box, x from where the text starts, y from the baseline (up is negative).
  const inkL = -m.actualBoundingBoxLeft, inkR = m.actualBoundingBoxRight;
  const inkT = -m.actualBoundingBoxAscent, inkB = m.actualBoundingBoxDescent;
  const inkW = inkR - inkL, inkH = inkB - inkT;
  if (!(inkW > 0 && inkH > 0)) return;                            // nothing drawn (or nothing measurable): leave it
  // Where CSS puts the baseline in a line box of boxH px: half of the leftover space above the font's own
  // ascent + descent, then the ascent. k = the scale (1 = the normal size).
  const A = m.fontBoundingBoxAscent, D = m.fontBoundingBoxDescent;
  const baseline = (k) => (boxH - (A + D) * k) / 2 + A * k;
  const startX = boxW ? (boxW - m.width) / 2 : 0;                 // centered text starts here (text-align: center)
  const fitsV = baseline(1) + inkT >= 0 && baseline(1) + inkB <= boxH;
  const fitsH = !boxW || (startX + inkL >= 0 && startX + inkR <= boxW);
  if (fitsV && fitsH) return;                                     // a normal font: keep the normal look

  const k = Math.min(1, (boxH - 2 * pad) / inkH, boxW ? (boxW - 2 * pad) / inkW : 1);
  const top = boxH / 2 - (baseline(k) + ((inkT + inkB) / 2) * k); // moves the ink's middle to the box's middle
  const left = boxW ? boxW / 2 - ((inkL + inkR) / 2) * k : 0;
  Object.assign(slot.style, { position: 'relative', overflow: 'hidden', height: `${boxH}px` });
  if (!boxW) slot.style.width = `${Math.ceil(m.width * k)}px`;   // the absolute text no longer gives the slot a width
  Object.assign(inner.style, {
    position: 'absolute', left: `${left}px`, top: `${top}px`,
    fontSize: `${size * k}px`, lineHeight: `${boxH}px`, whiteSpace: 'nowrap',
  });
}

// ---------- Grouping and picking ----------
// [{ family, fonts: [entries sorted by weight, normal before italic] }], families A-Z.
export function groupFamilies(fonts) {
  const map = new Map();
  for (const f of fonts) {
    if (!map.has(f.family)) map.set(f.family, []);
    map.get(f.family).push(f);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase()))   // alphabetical, case-insensitive
    .map(([family, list]) => ({
      family,
      fonts: list.sort((a, b) => a.weight - b.weight || (a.style === 'italic') - (b.style === 'italic')),
    }));
}

// "5 weights" / "2 styles" / "1 weight": the small caption under a family name.
export function familySummary(list) {
  const weights = new Set(list.map((f) => f.weight)).size;
  if (weights > 1) return `${weights} weights`;
  return list.length > 1 ? `${list.length} styles` : '1 weight';
}

// The entry whose weight is closest to 400 (normal style preferred; a tie goes to the heavier one).
// This is the default when a font is first assigned to a role.
export function closestTo400(list) {
  return [...list].sort((a, b) => {
    const da = Math.abs(a.weight - 400), db = Math.abs(b.weight - 400);
    return da - db || (a.style === 'italic') - (b.style === 'italic') || b.weight - a.weight;
  })[0] || null;
}

// ---------- B / I toggles (text properties) ----------
// B and I never fake a style: they switch to ANOTHER FILE of the same family. `fam` = every file of that family.
export const BOLD_MIN = 600;      // a weight of 600 or more counts as bold
const byDistance = (target) => (a, b) => Math.abs(a.weight - target) - Math.abs(b.weight - target) || b.weight - a.weight;

// The file B switches to, or null when the family has none. Not bold yet -> the bold file (weight ≥ 600) nearest to
// 700, in the same style (normal/italic). Already bold -> back to the non-bold file closest to 400, same style.
export function boldTarget(font, fam) {
  const same = fam.filter((f) => f.style === font.style);
  if (font.weight >= BOLD_MIN) return closestTo400(same.filter((f) => f.weight < BOLD_MIN));
  return [...same.filter((f) => f.weight >= BOLD_MIN)].sort(byDistance(700))[0] || null;
}

// The file I switches to, or null: the other style (italic <-> normal) at the weight nearest to the current one.
export function italicTarget(font, fam) {
  return [...fam.filter((f) => f.style !== font.style)].sort(byDistance(font.weight))[0] || null;
}

// ---------- Reading font files ----------
const WEIGHT_WORDS = [
  ['extralight', 200], ['ultralight', 200], ['semibold', 600], ['demibold', 600], ['extrabold', 800], ['ultrabold', 800],
  ['thin', 100], ['light', 300], ['regular', 400], ['medium', 500], ['bold', 700], ['black', 900], ['heavy', 900],
];

// Best guess from a file name like "SpaceGrotesk-SemiBoldItalic.ttf" (used when the font's own tables can't be read).
function describeFromFileName(fileName) {
  const base = fileName.replace(/\.[^.]+$/, '');
  const dash = base.indexOf('-');
  // "SpaceGrotesk-SemiBoldItalic": family before the dash, style words after it. No dash = no style info.
  const familyRaw = dash > 0 ? base.slice(0, dash) : base;
  const stylePart = (dash > 0 ? base.slice(dash + 1) : /italic|oblique/i.test(base) ? 'italic' : 'regular').toLowerCase();
  const family = familyRaw.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_]+/g, ' ').trim();
  const hit = WEIGHT_WORDS.find(([word]) => stylePart.includes(word));
  return { family: family || base, weight: hit ? hit[1] : 400, style: /italic|oblique/.test(stylePart) ? 'italic' : 'normal' };
}

// Returns a table's bytes from a TTF/OTF/WOFF file, or null.
async function readTable(view, bytes, tag) {
  const sig = view.getUint32(0);
  const isWoff = sig === 0x774F4646;               // 'wOFF'
  const count = view.getUint16(isWoff ? 12 : 4);
  const dirStart = isWoff ? 44 : 12;
  const entrySize = isWoff ? 20 : 16;
  for (let i = 0; i < count; i++) {
    const p = dirStart + i * entrySize;
    const name = String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
    if (name !== tag) continue;
    // TTF/OTF directory entry: tag, checksum, offset, length. WOFF entry: tag, offset, compLength, origLength, checksum.
    if (!isWoff) { const off = view.getUint32(p + 8); return bytes.subarray(off, off + view.getUint32(p + 12)); }
    const offset = view.getUint32(p + 4);
    const compLength = view.getUint32(p + 8), origLength = view.getUint32(p + 12);
    const raw = bytes.subarray(offset, offset + compLength);
    if (compLength >= origLength) return raw;      // stored uncompressed
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return null;
}

// Pulls a name string (by name id) out of an OpenType 'name' table.
function readName(table, wantedId) {
  const v = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const count = v.getUint16(2), strings = v.getUint16(4);
  let best = null;
  for (let i = 0; i < count; i++) {
    const p = 6 + i * 12;
    const platform = v.getUint16(p), id = v.getUint16(p + 6), len = v.getUint16(p + 8), off = v.getUint16(p + 10);
    if (id !== wantedId) continue;
    const slice = table.subarray(strings + off, strings + off + len);
    let text = '';
    if (platform === 3 || platform === 0) for (let k = 0; k + 1 < slice.length; k += 2) text += String.fromCharCode((slice[k] << 8) | slice[k + 1]);
    else text = String.fromCharCode(...slice);
    if (platform === 3 || !best) best = text;      // prefer the Windows record
  }
  return best;
}

// Reads { family, weight, style } from font bytes; falls back to the file name for WOFF2 or anything unreadable.
export async function describeFont(buffer, originalName) {
  const fallback = describeFromFileName(originalName);
  try {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    if (view.getUint32(0) === 0x774F4632) return fallback;   // 'wOF2' is Brotli-compressed; can't read tables here
    const nameTable = await readTable(view, bytes, 'name');
    if (!nameTable) return fallback;
    const family = readName(nameTable, 16) || readName(nameTable, 1) || fallback.family;
    const sub = readName(nameTable, 17) || readName(nameTable, 2) || '';
    let weight = fallback.weight, italic = /italic|oblique/i.test(sub);
    const os2 = await readTable(view, bytes, 'OS/2');
    if (os2 && os2.length >= 64) {
      const o = new DataView(os2.buffer, os2.byteOffset, os2.byteLength);
      weight = o.getUint16(4) || weight;
      italic = italic || (o.getUint16(62) & 1) === 1;
    }
    return { family: family.trim(), weight, style: italic ? 'italic' : 'normal' };
  } catch (err) {
    console.warn('font table read failed, using file name:', err);
    return fallback;
  }
}
