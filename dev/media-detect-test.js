// What the browser extension will and will not recognise as media (extension/classify.js).
// `node dev/media-detect-test.js` -- no browser, no network. The URL shapes below are the ones that
// used to slip through: manifests served as text/plain, manifests with no extension, segments that
// must be counted rather than listed, and tracking pixels that must not be offered as images.
const { classify, classifyUrl, baseName, cleanTitle } = require('../extension/classify.js');

let pass = 0; let fail = 0;
const ct = (type, len) => [{ name: 'content-type', value: type }].concat(len ? [{ name: 'content-length', value: String(len) }] : []);

function check(name, got, want) {
  const ok = got === want;
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} — got ${got}, want ${want}`); }
}
const kindOf = (url, headers) => { const c = classify(url, headers || []); return c ? c.kind : 'none'; };

console.log('manifests the old Content-Type test missed');
check('m3u8 as text/plain', kindOf('https://cdn.x.com/v/master.m3u8', ct('text/plain')), 'stream');
check('m3u8 as octet-stream', kindOf('https://cdn.x.com/v/index.m3u8', ct('application/octet-stream')), 'stream');
check('m3u8 with a query string', kindOf('https://cdn.x.com/v/play.m3u8?token=abc&e=123', ct('text/plain')), 'stream');
check('format=m3u8, no extension', kindOf('https://cdn.x.com/api/v/stream?id=9&format=m3u8', ct('text/plain')), 'stream');
check('extensionless /manifest path', kindOf('https://cdn.x.com/media/9/manifest', ct('', 0)), 'stream');
check('chunklist', kindOf('https://cdn.x.com/hls/chunklist_w12.m3u8', ct('application/vnd.apple.mpegurl')), 'stream');
check('dash mpd', kindOf('https://cdn.x.com/v/manifest.mpd', ct('application/dash+xml')), 'stream');
check('dash by extension only', kindOf('https://cdn.x.com/v/out.mpd', ct('text/plain')), 'stream');
check('proper HLS content-type wins', kindOf('https://cdn.x.com/weird/path', ct('application/x-mpegurl')), 'stream');

console.log('segments: counted, never listed on their own');
check('.ts segment', kindOf('https://cdn.x.com/hls/seg-0001.ts', ct('video/mp2t')), 'segment');
check('.m4s segment', kindOf('https://cdn.x.com/dash/chunk_1.m4s', ct('video/iso.segment')), 'segment');
check('numbered segment, no extension', kindOf('https://cdn.x.com/v/segment_42', ct('application/octet-stream')), 'segment');
check('a manifest is not a segment', kindOf('https://cdn.x.com/hls/segment/master.m3u8', ct('text/plain')), 'stream');

console.log('plain files still work');
check('mp4', kindOf('https://cdn.x.com/v/clip.mp4', ct('video/mp4', 9e6)), 'video');
check('mp4 mislabelled as octet-stream', kindOf('https://cdn.x.com/v/clip.mp4', ct('application/octet-stream', 9e6)), 'video');
check('webm', kindOf('https://cdn.x.com/v/clip.webm', ct('video/webm')), 'video');
check('mp3', kindOf('https://cdn.x.com/a/song.mp3', ct('audio/mpeg')), 'audio');
check('jpeg', kindOf('https://cdn.x.com/i/photo.jpg', ct('image/jpeg', 90000)), 'image');

console.log('things that must NOT be offered');
check('tracking pixel', kindOf('https://t.x.com/p.gif', ct('image/gif', 43)), 'none');
check('svg icon', kindOf('https://cdn.x.com/i/logo.svg', ct('image/svg+xml')), 'none');
check('favicon', kindOf('https://x.com/favicon.ico', ct('image/x-icon')), 'none');
check('json api', kindOf('https://x.com/api/user?id=1', ct('application/json')), 'none');
check('html page', kindOf('https://x.com/watch?v=1', ct('text/html')), 'none');
check('js bundle', kindOf('https://cdn.x.com/app.js', ct('application/javascript')), 'none');
// a big octet-stream on a "playlist"-ish path is a file, not a manifest
check('large body is not a manifest', kindOf('https://cdn.x.com/playlist/big.bin', ct('application/octet-stream', 80e6)), 'none');

console.log('classifyUrl alone (what the page hook has to work with — no headers at all)');
const uk = (u) => { const c = classifyUrl(u); return c ? c.kind : 'none'; };
check('hook sees m3u8', uk('https://cdn.x.com/v/master.m3u8?t=1'), 'stream');
check('hook sees mpd', uk('https://cdn.x.com/v/f.mpd'), 'stream');
check('hook sees mp4', uk('https://cdn.x.com/v/a.mp4'), 'video');
check('hook sees segment', uk('https://cdn.x.com/v/seg-9.ts'), 'segment');
check('hook ignores an api call', uk('https://x.com/graphql'), 'none');

console.log('naming: what the panel calls each item');
// The sniffer and the page hook only have a URL. Where it carries a real file name, use it; where it
// does not, the page's own title is what a person would have called the video (this is the case that
// used to show up as "media-120").
check('segment keeps its own name', baseName('https://cdn.b.com/up/41022194144-1-30280.m4s?e=1'), '41022194144-1-30280.m4s');
check('no file name in the path', baseName('https://cdn.b.com/api/play?id=9'), '');
check('directory URL has no name', baseName('https://cdn.b.com/hls/720p/'), '');
check('a whole path is not a name', baseName('https://cdn.b.com/' + 'a'.repeat(120) + '.mp4'), '');

const ct2 = (t, u) => cleanTitle(t, u);
check('bilibili double suffix',
  ct2('环环相扣《劫机七小时》_哔哩哔哩_bilibili', 'https://www.bilibili.com/video/BV1x'), '环环相扣《劫机七小时》');
check('youtube suffix', ct2('Never Gonna Give You Up - YouTube', 'https://www.youtube.com/watch?v=1'), 'Never Gonna Give You Up');
check('cn video site suffix', ct2('某新闻标题 - 腾讯视频', 'https://v.qq.com/x/page/a.html'), '某新闻标题');
// the dangerous half: a title must not be chopped because it happens to end in something site-like
check('github does not eat "hub"', ct2('fix: bug in hub', 'https://github.com/a/b'), 'fix: bug in hub');
check('a real episode suffix survives', ct2('电影解说 - 第一集', 'https://www.bilibili.com/video/BV1x'), '电影解说 - 第一集');
check('plain title untouched', ct2('纯标题没有后缀', 'https://x.com/a'), '纯标题没有后缀');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
