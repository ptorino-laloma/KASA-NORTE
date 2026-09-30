// Genera los íconos PNG de la PWA (public/icons/) sin dependencias:
// dibuja el tomate del logo de Kasa Norte (contorno a mano + hojitas) en crema
// sobre el bordó de la marca, y codifica el PNG a mano.
//   node scripts/iconos.js
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const BORDO = [0x6B, 0x05, 0x12];
const CREMA = [0xF0, 0xDD, 0xD3];

// Distancia de un punto al segmento (ax,ay)-(bx,by).
function distSeg(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}
// Color de un punto (coordenadas 0..1). El dibujo queda dentro del 70% central
// para que sirva también como ícono "maskable" (Android lo recorta en círculo).
const CX = 0.5, CY = 0.54, R = 0.27, TRAZO = 0.028;
const HOJAS = [[0.55, 0.30, 0.44, 0.22], [0.55, 0.30, 0.66, 0.21], [0.55, 0.30, 0.69, 0.33],
  [0.55, 0.30, 0.45, 0.36], [0.55, 0.30, 0.56, 0.40], [0.55, 0.30, 0.575, 0.19]];
function colorAt(x, y) {
  const a = Math.atan2(y - CY, x - CX);
  const r = R * (1 + 0.03 * Math.sin(3 * a + 0.4) + 0.018 * Math.sin(7 * a + 1.1));
  const d = Math.hypot((x - CX) / 1.02, y - CY);
  if (Math.abs(d - r) < TRAZO / 2) return CREMA;
  if (HOJAS.some(([ax, ay, bx, by]) => distSeg(x, y, ax, ay, bx, by) < TRAZO / 2)) return CREMA;
  return BORDO;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size) {
  const SS = 4; // supersampling para bordes suaves
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0; // filtro "none"
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const c = colorAt((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
      }
      const o = py * (size * 3 + 1) + 1 + px * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(acc[i] / (SS * SS));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

const out = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180], ['favicon-32.png', 32]]) {
  fs.writeFileSync(path.join(out, name), png(size));
  console.log('ok', name);
}
