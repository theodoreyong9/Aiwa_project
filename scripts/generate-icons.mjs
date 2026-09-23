// scripts/generate-icons.mjs — builds real PNG files for the PWA manifest.
// No canvas library: hand-encodes valid PNGs (IHDR/IDAT/IEND, zlib via
// node:zlib, CRC32 table) and rasterizes a rounded-square gradient
// background (matching style.css's own --accent/--accent-2) with a
// single ring glyph — the same "wallet mark" motif as the header's own
// .brand .mark block. Deterministic, dependency-free, matching this
// project's own "no build step" philosophy.
// Run: node scripts/generate-icons.mjs

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const ACCENT = [0x7c, 0x5c, 0xff];   // --accent
const ACCENT_2 = [0x22, 0xc7, 0xb8]; // --accent-2
const RING = [0xff, 0xff, 0xff];

function lerp(a, b, t) { return a + (b - a) * t; }

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}
const CRC_TABLE = makeCrcTable();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function drawIcon(size) {
  const px = new Uint8ClampedArray(size * size * 4);
  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };

  const radius = size * 0.22;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside = true;
      if (x < radius && y < radius) inside = (x - radius) ** 2 + (y - radius) ** 2 <= radius ** 2;
      else if (x > size - radius && y < radius) inside = (x - (size - radius)) ** 2 + (y - radius) ** 2 <= radius ** 2;
      else if (x < radius && y > size - radius) inside = (x - radius) ** 2 + (y - (size - radius)) ** 2 <= radius ** 2;
      else if (x > size - radius && y > size - radius) inside = (x - (size - radius)) ** 2 + (y - (size - radius)) ** 2 <= radius ** 2;
      if (!inside) continue;
      // Diagonal gradient, accent -> accent-2, matching header .mark.
      const t = (x + y) / (2 * size);
      const color = [
        Math.round(lerp(ACCENT[0], ACCENT_2[0], t)),
        Math.round(lerp(ACCENT[1], ACCENT_2[1], t)),
        Math.round(lerp(ACCENT[2], ACCENT_2[2], t)),
      ];
      set(x, y, color);
    }
  }

  // A single ring — real content, not a placeholder: the same "one
  // identity, one address" idea the whole protocol is built around.
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.28;
  const thickness = size * 0.09;
  const innerR = outerR - thickness;
  for (let y = Math.floor(cy - outerR); y <= cy + outerR; y++) {
    for (let x = Math.floor(cx - outerR); x <= cx + outerR; x++) {
      const d2 = (x - cx) ** 2 + (y - cy) ** 2;
      if (d2 <= outerR * outerR && d2 >= innerR * innerR) set(x, y, RING);
    }
  }

  return px;
}

function encodePNG(size) {
  const pixels = drawIcon(size);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filter type 0 (none) per scanline
    for (let x = 0; x < size; x++) {
      const srcI = (y * size + x) * 4;
      const dstI = rowStart + 1 + x * 4;
      raw[dstI] = pixels[srcI];
      raw[dstI + 1] = pixels[srcI + 1];
      raw[dstI + 2] = pixels[srcI + 2];
      raw[dstI + 3] = pixels[srcI + 3];
    }
  }

  const idatData = deflateSync(raw);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('icons', { recursive: true });
for (const size of [192, 512]) {
  const buf = encodePNG(size);
  const path = `icons/icon-${size}.png`;
  writeFileSync(path, buf);
  console.log(`wrote ${path} (${buf.length} bytes)`);
}
