// Measures what each OCR model actually costs: peak RSS, CPU time and wall time per screenshot.
// Usage: node dev/ocr-bench.js <image> <cacheDir> [model...]
const ocr = require('../src/main/ocr.js');

const image = process.argv[2];
const cacheDir = process.argv[3];
const models = process.argv.slice(4).length ? process.argv.slice(4) : ['v6-tiny', 'v6-small', 'v6-medium'];

function sampler() {
  let peak = 0;
  const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage.rss()); }, 50);
  return { stop() { clearInterval(timer); return peak; } };
}
const mb = (n) => (n / 1048576).toFixed(0);

(async () => {
  const baseline = process.memoryUsage.rss();
  console.log(`baseline RSS ${mb(baseline)} MB · ${require('os').cpus().length} logical cores\n`);
  console.log('model        load    1st run   2nd run   peak RSS   CPU time   text');
  for (const model of models) {
    const s = sampler();
    const cpu0 = process.cpuUsage();
    const t0 = Date.now();
    let first = 0;
    const r1 = await ocr.recognize(image, { model, cacheDir });
    first = Date.now() - t0;
    const t1 = Date.now();
    const r2 = await ocr.recognize(image, { model, cacheDir });
    const second = Date.now() - t1;
    const cpu = process.cpuUsage(cpu0);
    const peak = s.stop();
    console.log(`${model.padEnd(12)} ${'-'.padStart(5)}  ${String(first + ' ms').padStart(8)}  ${String(second + ' ms').padStart(8)}  ${(mb(peak) + ' MB').padStart(8)}  ${(((cpu.user + cpu.system) / 1000).toFixed(0) + ' ms').padStart(9)}   ${r2.text.length} chars`);
    await ocr.terminate();
    await new Promise((r) => setTimeout(r, 1500));   // let the allocator settle between models
  }
  process.exit(0);
})().catch((e) => { console.error('ERR', e.stack || e.message); process.exit(1); });
