// Times each stage of a region capture, so the slow part is measured rather than guessed.
// Run with: DAILYLOGS_SMOKE=bench-region electron .   (see main.js smokeTest)
const { desktopCapturer, screen } = require('electron');

async function bench() {
  const rows = [];
  const mark = (label, ms, extra) => { rows.push({ label, ms, extra }); console.log(`  ${label.padEnd(34)} ${String(Math.round(ms)).padStart(6)} ms  ${extra || ''}`); };

  const displays = screen.getAllDisplays();
  const d = displays[0];
  const scale = d.scaleFactor || 1;
  const w = Math.round(d.bounds.width * scale);
  const h = Math.round(d.bounds.height * scale);
  console.log(`display ${d.bounds.width}x${d.bounds.height} @${scale}x  →  ${w}x${h} device px\n`);

  let t = Date.now();
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h } });
  mark('desktopCapturer.getSources', Date.now() - t, `${sources.length} sources`);

  const img = sources[0].thumbnail;

  t = Date.now();
  const png = img.toPNG();
  mark('toPNG (what we send today)', Date.now() - t, `${(png.length / 1048576).toFixed(1)} MB`);

  t = Date.now();
  const dataUrl = img.toDataURL();
  mark('toDataURL (what we send today)', Date.now() - t, `${(dataUrl.length / 1048576).toFixed(1)} MB string`);

  t = Date.now();
  const jpeg = img.toJPEG(85);
  mark('toJPEG(85)', Date.now() - t, `${(jpeg.length / 1048576).toFixed(2)} MB`);

  t = Date.now();
  const bitmap = img.toBitmap();
  mark('toBitmap (raw BGRA)', Date.now() - t, `${(bitmap.length / 1048576).toFixed(1)} MB`);

  t = Date.now();
  const crop = img.crop({ x: 100, y: 100, width: 800, height: 600 });
  const cropPng = crop.toPNG();
  mark('crop + toPNG (the saved file)', Date.now() - t, `${(cropPng.length / 1024).toFixed(0)} KB`);

  return rows;
}

module.exports = { bench };
