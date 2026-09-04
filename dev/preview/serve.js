'use strict';
// Static preview server for iterating on the renderer UI in a normal browser (no Electron needed).
//   node dev/preview/serve.js   →  http://localhost:5173/          workspace window with mock data
//                                   http://localhost:5173/pet       the cat (mock IPC)
//                                   http://localhost:5173/bubble    the speech bubble
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.PORT || 5173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.wav': 'audio/wav', '.webm': 'audio/webm', '.jpg': 'image/jpeg' };

// The mock goes at the end of <head>, so it is defined before any page script runs -
// whether that script is external (pet, workspace) or inline (bubble).
function inject(html, mockScript, base) {
  return html
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/i, '')
    .replace('<head>', `<head><base href="${base}">`)
    .replace('</head>', `  <script src="${mockScript}"></script>\n</head>`);
}

http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  const send = (file, extra) => {
    fs.readFile(file, (err, data) => {
      if (err) { res.statusCode = 404; res.end('not found: ' + url); return; }
      const ext = path.extname(file).toLowerCase();
      res.setHeader('content-type', TYPES[ext] || 'application/octet-stream');
      res.end(extra ? extra(String(data)) : data);
    });
  };
  if (url === '/' || url === '/index.html') return send(path.join(ROOT, 'src/renderer/workspace/index.html'), (h) => inject(h, '/dev/preview/mock-ws.js', '/src/renderer/workspace/'));
  if (url === '/pet') return send(path.join(ROOT, 'src/renderer/pet/index.html'), (h) => inject(h, '/dev/preview/mock-pet.js', '/src/renderer/pet/'));
  if (url === '/bubble') return send(path.join(ROOT, 'src/renderer/bubble/index.html'), (h) => inject(h, '/dev/preview/mock-bubble.js', '/src/renderer/bubble/'));
  if (url === '/sample.png') return send(path.join(__dirname, 'sample.png'));
  const file = path.join(ROOT, url);
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  send(file);
}).listen(PORT, '127.0.0.1', () => console.log(`preview: http://localhost:${PORT}/  (pet: /pet, bubble: /bubble)`));
