'use strict';
// briffy's animation: does it draw the logo, does it stop, and is each state actually visible?
//
//   npx electron dev/briffy-anim-test.js
//
// Three things are worth a test here and they are all things that would be embarrassing to ship:
//
//   1. at rest it must be the brand file, to the decimal. The whole promise of this engine is that
//      the arches never move and the resting face is the mark; a rounding slip in the mouth's
//      sagitta would quietly redraw the logo everywhere it appears.
//   2. it must stop. A spring that never reaches its epsilon holds a requestAnimationFrame open for
//      ever, and on the always-on-top transparent desktop window that is a permanent composite --
//      the exact cost pet.css deleted the idle loops to avoid.
//   3. each state must move enough to be seen. Kick velocities are in units per second against a
//      638-unit box; the arithmetic is unforgiving and a nod worth 1.2 degrees is a nod nobody sees.
const { app, BrowserWindow } = require('electron');
const os = require('os');
const path = require('path');

// Its own profile. Without this the test shares briffy's userData directory, and Chromium's process
// singleton makes the second Electron on that directory wait for the first -- so running this while
// the app (or another dev script) is up hangs before `whenReady` ever resolves, with no output at
// all to say why. Cost of getting this wrong: twenty minutes looking for a bug in the animation.
app.setPath('userData', path.join(os.tmpdir(), 'briffy-anim-test'));

const anim = require('../assets/brand/briffy-anim');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0; let fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; } else { fail++; console.error(`FAIL ${name}${detail ? ': ' + detail : ''}`); }
};

// ---------- 1 · at rest it is briffy.svg ----------
{
  const m = anim.MARK;
  // the mouth in the brand file: M291.5 320 A27.6 27.6 0 0 0 345.5 320
  const d = anim.mouthPath(m.mouthX, m.mouthY, m.mouthHW, m.mouthSag);
  const got = d.match(/^M([\d.-]+) ([\d.-]+) A([\d.-]+) [\d.-]+ 0 0 (\d) ([\d.-]+) ([\d.-]+)$/);
  ok('the resting mouth is an arc', !!got, d);
  if (got) {
    ok('mouth starts where the brand file starts', Math.abs(+got[1] - 291.5) < 0.01 && Math.abs(+got[2] - 320) < 0.01, `${got[1]},${got[2]}`);
    ok('mouth ends where the brand file ends', Math.abs(+got[5] - 345.5) < 0.01 && Math.abs(+got[6] - 320) < 0.01, `${got[5]},${got[6]}`);
    ok('mouth radius is the brand file\'s 27.6', Math.abs(+got[3] - 27.6) < 0.01, got[3]);
    ok('mouth curves the way the brand file curves', got[4] === '0', got[4]);
  }
  ok('the eyes are the brand file\'s circles', m.eyeL === 238 && m.eyeR === 399 && m.eyeY === 281 && m.eyeR0 === 27);
  ok('idle sends nothing anywhere', Object.keys(anim.POSES.idle.to).length === 0);
  // a smile passing through a frown must go through a straight line, not through a flipped arc
  ok('a flat mouth is a straight line', /^M[\d.-]+ [\d.-]+ L/.test(anim.mouthPath(318.5, 320, 27, 0)));
  const frown = anim.mouthPath(318.5, 320, 27, -13);
  ok('a frown flips the sweep', / 0 1 /.test(frown), frown);
}

// ---------- 2 · the solver settles, and says how far it travelled ----------
// Run each pose's kick on its own spring and report the peak, in units of the 638 box (or degrees).
function ring(field, kick) {
  const [rest, freq, damp] = anim.FIELDS[field];
  const s = anim.spring(rest, freq, damp);
  s.t = rest; s.v += kick;
  let peak = 0; let t = 0;
  for (let i = 0; i < 6000; i++) {
    anim.step(s, anim.DT);
    t += anim.DT;
    peak = Math.max(peak, Math.abs(s.x - rest));
    if (anim.atRest(s)) break;
  }
  return { peak, secs: t, rested: anim.atRest(s) };
}

{
  const rows = [];
  for (const [name, p] of Object.entries(anim.POSES)) {
    if (!p.kick) continue;
    for (const [field, v] of Object.entries(p.kick)) {
      const r = ring(field, v);
      rows.push(`  ${name}.${field}  kick ${v} → 峰值 ${r.peak.toFixed(1)}${field === 'rot' ? '°' : field === 'scale' ? '×' : ' 单位'}，${r.secs.toFixed(2)}s 停住`);
      ok(`${name}.${field} settles`, r.rested, `still moving after ${r.secs.toFixed(1)}s`);
      ok(`${name}.${field} is big enough to see`, r.peak >= (field === 'scale' ? 0.05 : field === 'rot' ? 4 : 14),
        `peak ${r.peak.toFixed(2)}`);
      ok(`${name}.${field} is not a seizure`, r.peak <= (field === 'scale' ? 0.35 : field === 'rot' ? 22 : 90),
        `peak ${r.peak.toFixed(2)}`);
    }
  }
  console.log('弹一下能弹多远：');
  for (const r of rows) console.log(r);
}

// ---------- 3 · the character in a real page ----------
app.whenReady().then(async () => {
  // Loaded from the preview server rather than a data: URL, and offscreen rather than merely hidden.
  // A hidden window's compositor never ticks, so requestAnimationFrame never fires in it and every
  // spring would sit there for ever -- indistinguishable from the bug this test exists to catch.
  // (`node dev/preview/serve.js` must be up; every other renderer test in dev/ works the same way.)
  setTimeout(() => { console.error('FAILED timed out — is dev/preview/serve.js running?'); app.exit(1); }, 90000);
  const win = new BrowserWindow({ width: 900, height: 700, show: false, webPreferences: { offscreen: true } });
  await win.loadURL('http://127.0.0.1:5173/briffy');
  await sleep(900);
  const ev = (s) => win.webContents.executeJavaScript(s);
  await ev(`window.b = briffyAnim.attach(document.querySelector('#big')); 1`);

  ok('the module loads in a page', await ev('!!window.briffyAnim'));

  const dAt = () => ev(`document.querySelector('#big path:nth-of-type(3)').getAttribute('d')`);
  const BRAND_MOUTH = 'M291.5 320 A27.6 27.6 0 0 0 345.5 320';   // copied out of assets/brand/briffy.svg
  ok('it starts still', !(await ev('b.running()')));
  ok('drawn at rest, the mouth is the brand file\'s own path string', (await dAt()) === BRAND_MOUTH, await dAt());
  ok('at rest the eyes are the brand file\'s circles',
    await ev(`(() => { const e = document.querySelector('#big ellipse');
      return +e.getAttribute('cx') === 238 && +e.getAttribute('cy') === 281
        && +e.getAttribute('rx') === 27 && +e.getAttribute('ry') === 27; })()`));

  for (const name of ['recording', 'processing', 'capturing', 'success', 'error']) {
    await ev(`b.set('${name}'); 1`);
    await sleep(60);
    ok(`${name} starts the loop`, await ev('b.running()'));
    await sleep(2600);
    const running = await ev('b.running()');
    ok(`${name} stops the loop again`, !running, 'still asking for frames after 2.6s');
    const shape = await ev(`(() => { const e = document.querySelector('#big ellipse'), m = document.querySelector('#big path:nth-of-type(3)');
      const a = document.querySelector('#big path:nth-of-type(4)');
      return JSON.stringify({ rx: +e.getAttribute('rx'), ry: +e.getAttribute('ry'), cy: +e.getAttribute('cy'),
        arc: +a.getAttribute('opacity'), mouth: m.getAttribute('d'),
        body: document.querySelector('#big g').getAttribute('transform') }); })()`);
    const s = JSON.parse(shape);
    ok(`${name} looks different from idle`,
      Math.abs(s.rx - 27) > 0.5 || Math.abs(s.ry - 27) > 0.5 || s.arc > 0.5 || s.mouth !== BRAND_MOUTH,
      shape);
    console.log(`  ${name}: 眼 ${s.rx}×${s.ry}${s.arc > 0.5 ? '（笑成两道弧）' : ''} · 嘴 ${s.mouth.slice(0, 30)}…`);
  }

  await ev(`b.set('idle'); 1`);
  await sleep(1800);
  ok('it comes home to idle', (await dAt()) === BRAND_MOUTH, await dAt());
  ok('and is still again', !(await ev('b.running()')));

  // the arches are never touched, whatever it is doing
  const arches = await ev(`(() => { const p = document.querySelectorAll('#big path');
    return JSON.stringify([p[0].getAttribute('d'), p[1].getAttribute('d')]); })()`);
  ok('the two arches are still the brand file\'s two arches',
    arches === JSON.stringify([anim.MARK.outer.d, anim.MARK.inner.d]), arches);

  console.log(`briffy anim: ${pass} checks passed${fail ? `, ${fail} FAILED` : ''}`);
  win.destroy();
  app.exit(fail ? 1 : 0);
}).catch((e) => { console.error('FAILED', e); app.exit(1); });
