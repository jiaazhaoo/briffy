'use strict';
// Turning a stream of "was that speech?" into recordings with a beginning and an end.
//
//   ····speech·····························silence····
//   ^pre-roll  ^start                      ^end (after a pause)
//
// Two things it has to get right, both of which are about time rather than sound.
//
// The detector cannot know somebody has started until they already have, so by the time the answer is
// "speech" the first syllable is behind us. The last second and a bit is therefore kept at all times
// and put in front of every recording. At 16 kHz mono that is 45 KB held in memory, which is nothing.
//
// And a pause is not the end. People stop mid-sentence to think, and cutting there would file half a
// thought and then the other half. So silence has to last several seconds before a recording is closed,
// and the trailing quiet is trimmed back off afterwards so the file does not end with a long nothing.
//
// A pure state machine over block flags: no audio API, no DOM, so it can be tested without a microphone.

const DEFAULTS = {
  rate: 16000,
  blockSize: 4096,          // ~0.26 s
  preRollMs: 1400,
  startBlocks: 2,           // ~0.5 s of speech before it believes you
  stopMs: 2600,             // this much quiet ends a recording
  minSegmentMs: 1500,       // shorter than this is a cough, not a thought
  maxSegmentMs: 5 * 60 * 1000,   // a long meeting becomes several recordings, not one huge one
  keepTailBlocks: 2,        // a moment of the closing quiet, so the last word does not end abruptly
};

function createSegmenter(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const perBlockMs = (o.blockSize / o.rate) * 1000;
  const preRollBlocks = Math.max(1, Math.ceil(o.preRollMs / perBlockMs));
  // The ring has to hold the lead-in *plus* the speech blocks that are consumed proving it is speech:
  // by the time the third one arrives the first two are already in the ring, and keeping only
  // `preRollBlocks` would quietly shorten the lead-in by exactly that much. Measured before this line
  // existed: 1024 ms of lead-in where 1400 was asked for.
  const ringBlocks = preRollBlocks + o.startBlocks;
  const stopBlocks = Math.max(1, Math.ceil(o.stopMs / perBlockMs));
  const minBlocks = Math.max(1, Math.ceil(o.minSegmentMs / perBlockMs));
  const maxBlocks = Math.max(minBlocks + 1, Math.ceil(o.maxSegmentMs / perBlockMs));

  let ring = [];
  let voicedRun = 0;
  let quietRun = 0;
  let segment = null;
  const out = [];

  function close(reason) {
    const seg = segment;
    segment = null;
    voicedRun = 0; quietRun = 0;
    if (!seg) return;
    // Drop most of the silence that ended it, keeping a beat of it.
    const drop = reason === 'pause' ? Math.max(0, stopBlocks - o.keepTailBlocks) : 0;
    const blocks = drop ? seg.blocks.slice(0, Math.max(1, seg.blocks.length - drop)) : seg.blocks;
    // The test is how much *speech* there was, not how long the file is. Measuring the whole segment
    // counted the lead-in and the closing pause as content, so a 600 ms cough came out as a two-and-a-
    // half second recording and was filed.
    if (seg.voicedBlocks < minBlocks) return;
    out.push({ blocks, peak: seg.peak, reason, ms: Math.round(blocks.length * perBlockMs), speechMs: Math.round(seg.voicedBlocks * perBlockMs) });
  }

  return {
    /** @param {{block:*, speech:boolean, peak?:number}} b */
    push({ block, speech, peak = 0 }) {
      if (segment) {
        segment.blocks.push(block);
        if (peak > segment.peak) segment.peak = peak;
        if (speech) segment.voicedBlocks++;
        quietRun = speech ? 0 : quietRun + 1;
        if (quietRun >= stopBlocks) { close('pause'); return; }
        if (segment.blocks.length >= maxBlocks) { close('length'); return; }
        return;
      }
      ring.push(block);
      if (ring.length > ringBlocks) ring.shift();
      if (!speech) { voicedRun = 0; return; }
      voicedRun++;
      if (voicedRun < o.startBlocks) return;
      // the blocks that proved it was speech count towards the minimum
      segment = { blocks: ring.slice(), peak, voicedBlocks: voicedRun, startedAt: Date.now() };
      ring = [];
      quietRun = 0;
    },
    /** Ends anything in progress -- listening was turned off, or the app is quitting. */
    flush() { close('stopped'); },
    /** Recordings ready to file, oldest first. Taking them clears the queue. */
    take() { const got = out.splice(0, out.length); return got; },
    get recording() { return !!segment; },
    get pending() { return out.length; },
    limits: { preRollBlocks, ringBlocks, stopBlocks, minBlocks, maxBlocks, perBlockMs },
  };
}

// One file, two homes: `require`d by the tests under node, loaded as a plain <script> by the page.
const API = { createSegmenter, DEFAULTS };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else if (typeof window !== 'undefined') window.segmenter = API;
