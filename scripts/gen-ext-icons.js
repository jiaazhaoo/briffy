// Renders the cat icon into the extension's icon sizes by rescaling assets/icon.png with Electron-free code.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function decodePNG(buf) {
  let pos = 8, width = 0, height = 0; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos); const type = buf.toString('ascii', pos + 4, pos + 8); const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); if (data[8] !== 8 || data[9] !== 6) throw new Error('only 8-bit RGBA supported'); }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4; const out = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[y * stride + x - 4] : 0, b = y > 0 ? out[(y - 1) * stride + x] : 0, c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0;
      let v = line[x];
      if (filter === 1) v += a; else if (filter === 2) v += b; else if (filter === 3) v += (a + b) >> 1; else if (filter === 4) v += paeth(a, b, c);
      out[y * stride + x] = v & 0xff;
    }
  }
  return { width, height, data: out };
}
function resize(img, size) {
  const out = Buffer.alloc(size * size * 4);
  const ratio = img.width / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const x0 = Math.floor(x * ratio), x1 = Math.min(img.width, Math.ceil((x + 1) * ratio));
    const y0 = Math.floor(y * ratio), y1 = Math.min(img.height, Math.ceil((y + 1) * ratio));
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) { const i = (sy * img.width + sx) * 4; const al = img.data[i + 3] / 255; r += img.data[i] * al; g += img.data[i + 1] * al; b += img.data[i + 2] * al; a += img.data[i + 3]; n++; }
    const o = (y * size + x) * 4; const av = a / n / 255;
    out[o] = av ? Math.round(r / n / av) : 0; out[o + 1] = av ? Math.round(g / n / av) : 0; out[o + 2] = av ? Math.round(b / n / av) : 0; out[o + 3] = Math.round(a / n);
  }
  return out;
}
const src = decodePNG(fs.readFileSync(path.join(__dirname, '..', 'assets', 'icon.png')));
const dir = path.join(__dirname, '..', 'extension', 'icons');
fs.mkdirSync(dir, { recursive: true });
for (const size of [16, 32, 48, 128]) fs.writeFileSync(path.join(dir, `${size}.png`), encodePNG(size, size, resize(src, size)));
console.log('extension icons written to', dir);
