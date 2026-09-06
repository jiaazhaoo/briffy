// Deciding what a URL is. Lives on its own because it is the part that decides whether a video is
// found at all, and `node dev/media-detect-test.js` pins it against the shapes real CDNs use.
// Loaded by background.js through importScripts(), and by the test through require().
function header(headers, name) {
  const h = (headers || []).find((x) => x.name.toLowerCase() === name);
  return h ? String(h.value || '') : '';
}
// A manifest is recognised by its URL, not by what the CDN claims it is: plenty of them arrive as
// text/plain or application/octet-stream, and plenty have no extension at all.
const HLS_RE = /\.(m3u8|m3u)(\?|#|$)|[?&]format=m3u8|\/master\.txt(\?|$)/i;
const DASH_RE = /\.mpd(\?|#|$)|[?&]format=mpd/i;
const MANIFEST_HINT_RE = /(manifest|playlist|chunklist|\/hls\/|\/dash\/)/i;
const SEGMENT_RE = /\.(ts|m4s|cmfv|cmfa)(\?|#|$)|\/seg(ment)?[-_]?\d+/i;
const VAGUE_CT = new Set(['', 'text/plain', 'application/octet-stream', 'binary/octet-stream']);

// Everything that can be told from the URL alone. Used for the page-hook findings, which arrive with no
// headers at all, and as the floor for the sniffer when the Content-Type says nothing useful.
function classifyUrl(url) {
  const path = url.split(/[?#]/)[0].toLowerCase();
  const ext = (path.match(/\.([a-z0-9]{2,5})$/) || [])[1] || '';
  if (HLS_RE.test(url)) return { kind: 'stream', mime: 'application/vnd.apple.mpegurl', format: 'hls' };
  if (DASH_RE.test(url)) return { kind: 'stream', mime: 'application/dash+xml', format: 'dash' };
  if (SEGMENT_RE.test(url)) return { kind: 'segment' };
  if (['mp4', 'webm', 'mov', 'mkv', 'm4v'].includes(ext)) return { kind: 'video', mime: `video/${ext === 'mov' ? 'quicktime' : ext}` };
  if (['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'opus'].includes(ext)) return { kind: 'audio', mime: 'audio/mpeg' };
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp'].includes(ext)) return { kind: 'image', mime: `image/${ext === 'jpg' ? 'jpeg' : ext}` };
  return null;
}

function classify(url, headers) {
  const ct = header(headers, 'content-type').split(';')[0].trim().toLowerCase();
  const len = Number(header(headers, 'content-length')) || 0;
  const ext = (url.split(/[?#]/)[0].toLowerCase().match(/\.([a-z0-9]{2,5})$/) || [])[1] || '';
  const byUrl = classifyUrl(url);

  if (ct === 'application/vnd.apple.mpegurl' || ct === 'application/x-mpegurl') return { kind: 'stream', mime: 'application/vnd.apple.mpegurl', format: 'hls', size: len };
  if (ct === 'application/dash+xml') return { kind: 'stream', mime: 'application/dash+xml', format: 'dash', size: len };
  if (byUrl && byUrl.kind === 'stream') return { ...byUrl, size: len };
  // No extension and a shrug of a Content-Type, but the path reads like a manifest. Small bodies only,
  // so a video served as octet-stream is not mistaken for a playlist.
  if (VAGUE_CT.has(ct) && MANIFEST_HINT_RE.test(url) && !SEGMENT_RE.test(url) && (!len || len < 512 * 1024)) {
    return { kind: 'stream', mime: 'application/vnd.apple.mpegurl', format: 'hls', size: len, guessed: true };
  }
  // Segments are never offered on their own -- the playlist is what anyone wants -- but they are
  // counted, because a page whose only trace is 300 .ts requests is still a page with a video on it.
  if (byUrl && byUrl.kind === 'segment') return { kind: 'segment', size: len };
  if (ct.startsWith('video/') || (byUrl && byUrl.kind === 'video')) {
    return { kind: 'video', mime: ct.startsWith('video/') ? ct : (byUrl && byUrl.mime) || 'video/mp4', size: len };
  }
  if (ct.startsWith('audio/') || (byUrl && byUrl.kind === 'audio')) return { kind: 'audio', mime: ct.startsWith('audio/') ? ct : 'audio/mpeg', size: len };
  if (ct.startsWith('image/') || (byUrl && byUrl.kind === 'image')) {
    if (ct === 'image/svg+xml' || ext === 'svg' || ct === 'image/x-icon' || ext === 'ico') return null;
    if (len && len < 4096) return null; // tracking pixels, tiny icons
    return { kind: 'image', mime: ct.startsWith('image/') ? ct : `image/${ext === 'jpg' ? 'jpeg' : ext}`, size: len };
  }
  return null;
}


// ---------- naming ----------
// A name a person can read. The sniffer and the page hook only ever have a URL, so most items used to
// come through as media-17; AixDownloader-style tools take the URL's own file name when there is one
// and fall back to the page's title for the main video, which is what anyone would have called it.
function baseName(url) {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
    return /\.[a-z0-9]{2,5}$/i.test(last) && last.length <= 80 ? last : '';
  } catch (_) { return ''; }
}
// "…《劫机七小时》_哔哩哔哩_bilibili" -> "…《劫机七小时》": drop the trailing site name, however
// many times it was appended, but only when it really is this site's name.
const SITE_WORDS = ['bilibili', '哔哩哔哩', 'youtube', 'youku', '优酷', '腾讯视频', '爱奇艺', 'iqiyi', '西瓜视频', '抖音', 'douyin', 'weibo', '微博', 'vimeo', 'twitter', 'facebook', 'instagram', '知乎', 'zhihu'];
function cleanTitle(title, pageUrl) {
  let out = String(title || '').trim();
  let brand = '';
  try { brand = new URL(pageUrl || '').hostname.replace(/^www\./, '').split('.')[0].toLowerCase(); } catch (_) { /* ignore */ }
  for (let i = 0; i < 4; i++) {
    const m = out.match(/^(.*\S)\s*[_|\-–—·]\s*([^_|\-–—·]{1,24})$/);
    if (!m) break;
    const tail = m[2].toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
    if (!tail) break;
    // Exact-ish only: 'hub' must not be read as the site name of github.com and chopped off a title.
    const isSite = SITE_WORDS.includes(tail)
      || (brand && brand.length > 2 && (tail === brand || tail.startsWith(brand) || brand.startsWith(tail)));
    if (!isSite) break;
    out = m[1].trim();
  }
  return out;
}

// eslint-disable-next-line no-undef
if (typeof module !== 'undefined' && module.exports) module.exports = { classify, classifyUrl, header, baseName, cleanTitle, SITE_WORDS };
