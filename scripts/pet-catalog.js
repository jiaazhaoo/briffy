'use strict';
// Snapshots the free logo catalogue from ipaslogo.com into assets/pet/catalog.json.
//
//   node scripts/pet-catalog.js
//
// The site is a static SPA: its whole catalogue is baked into the hashed bundle as a
// map of storage keys to {backgroundColor, width, height}. There is no API to call,
// so this finds the bundle from the index page and parses that map out of it.
// Only ids and background colours are stored (~150 KB); the pictures stay on the CDN
// until someone actually picks one.
const fs = require('fs');
const path = require('path');

const SITE = 'https://ipaslogo.com';
const CDN = 'https://cdn.ipaslogo.com';
const OUT = path.join(__dirname, '..', 'assets', 'pet', 'catalog.json');

// "logos/<16 hex>-<slug>.png":{backgroundColor:`#42706e`,width:1254,height:1254}
const ENTRY = /"logos\/([0-9a-f]{16}-[a-z0-9-]+)\.png":\{backgroundColor:\s*[`"']([^`"']+)[`"']\s*,\s*width:\s*(\d+)\s*,\s*height:\s*(\d+)/g;

async function text(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'dailylogs-pet-catalog' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// "a746787047a05c50-quokka-2" -> "Quokka 2"
function title(key) {
  return key.slice(17).split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

async function main() {
  const html = await text(SITE);
  const bundle = (html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/) || [])[0];
  if (!bundle) throw new Error('could not find the site bundle in the index page - the site changed');
  console.log(`[catalog] bundle ${bundle}`);

  // orientation flags come from scripts/pet-orient.js; carry them over so a re-scrape
  // does not throw away the thumbnail analysis
  let flags = new Map();
  try { flags = new Map(JSON.parse(fs.readFileSync(OUT, 'utf8')).logos.map((l) => [l.k, l.f])); } catch (_) { /* first run */ }

  const js = await text(SITE + bundle);
  const logos = [];
  const seen = new Set();
  for (const m of js.matchAll(ENTRY)) {
    const [, key, bg] = m;
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = { k: key, n: title(key), bg };
    if (flags.get(key) !== undefined) entry.f = flags.get(key);
    logos.push(entry);
  }
  if (!logos.length) throw new Error('found the bundle but no catalogue entries - the shape changed');

  const doc = {
    source: SITE,
    cdn: CDN,
    // display-512 is the browsable webp; logos/<k>.png is the full-resolution original
    thumb: `${CDN}/display-512/{k}.webp`,
    original: `${CDN}/logos/{k}.png`,
    license: 'free to download and free for commercial use, per ipaslogo.com',
    fetched: new Date().toISOString().slice(0, 10),
    count: logos.length,
    logos,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(doc));
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`[catalog] ${logos.length} logos -> ${path.relative(path.join(__dirname, '..'), OUT)} (${kb} KB)`);
}

main().catch((err) => { console.error(`[catalog] ${err.message}`); process.exit(1); });
