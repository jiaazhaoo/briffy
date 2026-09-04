'use strict';
// Fetches a URL and turns it into something the tagger can read (page text, a PDF, or plain metadata).

const MAX_TEXT = 20000;
const MAX_PDF = 30 * 1024 * 1024;
const MAX_IMAGE = 25 * 1024 * 1024;

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function htmlToText(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim() : '';
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i);
  const description = descMatch ? decodeEntities(descMatch[1]).trim() : '';
  let body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|head|template|iframe|nav|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/header|\/footer)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  body = decodeEntities(body)
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, description, text: body.slice(0, MAX_TEXT) };
}

/**
 * @returns {Promise<{kind:'text'|'pdf'|'meta', title:string, text?:string, pdf?:Buffer, mime:string}>}
 */
async function fetchUrl(url, { timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; DailyLogs/0.1; +https://example.invalid)',
        accept: 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5',
      },
    });
    const mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!res.ok) return { kind: 'meta', title: url, mime, text: `HTTP ${res.status}` };
    if (mime === 'application/pdf') {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_PDF) return { kind: 'meta', title: url, mime, text: `PDF too large (${buf.length} bytes)` };
      return { kind: 'pdf', title: url.split('/').pop() || url, pdf: buf, mime };
    }
    if (mime.startsWith('image/')) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_IMAGE) return { kind: 'meta', title: url, mime, text: `Image too large (${buf.length} bytes)` };
      const name = decodeURIComponent((new URL(url).pathname.split('/').pop() || 'image')).replace(/[?#].*$/, '');
      return { kind: 'image', title: name, image: buf, mime };
    }
    if (mime.startsWith('text/html') || mime.includes('xml')) {
      const html = await res.text();
      const { title, description, text } = htmlToText(html);
      return { kind: 'text', title: title || url, text: [description, text].filter(Boolean).join('\n\n'), mime };
    }
    if (mime.startsWith('text/') || mime === 'application/json') {
      const text = (await res.text()).slice(0, MAX_TEXT);
      return { kind: 'text', title: url, text, mime };
    }
    return { kind: 'meta', title: url, mime, text: `Content type ${mime || 'unknown'}` };
  } finally {
    clearTimeout(timer);
  }
}

function isUrl(s) {
  if (!s) return false;
  const t = s.trim();
  if (/\s/.test(t)) return false;
  return /^https?:\/\/[^\s]+$/i.test(t) || /^www\.[^\s]+\.[a-z]{2,}(\/|$)/i.test(t);
}

function normalizeUrl(s) {
  const t = s.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

module.exports = { fetchUrl, htmlToText, isUrl, normalizeUrl };
