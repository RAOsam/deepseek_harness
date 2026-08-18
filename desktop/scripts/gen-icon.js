// Generate app/tray PNG + ICO icons with pure Node (no dependencies).
// Design: DeepSeek-style blue whale drawn from a real bezier silhouette
// (head, back, tail flukes, belly), gradient body, eye, water spout,
// inside a dark rounded-square badge. Includes an ASCII self-check print.
'use strict';

const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

// ============================ tiny PNG encoder ============================
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

// ============================ bezier path ============================
function quad(p0, p1, p2, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push([
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    ]);
  }
  return pts;
}

function buildPath(cmds, n = 40) {
  const pts = [];
  let cur = null;
  for (const c of cmds) {
    const op = c[0];
    if (op === 'M') { cur = [c[1], c[2]]; pts.push(cur); }
    else if (op === 'L') { pts.push([c[1], c[2]]); cur = [c[1], c[2]]; }
    else if (op === 'Q') {
      const p0 = cur, p1 = [c[1], c[2]], p2 = [c[3], c[4]];
      const seg = quad(p0, p1, p2, n);
      seg.shift();
      pts.push(...seg);
      cur = p2;
    }
  }
  return pts;
}

// ============================ geometry helpers ============================
function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function covCircle(x, y, cx, cy, r, aa) {
  const d = Math.hypot(x - cx, y - cy) / r;
  return smoothstep(1 + aa / r, 1 - aa / r, d);
}

function rrDist(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function pointInPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const lerp = (a, b, t) => a + (b - a) * t;

// ============================ whale silhouette ============================
// Whale drawn in its own 0..1 box (y down), facing left.
const WHALE = buildPath([
  ['M', 0.08, 0.50],                    // snout tip
  ['Q', 0.12, 0.32, 0.30, 0.29],        // head dome
  ['Q', 0.48, 0.26, 0.64, 0.33],        // back
  ['Q', 0.72, 0.37, 0.78, 0.47],        // taper to tail peduncle (top)
  ['Q', 0.86, 0.40, 0.94, 0.36],        // top fluke tip
  ['Q', 0.88, 0.48, 0.82, 0.50],        // back to the notch
  ['Q', 0.88, 0.56, 0.94, 0.62],        // bottom fluke tip
  ['Q', 0.84, 0.56, 0.78, 0.53],        // peduncle (bottom)
  ['Q', 0.70, 0.66, 0.56, 0.70],        // belly
  ['Q', 0.40, 0.73, 0.28, 0.69],        // chin
  ['Q', 0.16, 0.64, 0.08, 0.50],        // jaw back to snout
]);

// whale box -> canvas transform (whale box center ~ (0.51, 0.495))
const SCL = 0.9;
const CTX_X = 0.5, CTX_Y = 0.56;
function wx(x) { return (x - 0.51) * SCL + CTX_X; }
function wy(y) { return (y - 0.495) * SCL + CTX_Y; }

const WHALE_PTS = WHALE.map(([x, y]) => [wx(x), wy(y)]); // normalized canvas coords

const EYE = { cx: wx(0.20), cy: wy(0.40), r: 0.021 };
const SPOUT = [
  { cx: wx(0.12), cy: wy(0.14), r: 0.036 },
  { cx: wx(0.24), cy: wy(0.08), r: 0.029 },
  { cx: wx(0.33), cy: wy(0.15), r: 0.024 },
];

// palette
const BG = [14, 19, 32];
const BLUE_TOP = [124, 155, 255];
const BLUE_BOT = [59, 91, 219];
const EYE_C = [8, 12, 24];
const SPOUT_C = [159, 216, 255];

// ============================ drawing ============================
function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const aa = Math.max(1.2, size / 96);
  const S = size;
  const sub = size <= 32 ? 5 : 3;
  const offsets = [];
  for (let i = 0; i < sub; i++) offsets.push((i + 0.5) / sub);

  const poly = WHALE_PTS.map(([x, y]) => [x * S, y * S]);
  const eye = { cx: EYE.cx * S, cy: EYE.cy * S, r: EYE.r * S };
  const spout = SPOUT.map((s) => ({ cx: s.cx * S, cy: s.cy * S, r: s.r * S }));
  const topY = Math.min(...poly.map((p) => p[1]));
  const botY = Math.max(...poly.map((p) => p[1]));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px0 = x + 0.5, py0 = y + 0.5;
      const badge = smoothstep(aa, -aa, rrDist(px0, py0, 0.5 * S, 0.5 * S, 0.47 * S, 0.47 * S, 0.235 * S));

      let hit = 0;
      for (const oy of offsets) {
        for (const ox of offsets) {
          if (pointInPoly(x + ox, y + oy, poly)) hit++;
        }
      }
      const whale = hit / (sub * sub);

      const g = Math.min(1, Math.max(0, (py0 - topY) / (botY - topY)));
      let r = lerp(BLUE_TOP[0], BLUE_BOT[0], g);
      let gg = lerp(BLUE_TOP[1], BLUE_BOT[1], g);
      let b = lerp(BLUE_TOP[2], BLUE_BOT[2], g);

      const cEye = covCircle(px0, py0, eye.cx, eye.cy, eye.r, aa);
      r = lerp(r, EYE_C[0], cEye);
      gg = lerp(gg, EYE_C[1], cEye);
      b = lerp(b, EYE_C[2], cEye);

      let cSpout = 0;
      for (const s of spout) cSpout = Math.max(cSpout, covCircle(px0, py0, s.cx, s.cy, s.r, aa));
      r = lerp(r, SPOUT_C[0], cSpout);
      gg = lerp(gg, SPOUT_C[1], cSpout);
      b = lerp(b, SPOUT_C[2], cSpout);

      const fr = lerp(BG[0], r, whale);
      const fg = lerp(BG[1], gg, whale);
      const fb = lerp(BG[2], b, whale);

      const i = (y * size + x) * 4;
      px[i] = Math.round(fr);
      px[i + 1] = Math.round(fg);
      px[i + 2] = Math.round(fb);
      px[i + 3] = Math.round(255 * badge);
    }
  }
  return px;
}

// ASCII preview of the WHALE coverage (not alpha) to eyeball the silhouette.
function asciiPreview(size, cols) {
  const sub = 3;
  const offsets = [];
  for (let i = 0; i < sub; i++) offsets.push((i + 0.5) / sub);
  const poly = WHALE_PTS.map(([x, y]) => [x * size, y * size]);
  const rows = Math.round(cols / 2);
  const cellW = size / cols, cellH = size / rows;
  const ramp = ' .:-=+*#%@';
  let out = '';
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      let hit = 0;
      for (let sy = 0; sy < sub; sy++) {
        for (let sx = 0; sx < sub; sx++) {
          const x = (c + offsets[sx]) * cellW;
          const y = (r + offsets[sy]) * cellH;
          if (pointInPoly(x, y, poly)) hit++;
        }
      }
      const v = hit / (sub * sub);
      line += ramp[Math.min(ramp.length - 1, Math.floor(v * (ramp.length - 1) + 0.5))];
    }
    out += line + '\n';
  }
  return out;
}

// ============================ output ============================
const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });

// collect PNG buffers for the ICO
const pngs = new Map();
for (const size of [16, 32, 48, 64, 128, 256]) {
  const file = path.join(outDir, size === 256 ? 'icon.png' : `icon-${size}.png`);
  const png = encodePng(size, size, draw(size));
  pngs.set(size, png);
  fs.writeFileSync(file, png);
  console.log('wrote', file);
}

fs.writeFileSync(path.join(outDir, 'preview.png'), encodePng(512, 512, draw(512)));
console.log('wrote', path.join(outDir, 'preview.png'));

// Multi-size ICO (PNG-compressed entries, Vista+ supported).
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
const icoFile = path.join(outDir, 'icon.ico');
fs.writeFileSync(icoFile, encodeIco([16, 32, 48, 64, 128, 256].map((s) => [s, pngs.get(s)])));
console.log('wrote', icoFile, '(' + fs.statSync(icoFile).size + ' bytes)');

console.log('\n=== ASCII preview (whale silhouette check) ===');
console.log(asciiPreview(256, 64));
console.log('icon generation done');
