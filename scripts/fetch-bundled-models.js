'use strict';
// Downloads the models that ship inside the installer:
//   bundled-models/ocr/v6-tiny/…      PP-OCRv6 tiny  (Chinese + English text recognition, ~12 MB)
//   bundled-models/stt/Xenova/whisper-tiny.en/…   English speech-to-text (~42 MB)
// Everything else (other scripts, multilingual speech) is downloaded by the app on demand.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'bundled-models');
const HF = process.env.HF_MIRROR || 'https://huggingface.co';

// Both OCR sizes ship: the app picks between them from the machine it finds itself on.
const OCR_SETS = {
  'v6-tiny': [
    'https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/main/detection/ort/PP-OCRv6_tiny_det.ort',
    'https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/main/recognition/ort/PP-OCRv6_tiny_rec.ort',
    'https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/main/recognition/ppocrv6_tiny_dict.txt',
  ],
  'v6-small': [
    'https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/main/detection/ort/PP-OCRv6_small_det.ort',
    'https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/main/recognition/ort/PP-OCRv6_small_rec.ort',
    'https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/main/recognition/ppocrv6_dict.txt',
  ],
};
const STT_MODEL = 'Xenova/whisper-tiny.en';
const STT_FILES = [
  'config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json',
  'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx',
];

async function download(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 512) { console.log(`  have  ${path.basename(file)}`); return; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const tmp = `${file}.part`;
  const out = fs.createWriteStream(tmp);
  let got = 0;
  let lastPrint = 0;
  for await (const chunk of res.body) {
    got += chunk.length;
    out.write(Buffer.from(chunk));
    if (total && Date.now() - lastPrint > 1000) { lastPrint = Date.now(); process.stdout.write(`\r  ${path.basename(file)} ${Math.round((got / total) * 100)}%   `); }
  }
  await new Promise((resolve, reject) => { out.end(resolve); out.on('error', reject); });
  fs.renameSync(tmp, file);
  process.stdout.write(`\r  done  ${path.basename(file)} (${(got / 1048576).toFixed(1)} MB)\n`);
}

(async () => {
  for (const [key, urls] of Object.entries(OCR_SETS)) {
    console.log(`OCR model (${key}):`);
    for (const url of urls) await download(url, path.join(ROOT, 'ocr', key, url.split('/').pop()));
  }

  console.log(`Speech model (${STT_MODEL}):`);
  for (const rel of STT_FILES) {
    await download(`${HF}/${STT_MODEL}/resolve/main/${rel}`, path.join(ROOT, 'stt', ...STT_MODEL.split('/'), ...rel.split('/')));
  }

  const size = (dir) => { let n = 0; for (const f of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) if (f.isFile()) n += fs.statSync(path.join(f.parentPath || f.path, f.name)).size; return n; };
  console.log(`\nbundled-models total: ${(size(ROOT) / 1048576).toFixed(1)} MB`);
})().catch((e) => { console.error('failed:', e.message); process.exit(1); });
