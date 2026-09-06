'use strict';
// Renders every icon the app ships from one vector file: assets/brand/briffy.svg.
//
//   node scripts/gen-brand.js
//
// The mark was traced from the artwork by measuring it rather than by eye. Scanning the original for
// runs of brand-blue pixels gives each stroke's width and each arc's radius directly: a horizontal
// line across an arch cuts it in two places while it is below the arc's centre and in one place
// above, and where that switch happens fixes the centre. Those numbers are the ones in the SVG.
//
// Outputs
//   assets/icon.png            512  the mark on its own square: window icons on Windows / Linux
//   assets/icon-mac.png       1024  the same mark on Apple's icon grid, for the Dock and the .app
//   assets/pet/avatar.png      240  the pet's face, inset so the round frame does not clip the head
//   assets/tray.png / @2x      32   the menu-bar icon on Windows and Linux
//   assets/trayTemplate.png    22   macOS wants a black-and-transparent template it can tint itself
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
// The legs running off the bottom are what the mark is; narrowing them until they clear the corner
// curves keeps that, and reads better at Dock size than a floating glyph. MAC_FIT=inset to compare.
// The same framing as the desktop character, which is what the user chose after seeing all three.
// MAC_FIT=bleed or =inset to compare.
const MAC_FIT = ['bleed', 'inset'].includes(process.env.MAC_FIT) ? process.env.MAC_FIT : 'cover';
const SRC = path.join(ROOT, 'assets', 'brand', 'briffy.svg');
const svg = fs.readFileSync(SRC);

// The tray template: the same silhouette in black on transparent, which macOS recolours for the
// menu bar. Only the shape survives, so the face is dropped -- at 22px it would be three smudges.
const TEMPLATE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 638 638">
  <g fill="none" stroke="#000000" stroke-linecap="round">
    <path d="M156.5 620 V283.75 A161.75 161.75 0 0 1 480 283.75 V620" stroke-width="62"/>
    <path d="M245.5 620 V493.5 A73 73 0 0 1 391.5 493.5 V620" stroke-width="58"/>
  </g>
</svg>`;

// ---------- the macOS icon grid ----------
//
// A Dock icon is not "the picture, square". Apple gives every app the same body so a row of them reads
// as a row: on a 1024 canvas the rounded square is 824 across, inset 100 on every side, with a corner
// radius of 185.4 and a soft shadow under it. Ignore that and the icon sits proud of its neighbours,
// which is exactly what a full-bleed PNG looked like in the Dock.
//
// The mark does not simply drop into that shape. Its legs run off the bottom of its own square by
// design, and the rounded corner cuts across where they land: the flat part of the bottom edge only
// spans x 285.4 to 738.6, while the legs at full bleed would sit at 271.8 and 787 -- clipped, mid-leg.
// So the mark is placed rather than stretched, and there are two honest ways to place it.
const G = { canvas: 1024, inset: 100, body: 824, radius: 185.4 };

// The mark without its white ground, so it can be laid on the rounded square instead.
const MARK = `<g fill="none" stroke="#2A6CF0" stroke-linecap="round">
      <path d="M156.5 638 V283.75 A161.75 161.75 0 0 1 480 283.75 V638" stroke-width="46"/>
      <path d="M245.5 638 V493.5 A73 73 0 0 1 391.5 493.5 V638" stroke-width="45"/>
      <path d="M291.5 320 A27.6 27.6 0 0 0 345.5 320" stroke-width="20"/>
    </g>
    <g fill="#2A6CF0">
      <circle cx="238" cy="281" r="27"/>
      <circle cx="399" cy="281" r="27"/>
    </g>`;

/**
 * @param {{fit:'cover'|'bleed'|'inset', zoom?:number, ground?:string, ink?:string}} opts
 *   'cover'  the mark filling the whole body and running off it, the way the desktop character is
 *            framed (a 50x50 window with the picture drawn at 110% and cropped). The user picked this
 *            one by looking: "logo 就用常驻头像这个图片吧". Checked at the bottom corners -- the outer
 *            legs still land on the flat part of the edge, so nothing is cut on the diagonal.
 *   'bleed'  the same idea, narrowed until the legs are comfortably inside the corners.
 *   'inset'  the mark floating with even margins, the way most glyph icons sit. The legs then end in
 *            mid-air, which is the thing given up.
 */
function macIcon({ fit = 'cover', zoom = 1.1, ground = '#FFFFFF', ink = '#2A6CF0' } = {}) {
  const { canvas, inset, body, radius } = G;
  const bottom = inset + body;
  let w; let x; let y;
  if (fit === 'cover') {
    // Bottom-aligned and oversized, so the head is cropped at the top exactly as the desktop
    // character's own frame crops it. That framing is what makes the mark read as a face rather than
    // a small drawing sitting in a box.
    w = Math.round(body * zoom);
    x = (canvas - w) / 2;
    y = inset + body - w + Math.round(body * (zoom - 1) * 0.5);
  } else if (fit === 'bleed') {
    // widest the mark can be while both legs stay on the flat part of the bottom edge, less a margin
    const flat = body - 2 * radius;                 // 453.2
    const legSpan = (503 - 133) / 638;              // the mark's own legs, as a share of its width
    w = Math.floor((flat * 0.94) / legSpan);
    x = (canvas - w) / 2;
    y = bottom - w;
  } else {
    w = Math.round(body * 0.60);
    x = (canvas - w) / 2;
    // optically centred, not geometrically: the mark is heavy at the foot, so it is nudged up a little
    y = inset + (body - w) / 2 - Math.round(w * 0.03);
  }
  const mark = ink === '#2A6CF0' ? MARK : MARK.split('#2A6CF0').join(ink);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas} ${canvas}" width="${canvas}" height="${canvas}">
  <defs>
    <filter id="s" x="-25%" y="-25%" width="150%" height="150%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="9"/>
      <feOffset dy="10" result="b"/>
      <feComponentTransfer in="b" result="c"><feFuncA type="linear" slope="0.30"/></feComponentTransfer>
      <feMerge><feMergeNode in="c"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <clipPath id="body">
      <rect x="${inset}" y="${inset}" width="${body}" height="${body}" rx="${radius}" ry="${radius}"/>
    </clipPath>
  </defs>
  <g filter="url(#s)">
    <rect x="${inset}" y="${inset}" width="${body}" height="${body}" rx="${radius}" ry="${radius}" fill="${ground}"/>
  </g>
  <g clip-path="url(#body)">
    <g transform="translate(${x} ${y}) scale(${(w / 638).toFixed(6)})">
      ${mark}
    </g>
  </g>
</svg>`;
}

async function main() {
  const out = [];
  const write = async (file, buf) => { fs.writeFileSync(path.join(ROOT, file), buf); out.push(`${file} ${(buf.length / 1024).toFixed(1)} KB`); };

  await write('assets/icon.png', await sharp(svg).resize(512, 512).png().toBuffer());
  // macOS only: the Dock, Cmd+Tab and the .app bundle all show this one.
  await write('assets/icon-mac.png', await sharp(Buffer.from(macIcon({ fit: MAC_FIT }))).resize(1024, 1024).png().toBuffer());
  // The mark reaches the bottom edge of its square by design, and the pet's frame is a circle: the
  // legs run into that edge and stop there, which reads as drawn. Insetting it instead left them
  // hanging in the middle of the circle as two rounded stubs.
  await write('assets/pet/avatar.png', await sharp(svg).resize(240, 240).png().toBuffer());
  for (const [file, size] of [['assets/tray.png', 32], ['assets/tray@2x.png', 64]]) {
    await write(file, await sharp(Buffer.from(TEMPLATE)).resize(size, size).png().toBuffer());
  }
  for (const [file, size] of [['assets/trayTemplate.png', 22], ['assets/trayTemplate@2x.png', 44]]) {
    await write(file, await sharp(Buffer.from(TEMPLATE)).resize(size, size).png().toBuffer());
  }
  console.log(out.join('\n'));
}
if (require.main === module) main().catch((e) => { console.error('[brand]', e.message); process.exit(1); });
module.exports = { macIcon, G, MARK };
