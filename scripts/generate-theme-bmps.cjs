// Одноразовая генерация статических обоев 320x180 (24-bit Top-Down BMP) в assets/themes/.
// Запуск: node scripts/generate-theme-bmps.cjs
// [PERF-01] Main Process больше не считает пиксели — он просто копирует готовые файлы.
const fs = require('fs');
const path = require('path');

function createGradientBmpBuffer(r1, g1, b1, r2, g2, b2) {
  const width = 320;
  const height = 180;
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelArraySize = rowSize * height;
  const fileSize = 54 + pixelArraySize;
  const buf = Buffer.alloc(fileSize);
  buf.write('BM', 0, 2, 'ascii');
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(-height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(pixelArraySize, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) {
    const tY = y / (height - 1);
    for (let x = 0; x < width; x++) {
      const t = (x / (width - 1) + tY) / 2;
      const o = 54 + y * rowSize + x * 3;
      buf[o] = Math.round(b1 + (b2 - b1) * t);
      buf[o + 1] = Math.round(g1 + (g2 - g1) * t);
      buf[o + 2] = Math.round(r1 + (r2 - r1) * t);
    }
  }
  return buf;
}

const themes = {
  win11: [10, 35, 90, 0, 120, 212],
  win10: [5, 45, 110, 0, 162, 237],
  doom: [25, 5, 5, 190, 35, 15],
  witcher: [18, 22, 28, 85, 100, 120],
  stalker: [25, 20, 10, 180, 115, 15],
};

const outDir = path.join(__dirname, '..', 'assets', 'themes');
fs.mkdirSync(outDir, { recursive: true });
for (const [name, c] of Object.entries(themes)) {
  fs.writeFileSync(path.join(outDir, `${name}.bmp`), createGradientBmpBuffer(...c));
}
console.log('Generated', Object.keys(themes).length, 'BMP files in', outDir);
