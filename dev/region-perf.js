'use strict';
// How long does the selection overlay actually take to appear, and where does that time go?
//
//   npx electron dev/region-perf.js
//
// "Smooth" is not a feeling here, it is a number: anything past ~120 ms between pressing the key and
// seeing the frozen screen reads as a stutter, and past ~250 ms it reads as broken. This measures the
// three parts separately -- grabbing every display, encoding what the overlay is sent, and cropping
// the result -- so it is clear which one to attack.
const { app, desktopCapturer, screen } = require('electron');

const ms = (t0) => `${(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(1)} ms`;
const now = () => process.hrtime.bigint();

app.whenReady().then(async () => {
  const displays = screen.getAllDisplays();
  console.log(`${displays.length} display(s):`);
  for (const d of displays) {
    console.log(`  ${d.bounds.width}x${d.bounds.height} @${d.scaleFactor}x  → ${Math.round(d.bounds.width * d.scaleFactor)}x${Math.round(d.bounds.height * d.scaleFactor)} real pixels`);
  }

  const box = displays.reduce((a, d) => ({
    width: Math.max(a.width, Math.round(d.bounds.width * (d.scaleFactor || 1))),
    height: Math.max(a.height, Math.round(d.bounds.height * (d.scaleFactor || 1))),
  }), { width: 1, height: 1 });

  // Cold first, then warm: the first call pays for the capture stream being set up.
  for (const round of ['cold', 'warm', 'warm', 'warm']) {
    const t0 = now();
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: box });
    const grabbed = ms(t0);

    const first = sources[0].thumbnail;
    const t1 = now();
    const jpeg = first.toJPEG(88);
    const encoded = ms(t1);

    const t2 = now();
    first.crop({ x: 100, y: 100, width: 800, height: 600 }).toPNG();
    const cropped = ms(t2);

    console.log(`  ${round.padEnd(5)} grab ${grabbed.padStart(8)}   jpeg ${encoded.padStart(8)} (${(jpeg.length / 1024).toFixed(0)} KB)   crop+png ${cropped.padStart(8)}   total to overlay ≈ ${(Number(now() - t0) / 1e6 - Number(now() - t2) / 1e6).toFixed(1)} ms`);
  }

  // What a scrolling capture would cost per frame: one display, one region, repeatedly.
  console.log('\nrepeated capture of one screen, as a scrolling capture would do:');
  const one = { width: Math.round(displays[0].bounds.width * displays[0].scaleFactor), height: Math.round(displays[0].bounds.height * displays[0].scaleFactor) };
  const times = [];
  for (let i = 0; i < 8; i++) {
    const t = now();
    const s = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: one });
    s[0].thumbnail.crop({ x: 0, y: 0, width: Math.min(1200, one.width), height: Math.min(900, one.height) });
    times.push(Number(now() - t) / 1e6);
  }
  const sorted = [...times].sort((a, b) => a - b);
  console.log(`  ${times.length} frames: median ${sorted[4].toFixed(1)} ms, best ${sorted[0].toFixed(1)} ms, worst ${sorted[sorted.length - 1].toFixed(1)} ms`);
  console.log(`  → about ${(1000 / sorted[4]).toFixed(1)} frames a second, which is the ceiling for stitching while the user scrolls`);

  process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });
