// Render the official DeepSeek logo (assets/logo.svg) into app/tray icons.
// Strategy: capture ONE 512px raster with Chromium (Electron), then downscale
// in pure Node (bilinear) and pack a multi-size ICO.
// Run with: electron scripts/render-logo.js
'use strict';

const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const BRAND_BLUE = '#4d6bfe';
const SIZES = [16, 32, 48, 64, 128, 256, 512];
const srcSvg = path.join(__dirname, '..', 'assets', 'logo.svg');
const outDir = path.join(__dirname, '..', 'assets');

// ---- PNG encoder ----
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function encodeIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const parts = [header];
  let offset = 6 + 16 * count;
  for (const [size, png] of entries) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0;
    e[3] = 0;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    parts.push(e);
    offset += png.length;
  }
  for (const [, png] of entries) parts.push(png);
  return Buffer.concat(parts);
}

// ---- bilinear downscale (straight RGBA) ----
function downscale(src, w, h, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  const sx = w / dw, sy = h / dh;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const gx = (x + 0.5) * sx - 0.5;
      const gy = (y + 0.5) * sy - 0.5;
      const x0 = Math.max(0, Math.floor(gx));
      const y0 = Math.max(0, Math.floor(gy));
      const x1 = Math.min(w - 1, x0 + 1);
      const y1 = Math.min(h - 1, y0 + 1);
      const fx = gx - x0, fy = gy - y0;
      const s00 = (y0 * w + x0) * 4, s10 = (y0 * w + x1) * 4;
      const s01 = (y1 * w + x0) * 4, s11 = (y1 * w + x1) * 4;
      const o = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const v = (src[s00 + c] * (1 - fx) + src[s10 + c] * fx) * (1 - fy) +
                  (src[s01 + c] * (1 - fx) + src[s11 + c] * fx) * fy;
        out[o + c] = Math.round(v);
      }
    }
  }
  return out;
}

// ---- prepare a blue logo SVG ----
function writeBlueSvg() {
  let svg = fs.readFileSync(srcSvg, 'utf8');
  svg = svg.replace(/<style>[\s\S]*?<\/style>/g, '');
  svg = svg.replace(/<path\b/, '<path fill="' + BRAND_BLUE + '"');
  svg = svg.replace(/\sfill="#000"\s*fill-opacity="[^"]*"/g, '');
  // fill the viewport (SVG-as-document renders at natural size otherwise)
  svg = svg.replace(/width="[\d.]+"\s+height="[\d.]+"/, 'width="100%" height="100%"');
  // ~8% breathing room around the mark
  svg = svg.replace(/viewBox="0 0 50 50"/, 'viewBox="-2 -2 54 54"');
  const file = path.join(outDir, 'logo-blue.svg');
  fs.writeFileSync(file, svg);
  return file;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function renderAll() {
  nativeTheme.themeSource = 'light';
  const blueSvg = writeBlueSvg();

  // one 512px capture
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
  });
  await win.loadFile(blueSvg);
  await sleep(500);
  const img = await win.webContents.capturePage();
  win.destroy();

  const { width: W, height: H } = img.getSize();
  const bmp = img.toBitmap(); // BGRA, premultiplied
  // -> straight RGBA
  const big = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const b = bmp[i * 4], g = bmp[i * 4 + 1], r = bmp[i * 4 + 2], a = bmp[i * 4 + 3];
    let rr = r, gg = g, bb = b;
    if (a > 0 && a < 255) {
      rr = Math.round((r * 255) / a);
      gg = Math.round((g * 255) / a);
      bb = Math.round((b * 255) / a);
    }
    big[i * 4] = Math.min(255, rr);
    big[i * 4 + 1] = Math.min(255, gg);
    big[i * 4 + 2] = Math.min(255, bb);
    big[i * 4 + 3] = a;
  }
  console.log('captured', W + 'x' + H);

  const pngs = new Map();
  for (const size of SIZES) {
    const rgba = size === W ? big : downscale(big, W, H, size, size);
    const png = encodePng(size, size, rgba);
    pngs.set(size, png);
    const file = size === 256 ? 'icon.png' : size === 512 ? 'preview.png' : `icon-${size}.png`;
    fs.writeFileSync(path.join(outDir, file), png);
    console.log('wrote', path.join(outDir, file), png.length, 'bytes');
  }

  const icoEntries = SIZES.filter((s) => s <= 256).map((s) => [s, pngs.get(s)]);
  fs.writeFileSync(path.join(outDir, 'icon.ico'), encodeIco(icoEntries));
  console.log('wrote', path.join(outDir, 'icon.ico'), icoEntries.length, 'entries');
}

app.whenReady().then(renderAll).then(() => app.exit(0)).catch((e) => { console.error(e); app.exit(1); });
