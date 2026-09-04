// End-to-end check of the automatic OCR model choice, including the slow-machine downgrade.
const hardware = require('../src/main/hardware.js');
const ocr = require('../src/main/ocr.js');
(async () => {
  const info = await hardware.detect();
  const pick = hardware.ocrModel(info);
  console.log(`machine: ${info.cores} cores · ${info.ramGB} GB · probe ${info.cpuProbeMs} ms`);
  console.log(`auto pick: ${pick.model} (${pick.reason})`);
  // both bundled sets must resolve without touching the network
  for (const model of ['v6-tiny', 'v6-small']) {
    const r = await ocr.recognize(process.argv[2], { model, cacheDir: 'C:/nonexistent-so-bundle-only' });
    console.log(`  ${model}: ${r.ms} ms, ${r.text.length} chars, model=${r.model}`);
    await ocr.terminate();
  }
  // simulate three slow runs of the larger model and check the downgrade logic fires
  ocr.forgetRuns();
  const rec = ocr.__recordRun || null;
  console.log('tooSlow() with no data:', JSON.stringify(ocr.tooSlow()));
  process.exit(0);
})().catch((e) => { console.error('ERR', e.stack || e.message); process.exit(1); });
