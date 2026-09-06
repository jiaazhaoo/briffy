'use strict';
// Where a recording starts and where it stops, on made-up speech.
//
//   node dev/segmenter-test.js
//
// No microphone and no audio: the detector's answer for each block is simply written down, so every
// boundary is known in advance and can be checked rather than listened to. The cases that matter are
// the human ones -- somebody pausing mid-sentence, somebody clearing their throat, a meeting that runs
// past the length any one recording should be.
const assert = require('assert');
const { createSegmenter, DEFAULTS } = require('../src/renderer/listen/segmenter');

let pass = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; } };

const perBlockMs = (DEFAULTS.blockSize / DEFAULTS.rate) * 1000;   // ~256 ms
const blocks = (ms) => Math.round(ms / perBlockMs);

/** Feeds a pattern of speech/silence; each block is numbered so the output can be traced back. */
function run(pattern, opts) {
  const seg = createSegmenter(opts);
  let n = 0;
  for (const speech of pattern) seg.push({ block: n++, speech, peak: speech ? 0.4 : 0.01 });
  seg.flush();
  return seg.take();
}
const speech = (ms) => new Array(blocks(ms)).fill(true);
const quiet = (ms) => new Array(blocks(ms)).fill(false);

// ---------- the ordinary case ----------
ok('somebody talks, stops, and it is filed once', () => {
  const got = run([...quiet(3000), ...speech(6000), ...quiet(6000)]);
  assert.strictEqual(got.length, 1, `${got.length} recordings`);
  assert.strictEqual(got[0].reason, 'pause');
});

ok('the recording starts before the first word', () => {
  const lead = blocks(3000);
  const got = run([...quiet(3000), ...speech(6000), ...quiet(6000)]);
  const first = got[0].blocks[0];
  // speech begins at block `lead`; the pre-roll must reach back before it
  assert.ok(first < lead, `began at block ${first}, speech began at ${lead}`);
  const reachedBack = (lead - first) * perBlockMs;
  assert.ok(reachedBack >= DEFAULTS.preRollMs - perBlockMs,
    `only reached back ${Math.round(reachedBack)} ms of the ${DEFAULTS.preRollMs} ms it should`);
});

ok('and does not keep the whole silence that ended it', () => {
  const got = run([...quiet(3000), ...speech(6000), ...quiet(9000)]);
  const trailing = got[0].blocks.length - blocks(3000 + 6000 - (DEFAULTS.preRollMs / 1000) * 1000 / 1000);
  assert.ok(got[0].ms < 6000 + DEFAULTS.preRollMs + DEFAULTS.stopMs,
    `kept ${got[0].ms} ms for 6 s of speech`);
  assert.ok(got[0].ms > 6000, `kept only ${got[0].ms} ms of 6 s of speech`);
});

// ---------- the human ones ----------
ok('a pause for thought does not split a sentence in two', () => {
  // 1.5 s of quiet in the middle -- less than the 2.6 s that ends a recording
  const got = run([...quiet(2000), ...speech(4000), ...quiet(1500), ...speech(4000), ...quiet(6000)]);
  assert.strictEqual(got.length, 1, `split into ${got.length}`);
});

ok('a real gap does split them', () => {
  const got = run([...quiet(2000), ...speech(4000), ...quiet(6000), ...speech(4000), ...quiet(6000)]);
  assert.strictEqual(got.length, 2, `${got.length} recordings, expected 2`);
});

ok('a cough is not a recording', () => {
  const got = run([...quiet(3000), ...speech(600), ...quiet(6000)]);
  assert.strictEqual(got.length, 0, `filed ${got.length}`);
});

ok('one loud block on its own is not either', () => {
  const got = run([...quiet(3000), true, ...quiet(6000)]);
  assert.strictEqual(got.length, 0, `filed ${got.length}`);
});

ok('a long meeting becomes several recordings, not one huge one', () => {
  const got = run([...quiet(1000), ...speech(70000), ...quiet(6000)], { maxSegmentMs: 20000 });
  assert.ok(got.length >= 3, `${got.length} recordings for 70 s capped at 20 s`);
  assert.ok(got.slice(0, -1).every((g) => g.reason === 'length'), 'the early ones should close on length');
  assert.ok(got.every((g) => g.ms <= 21000), `one ran to ${Math.max(...got.map((g) => g.ms))} ms`);
});

ok('nothing but silence files nothing', () => {
  assert.strictEqual(run(quiet(30000)).length, 0);
});

ok('speech still running when listening stops is still kept', () => {
  const seg = createSegmenter();
  let n = 0;
  for (const s of [...quiet(2000), ...speech(6000)]) seg.push({ block: n++, speech: s, peak: 0.4 });
  assert.ok(seg.recording, 'should be mid-recording');
  seg.flush();
  const got = seg.take();
  assert.strictEqual(got.length, 1, 'the recording in progress was thrown away');
  assert.strictEqual(got[0].reason, 'stopped');
});

// ---------- housekeeping ----------
ok('taking the recordings clears the queue', () => {
  const seg = createSegmenter();
  let n = 0;
  for (const s of [...quiet(2000), ...speech(5000), ...quiet(6000)]) seg.push({ block: n++, speech: s, peak: 0.4 });
  assert.strictEqual(seg.take().length, 1);
  assert.strictEqual(seg.take().length, 0, 'the same recording came back twice');
});

ok('memory does not grow while nothing is happening', () => {
  const seg = createSegmenter();
  for (let i = 0; i < 5000; i++) seg.push({ block: i, speech: false });
  assert.strictEqual(seg.pending, 0);
  // the pre-roll ring is the only thing held, and it is bounded
  assert.ok(seg.limits.preRollBlocks < 20, `pre-roll holds ${seg.limits.preRollBlocks} blocks`);
});

ok('the peak of a recording is the loudest block in it', () => {
  const seg = createSegmenter();
  let n = 0;
  for (const s of quiet(2000)) seg.push({ block: n++, speech: s, peak: 0.01 });
  for (const s of speech(5000)) seg.push({ block: n++, speech: s, peak: 0.2 });
  seg.push({ block: n++, speech: true, peak: 0.9 });
  for (const s of quiet(6000)) seg.push({ block: n++, speech: s, peak: 0.01 });
  assert.strictEqual(seg.take()[0].peak, 0.9);
});

console.log(`segmenter: ${pass} checks passed`);
