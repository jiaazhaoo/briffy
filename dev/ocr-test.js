const ocr = require('../src/main/ocr.js');
const dir = process.argv[3] || 'C:/Users/User/AppData/Local/Temp/claude/C--local-project-dailylogs/d7a57167-5430-4877-91d0-45d59f75682c/scratchpad/ocr-models';
(async () => {
  let last = '';
  const t0 = Date.now();
  const r = await ocr.recognize(process.argv[2], { engine: 'paddle', languages: ['zh-Hans', 'en'], modelsDir: dir },
    (p) => { const s = `${p.stage} ${p.file || ''} ${p.percent}%`; if (s !== last) { last = s; process.stdout.write(`  ${s}\n`); } });
  console.log('engine:', r.engine, '| took', Date.now() - t0, 'ms | chars', r.text.length);
  console.log('--- TEXT ---');
  console.log(r.text.slice(0, 700));
  await ocr.terminate();
  process.exit(0);
})().catch((e) => { console.error('OCR_ERROR', e.stack || e); process.exit(1); });
