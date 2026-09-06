'use strict';
// The region detector, on interfaces whose real rectangles are known.
//
//   npx electron dev/boxes-test.js
//
// It has to be run under electron rather than plain node because the input is a real screenshot of a
// real interface -- the point is whether it finds a toolbar in a picture of a toolbar, and a page of
// made-up rectangles would only prove that flood fill works.
//
// The second page is briffy's own look on purpose: white slips on an off-white ground, separated by
// nothing but a soft shadow. That is the case this detector cannot see, and the number it scores is
// the honest measure of when window snapping still has to carry it.
const { app, BrowserWindow } = require('electron');
const boxes = require('../src/renderer/region/boxes');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0; let fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; } else { fail++; console.error(`FAIL ${name}${detail ? ': ' + detail : ''}`); }
};

// A perfectly ordinary application: hairlines and flat fills, which is what interface is made of.
const HAIRLINE = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}body{font:13px/1.5 -apple-system,system-ui,sans-serif;background:#fff;color:#222}
#bar{height:44px;background:#f6f6f6;border-bottom:1px solid #d6d6d6;display:flex;align-items:center;gap:10px;padding:0 12px}
#side{position:absolute;left:0;top:44px;bottom:0;width:200px;background:#fafafa;border-right:1px solid #d6d6d6}
#main{position:absolute;left:200px;top:44px;right:0;bottom:0;padding:20px;display:grid;grid-template-columns:1fr 1fr;gap:20px;align-content:start}
.card{background:#eef2f7;border:1px solid #c8d2de;height:150px;padding:14px}
#note{position:absolute;left:240px;top:420px;width:320px;height:120px;background:#fff7d6;border:1px solid #e0d08a}
</style><div id="bar">toolbar</div><div id="side">sidebar</div>
<div id="main"><div class="card">one</div><div class="card">two</div><div class="card">three</div><div class="card">four</div></div>
<div id="note">a floating panel</div>`;

// The same layout, briffy's way: no borders anywhere, only a soft shadow.
const SHADOW = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}body{font:13px/1.5 -apple-system,system-ui,sans-serif;background:#f3f1f0;color:#32302f}
#main{position:absolute;inset:0;padding:24px;display:grid;grid-template-columns:1fr 1fr;gap:24px;align-content:start}
.card{background:#fbf9f8;box-shadow:0 1px 2px rgba(0,0,0,.06),0 6px 16px rgba(0,0,0,.07);height:150px;padding:14px}
</style><div id="main"><div class="card">one</div><div class="card">two</div><div class="card">three</div><div class="card">four</div></div>`;

/** Where the browser says those elements really are, in CSS pixels. */
const TRUTH = `(() => {
  const out = {};
  for (const [k, sel] of Object.entries({ bar: '#bar', side: '#side', note: '#note', card1: '.card' })) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    out[k] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }
  return JSON.stringify(out);
})()`;

const close = (a, b, slack) => a && b
  && Math.abs(a.x - b.x) <= slack && Math.abs(a.y - b.y) <= slack
  && Math.abs(a.w - b.w) <= slack * 2 && Math.abs(a.h - b.h) <= slack * 2;

async function shoot(win, html) {
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await sleep(400);
  const truth = JSON.parse(await win.webContents.executeJavaScript(TRUTH));
  const img = await win.webContents.capturePage();
  const size = img.getSize();
  const rgba = img.toBitmap();
  for (let i = 0; i < rgba.length; i += 4) { const t = rgba[i]; rgba[i] = rgba[i + 2]; rgba[i + 2] = t; }
  return { truth, rgba, size };
}

app.whenReady().then(async () => {
  const W = 1000; const H = 700;
  const win = new BrowserWindow({ width: W, height: H, show: false, webPreferences: { offscreen: true } });

  // ---------- an ordinary interface ----------
  {
    const { truth, rgba, size } = await shoot(win, HAIRLINE);
    const dpr = size.width / W;
    const t0 = Date.now();
    const found = boxes.find(rgba, size.width, size.height, dpr);
    const ms = Date.now() - t0;
    console.log(`hairline UI: ${size.width}×${size.height}, ${found.length} 个候选框，${ms} ms`);
    for (const [name, want] of Object.entries(truth)) {
      const hit = found.find((b) => close(b, want, 4));
      ok(`finds ${name}`, !!hit, `wanted ${JSON.stringify(want)}, nearest ${JSON.stringify(
        found.map((b) => ({ b, d: Math.abs(b.x - want.x) + Math.abs(b.y - want.y) + Math.abs(b.w - want.w) + Math.abs(b.h - want.h) }))
          .sort((a, b) => a.d - b.d)[0] || null)}`);
    }
    // hovering: the middle of a card must offer that card, not the page it sits on
    const c = truth.card1;
    const hover = boxes.at(found, c.x + (c.w / 2), c.y + (c.h / 2), { maxW: W, maxH: H });
    ok('hovering a card offers the card', close(hover, c, 4), `offered ${JSON.stringify(hover)}, wanted ${JSON.stringify(c)}`);
    const n = truth.note;
    const overNote = boxes.at(found, n.x + 20, n.y + 20, { maxW: W, maxH: H });
    ok('hovering the floating panel offers the panel', close(overNote, n, 4), `offered ${JSON.stringify(overNote)}`);
    // and never the whole screen
    ok('the desktop itself is never offered', !found.some((b) => b.w >= W - 2 && b.h >= H - 2 && boxes.at(found, 5, 5, { maxW: W, maxH: H }) === b));
  }

  // ---------- the case it cannot see ----------
  {
    const { truth, rgba, size } = await shoot(win, SHADOW);
    const dpr = size.width / W;
    const found = boxes.find(rgba, size.width, size.height, dpr);
    const c = truth.card1;
    const hover = boxes.at(found, c.x + (c.w / 2), c.y + (c.h / 2), { maxW: W, maxH: H });
    const got = close(hover, c, 6);
    console.log(`soft-shadow UI: ${found.length} 个候选框；悬停一张卡片 → ${got ? '认出来了' : '没认出来（窗口吸附兜底）'}`);
  }

  console.log(`boxes: ${pass} checks passed${fail ? `, ${fail} FAILED` : ''}`);
  win.destroy();
  app.exit(fail ? 1 : 0);
}).catch((e) => { console.error('FAILED', e); app.exit(1); });
