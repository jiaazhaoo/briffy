'use strict';
// Joining what was said to who said it.
//
//   node dev/attribute-test.js
//
// Both inputs are made up, so every answer is known. The cases worth having are the awkward ones: a
// sentence that straddles a handover, a chunk the transcriber gave no time to, and a stretch nobody was
// diarized as speaking.
const assert = require('assert');
const { attribute, asLines, shares, overlap } = require('../src/main/attribute');

let pass = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; } };

const chunk = (text, start, end) => ({ text, start, end });
const seg = (start, end, speaker) => ({ start, end, speaker });

// ---------- the ordinary case ----------
ok('two people taking turns come out as two turns', () => {
  const turns = attribute(
    [chunk('hello there', 0, 3), chunk('how are you', 3, 6), chunk('very well thanks', 7, 10)],
    [seg(0, 6.5, 'A'), seg(6.8, 11, 'B')],
  );
  assert.strictEqual(turns.length, 2, `${turns.length} turns`);
  assert.deepStrictEqual(turns.map((t) => t.speaker), ['A', 'B']);
  assert.strictEqual(turns[0].text, 'hello there how are you');
  assert.strictEqual(turns[1].text, 'very well thanks');
});

ok('the same person twice in a row is one turn, not two', () => {
  const turns = attribute(
    [chunk('one', 0, 2), chunk('two', 2, 4), chunk('three', 4, 6)],
    [seg(0, 7, 'A')],
  );
  assert.strictEqual(turns.length, 1);
  assert.strictEqual(turns[0].text, 'one two three');
  assert.strictEqual(turns[0].end, 6);
});

// ---------- the awkward ones ----------
ok('a sentence straddling a handover goes to whoever said most of it', () => {
  // 0–4 is A's, 4–10 is B's; the chunk runs 3–9, so B has 5 s of it and A has 1
  const turns = attribute([chunk('a long sentence', 3, 9)], [seg(0, 4, 'A'), seg(4, 10, 'B')]);
  assert.strictEqual(turns[0].speaker, 'B', `went to ${turns[0].speaker}`);
});

ok('and the other way round', () => {
  const turns = attribute([chunk('a long sentence', 1, 5)], [seg(0, 4, 'A'), seg(4, 10, 'B')]);
  assert.strictEqual(turns[0].speaker, 'A', `went to ${turns[0].speaker}`);
});

ok('a chunk nobody was speaking over keeps its words and no name', () => {
  const turns = attribute([chunk('who said that', 20, 22)], [seg(0, 5, 'A')]);
  assert.strictEqual(turns.length, 1, 'the words were dropped');
  assert.strictEqual(turns[0].speaker, null);
  assert.strictEqual(turns[0].text, 'who said that');
});

ok('a chunk that barely grazes a speaker is not theirs', () => {
  // 0.1 s of overlap, below the floor
  const turns = attribute([chunk('hmm', 4.9, 7)], [seg(0, 5, 'A')]);
  assert.strictEqual(turns[0].speaker, null, `claimed by ${turns[0].speaker}`);
});

ok('a chunk with no timing keeps its words', () => {
  const turns = attribute([chunk('untimed', undefined, undefined)], [seg(0, 5, 'A')]);
  assert.strictEqual(turns.length, 1);
  assert.strictEqual(turns[0].text, 'untimed');
  assert.strictEqual(turns[0].speaker, null);
});

ok('empty text is dropped, empty everything is safe', () => {
  assert.strictEqual(attribute([chunk('   ', 0, 1)], [seg(0, 5, 'A')]).length, 0);
  assert.deepStrictEqual(attribute([], []), []);
  assert.deepStrictEqual(attribute(null, null), []);
});

ok('with no diarization at all the words still come through, unattributed', () => {
  const turns = attribute([chunk('one', 0, 2), chunk('two', 2, 4)], []);
  assert.strictEqual(turns.length, 1);
  assert.strictEqual(turns[0].speaker, null);
  assert.strictEqual(turns[0].text, 'one two');
});

// ---------- reading it back ----------
ok('it reads as a conversation', () => {
  const turns = attribute(
    [chunk('are we ready', 0, 2), chunk('yes go ahead', 3, 5)],
    [seg(0, 2.5, 'p1'), seg(2.8, 6, 'p2')],
  );
  const names = { p1: '张三', p2: '李四' };
  assert.strictEqual(asLines(turns, (id) => names[id]), '张三: are we ready\n李四: yes go ahead');
});

ok('an unnamed speaker is not labelled with an empty name', () => {
  const turns = attribute([chunk('hello', 0, 2)], [seg(0, 3, 'p1')]);
  assert.strictEqual(asLines(turns, () => ''), 'hello');
});

ok('who held the floor, longest first', () => {
  const turns = attribute(
    [chunk('a', 0, 6), chunk('b', 7, 9)],
    [seg(0, 6.5, 'A'), seg(6.8, 10, 'B')],
  );
  assert.deepStrictEqual(shares(turns), [{ speaker: 'A', seconds: 6 }, { speaker: 'B', seconds: 2 }]);
});

// ---------- the arithmetic underneath ----------
ok('overlap is the shared part, never negative', () => {
  assert.strictEqual(overlap(0, 10, 5, 15), 5);
  assert.strictEqual(overlap(0, 5, 5, 10), 0);
  assert.strictEqual(overlap(0, 5, 6, 10), 0);
  assert.strictEqual(overlap(2, 4, 0, 10), 2);
});

console.log(`attribute: ${pass} checks passed`);
