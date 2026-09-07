'use strict';
// briffy, moving.
//
// The mark is two open arches with a face in the head (assets/brand/briffy.svg, where every number
// was measured off the artwork). This file is that same drawing with springs on the face.
//
// **The arches never deform.** Their radii, centres and stroke widths are copied out of the svg and
// are never touched -- whatever briffy is doing, freeze a frame and it is still the logo. What moves
// is the face (two eyes and a mouth) and the whole mark as one rigid thing: it can be lifted, tilted,
// or popped, the way you would move a drawing on a table, but it is never squashed or stretched.
//
// Why springs and not keyframes. A keyframed pose has to be authored for every pair of states you
// might cut between; a spring only needs the destination, and getting interrupted halfway is free --
// it just changes where it is heading, from wherever it currently is, at whatever speed it currently
// has. briffy's states interrupt each other constantly (a capture lands while a recording is running,
// an error arrives mid-save), so this is not a stylistic preference.
//
// **And springs stop.** That is the reason this can exist at all. The desktop window is transparent,
// always on top and never closed, so every frame it asks for is an alpha composite that never ends;
// pet.css has the measurement -- three `infinite` idle loops cost 11.4% of a core against 0.9% for a
// still one, which is why the idle loops were deleted. A spring settles: when every variable is
// within an epsilon of its target and has no velocity left, the loop snaps them exactly to target and
// cancels the frame request. Between two states nothing is animating and nothing is composited. A
// state change wakes it, the motion plays, it goes back to costing nothing.
//
// Plain numbers and one <svg>: no canvas, no dependency, no build step, so it can be `require`d by a
// test under node and dropped into any page with a <script> tag.

(() => {
  // ---------- the mark, exactly as briffy.svg draws it ----------
  // Changing anything in here changes the logo. The face keys are the resting pose, and `pose.idle`
  // below is written from them, so briffy at rest is pixel-for-pixel the brand file.
  const MARK = {
    box: 638,
    outer: { d: 'M156.5 638 V283.75 A161.75 161.75 0 0 1 480 283.75 V638', w: 46 },
    inner: { d: 'M245.5 638 V493.5 A73 73 0 0 1 391.5 493.5 V638', w: 45 },
    eyeL: 238, eyeR: 399, eyeY: 281, eyeR0: 27,
    mouthX: 318.5, mouthY: 320, mouthHW: 27, mouthSag: 21.88, mouthW: 20,
    pivotX: 318.25, pivotY: 638,          // the feet: it tilts and grows from where it stands
    colour: '#2A6CF0',
  };

  // ---------- 整只，不是那个标记 ----------
  //
  // 标记是从底下切开的：两道弧各自走出画面，因为它要蹲在一个方形的图标里。
  // 桌面上那只不一样，它得是一枚真的回形针——而回形针**是一根连着的铁丝**，不是两个分开的圈：
  // 大环的左侧在底下用一个半圆兜过去，接上小环的右侧；剩下两个头是自由的（大环的右腿、小环的左腿）。
  //
  // 所以这里只有一条路径，一笔画完：
  //   大环右腿（自由端）↑ → 大环顶上的弧 → 大环左腿 ↓ → 底下那个半圆 → 小环右腿 ↑
  //   → 小环顶上的弧 → 小环左腿 ↓（自由端）
  //
  // 每个数都还是标记里的那几个（腿在 x 156.5 / 480、弧半径 161.75、内弧 (318.5, 493.5) r73），
  // 新的只有那个兜底的半圆：从 x156.5 到 x391.5，所以圆心 x274、半径 117.5。
  // 一根铁丝当然只有一个粗细，所以整条都是 46（标记里内弧的 45 是切开之后各写各的）。
  // 脸一个像素没动——viewBox 只是换了一块取景，坐标系是同一个。
  //
  // 直腰比标记里长一截（大环左腿走到 y710，不是 640）：标记是切开的，看不出腰身；
  // 整只站起来之后，短腰会读成一颗药丸，长一点才是一枚回形针。
  // 两个自由端：大环右腿收在 y720，小环左腿收在 y710——小环那条正好齐着它自己那一侧
  // 转进半圆的那个点（大环左腿也是走到 710 才兜过去），所以它看着是「到底了」，不是随便断的。
  const FULL = {
    view: '129 95 379 760',
    wire: {
      d: 'M480 720 V283.75 A161.75 161.75 0 0 0 156.5 283.75 V710 A117.5 117.5 0 0 0 391.5 710'
        + ' V493.5 A73 73 0 0 0 245.5 493.5 V710',
      w: 46,
    },
    pivotY: 827.5,                        // 脚：底下那个半圆的最低点
  };

  // ---------- the solver ----------
  // Damped harmonic motion, integrated at a fixed 120 Hz however long the real frame was, so a
  // dropped frame changes nothing about how the motion looks.
  const DT = 1 / 120;

  function spring(x, freq, damp) { return { x, v: 0, t: x, freq, damp }; }

  function step(s, dt) {
    let left = dt;
    while (left > 0) {
      const h = Math.min(DT, left);
      left -= h;
      s.v += ((-2 * s.damp * s.freq * s.v) - (s.freq * s.freq * (s.x - s.t))) * h;
      s.x += s.v * h;
    }
    // A spring that has gone to NaN never comes back and paints nothing for ever; put it on target.
    if (!Number.isFinite(s.x) || !Number.isFinite(s.v)) { s.x = s.t; s.v = 0; }
  }

  // Rest is relative to how big the number is, so one rule covers a radius of 27 and a cross-fade
  // of 0..1: within a fifth of a percent of target, and going nowhere.
  function atRest(s) {
    const eps = 0.002 * Math.max(1, Math.abs(s.t));
    return Math.abs(s.x - s.t) < eps && Math.abs(s.v) < eps * 8;
  }

  // ---------- what can move ----------
  // Four for the whole mark as one rigid object, seven for the face. That is the entire vocabulary;
  // there is deliberately no way to say "make the outer arch wider".
  const FIELDS = {
    bx: [0, 16, 0.55],      // slide across  — a head shake
    by: [0, 16, 0.5],       // lift          — a hop
    rot: [0, 17, 0.5],      // tilt, degrees — a nod, a thinking lean
    scale: [1, 19, 0.5],    // grow from the feet — a startle
    ex: [0, 22, 0.85],      // both eyes across (look left / right)
    ey: [0, 22, 0.85],      // both eyes up / down
    erx: [MARK.eyeR0, 21, 0.8],
    ery: [MARK.eyeR0, 21, 0.8],
    earc: [0, 20, 0.9],     // 0 = round eyes, 1 = two happy arcs; a cross-fade, so it is continuous
    mhw: [MARK.mouthHW, 20, 0.8],
    msag: [MARK.mouthSag, 20, 0.8],   // signed: + smiles, 0 is a straight line, − frowns
  };

  // ---------- the six states ----------
  // One entry per state pet.js already broadcasts, so nothing here needs a new event. `to` is where
  // the springs are sent; `kick` is velocity handed to a spring at the moment of arrival, which is
  // how a nod or a shake happens without a single keyframe -- you push it and let it ring down.
  //
  // Kicks are velocities, not distances, and the two are further apart than they look: a damped
  // spring released at v0 only reaches about v0/(2·omega_d), so on a 638-unit box a kick of 90 buys
  // a hop of 2.7 units -- a fifth of a pixel at the size the desktop pet is drawn. The numbers below
  // are the ones that came back from dev/briffy-anim-test.js, which prints the peak each one reaches;
  // change a kick and read that table again rather than reasoning about it.
  const POSES = {
    // At rest it is the logo, to the decimal.
    idle: { to: {} },

    // Listening. Attention has to be a *shape*, not a movement: recording runs for minutes and the
    // springs are asleep for all but the first second of it, so whatever says "listening" has to still
    // be saying it while nothing is moving. Narrow, tall, focused eyes and a mouth closed to a line.
    // The first try -- eyes 6% bigger and a slightly smaller smile -- was indistinguishable from idle
    // at the size this is actually drawn.
    recording: { to: { erx: 21, ery: 33, ey: -4, mhw: 12, msag: 1, rot: -1.5 } },

    // Thinking: looking up and away, mouth pursed, leaning on one leg.
    processing: { to: { ex: 15, ey: -13, erx: 25, ery: 25, mhw: 13, msag: 3.5, rot: -5 } },

    // The shutter: eyes blown round and wide, mouth a small deep o, and the whole mark pops off its
    // feet. Round and huge against recording's narrow and tall -- the two states are next to each
    // other in time (you record, you capture) so they must not resolve to the same face.
    capturing: { to: { erx: 35, ery: 36, ey: -2, mhw: 9, msag: 17 }, kick: { scale: 2.6, by: -1000 } },

    // Saved: two happy arcs and a wide smile, and a nod -- pushed on the tilt, so it swings and settles.
    success: { to: { earc: 1, ery: 24, mhw: 34, msag: 27 }, kick: { rot: -320 } },

    // Failed: eyes narrowed, mouth turned down, one shake across.
    error: { to: { ery: 9, erx: 26, mhw: 24, msag: -13 }, kick: { bx: 780 } },
  };

  // ---------- drawing ----------
  const NS = 'http://www.w3.org/2000/svg';
  const el = (name, attrs) => {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };

  /**
   * The mouth: an elliptical arc through two ends with a signed sagitta.
   *
   * Sagitta rather than a radius because a radius cannot pass through flat -- a smile becoming a
   * frown would have to jump from one sweep flag to the other and back through infinity. The height
   * of the bulge goes smoothly through zero, and the radius is derived from it; at zero it is simply
   * a straight line, which is the shape a mouth has on the way from one to the other.
   */
  // Two decimals, trailing zeros dropped. Not tidiness: at the resting values this makes the mouth
  // come out as the brand file's own string, character for character.
  const n = (v) => +v.toFixed(2);

  function mouthPath(cx, y, hw, sag) {
    const x0 = n(cx - hw), x1 = n(cx + hw);
    if (Math.abs(sag) < 0.4 || hw < 0.5) return `M${x0} ${n(y)} L${x1} ${n(y)}`;
    const r = n(((sag * sag) + (hw * hw)) / (2 * Math.abs(sag)));
    return `M${x0} ${n(y)} A${r} ${r} 0 0 ${sag > 0 ? 0 : 1} ${x1} ${n(y)}`;
  }

  /** A happy eye: one arc bulging upwards, sitting where the round eye sits. */
  function archPath(cx, cy) {
    const w = 23, h = 26;
    return `M${n(cx - w)} ${n(cy + 7)} A${h} ${h} 0 0 1 ${n(cx + w)} ${n(cy + 7)}`;
  }

  /**
   * @param {Element} host where to put it; it is emptied first
   * @param {{colour?:string, plate?:boolean, title?:string}} [opts] `plate` paints the brand's white
   *   square behind it (the app icon has one, the desktop pet does not -- it sits on its own paper)
   */
  function create(host, opts = {}) {
    const colour = opts.colour || MARK.colour;
    const full = opts.body === 'full';
    const svg = el('svg', {
      xmlns: NS,
      viewBox: full ? FULL.view : `0 0 ${MARK.box} ${MARK.box}`,
      width: '100%', height: '100%',
    });
    svg.setAttribute('aria-hidden', 'true');
    if (opts.title) { const t = el('title'); t.textContent = opts.title; svg.appendChild(t); svg.removeAttribute('aria-hidden'); }
    if (opts.plate && !full) svg.appendChild(el('rect', { width: MARK.box, height: MARK.box, fill: '#fff' }));

    const body = el('g', {});
    const strokes = el('g', { fill: 'none', stroke: colour, 'stroke-linecap': 'round' });
    if (full) {
      strokes.appendChild(el('path', { d: FULL.wire.d, 'stroke-width': FULL.wire.w }));
    } else {
      strokes.appendChild(el('path', { d: MARK.outer.d, 'stroke-width': MARK.outer.w }));
      strokes.appendChild(el('path', { d: MARK.inner.d, 'stroke-width': MARK.inner.w }));
    }
    const mouth = el('path', { 'stroke-width': MARK.mouthW });
    const archL = el('path', { 'stroke-width': 17, opacity: 0 });
    const archR = el('path', { 'stroke-width': 17, opacity: 0 });
    strokes.appendChild(mouth); strokes.appendChild(archL); strokes.appendChild(archR);
    const eyes = el('g', { fill: colour });
    const eyeL = el('ellipse', {});
    const eyeR = el('ellipse', {});
    eyes.appendChild(eyeL); eyes.appendChild(eyeR);
    body.appendChild(strokes); body.appendChild(eyes);
    svg.appendChild(body);
    host.textContent = '';
    host.appendChild(svg);
    return { svg, body, mouth, archL, archR, eyeL, eyeR, pivotY: full ? FULL.pivotY : MARK.pivotY };
  }

  // ---------- the character ----------
  /**
   * @param {Element} host an element to draw into
   * @param {object} [opts] passed to create(); `reduce` forces the no-motion path
   * @returns {{set:(name:string)=>void, poke:(name:string)=>void, pose:()=>string,
   *            running:()=>boolean, destroy:()=>void, node:SVGElement}}
   */
  function attach(host, opts = {}) {
    const parts = create(host, opts);
    const S = {};
    for (const k in FIELDS) S[k] = spring(FIELDS[k][0], FIELDS[k][1], FIELDS[k][2]);

    // Someone who has asked their system for less movement gets the poses and none of the travel:
    // every state still reads differently, it simply arrives there rather than springing there.
    const still = () => opts.reduce
      || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

    let raf = 0;
    let last = 0;
    let current = 'idle';
    let dead = false;

    function paint() {
      const { bx, by, rot, scale, ex, ey, erx, ery, earc, mhw, msag } = S;
      const px = MARK.pivotX, py = parts.pivotY;
      parts.body.setAttribute('transform',
        `translate(${(px + bx.x).toFixed(2)} ${(py + by.x).toFixed(2)}) `
        + `rotate(${rot.x.toFixed(2)}) scale(${scale.x.toFixed(4)}) `
        + `translate(${-px} ${-py})`);

      const cyv = MARK.eyeY + ey.x;
      const lx = MARK.eyeL + ex.x, rx = MARK.eyeR + ex.x;
      const rxv = Math.max(0.5, erx.x), ryv = Math.max(0.5, ery.x);
      const round = 1 - Math.min(1, Math.max(0, earc.x));
      for (const [node, cx] of [[parts.eyeL, lx], [parts.eyeR, rx]]) {
        node.setAttribute('cx', cx.toFixed(2));
        node.setAttribute('cy', cyv.toFixed(2));
        node.setAttribute('rx', rxv.toFixed(2));
        node.setAttribute('ry', ryv.toFixed(2));
        node.setAttribute('opacity', round.toFixed(3));
      }
      for (const [node, cx] of [[parts.archL, lx], [parts.archR, rx]]) {
        node.setAttribute('opacity', (1 - round).toFixed(3));
        if (round < 0.999) node.setAttribute('d', archPath(cx, cyv));
      }
      parts.mouth.setAttribute('d', mouthPath(MARK.mouthX, MARK.mouthY, Math.max(0, mhw.x), msag.x));
    }

    function settle() {                     // land exactly on target, then stop asking for frames
      for (const k in S) { S[k].x = S[k].t; S[k].v = 0; }
      paint();
      raf = 0;
    }

    function frame(now) {
      if (dead) return;
      const dt = Math.min(0.05, last ? (now - last) / 1000 : DT);   // a backgrounded tab must not leap
      last = now;
      let moving = false;
      for (const k in S) {
        const s = S[k];
        if (atRest(s)) { s.x = s.t; s.v = 0; continue; }
        step(s, dt);
        moving = true;
      }
      paint();
      if (moving) raf = requestAnimationFrame(frame);
      else settle();
    }

    function wake() {
      if (dead || raf) return;
      if (still()) { settle(); return; }
      last = 0;
      raf = requestAnimationFrame(frame);
    }

    // `noScale`：这一处不许把整只放大。桌面上那只用它——一枚贴在别人桌面上的回形针一鼓一鼓地涨大，
    // 既不像纸也不像铁丝，而且 80×80 的窗口里放大就是把自己顶出边界。
    const allowed = (k) => !(opts.noScale && k === 'scale');

    /** Go to a state. Calling it with the state it is already in does nothing, kicks included. */
    function set(name) {
      const p = POSES[name] || POSES.idle;
      if (name === current) return;
      current = POSES[name] ? name : 'idle';
      for (const k in FIELDS) S[k].t = (p.to && k in p.to) ? p.to[k] : FIELDS[k][0];
      if (p.kick && !still()) for (const k in p.kick) if (S[k] && allowed(k)) S[k].v += p.kick[k];
      wake();
    }

    /** The same state again, on purpose: re-throw its kick. A second save should nod a second time. */
    function poke(name) {
      const p = POSES[name || current];
      if (!p) return;
      if ((name || current) !== current) { set(name); return; }
      if (p.kick && !still()) { for (const k in p.kick) if (S[k] && allowed(k)) S[k].v += p.kick[k]; wake(); }
    }

    paint();
    return {
      node: parts.svg,
      set,
      poke,
      /** 推它一下，不动表情——待机的小动作要的就是这个 */
      nudge(field, v) { if (S[field] && allowed(field) && !still()) { S[field].v += v; wake(); } },
      pose: () => current,
      running: () => !!raf,
      destroy() { dead = true; if (raf) cancelAnimationFrame(raf); raf = 0; host.textContent = ''; },
    };
  }

  const API = { attach, create, mouthPath, archPath, spring, step, atRest, MARK, FULL, FIELDS, POSES, DT };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.briffyAnim = API;
})();
