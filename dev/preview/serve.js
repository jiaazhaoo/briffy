'use strict';
// Static preview server for iterating on the renderer UI in a normal browser (no Electron needed).
//   node dev/preview/serve.js   →  http://localhost:5173/          workspace window with mock data
//                                   http://localhost:5173/pet       the cat (mock IPC)
//                                   http://localhost:5173/onboarding  the first-run flow
//                                   http://localhost:5173/shelf     the hover shelf
//                                   http://localhost:5173/region    the selection overlay, with window snapping
//                                   http://localhost:5173/lang      the design language, three papers x three hierarchies
//                                   http://localhost:5173/system    the design hierarchy: 层 / 墨 / 空
//                                   http://localhost:5173/cards     五种记录，五张纸：各自的物证和纸色
//                                   http://localhost:5173/links     双链怎么给：四种方案摆一起比
//                                   http://localhost:5173/site      官网（site/，可整个目录单独部署）
//                                   http://localhost:5173/site-dist/     发布出去的中文页（先跑 npm run site）
//                                   http://localhost:5173/site-dist/en/  英文页
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.PORT || 5173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.wav': 'audio/wav', '.webm': 'audio/webm', '.jpg': 'image/jpeg' };

// The mock goes at the end of <head>, so it is defined before any page script runs -
// whether that script is external (pet, workspace) or inline.
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
      // Never cache: this exists to look at the file you just edited, and a browser holding on to
      // the previous one turns every UI change into a hunt for a bug that is not there.
      res.setHeader('cache-control', 'no-store, must-revalidate');
      res.end(extra ? extra(String(data)) : data);
    });
  };
  if (url === '/' || url === '/index.html') return send(path.join(ROOT, 'src/renderer/workspace/index.html'), (h) => inject(h, '/dev/preview/mock-ws.js', '/src/renderer/workspace/'));
  if (url === '/pet') return send(path.join(ROOT, 'src/renderer/pet/index.html'), (h) => inject(h, '/dev/preview/mock-pet.js', '/src/renderer/pet/'));
  if (url === '/onboarding') return send(path.join(ROOT, 'src/renderer/onboarding/index.html'), (h) => inject(h, '/dev/preview/mock-ob.js', '/src/renderer/onboarding/'));
  if (url === '/shelf') return send(path.join(ROOT, 'src/renderer/shelf/index.html'), (h) => inject(h, '/dev/preview/mock-shelf.js', '/src/renderer/shelf/'));
  if (url === '/region') return send(path.join(ROOT, 'src/renderer/region/index.html'), (h) => inject(h, '/dev/preview/mock-region.js', '/src/renderer/region/'));
  if (url === '/viewer') return send(path.join(ROOT, 'src/renderer/viewer/index.html'), (h) => inject(h, '/dev/preview/mock-viewer.js', '/src/renderer/viewer/'));
  if (url === '/lang') return send(path.join(__dirname, 'lang.html'));
  if (url === '/system') return send(path.join(__dirname, 'system.html'));
  if (url === '/cards') return send(path.join(__dirname, 'cards.html'));
  if (url === '/palette') return send(path.join(__dirname, 'palette.html'));
  if (url === '/links') return send(path.join(__dirname, 'links.html'));
  if (url === '/ground') return send(path.join(__dirname, 'ground.html'));
  if (url === '/briffy') return send(path.join(__dirname, 'briffy.html'));
  // 官网。/site 必须先跳到 /site/：没有那道斜杠，页面里 paper/tokens.css 这些相对地址会落到站点根上。
  if (url === '/site') { res.statusCode = 302; res.setHeader('location', '/site/'); return res.end(); }
  if (url === '/site/') return send(path.join(ROOT, 'site/index.html'));
  // 发布出去的两页（npm run site 生成）。得挂在 /site-dist/ 下面，页面里的相对路径
  // 才落回同一个目录——那正是 Cloudflare Pages 把它当站点根目录时的样子。
  if (url === '/site-dist' ) { res.statusCode = 302; res.setHeader('location', '/site-dist/'); return res.end(); }
  if (url === '/site-dist/en') { res.statusCode = 302; res.setHeader('location', '/site-dist/en/'); return res.end(); }
  if (url === '/site-dist/') return send(path.join(ROOT, 'site-dist/index.html'));
  if (url === '/site-dist/en/') return send(path.join(ROOT, 'site-dist/en/index.html'));
  if (url === '/sample.png') return send(path.join(__dirname, 'sample.png'));
  const file = path.join(ROOT, url);
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  send(file);
}).listen(PORT, '127.0.0.1', () => console.log(`preview: http://localhost:${PORT}/  (pet: /pet, shelf: /shelf, briffy: /briffy)`));
