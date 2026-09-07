'use strict';
// Telling voices apart, on real recordings of real people.
//
//   npx electron dev/diarize-test.js
//
// The clips are the ones the sherpa-onnx project publishes with the models, so the right answer is
// known: one has four people speaking Chinese, one has two speaking English. Downloaded on first run
// into a throwaway userData, along with the models.
//
// The check that matters most is the second half: that the same voice heard in two different
// recordings comes back as the same person. Diarization alone cannot do that -- its labels are local to
// one file -- and without it "Speaker 1" would mean somebody different every time.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app } = require('electron');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-diarize-'));
app.setPath('userData', TMP);

const CLIPS = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models';
const SAMPLES = [
  { file: '0-four-speakers-zh.wav', people: 4, what: 'four people, Chinese' },
  { file: '1-two-speakers-en.wav', people: 2, what: 'two people, English' },
];

let pass = 0; let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}${detail ? `  ${detail}` : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

async function fetchTo(url, to) {
  if (fs.existsSync(to)) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, Buffer.from(await res.arrayBuffer()));
}

app.whenReady().then(async () => {
  const { Store } = require('../src/main/store');
  const workspace = require('../src/main/workspace');
  const diarize = require('../src/main/diarize');
  const { attribute, asLines } = require('../src/main/attribute');

  const store = new Store();
  store.init();
  diarize.init({ store });

  // Clips live outside the throwaway userData so a second run does not download them again.
  const clipDir = path.join(os.tmpdir(), 'briffy-diarize-clips');
  for (const s of SAMPLES) await fetchTo(`${CLIPS}/${s.file}`, path.join(clipDir, s.file));
  check('the test recordings are here', SAMPLES.every((s) => fs.existsSync(path.join(clipDir, s.file))), '');

  const t0 = Date.now();
  let shown = '';
  const got = await diarize.ensureModels((p) => {
    const line = `part ${p.part}/${p.parts} ${Math.floor(p.percent / 25) * 25}%`;
    if (p.stage === 'download' && line !== shown) { shown = line; process.stdout.write(`\r  fetching models… ${line}   `); }
  });
  process.stdout.write('\r' + ' '.repeat(60) + '\r');
  check('the models are ready', got === true && diarize.ready(), `${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!got) { console.log(`\n${pass} passed, ${fail + 1} failed`); process.exit(1); }

  // ---------- within one recording ----------
  const heard = {};
  for (const s of SAMPLES) {
    const pcm = workspace.readWav(path.join(clipDir, s.file));
    const secs = pcm.length / 16000;
    const t = Date.now();
    const out = await diarize.run(pcm);
    const ms = Date.now() - t;
    check(`${s.what}: it hears the right number of people`, out && out.speakers.length === s.people,
      out ? `${out.speakers.length} of ${s.people}, ${secs.toFixed(0)}s in ${(ms / 1000).toFixed(1)}s (${(ms / 1000 / secs).toFixed(2)}x real time)` : 'nothing came back');
    check(`${s.what}: it is fast enough to run beside the transcription`, ms / 1000 < secs * 0.4, `${(ms / 1000 / secs).toFixed(2)}x real time`);
    if (out) {
      check(`${s.what}: every stretch belongs to somebody it heard`,
        out.segments.every((x) => out.speakers.some((p) => p.id === x.speaker)), '');
      check(`${s.what}: the stretches are in order and do not run backwards`,
        out.segments.every((x, i) => x.end > x.start && (i === 0 || x.start >= out.segments[i - 1].start)), '');
      // Two voices in one recording must be two people, not one heard twice. Full ids, not the first
      // few characters -- ids made in the same millisecond share a prefix, which once made a passing
      // test look like a failure.
      check(`${s.what}: the voices are distinct people`,
        new Set(out.speakers.map((p) => p.id)).size === out.speakers.length,
        out.speakers.map((p) => p.id).join(', '));
      heard[s.file] = out;
    }
  }

  const first = heard[SAMPLES[1].file];
  // 跨录音认人、给声音起名字那一半在 2026-09-06 删了（「不同会议有不同的人」），
  // 所以这里也不再有相应的检查。剩下的就是这套东西真正在做的事：
  // 在**一段**录音里把人分开，按说得多少编号。
  const again = await diarize.run(workspace.readWav(path.join(clipDir, SAMPLES[1].file)));
  check('同一段录音跑两遍，人数一样', again && again.speakers.length === SAMPLES[1].people,
    again ? `${again.speakers.length} of ${SAMPLES[1].people}` : 'nothing came back');
  check('编号就是 s1 s2 s3，按说得多少排', again
    && again.speakers.every((p, i) => p.id === `s${i + 1}`)
    && again.speakers.every((p, i) => i === 0 || p.seconds <= again.speakers[i - 1].seconds),
    again ? again.speakers.map((p) => `${p.id}:${p.seconds}s`).join(' ') : '');
  check('不再往工作区里写 speakers.json', !fs.existsSync(path.join(store.paths().workspace, 'speakers.json')), '');

  // ---------- the words, joined to the voices ----------
  if (first) {
    const fake = [
      { text: 'hello there', start: first.segments[0].start + 0.2, end: first.segments[0].end - 0.2 },
      { text: 'and hello to you', start: first.segments[first.segments.length - 1].start + 0.2, end: first.segments[first.segments.length - 1].end - 0.2 },
    ];
    const turns = attribute(fake, first.segments);
    check('words land on the voice that was speaking', turns.every((x) => x.speaker), JSON.stringify(turns.map((x) => x.speaker && x.speaker.slice(0, 6))));
    const line = asLines(turns, (id) => `说话人 ${id.slice(1)}`);
    check('and read back as a conversation', line.includes(':'), line.slice(0, 60));
  }

  diarize.release();
  console.log(`\n${pass} passed, ${fail} failed`);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* leave it */ }
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('TEST_ERROR', e && e.stack || e); process.exit(1); });
