const ocr = require('../src/main/ocr.js');
(async () => {
  const img = process.argv[2];
  const dir = process.argv[3];
  for (const model of ['v6-tiny', 'v6-small', 'v5-mobile']) {
    const t0 = Date.now();
    const r = await ocr.recognize(img, { model, cacheDir: dir });
    await ocr.terminate();
    const lines = r.text.split('\n').filter((l) => /[一-鿿]/.test(l));
    console.log(`\n=== ${model} · ${Date.now() - t0} ms · ${r.text.length} chars ===`);
    console.log(lines.slice(0, 4).map((l) => '  ' + l.slice(0, 76)).join('\n'));
  }
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
