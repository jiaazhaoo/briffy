// Runs inside the page (all frames): collects every image / video / audio the DOM references.
// Injected by popup.js through chrome.scripting.executeScript; must be self-contained.
(() => {
  const out = new Map();
  const abs = (u) => { try { return new URL(u, document.baseURI).href; } catch (_) { return ''; } };
  const add = (url, item) => {
    if (!url || url.startsWith('javascript:')) return;
    if (url.startsWith('data:') && url.length < 4096) return; // inline icons
    const key = url.split('#')[0];
    if (!out.has(key)) out.set(key, { url: key, ...item });
    else { const cur = out.get(key); if ((item.width || 0) * (item.height || 0) > (cur.width || 0) * (cur.height || 0)) Object.assign(cur, item); }
  };
  // querySelectorAll stops at a shadow boundary, and a lot of players are custom elements whose <video>
  // lives inside one. Walk the open roots too; closed roots stay invisible, which is the point of them.
  const roots = [document];
  (function collectRoots(root, depth) {
    if (depth > 6) return;
    let hosts;
    try { hosts = root.querySelectorAll('*'); } catch (_) { return; }
    let n = 0;
    for (const el of hosts) {
      if (++n > 4000) break;
      if (el.shadowRoot) { roots.push(el.shadowRoot); collectRoots(el.shadowRoot, depth + 1); }
    }
  })(document, 0);
  const all = (sel) => roots.flatMap((r) => { try { return [...r.querySelectorAll(sel)]; } catch (_) { return []; } });

  const nameOf = (u) => { try { return decodeURIComponent(new URL(u).pathname.split('/').pop() || ''); } catch (_) { return ''; } };
  const largestSrcset = (srcset) => {
    let best = null;
    for (const part of String(srcset || '').split(',')) {
      const [u, d] = part.trim().split(/\s+/);
      if (!u) continue;
      const w = d && d.endsWith('w') ? parseFloat(d) : d && d.endsWith('x') ? parseFloat(d) * 1000 : 0;
      if (!best || w > best.w) best = { u, w };
    }
    return best ? abs(best.u) : '';
  };

  for (const img of all('img')) {
    const candidates = [largestSrcset(img.srcset), img.currentSrc, img.src, img.dataset.src, img.dataset.original, img.dataset.lazySrc, img.dataset.lazy, img.getAttribute('data-hi-res-src')].map(abs).filter(Boolean);
    const w = img.naturalWidth || 0; const h = img.naturalHeight || 0;
    for (const u of candidates) add(u, { kind: 'image', width: w, height: h, alt: (img.alt || '').slice(0, 120), filename: nameOf(u) });
    const pic = img.closest('picture');
    if (pic) for (const s of pic.querySelectorAll('source')) { const u = largestSrcset(s.srcset); if (u) add(u, { kind: 'image', width: w, height: h, mime: s.type || '', filename: nameOf(u) }); }
  }
  for (const v of all('video')) {
    const w = v.videoWidth || 0; const h = v.videoHeight || 0;
    const urls = [v.currentSrc, v.src, ...[...v.querySelectorAll('source')].map((s) => s.src)].map(abs).filter(Boolean);
    for (const u of urls) add(u, { kind: u.startsWith('blob:') ? 'blob' : 'video', width: w, height: h, filename: nameOf(u), duration: v.duration || 0 });
    if (v.poster) add(abs(v.poster), { kind: 'image', filename: nameOf(v.poster), alt: 'poster' });
  }
  for (const a of all('audio')) {
    const urls = [a.currentSrc, a.src, ...[...a.querySelectorAll('source')].map((s) => s.src)].map(abs).filter(Boolean);
    for (const u of urls) add(u, { kind: 'audio', filename: nameOf(u), duration: a.duration || 0 });
  }
  // links straight to media files
  for (const a of all('a[href]')) {
    const u = abs(a.href);
    const ext = (u.split(/[?#]/)[0].match(/\.([a-z0-9]{2,5})$/i) || [])[1];
    if (!ext) continue;
    const e = ext.toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'].includes(e)) add(u, { kind: 'image', filename: nameOf(u) });
    else if (['mp4', 'webm', 'mov', 'mkv'].includes(e)) add(u, { kind: 'video', filename: nameOf(u) });
    else if (['mp3', 'm4a', 'flac', 'wav'].includes(e)) add(u, { kind: 'audio', filename: nameOf(u) });
    else if (e === 'm3u8' || e === 'mpd') add(u, { kind: 'stream', filename: nameOf(u) });
  }
  // CSS background images (only elements that are actually visible and reasonably large)
  let scanned = 0;
  for (const el of all('*')) {
    if (++scanned > 4000) break;
    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || bg === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 80 || r.height < 80) continue;
    for (const m of bg.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
      const u = abs(m[1]);
      if (u && !/\.svg(\?|$)/i.test(u)) add(u, { kind: 'image', width: Math.round(r.width), height: Math.round(r.height), filename: nameOf(u), css: true });
    }
  }
  // Even when every URL is a blob:, the element itself is evidence: the panel can say a video is
  // playing here and how big it is, instead of showing an empty list.
  const players = all('video').map((v) => ({
    width: v.videoWidth || 0, height: v.videoHeight || 0, duration: v.duration || 0,
    blob: /^blob:/.test(v.currentSrc || v.src || ''), poster: v.poster ? abs(v.poster) : '',
  }));
  return { frame: location.href, title: document.title, items: [...out.values()], players };
})();
