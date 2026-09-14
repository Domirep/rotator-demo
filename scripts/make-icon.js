#!/usr/bin/env node
/**
 * Draw the token icon in the game's own style.
 *
 *   node scripts/make-icon.js
 *
 * The hero art is a photoreal space scene, which is the wrong thing for a
 * field rendered at 32-64px: it collapses into a smudge. This draws the icon
 * out of the same pixel rocket the race page draws, on a stylised galaxy, so
 * the icon looks like the game rather than like stock space art -- and pixel
 * art is built to survive being shrunk.
 *
 * The sprite is READ FROM index.html, not copied, so the icon cannot drift
 * from the rockets on the site.
 *
 * Writes a PNG. Pixel art wants PNG: JPEG would smear every hard edge.
 */

import fs from 'node:fs';
import zlib from 'node:zlib';

const GRID = 128;          // logical pixels
const SCALE = 4;           // 128 * 4 = 512
const SIZE = GRID * SCALE;

/* ---- the sprite, straight out of the page ---- */
const html = fs.readFileSync('index.html', 'utf8');
const block = html.slice(html.indexOf('const RK=['));
const RK = block.slice(0, block.indexOf('];'))
  .split('\n').slice(1)
  .map((l) => (l.match(/"([^"]*)"/) || [])[1])
  .filter(Boolean);
const RW = RK[0].length;
const RH = RK.length;

/* ---- colour ---- */
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t));
const lite = (c, t) => mix(c, '#FFFFFF', t);
const dark = (c, t) => mix(c, '#000000', t);
const palette = (c) => ({
  k: hex('#080C12'), H: lite(c, 0.42), h: hex(c), d: dark(c, 0.34),
  f: mix(c, '#3B4859', 0.78), e: mix(c, '#66748C', 0.72),
  w: hex('#0D1826'), W: hex('#A9DCFF'),
});

const buf = new Uint8Array(GRID * GRID * 3);
const put = (x, y, rgb) => {
  if (x < 0 || y < 0 || x >= GRID || y >= GRID) return;
  const i = (y * GRID + x) * 3;
  buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2];
};

/* deterministic noise so the icon is identical on every run */
let seed = 20710;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

/* ---- a stylised galaxy: banded spiral, not a photograph ---- */
const CORE = '#FFE9B8', ARM1 = '#8A6BD6', ARM2 = '#4B3A8F', VOID = '#0A0A1E';
const cx = GRID * 0.5, cy = GRID * 0.36;
for (let y = 0; y < GRID; y++) {
  for (let x = 0; x < GRID; x++) {
    const dx = x - cx, dy = (y - cy) * 1.35;
    const r = Math.sqrt(dx * dx + dy * dy);
    const a = Math.atan2(dy, dx);
    /* two arms, quantised into bands so it reads as illustration */
    const swirl = Math.sin(a * 2 - r * 0.22) * 0.5 + 0.5;
    let t = swirl * Math.max(0, 1 - r / 62);
    t = Math.round(t * 4) / 4;
    let col;
    if (r < 7) col = hex(CORE);
    else if (r < 12) col = mix(CORE, ARM1, (r - 7) / 5);
    else if (t > 0.7) col = mix(ARM1, CORE, 0.25);
    else if (t > 0.45) col = hex(ARM1);
    else if (t > 0.2) col = hex(ARM2);
    else col = hex(VOID);
    put(x, y, col);
  }
}
/* stars, denser away from the core */
for (let i = 0; i < 340; i++) {
  const x = Math.floor(rnd() * GRID), y = Math.floor(rnd() * GRID);
  const r = Math.hypot(x - cx, (y - cy) * 1.35);
  if (r < 16 || rnd() > Math.min(1, r / 55)) continue;
  const b = rnd();
  put(x, y, b > 0.85 ? [255, 255, 255] : b > 0.5 ? [198, 214, 255] : [130, 150, 210]);
}

/* ---- five rockets, the site's own palette ---- */
const HUES = ['#FF7A3D', '#6FD08C', '#7FB4E8', '#E8B54A', '#C98CE0'];
const rockets = [
  { x: 4,  y: 74, c: HUES[1] },
  { x: 26, y: 62, c: HUES[2] },
  { x: 52, y: 44, c: HUES[0] },   // the lead rocket, centred and highest
  { x: 78, y: 60, c: HUES[3] },
  { x: 100, y: 72, c: HUES[4] },
];

for (const rk of rockets) {
  const pal = palette(rk.c);
  /* flame first so the hull draws over it */
  const fx = rk.x + Math.floor(RW / 2);
  for (let i = 0; i < 40; i++) {
    const y = rk.y + RH + i;
    if (y >= GRID) break;
    const w = Math.max(0, 3 - Math.floor(i / 7));
    const heat = 1 - i / 40;
    for (let dx = -w; dx <= w; dx++) {
      if (rnd() > 0.30 + heat * 0.66) continue;
      const edge = Math.abs(dx) / (w + 0.5);
      const col = heat > 0.7 && edge < 0.5 ? [255, 246, 214]
        : heat > 0.4 ? mix('#FFC24A', '#FF6A1F', edge)
          : mix('#FF6A1F', '#5A2410', 1 - heat);
      put(fx + dx, y, col);
      put(fx + dx - 1, y, col);
    }
  }
  for (let ry = 0; ry < RH; ry++) {
    for (let rx = 0; rx < RW; rx++) {
      const ch = RK[ry][rx];
      if (ch === '.') continue;
      const col = pal[ch];
      if (col) put(rk.x + rx, rk.y + ry, col);
    }
  }
}

/* ---- upscale and write a PNG ---- */
const raw = Buffer.alloc(SIZE * (SIZE * 3 + 1));
let p = 0;
for (let y = 0; y < SIZE; y++) {
  raw[p++] = 0;                                   // filter: none
  for (let x = 0; x < SIZE; x++) {
    const i = (Math.floor(y / SCALE) * GRID + Math.floor(x / SCALE)) * 3;
    raw[p++] = buf[i]; raw[p++] = buf[i + 1]; raw[p++] = buf[i + 2];
  }
}

const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
const crc = (b) => {
  let c = 0xFFFFFFFF;
  for (const byte of b) c = crcTable[(c ^ byte) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

fs.writeFileSync('galaxy-icon.png', png);
console.log(`sprite read from index.html: ${RW}x${RH}`);
console.log(`wrote galaxy-icon.png  ${SIZE}x${SIZE}  ${(png.length / 1024).toFixed(0)} KB  ${rockets.length} rockets`);
