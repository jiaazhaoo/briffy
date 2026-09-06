'use strict';
// Putting the words in the right mouth.
//
// Two things are known separately and have to be joined: Whisper says *what* was said and roughly when
// (chunk timestamps), and diarization says *who* was speaking when. Neither knows about the other, and
// their boundaries never line up -- Whisper chunks on sentences and pauses, diarization on voices.
//
// So each chunk of text is given to whichever speaker was talking for most of it. That is the whole
// idea, and it is deliberately simple: a chunk that straddles a handover is one sentence, and guessing
// where inside it the voice changed would be inventing detail nobody measured.
//
// Then consecutive chunks by the same person are merged into a turn, because "A: … A: … A: …" is not
// how anyone reads a conversation.
//
// Pure functions over plain objects: no models, no audio.

const MIN_OVERLAP = 0.2;      // a chunk overlapping a speaker by less than this in seconds is not theirs

/** How much two intervals share, in seconds. */
function overlap(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/**
 * @param {Array<{text:string, start:number, end:number}>} chunks from the transcriber, in order
 * @param {Array<{start:number, end:number, speaker:string}>} segments from diarization
 * @returns {Array<{speaker:string|null, start:number, end:number, text:string}>} turns, in order
 */
function attribute(chunks, segments) {
  const turns = [];
  for (const c of chunks || []) {
    const text = String(c && c.text || '').trim();
    if (!text) continue;
    const start = Number(c.start);
    const end = Number(c.end);
    // A chunk with no usable time cannot be placed; it keeps its text and no speaker rather than being
    // dropped, because losing words is worse than not knowing who said them.
    const timed = Number.isFinite(start) && Number.isFinite(end) && end > start;

    let speaker = null;
    if (timed) {
      const totals = new Map();
      for (const s of segments || []) {
        const shared = overlap(start, end, s.start, s.end);
        if (shared > 0) totals.set(s.speaker, (totals.get(s.speaker) || 0) + shared);
      }
      let best = 0;
      for (const [who, secs] of totals) if (secs > best) { best = secs; speaker = who; }
      if (best < MIN_OVERLAP) speaker = null;
    }

    const last = turns[turns.length - 1];
    if (last && last.speaker === speaker) {
      last.text = `${last.text} ${text}`.replace(/\s+/g, ' ').trim();
      if (timed) last.end = Math.max(last.end, end);
    } else {
      turns.push({ speaker, start: timed ? start : (last ? last.end : 0), end: timed ? end : (last ? last.end : 0), text });
    }
  }
  return turns;
}

/**
 * The turns as something a person reads, one line each.
 * @param {Array} turns from `attribute`
 * @param {(speakerId:string)=>string} nameOf what to call each speaker
 */
function asLines(turns, nameOf) {
  return (turns || []).map((t) => {
    const who = t.speaker ? nameOf(t.speaker) : '';
    return who ? `${who}: ${t.text}` : t.text;
  }).join('\n');
}

/** How long each speaker held the floor, most first -- for a summary line above the transcript. */
function shares(turns) {
  const secs = new Map();
  for (const t of turns || []) {
    if (!t.speaker) continue;
    secs.set(t.speaker, (secs.get(t.speaker) || 0) + Math.max(0, t.end - t.start));
  }
  return [...secs.entries()]
    .map(([speaker, seconds]) => ({ speaker, seconds: Math.round(seconds) }))
    .sort((a, b) => b.seconds - a.seconds);
}

module.exports = { attribute, asLines, shares, overlap, MIN_OVERLAP };
