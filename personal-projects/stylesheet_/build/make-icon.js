// make-icon.js: turns build/icon.svg (the source) into build/icon.ico (generated; never edit it by hand).
// Run with `npm run icon` whenever icon.svg changes. It uses Electron itself (already a devDependency), so no
// extra package is needed: a hidden window draws the SVG onto a <canvas> at each size (Chromium rasterizes the
// vector fresh at every size, so the small sizes stay sharp), and this script packs the results into one .ico.
// Not part of the app: it is not in package.json "files", so it never ships in the installer.

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const SVG_PATH = path.join(__dirname, 'icon.svg');
const ICO_PATH = path.join(__dirname, 'icon.ico');

// Runs inside the hidden window: draws the SVG at every size and returns, per size, the raw RGBA pixels
// (for the small sizes) and a PNG (for 256). Everything outside the rounded square stays transparent.
function renderInPage(svgBase64, sizes) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(sizes.map((size) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      return {
        size,
        rgba: Array.from(ctx.getImageData(0, 0, size, size).data),
        png: canvas.toDataURL('image/png').split(',')[1],
      };
    }));
    img.onerror = () => reject(new Error('could not load icon.svg'));
    img.src = `data:image/svg+xml;base64,${svgBase64}`;
  });
}

// One classic (uncompressed 32-bit) icon image: a BITMAPINFOHEADER, the pixels bottom-up in BGRA, then an empty
// AND mask (the alpha channel already does the transparency). Used for the small sizes because every Windows
// tool (Explorer, the taskbar, NSIS) reads this format.
function bmpEntry(size, rgba) {
  const header = Buffer.alloc(40);
  const maskRow = Math.ceil(size / 32) * 4;                // AND mask rows are padded to 4 bytes
  const pixels = Buffer.alloc(size * size * 4);
  const mask = Buffer.alloc(maskRow * size);              // all zeros = "use the alpha channel"
  header.writeUInt32LE(40, 0);                             // header size
  header.writeInt32LE(size, 4);                            // width
  header.writeInt32LE(size * 2, 8);                        // height: doubled, because it counts the mask too
  header.writeUInt16LE(1, 12);                             // planes
  header.writeUInt16LE(32, 14);                            // bits per pixel
  header.writeUInt32LE(pixels.length + mask.length, 20);   // image size (compression at 16 stays 0 = none)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = ((size - 1 - y) * size + x) * 4;         // bitmaps are stored bottom row first
      pixels[dst] = rgba[src + 2];                         // B
      pixels[dst + 1] = rgba[src + 1];                     // G
      pixels[dst + 2] = rgba[src];                         // R
      pixels[dst + 3] = rgba[src + 3];                     // A
    }
  }
  return Buffer.concat([header, pixels, mask]);
}

// Packs the images into the .ico container: a 6-byte header, one 16-byte directory entry per image, then the images.
// 256 is stored as PNG (the standard for that size, and much smaller); the rest as classic bitmaps.
function buildIco(images) {
  const data = images.map((im) => (im.size === 256 ? Buffer.from(im.png, 'base64') : bmpEntry(im.size, im.rgba)));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);                              // reserved
  header.writeUInt16LE(1, 2);                              // type 1 = icon
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach((im, i) => {
    const o = i * 16;
    dir.writeUInt8(im.size === 256 ? 0 : im.size, o);      // width (0 means 256)
    dir.writeUInt8(im.size === 256 ? 0 : im.size, o + 1);  // height
    dir.writeUInt8(0, o + 2);                              // palette colors (none)
    dir.writeUInt8(0, o + 3);                              // reserved
    dir.writeUInt16LE(1, o + 4);                           // planes
    dir.writeUInt16LE(32, o + 6);                          // bits per pixel
    dir.writeUInt32LE(data[i].length, o + 8);              // bytes in this image
    dir.writeUInt32LE(offset, o + 12);                     // where it starts
    offset += data[i].length;
  });
  return Buffer.concat([header, dir, ...data]);
}

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false });
    await win.loadURL('about:blank');
    const svg = fs.readFileSync(SVG_PATH).toString('base64');
    const images = await win.webContents.executeJavaScript(`(${renderInPage.toString()})(${JSON.stringify(svg)}, ${JSON.stringify(SIZES)})`);
    fs.writeFileSync(ICO_PATH, buildIco(images));
    console.log(`wrote ${ICO_PATH} (${SIZES.join(', ')} px)`);
  } catch (err) {
    console.error('make-icon failed:', err);
    process.exitCode = 1;
  }
  app.quit();
});
