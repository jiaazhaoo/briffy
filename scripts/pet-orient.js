'use strict';
// Flags every catalogue entry whose character rises from the lower-left (`f: 1`), so the
// settings grid can mirror those thumbnails the same way petskin mirrors the real one.
//
//   node scripts/pet-orient.js          analyse entries not flagged yet
//   node scripts/pet-orient.js --all    re-analyse everything
//
// Each display-512 webp is downloaded once into the OS temp dir (about 60 MB for the whole
// library) and looked at with the same heuristic as src/main/orient.js.
const fs = require('fs');
const os = require('os');
const path = require('path');
const orient = require('../src/main/orient');

let sharp;
try { sharp = require('sharp'); } catch {
  console.error('[orient] needs sharp: npm install sharp');
  process.exit(1);
}

const CATALOG = path.join(__dirname, '..', 'assets', 'pet', 'catalog.json');
const CACHE = path.join(os.tmpdir(), 'briffy-pet-thumbs');
const CONCURRENCY = 8;
const SAMPLE = 160;   // plenty for a which-corner question

function hex(s) {
  const n = parseInt(String(s).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

async function thumb(url, file) {
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, buf);
  return buf;
}

async function analyse(buf, bg) {
  const { data, info } = await sharp(buf).resize(SAMPLE, SAMPLE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;
  const px = (x, y) => { const i = (y * w + x) * ch; return [data[i], data[i + 1], data[i + 2]]; };
  return orient.anchor(px, w, h, bg);
}

async function main() {
  const all = process.argv.includes('--all');
  const cat = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  const todo = cat.logos.filter((l) => all || l.f === undefined);
  fs.mkdirSync(CACHE, { recursive: true });
  console.log(`[orient] ${todo.length} of ${cat.logos.length} to analyse, cache ${CACHE}`);

  let done = 0, failed = 0;
  const tally = { left: 0, right: 0, center: 0 };
  const save = () => fs.writeFileSync(CATALOG, JSON.stringify(cat));
  let next = 0;
  async function worker() {
    while (next < todo.length) {
      const l = todo[next++];
      try {
        const buf = await thumb(cat.thumb.replace('{k}', l.k), path.join(CACHE, `${l.k}.webp`));
        const a = await analyse(buf, hex(l.bg));
        tally[a]++;
        l.f = a === 'left' ? 1 : 0;
      } catch (err) {
        failed++;
        console.log(`  ${l.k}: ${err.message}`);
      }
      done++;
      if (done % 200 === 0) { save(); console.log(`  ${done}/${todo.length}`); }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  save();
  console.log(`[orient] done: ${tally.left} rise from the left (mirrored), ${tally.right} from the right, ${tally.center} centred, ${failed} failed`);
}

main().catch((err) => { console.error(`[orient] ${err.message}`); process.exit(1); });
