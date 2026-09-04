// Compares OCR resource cost under different runtime settings, to pick defaults that behave on a laptop.
// Usage: node dev/ocr-tune.js <image> <cacheDir> [model]
const fs = require('fs');
const os = require('os');

const image = process.argv[2];
const cacheDir = process.argv[3];
const modelKey = process.argv[4] || 'v6-tiny';

const CONFIGS = [
  { label: 'default (all cores)', session: {}, detection: {} },
  { label: '4 threads', session: { intraOpNumThreads: 4, interOpNumThreads: 1 }, detection: {} },
  { label: '2 threads', session: { intraOpNumThreads: 2, interOpNumThreads: 1 }, detection: {} },
  { label: '2 threads, no arena', session: { intraOpNumThreads: 2, interOpNumThreads: 1, enableCpuMemArena: false }, detection: {} },
  { label: '2 threads, side 1280', session: { intraOpNumThreads: 2, interOpNumThreads: 1, enableCpuMemArena: false }, detection: { maxSideLength: 1280 } },
  { label: '2 threads, side 960', session: { intraOpNumThreads: 2, interOpNumThreads: 1, enableCpuMemArena: false }, detection: { maxSideLength: 960 } },
];

const mb = (n) => (n / 1048576).toFixed(0);

(async () => {
  const mod = await import('ppu-paddle-ocr');
  const ocr = require('../src/main/ocr.js');
  const urls = mod[ocr.PADDLE_MODELS[modelKey].preset];
  const bundled = require('path').join(ocr.bundledDir(), modelKey);
  const files = {};
  for (const [role, url] of Object.entries(urls)) {
    const name = url.split('/').pop();
    const b = require('path').join(bundled, name);
    files[role] = fs.existsSync(b) ? b : require('path').join(cacheDir, modelKey, name);
  }

  const buf = fs.readFileSync(image);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  console.log(`${modelKey} · ${os.cpus().length} logical cores · image ${(buf.length / 1048576).toFixed(1)} MB\n`);
  console.log('setting                      wall     CPU    peak RSS   chars');
  for (const cfg of CONFIGS) {
    let peak = 0;
    const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage.rss()); }, 40);
    const cpu0 = process.cpuUsage();
    const svc = new mod.PaddleOcrService({ model: files, session: cfg.session, detection: cfg.detection });
    await svc.initialize();
    const t0 = Date.now();
    const r = await svc.recognize(ab, { noCache: true });
    const wall = Date.now() - t0;
    const cpu = process.cpuUsage(cpu0);
    clearInterval(timer);
    await svc.destroy?.();
    console.log(`${cfg.label.padEnd(26)} ${(wall + 'ms').padStart(7)} ${(((cpu.user + cpu.system) / 1000).toFixed(0) + 'ms').padStart(7)}  ${(mb(peak) + ' MB').padStart(8)}   ${r.text.length}`);
    await new Promise((res) => setTimeout(res, 1200));
  }
  process.exit(0);
})().catch((e) => { console.error('ERR', e.stack || e.message); process.exit(1); });
