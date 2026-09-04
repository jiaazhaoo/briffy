const ocr = require('../src/main/ocr.js');
const stt = require('../src/main/stt.js');
const fs = require('fs');
function readWav(file) {
  const buf = fs.readFileSync(file); let pos = 12, fmt = null, data = null;
  while (pos + 8 <= buf.length) { const id = buf.toString('ascii', pos, pos + 4); const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(pos + 10), sampleRate: buf.readUInt32LE(pos + 12) };
    else if (id === 'data') { data = buf.subarray(pos + 8, Math.min(pos + 8 + size, buf.length)); break; }
    pos += 8 + size + (size & 1); }
  const frames = Math.floor(data.length / (2 * fmt.channels)); const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) mono[i] = data.readInt16LE(i * 2 * fmt.channels) / 32768;
  const ratio = fmt.sampleRate / 16000; const out = new Float32Array(Math.floor(frames / ratio));
  for (let i = 0; i < out.length; i++) { const s = i * ratio, j = Math.floor(s), f = s - j; out[i] = mono[j] * (1 - f) + (mono[Math.min(j + 1, frames - 1)] || 0) * f; }
  return out;
}
(async () => {
  const noNet = 'C:/nonexistent-cache-dir-for-test';
  console.log('stt.isBundled(tiny.en):', stt.isBundled('Xenova/whisper-tiny.en'));
  const t0 = Date.now();
  const r = await ocr.recognize(process.argv[2], { languages: ['zh-Hans', 'en'], cacheDir: noNet });
  console.log('OCR model:', r.model, '| took', Date.now() - t0, 'ms | first line:', r.text.split('\n')[0].slice(0, 70));
  const t1 = Date.now();
  const s = await stt.transcribe(readWav(process.argv[3]), { model: 'Xenova/whisper-tiny.en', cacheDir: noNet });
  console.log('STT:', JSON.stringify(s.text.slice(0, 90)), '| took', Date.now() - t1, 'ms');
  await ocr.terminate(); await stt.dispose(); process.exit(0);
})().catch((e) => { console.error('BUNDLED_ERROR', e.message); process.exit(1); });
