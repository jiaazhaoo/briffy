// Reports the real download size of every PP-OCR model set in the catalogue (HEAD requests, no download).
(async () => {
  const mod = await import('ppu-paddle-ocr');
  const ocr = require('../src/main/ocr.js');
  const rows = [];
  for (const [key, meta] of Object.entries(ocr.PADDLE_MODELS)) {
    const urls = mod[meta.preset];
    if (!urls) { rows.push({ key, name: meta.name, error: 'no preset' }); continue; }
    const parts = {};
    let total = 0;
    for (const [role, url] of Object.entries(urls)) {
      try {
        const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
        const n = Number(res.headers.get('content-length')) || 0;
        parts[role] = n;
        total += n;
      } catch (e) { parts[role] = 0; }
    }
    rows.push({ key, name: meta.name, det: parts.detection, rec: parts.recognition, dict: parts.charactersDictionary, total, langs: meta.langs.join(' ') });
  }
  const mb = (n) => (n ? (n / 1048576).toFixed(1) : '?');
  console.log('key           model                  det      rec     dict    total   languages');
  for (const r of rows.sort((a, b) => (a.total || 0) - (b.total || 0))) {
    console.log(`${r.key.padEnd(13)} ${String(r.name).padEnd(22)} ${mb(r.det).padStart(6)}  ${mb(r.rec).padStart(6)}  ${mb(r.dict).padStart(5)}  ${mb(r.total).padStart(6)}  ${r.langs || r.error || ''}`);
  }
})().catch((e) => { console.error('failed:', e.message); process.exit(1); });
