'use strict';
// Turning a streamed video back into a file.
//
// A stream is a playlist plus a few hundred segments, and on DASH sites the picture and the sound are
// separate tracks. ffmpeg reads HLS and DASH manifests natively, follows the segments and muxes the
// tracks, so the job here is mostly about asking it correctly: pick a container the copy can go into,
// and send the headers the CDN insists on.
const path = require('path');
const ffmpeg = require('./ffmpeg');

// Hotlink protection is the norm on video CDNs: without the page it was played from, the segments 403.
// A browser's own headers are what the extension's fetch already sends; ffmpeg has to be told.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
function headerBlock(pageUrl) {
  const lines = [`User-Agent: ${UA}`];
  if (pageUrl) {
    lines.push(`Referer: ${pageUrl}`);
    try { lines.push(`Origin: ${new URL(pageUrl).origin}`); } catch (_) { /* not a URL we can use */ }
  }
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * @param {string} url        an .m3u8 / .mpd manifest, or a plain media URL
 * @param {string} outFile    where to write; the extension decides the container
 * @param {{pageUrl?:string, onProgress?:Function, signal?:AbortSignal, timeoutSec?:number}} [opts]
 */
async function download(url, outFile, { pageUrl = '', onProgress, signal, timeoutSec = 3600 } = {}) {
  const ext = path.extname(outFile).toLowerCase();
  const args = [
    '-hide_banner', '-nostdin', '-y',
    '-headers', headerBlock(pageUrl),
    '-rw_timeout', '30000000',                  // 30s without a byte is a dead connection, not a slow one
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
    '-i', url,
    // Copy the streams as they are: remuxing is fast and lossless, re-encoding would be neither.
    '-map', '0:v:0?', '-map', '0:a:0?',
    '-c', 'copy',
  ];
  // MPEG-TS audio carries ADTS headers that MP4 cannot hold; this rewrites them without touching samples.
  if (ext === '.mp4' || ext === '.m4v') args.push('-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart');
  args.push('-t', String(timeoutSec), outFile);
  await ffmpeg.exec(args, { onProgress, signal });
  return outFile;
}

// HLS segments are MPEG-TS, which MP4 can hold; DASH is already fMP4. Either way .mp4 is the container
// people expect, and ffmpeg will refuse loudly rather than silently produce something broken.
function suggestExtension(mime) {
  if (mime === 'application/dash+xml') return '.mp4';
  return '.mp4';
}

/** Reads what a manifest actually contains, so a failure can say which part was the problem. */
async function probe(url, { pageUrl = '' } = {}) {
  const found = await ffmpeg.find();
  if (!found || !found.ffprobe) return null;
  const { execFile } = require('child_process');
  const args = [
    '-v', 'error', '-headers', headerBlock(pageUrl),
    '-print_format', 'json', '-show_format', '-show_streams', url,
  ];
  return new Promise((resolve) => {
    execFile(found.ffprobe, args, { timeout: 30000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        const j = JSON.parse(stdout);
        const v = (j.streams || []).find((s) => s.codec_type === 'video') || null;
        const a = (j.streams || []).find((s) => s.codec_type === 'audio') || null;
        resolve({
          duration: Number(j.format && j.format.duration) || 0,
          width: v ? v.width : 0, height: v ? v.height : 0,
          videoCodec: v ? v.codec_name : '', audioCodec: a ? a.codec_name : '',
        });
      } catch (_) { resolve(null); }
    });
  });
}

module.exports = { download, probe, suggestExtension, headerBlock };
