// End-to-end check of the streamed-video download (src/main/stream.js), against a real HLS stream this
// script generates and serves itself: `node dev/stream-test.js`. No Electron, no internet, no site.
//
// It builds a few seconds of video + audio, segments it the way a CDN would, serves it over localhost
// while REQUIRING a Referer (hotlink protection, which is what breaks naive downloaders), then downloads
// it back and checks the result is one playable file with both tracks intact.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');
const ffmpeg = require('../src/main/ffmpeg.js');
const stream = require('../src/main/stream.js');

const PAGE = 'https://example.invalid/watch?v=1';
let pass = 0; let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}
const run = (file, args) => new Promise((res, rej) => execFile(file, args, { maxBuffer: 8e6 }, (e, so, se) => (e ? rej(new Error(se || e.message)) : res(so + se))));

(async () => {
  const bin = await ffmpeg.find();
  if (!bin) { console.log('ffmpeg not installed — nothing to test. Install it and re-run.'); process.exit(0); }
  console.log(`ffmpeg ${bin.version} at ${bin.ffmpeg}\n`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-hls-'));
  try {
    console.log('build a real HLS stream (5s, video + a separate audio track)');
    await run(bin.ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=15:duration=5',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
      '-g', '15', '-keyint_min', '15', '-sc_threshold', '0',   // a keyframe every second, or it will not segment
      '-hls_time', '1', '-hls_playlist_type', 'vod',
      '-hls_segment_filename', path.join(dir, 'seg%03d.ts'), path.join(dir, 'index.m3u8'),
    ]);
    const segs = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
    check('the fixture really is segmented', segs.length >= 4, `${segs.length} segments`);

    // A CDN that 403s anything without a Referer — the case that makes downloads fail in practice.
    let refererSeen = 0; let served = 0;
    const server = http.createServer((req, res) => {
      if ((req.headers.referer || '') !== PAGE) { res.writeHead(403); res.end('no referer'); return; }
      refererSeen++;
      const f = path.join(dir, path.basename(req.url.split('?')[0]));
      if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
      served++;
      res.writeHead(200, { 'Content-Type': f.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t' });
      fs.createReadStream(f).pipe(res);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;

    console.log('download it back through stream.download()');
    const out = path.join(dir, 'out.mp4');
    let lastPercent = -1; let sawProgress = false;
    await stream.download(`${base}/index.m3u8`, out, {
      pageUrl: PAGE,
      onProgress: (p) => { sawProgress = true; if (p.percent !== lastPercent) lastPercent = p.percent; },
    });
    check('the Referer was actually sent', refererSeen > 0, `${refererSeen} requests carried it`);
    check('every segment was fetched', served >= segs.length, `${served} responses`);
    check('progress was reported', sawProgress, `last ${lastPercent}%`);
    check('an output file exists', fs.existsSync(out) && fs.statSync(out).size > 20000, fs.existsSync(out) ? `${fs.statSync(out).size} bytes` : 'missing');

    console.log('the result has to be one playable file, not a pile of segments');
    const info = await stream.probe(out);
    check('probe reads it back', !!info, JSON.stringify(info));
    check('video track survived', !!info && info.videoCodec === 'h264', info && info.videoCodec);
    check('audio track survived (this is the muxing)', !!info && info.audioCodec === 'aac', info && info.audioCodec);
    check('duration is about right', !!info && Math.abs(info.duration - 5) < 1.5, info && `${info.duration}s`);
    check('resolution preserved', !!info && info.width === 320 && info.height === 240, info && `${info.width}x${info.height}`);

    console.log('failure modes report the reason, not just "it failed"');
    let msg = '';
    try {
      await stream.download(`${base}/index.m3u8`, path.join(dir, 'nope.mp4'), { pageUrl: 'https://wrong.invalid/' });
    } catch (e) { msg = e.message; }
    check('a 403 from the CDN surfaces', /403|Forbidden|Server returned|Invalid data|error/i.test(msg), msg.slice(0, 90));

    server.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.stack || e.message); process.exit(1); });
