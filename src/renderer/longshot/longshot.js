'use strict';
/* global longshot */
// Watching one rectangle while the user scrolls, and growing a single tall picture out of it.
//
// The stream is opened here rather than in the main process because that is the only place it can be:
// `getUserMedia` is a page API. One <video> carries the whole display; every tick a strip of it -- the
// chosen rectangle, in the display's real pixels -- is drawn into a small canvas, compared with the
// one before, and whatever is new is appended to a tall canvas that only ever grows.
//
// Step and shoot, not watch and guess. Each round asks the main process to post a scroll of a known
// size, waits for it to settle, takes one frame, and joins it on. Two things follow from doing the
// scrolling rather than watching it, and both are what make this work at all:
//
//   the overlap is guaranteed. A step is 45 % of the region, so 55 % of every frame is content the
//   picture already has. The old version could be scrolled past its own overlap, and then the best
//   match available was a wrong one -- there was no right one left to find.
//
//   the distance is known. The search is confined to a band around what the step should have produced,
//   and after the first join, around what the last one actually did. A join one card too far down now
//   falls outside the band and is refused instead of chosen.
//
// It also means the shot ends by itself: when three steps in a row move nothing, the page is at its
// bottom and the picture is finished.
(() => {
  const api = window.longshot;
  const $ = (s) => document.querySelector(s);
  const stateEl = $('#state');
  const countEl = $('#count');
  const fillEl = $('#fill');
  const btnDone = $('#btnDone');
  const btnCancel = $('#btnCancel');

  const MAX_ROWS = 30000;          // a tall page, not an endless one
  const SETTLE_POLL_MS = 40;
  const SETTLE_MAX_MS = 1200;      // give up waiting for stillness and take what is there
  const STEP_FRACTION = 0.45;      // of the region's height, so 55 % of each frame is overlap
  const PROBE_PX = 100;            // a deliberately small first step; see `run`
  const NEAR = 0.72;               // how far below the expected distance a join may still be
  const FAR = 1.35;                // and how far above
  const MAX_STEPS = 500;
  const STALLS_TO_STOP = 3;        // steps that move nothing before calling it the bottom

  let strings = {};
  const stitch = window.stitch;    // loaded by the <script> before this one
  let video = null;
  let stream = null;
  let acc = null;                  // the tall canvas
  let accCtx = null;
  let accRows = 0;
  // The frame whose bottom edge *is* the bottom of the tall picture -- not simply the frame before.
  //
  // Advancing this on every tick, matched or not, was a real bug and a nasty one. A frame that could
  // not be matched was thrown away, and the next frame was then compared against it rather than
  // against the picture so far; whatever had scrolled past in between was gone, and the result had a
  // join in it with content missing on both sides. Nobody re-reads a long screenshot closely enough to
  // catch that. Keeping the anchor still means a frame that cannot be matched costs nothing: the next
  // one is measured from the same place, and if the user scrolls past the overlap entirely they are
  // told, rather than handed a picture with a hole in it.
  let anchor = null;
  let frames = 0;                  // how many frames actually contributed
  let stepPx = 0;                  // what we ask for each step, in the display's own points
  // How many rows of picture one point of requested scroll is worth in this window. Two, on a retina
  // display, when the app moves exactly as far as it is asked -- but an app may move more or less, so
  // it is measured rather than assumed, and only ever nudged, never replaced.
  let ratio = 0;                   // 0 = nothing measured yet
  let stopping = false;
  let crop = null;                 // { x, y, w, h } in the stream's own pixels
  let rectPoints = null;           // the same region in the display's points, which is what a step is in
  let finished = false;
  // The bars that do not scroll -- a pinned header, a pinned footer -- as measured the first time two
  // frames could be compared. They belong in the tall picture once: the header comes free with the
  // first screenful, and the footer is put back at the very end. Everything in between is written
  // from the moving part of the frame only, which is what keeps a chat box or a toolbar from being
  // printed once per screenful down the whole length of the shot.
  let sticky = null;               // { top, bottom }
  let lastCanvas = null;           // the last frame that contributed, kept for its footer

  function say(text, count = '') {
    stateEl.textContent = text || '';
    countEl.textContent = count || '';
  }

  // No total to measure against -- a page has no known length -- so the bar just creeps and wraps.
  function tickBar() {
    const pct = ((accRows / 1200) * 100) % 100;
    fillEl.style.width = `${pct.toFixed(1)}%`;
  }

  function stop() {
    stopping = true;
    if (stream) { for (const t of stream.getTracks()) t.stop(); stream = null; }
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * A cheap number that changes when the picture does. Sampling a lattice rather than every pixel
   * because this runs several times a step and only has to answer "is it still moving".
   */
  function fingerprint(rgba, w, h) {
    let a = 0; let b = 0;
    for (let y = 0; y < h; y += 7) {
      for (let x = 0; x < w; x += 11) {
        const i = ((y * w) + x) * 4;
        a = (a + rgba[i] + (rgba[i + 1] * 3) + (rgba[i + 2] * 7)) % 4294967291;
        b = (b + a) % 4294967291;
      }
    }
    return `${a}:${b}`;
  }

  /**
   * Wait for the scroll to come to rest, rather than for a fixed time.
   *
   * A fixed wait was wrong in both directions. Too short and the frame is taken mid-animation: the
   * content has moved less than the step, the next step is matched against that smaller measurement,
   * and the error compounds -- in a run over a page of thirty sections that showed up as slivers
   * duplicated at some joins and lost at others, three sections missing overall, and one place where
   * later content was joined on above earlier content. Too long and every step of a long page pays for
   * the slowest app anybody uses. Watching the frame settle costs a few reads and is right for both.
   */
  async function settle() {
    let last = null;
    const until = Date.now() + SETTLE_MAX_MS;
    while (Date.now() < until && !stopping && !finished) {
      await wait(SETTLE_POLL_MS);
      const shotFrame = grab();
      if (!shotFrame) return null;
      const mark = fingerprint(shotFrame.rgba, crop.w, crop.h);
      if (mark === last) return shotFrame;   // two the same: it has stopped
      last = mark;
    }
    return grab();
  }

  /**
   * Where the content can plausibly have got to, in rows of the picture. Before anything has been
   * measured this is the step we asked for, loosely bounded, because how many pixels a window moves
   * for a given request is the window's business. Afterwards it is the last real measurement, tightly
   * bounded -- the same window keeps behaving the same way.
   */
  function band(expect) {
    const cap = Math.max(8, Math.floor(crop.h * 0.85));
    const centre = expect * (ratio > 0 ? ratio : 1);
    // Wider before anything has been measured, because how far a window moves for a given request is
    // the window's business. The first step is small enough (PROBE_PX) that even this wide band cannot
    // reach a repeat of the content -- see `run`.
    const lo = ratio > 0 ? NEAR : 0.45;
    const hi = ratio > 0 ? FAR : 1.8;
    return { min: Math.max(4, Math.floor(centre * lo)), max: Math.min(cap, Math.ceil(centre * hi)) };
  }

  function grow(rows) {
    const next = document.createElement('canvas');
    next.width = acc.width;
    next.height = Math.min(MAX_ROWS, accRows + rows);
    const ctx = next.getContext('2d', { alpha: false });
    ctx.drawImage(acc, 0, 0);
    acc = next;
    accCtx = ctx;
  }

  /** One frame of the region, as a canvas and as something the stitcher can compare. */
  function grab() {
    if (!video || !video.videoWidth) return null;
    const frame = document.createElement('canvas');
    frame.width = crop.w; frame.height = crop.h;
    const fctx = frame.getContext('2d', { alpha: false, willReadFrequently: true });
    fctx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
    const rgba = fctx.getImageData(0, 0, crop.w, crop.h).data;
    return { frame, fctx, rgba, cur: stitch.prepare(rgba, crop.w, crop.h) };
  }

  /** @returns {boolean} whether anything was added. */
  function join(shotFrame, expect) {
    const { frame, fctx, cur } = shotFrame;
    if (!anchor) {
      // the first frame is the picture so far, entire
      acc = frame; accCtx = fctx; accRows = crop.h; anchor = cur; frames = 1;
      lastCanvas = frame;
      say(strings.scroll || '', `${accRows} px`);
      tickBar();
      return true;
    }

    const hit = stitch.newRowsFor(anchor, cur, { expect: band(expect) });
    // No join means the view did not move -- at the bottom of the page, or the window ignored the
    // scroll. It is never taken to mean "moved further than expected": the step size is ours, so that
    // cannot happen, and treating it as a reason to widen the search is exactly the bug this replaced.
    if (!hit) return false;
    if (accRows >= MAX_ROWS) { say(strings.full || '', `${accRows} px`); return false; }

    // The first join is the first chance to know where the furniture is. The footer that came with
    // the opening screenful is cut off here and put back once at the end; without this it would be
    // buried mid-picture and reprinted below every join.
    if (!sticky) {
      sticky = { top: hit.top || 0, bottom: hit.bottom || 0 };
      if (sticky.bottom > 0) accRows = Math.max(1, accRows - sticky.bottom);
    }
    const bottom = hit.bottom || 0;
    const rows = Math.min(hit.newRows, MAX_ROWS - accRows, crop.h - bottom);
    if (rows < 1) return false;
    grow(rows);
    // The new rows end where the moving part of the view ends -- just above the pinned footer, not at
    // the bottom edge of the frame.
    accCtx.drawImage(frame, 0, crop.h - bottom - rows, crop.w, rows, 0, accRows, crop.w, rows);
    accRows += rows;
    anchor = cur;
    lastCanvas = frame;
    // Nudged, not replaced. Trusting each measurement outright was the mistake that survived the first
    // repair, and it looked entirely reasonable: centre the search on what the last step actually
    // produced. One bad step then moved the centre onto the bad value, the next step matched inside the
    // moved band, and the error held for the rest of the picture. On a page of 190-point sections the
    // joins settled into 184 rows, then 936, then 184 again -- a section short, then a section long,
    // for ever -- where the truth was 558 every time. Three sections were lost, several were repeated,
    // and the picture came out 10 % short with nothing about it to say so.
    //
    // What is known here is the request. The measurement only says how this window answers it, so it
    // bends the ratio a little each step and never carries it away.
    const answered = hit.newRows / Math.max(1, expect);
    ratio = ratio > 0 ? (ratio * 0.7) + (answered * 0.3) : answered;
    ratio = Math.min(2.6, Math.max(0.35, ratio));
    frames++;
    say(strings.scroll || '', `${accRows} px`);
    tickBar();
    btnDone.disabled = false;
    return true;
  }

  /** Step, settle, shoot, join -- until the page stops moving or the user says stop. */
  async function run() {
    const first = grab();
    if (!first) { say(strings.failed || ''); return; }
    join(first, 0);

    let stalls = 0;
    for (let i = 0; i < MAX_STEPS && !stopping && !finished; i++) {
      // The first step is small on purpose. Nothing is known yet about how far this window moves for a
      // given request, so the band has to be wide -- and a wide band is where a repeat of the content
      // can be taken for the join. A small step keeps even a wide band clear of the nearest repeat, and
      // one measurement later the band is tight and the steps can be full size.
      const ask = ratio > 0 ? stepPx : Math.min(PROBE_PX, stepPx);
      const posted = await api.step(ask);
      if (!posted) { say(strings.failed || ''); return; }
      const shotFrame = await settle();
      if (stopping || finished) return;
      if (!shotFrame) break;
      // What the step should be worth in rows of the picture: our own request, in the stream's pixels.
      const expect = ask * (crop.h / rectPoints.height);
      if (join(shotFrame, expect)) { stalls = 0; continue; }
      // Chromium swallows the first scroll after a pause often enough that one stall means nothing.
      // Three in a row is the bottom of the page, and the shot is finished rather than left hanging.
      stalls++;
      if (stalls >= STALLS_TO_STOP) break;
    }
    if (!finished && accRows > crop.h) done();
    else if (!finished) { say(strings.failed || strings.scroll || '', `${accRows} px`); btnDone.disabled = false; }
  }

  function done() {
    if (finished) return;
    finished = true;
    stop();
    if (!acc || accRows < 4) { api.cancel(); return; }
    // Put the pinned footer back, once, under everything -- it is part of what the user was looking at.
    const foot = sticky && sticky.bottom > 0 && lastCanvas ? Math.min(sticky.bottom, MAX_ROWS - accRows) : 0;
    const out = document.createElement('canvas');
    out.width = acc.width; out.height = accRows + Math.max(0, foot);
    const octx = out.getContext('2d', { alpha: false });
    octx.drawImage(acc, 0, 0);
    if (foot > 0) octx.drawImage(lastCanvas, 0, crop.h - foot, crop.w, foot, 0, accRows, crop.w, foot);
    api.done({ png: out.toDataURL('image/png'), width: out.width, height: out.height, frames });
  }

  function give_up() {
    if (finished) return;
    finished = true;
    stop();
    api.cancel();
  }

  api.onInit(async ({ sourceId, rect, display, canScroll, strings: s }) => {
    strings = s || {};
    rectPoints = rect;
    $('#labelDone').textContent = strings.done || '';
    $('#labelCancel').textContent = strings.cancel || '';
    btnDone.disabled = true;
    say(strings.starting || '');

    if (!stitch) { say(strings.failed || 'stitch.js did not load'); return; }
    // No Accessibility, no long shot. The old mode -- watch the user scroll and infer the distance --
    // is not offered instead, because it produced pictures that were wrong without looking wrong.
    if (!canScroll) { say(strings.needsAccess || strings.failed || ''); btnDone.disabled = true; return; }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            maxWidth: Math.round(display.width * display.scaleFactor),
            maxHeight: Math.round(display.height * display.scaleFactor),
            maxFrameRate: 30,
          },
        },
      });
    } catch (e) {
      say(strings.failed || String(e.message));
      return;
    }

    video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    // wait for real dimensions
    for (let i = 0; i < 40 && !video.videoWidth; i++) await new Promise((r) => setTimeout(r, 25));
    if (!video.videoWidth) { say(strings.failed || ''); return; }

    // The ratio is measured off the stream rather than taken from scaleFactor, for the same reason
    // region.js measures its own: what comes back is not always what was asked for.
    const sx = video.videoWidth / display.width;
    const sy = video.videoHeight / display.height;
    crop = {
      x: Math.max(0, Math.round(rect.x * sx)),
      y: Math.max(0, Math.round(rect.y * sy)),
      w: Math.round(rect.width * sx),
      h: Math.round(rect.height * sy),
    };
    crop.w = Math.min(crop.w, video.videoWidth - crop.x);
    crop.h = Math.min(crop.h, video.videoHeight - crop.y);
    if (crop.w < 8 || crop.h < 8) { say(strings.failed || ''); return; }

    // Big enough that a long page is not fifty waits, small enough that over half of every frame is
    // content the picture already has -- which is what the matcher needs to have anything to find.
    stepPx = Math.max(40, Math.round(rect.height * STEP_FRACTION));

    say(strings.scroll || '');
    await run();
  });

  btnDone.addEventListener('click', done);
  btnCancel.addEventListener('click', give_up);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') give_up();
    if (e.key === 'Enter') done();
  });
  window.addEventListener('beforeunload', stop);
})();
