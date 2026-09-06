'use strict';
// Deciding whether anyone is talking, on the audio thread.
//
// It runs in a worklet so the interface never waits for it, and it works on 16 kHz mono, which is all
// Whisper wants and half the work of 48 kHz. Measured: the microphone's own echo/noise/gain processing
// costs 4.5 % of a core on its own, and this detector 1.4 % on top; with that processing turned off and
// the rate dropped, the pair costs 2.6 %. That is the difference between a feature that can be left on
// and one that cannot.
//
// "Loud enough" is relative. A fixed threshold either misses a quiet room or fires all day in a noisy
// one, so the quiet of *this* room is tracked and speech is what rises clearly above it. The floor
// falls quickly and rises slowly: a lull should be believed at once, a burst of noise should not.
class Vad extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.blockSize = o.blockSize || 4096;      // ~0.26 s at 16 kHz, one message per block
    this.overFloor = o.overFloor || 3.2;       // speech is this many times the room's quiet
    this.absolute = o.absolute || 0.006;       // and never below this, so silence cannot trigger
    this.buf = new Float32Array(this.blockSize);
    this.at = 0;
    this.floor = 0.02;
    this.voiced = 0;
    this.quanta = 0;
    this.peak = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;

    let sum = 0;
    let p = 0;
    for (let i = 0; i < ch.length; i++) { const v = ch[i]; sum += v * v; const a = v < 0 ? -v : v; if (a > p) p = a; }
    const rms = Math.sqrt(sum / ch.length);
    if (p > this.peak) this.peak = p;

    // down fast, up slow
    this.floor = rms < this.floor
      ? (this.floor * 0.98) + (rms * 0.02)
      : (this.floor * 0.9995) + (rms * 0.0005);

    this.quanta++;
    if (rms > Math.max(this.floor * this.overFloor, this.absolute)) this.voiced++;

    for (let i = 0; i < ch.length; i++) {
      this.buf[this.at++] = ch[i];
      if (this.at === this.blockSize) {
        const out = this.buf;
        this.buf = new Float32Array(this.blockSize);
        this.at = 0;
        // A block counts as speech when most of it was: one loud quantum is a door, not a voice.
        const speech = this.voiced / Math.max(1, this.quanta) > 0.35;
        this.port.postMessage({ pcm: out, speech, rms, floor: this.floor, peak: this.peak }, [out.buffer]);
        this.voiced = 0; this.quanta = 0; this.peak = 0;
      }
    }
    return true;
  }
}
registerProcessor('vad', Vad);
