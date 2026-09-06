// Runs in the page's own world at document_start, before any of the site's code.
//
// This is the only place a modern player's media URLs exist. With Media Source Extensions the <video>
// element carries a `blob:` URL and every real byte arrives through fetch() or XMLHttpRequest, so a DOM
// scan sees nothing and the network sniffer only sees whatever the CDN's Content-Type happens to admit
// to. Here we watch the three ways a URL can be requested and report the ones that look like media.
//
// It only observes: nothing is blocked, redirected or altered, no response body is read or buffered,
// and only the URL is passed on. Anything that does not look like media or a manifest is ignored, so
// this is not a log of the page's API traffic.
(() => {
  const TAG = 'briffy-hook';
  if (window.__briffyHook) return;
  window.__briffyHook = true;

  // What is worth reporting. Extensions first, then the shapes CDNs use when they serve a manifest
  // from a path with no extension at all.
  const MEDIA_RE = /\.(m3u8|m3u|mpd|mp4|m4v|webm|mov|mkv|ts|m4s|cmfv|cmfa|mp3|m4a|aac|flac|wav|ogg|opus)(\?|#|$)/i;
  const HINT_RE = /(manifest|playlist|master|chunklist|\/hls\/|\/dash\/|[?&]format=(m3u8|mpd)|mime=(video|audio)|videoplayback|\/media\/[^/]+\/stream)/i;
  const wanted = (u) => MEDIA_RE.test(u) || HINT_RE.test(u);

  const seen = new Set();
  function report(raw, how) {
    if (!raw || typeof raw !== 'string') return;
    let url;
    try { url = new URL(raw, document.baseURI).href; } catch (_) { return; }
    if (!/^https?:/i.test(url) || !wanted(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    if (seen.size > 1000) seen.clear();
    try { window.postMessage({ source: TAG, url, how }, '*'); } catch (_) { /* ignore */ }
  }

  // --- fetch ---
  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (input, init) {
      try { report(typeof input === 'string' ? input : (input && input.url), 'fetch'); } catch (_) { /* never break the page */ }
      return nativeFetch.apply(this, arguments);
    };
  }

  // --- XMLHttpRequest ---
  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { report(url, 'xhr'); } catch (_) { /* ignore */ }
    return nativeOpen.apply(this, arguments);
  };

  // --- MSE: tells us the page is streaming even when we never catch a manifest ---
  const nativeCreateObjectURL = URL.createObjectURL;
  if (typeof nativeCreateObjectURL === 'function' && typeof window.MediaSource === 'function') {
    URL.createObjectURL = function (obj) {
      const url = nativeCreateObjectURL.apply(this, arguments);
      try {
        if (obj instanceof window.MediaSource) window.postMessage({ source: TAG, mse: true, url: String(url), how: 'mse' }, '*');
      } catch (_) { /* ignore */ }
      return url;
    };
  }
})();
