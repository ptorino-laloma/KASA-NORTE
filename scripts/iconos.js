// Genera los íconos PNG de la PWA (public/icons/) sin dependencias:
// dibuja una empanada (media luna con repulgue) sobre el fondo de la app y codifica el PNG a mano.
//   node scripts/iconos.js
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const BRAND = [0x5E, 0x26, 0x16];
const DOUGH = [0xE2, 0xB0, 0x5E];
const EDGE = [0xC9, 0x8A, 0x2B];

// Color de un punto (coordenadas 0..1). El dibujo queda dentro del 80% central
// para que sirva también como ícono "maskable" (Android lo recorta en círculo).
// Empanada: medio disco con la parte plana abajo y un borde repulgado arriba.
function colorAt(x, y) {
  const cx = 0.5, cy = 0.64, R = 0.30;
  const dx = x - cx, dy = y - cy;
  const r = Math.sqrt(dx * dx + dy * dy);
  if (dy > 0.02 || r > R) return BRAND;
  const ang = Math.atan2(-dy, dx);            // 0..π sobre la media luna
  const onda = 0.025 * Math.abs(Math.sin(ang * 9));
  if (r > R - 0.05 - onda) return EDGE;         // repulgue
  return DOUGH;
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
