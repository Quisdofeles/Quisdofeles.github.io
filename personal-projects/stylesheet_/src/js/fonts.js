// fonts.js: imported fonts.
//  - reads family / weight / style out of a font file (TTF, OTF, WOFF directly; WOFF2 falls back to the file name)
//  - registers each file with the FontFace API under its own unique CSS family name (via ssfile://)
//  - helpers for labels ("Space Grotesk 700"), grouping by family, and "closest to 400" picking

const registered = new Set();   // font ids already added to document.fonts

// Every library font file gets its own CSS family name, so "Space Grotesk 700" and "Space Grotesk 400"
// can never be confused or faux-bolded by the browser.
export const cssFamily = (font) => `ssf-${font.id}`;
export const fontUrl = (font) => `ssfile://lib/fonts/${encodeURIComponent(font.fileName)}`;

// "Space Grotesk 700" / "DM Serif Display 400 italic": the label shown in pickers and the trash.
export function fontLabel(font) {
  return `${font.family} ${font.weight}${font.style === 'italic' ? ' italic' : ''}`;
}

// ---------- Registering ----------
export async function registerFont(font) {
  if (registered.has(font.id)) return;
  registered.add(font.id);
  try {
    const face = new FontFace(cssFamily(font), `url("${fontUrl(font)}")`);
    await face.load();
    document.fonts.add(face);
  } catch (err) {
    registered.delete(font.id);
    console.warn('could not load font', font.family, err);
  }
}
export const registerFonts = (fonts) => Promise.all(fonts.map(registerFont));

// ---------- Grouping and picking ----------
// [{ family, fonts: [entries sorted by weight, normal before italic] }], families A-Z.
export function groupFamilies(fonts) {
  const map = new Map();
  for (const f of fonts) {
    if (!map.has(f.family)) map.set(f.family, []);
    map.get(f.family).push(f);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
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
