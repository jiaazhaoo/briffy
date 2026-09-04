// Generates assets/icon.png (256x256), assets/tray.png (32x32) and assets/trayTemplate.png
// without any native dependency: a tiny PNG encoder on top of Node's zlib.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- a tiny software rasterizer (anti-aliased circles / triangles) ---
function makeCanvas(size) {
  return { size, data: Buffer.alloc(size * size * 4) };
}
function blend(cv, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= cv.size || y >= cv.size || a <= 0) return;
  const i = (y * cv.size + x) * 4;
  const da = cv.data[i + 3] / 255;
  const oa = a + da * (1 - a);
  if (oa <= 0) return;
  cv.data[i] = Math.round((r * a + cv.data[i] * da * (1 - a)) / oa);
  cv.data[i + 1] = Math.round((g * a + cv.data[i + 1] * da * (1 - a)) / oa);
  cv.data[i + 2] = Math.round((b * a + cv.data[i + 2] * da * (1 - a)) / oa);
  cv.data[i + 3] = Math.round(oa * 255);
}
function fillShape(cv, inside, color) {
  const [r, g, b, alpha = 1] = color;
  const SS = 4; // supersampling
  for (let y = 0; y < cv.size; y++) {
    for (let x = 0; x < cv.size; x++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        if (inside(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) hit++;
      }
      if (hit) blend(cv, x, y, r, g, b, alpha * hit / (SS * SS));
    }
  }
}
const circle = (cx, cy, rad) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
const ellipse = (cx, cy, rx, ry) => (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
function triangle(ax, ay, bx, by, cx, cy) {
  const sign = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  return (x, y) => {
    const d1 = sign(x, y, ax, ay, bx, by), d2 = sign(x, y, bx, by, cx, cy), d3 = sign(x, y, cx, cy, ax, ay);
    const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  };
}

function drawCat(size, opts = {}) {
  const cv = makeCanvas(size);
  const s = size / 100; // work in a 100x100 design space
  const fur = opts.fur || [255, 176, 92];
  const dark = opts.dark || [61, 40, 23];
  const white = [255, 255, 255];
  const pink = [255, 120, 140];
  if (opts.background) fillShape(cv, circle(50 * s, 50 * s, 50 * s), opts.background);
  // ears
  fillShape(cv, triangle(18 * s, 48 * s, 26 * s, 14 * s, 48 * s, 36 * s), fur);
  fillShape(cv, triangle(82 * s, 48 * s, 74 * s, 14 * s, 52 * s, 36 * s), fur);
  fillShape(cv, triangle(24 * s, 44 * s, 28 * s, 24 * s, 42 * s, 38 * s), pink);
  fillShape(cv, triangle(76 * s, 44 * s, 72 * s, 24 * s, 58 * s, 38 * s), pink);
  // head
  fillShape(cv, ellipse(50 * s, 58 * s, 36 * s, 32 * s), fur);
  // cheeks
  fillShape(cv, ellipse(30 * s, 68 * s, 8 * s, 5 * s), [255, 150, 150, 0.6]);
  fillShape(cv, ellipse(70 * s, 68 * s, 8 * s, 5 * s), [255, 150, 150, 0.6]);
  // eyes
  if (opts.monochrome) {
    fillShape(cv, ellipse(37 * s, 56 * s, 5 * s, 6.5 * s), dark);
    fillShape(cv, ellipse(63 * s, 56 * s, 5 * s, 6.5 * s), dark);
  } else {
    fillShape(cv, ellipse(37 * s, 56 * s, 6 * s, 7.5 * s), white);
    fillShape(cv, ellipse(63 * s, 56 * s, 6 * s, 7.5 * s), white);
    fillShape(cv, ellipse(38 * s, 57 * s, 3.6 * s, 5 * s), dark);
    fillShape(cv, ellipse(64 * s, 57 * s, 3.6 * s, 5 * s), dark);
    fillShape(cv, circle(39.5 * s, 54.5 * s, 1.4 * s), white);
    fillShape(cv, circle(65.5 * s, 54.5 * s, 1.4 * s), white);
  }
  // nose + mouth
  fillShape(cv, triangle(46 * s, 66 * s, 54 * s, 66 * s, 50 * s, 71 * s), pink);
  fillShape(cv, ellipse(45 * s, 74 * s, 5 * s, 2.2 * s), [dark[0], dark[1], dark[2], 0.5]);
  fillShape(cv, ellipse(55 * s, 74 * s, 5 * s, 2.2 * s), [dark[0], dark[1], dark[2], 0.5]);
  return cv;
}

function drawMono(size) {
  // macOS template image: black shape with alpha only
  const cv = makeCanvas(size);
  const s = size / 100;
  const k = [0, 0, 0];
  fillShape(cv, triangle(16 * s, 50 * s, 24 * s, 10 * s, 48 * s, 34 * s), k);
  fillShape(cv, triangle(84 * s, 50 * s, 76 * s, 10 * s, 52 * s, 34 * s), k);
  fillShape(cv, ellipse(50 * s, 58 * s, 38 * s, 34 * s), k);
  // punch out eyes by drawing transparent? simpler: leave solid silhouette
  return cv;
}

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
const big = drawCat(256, { background: [255, 246, 230] });
fs.writeFileSync(path.join(out, 'icon.png'), encodePNG(big.size, big.size, big.data));
const tray = drawCat(32);
fs.writeFileSync(path.join(out, 'tray.png'), encodePNG(tray.size, tray.size, tray.data));
const tray2x = drawCat(64);
fs.writeFileSync(path.join(out, 'tray@2x.png'), encodePNG(tray2x.size, tray2x.size, tray2x.data));
const mono = drawMono(22), mono2 = drawMono(44);
fs.writeFileSync(path.join(out, 'trayTemplate.png'), encodePNG(mono.size, mono.size, mono.data));
fs.writeFileSync(path.join(out, 'trayTemplate@2x.png'), encodePNG(mono2.size, mono2.size, mono2.data));
console.log('icons written to', out);
