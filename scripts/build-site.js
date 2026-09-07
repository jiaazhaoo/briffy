'use strict';
// 把 site/ 那份双语源文件切成两个真正的单语页面，输出到 site-dist/。
//
//   node scripts/build-site.js      →  site-dist/index.html      中文
//                                      site-dist/en/index.html   English
//
// 为什么不直接把带切换按钮的那一页发出去：一个页面服务两种语言，链接分不开、
// 搜索引擎收不进去、分享出去的标题永远是其中一种。所以发布的是两页，
// 切换按钮在这里被换成一条真链接；源文件里那个按钮只为本地预览留着。
//
// 源文件是 site/index.html，站点的每一个字都只有那一份——包括两种语言的标题和描述
// （它们躺在 x-title-* / x-desc-* 这四个 meta 里，这里挑走之后删掉）。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'site');
const OUT = path.join(ROOT, 'site-dist');
const ORIGIN = 'https://briffy.cc';

/** 页面自己带的静态文件。en/ 那一页在下一级，所以路径要往上退一格 */
const ASSETS = ['site.css', 'site.js', 'briffy-anim.js', 'favicon.svg', 'og.png', 'shot.svg', 'paper/tokens.css'];

// ---------- 按 class 删掉整个元素 ----------
// 不引入 HTML 解析器：源文件是我们自己写的，而且带语言 class 的元素从不自我嵌套
// （没有 .zh 里面还有 .zh）。所以只要认出开标签，再往前数同名标签的开合就够了。
function classesOf(tag) {
  const m = /\sclass\s*=\s*"([^"]*)"/i.exec(tag);
  return m ? m[1].trim().split(/\s+/) : [];
}

function stripByClass(html, cls) {
  const open = /<([a-zA-Z][\w-]*)\b[^>]*>/g;
  let out = html;
  for (;;) {
    open.lastIndex = 0;
    let hit = null;
    let m;
    while ((m = open.exec(out))) {
      if (m[0].endsWith('/>')) continue;
      if (classesOf(m[0]).includes(cls)) { hit = m; break; }
    }
    if (!hit) return out;

    const name = hit[1];
    const scan = new RegExp(`<${name}\\b[^>]*>|</${name}\\s*>`, 'gi');
    scan.lastIndex = hit.index + hit[0].length;
    let depth = 1;
    let end = -1;
    let s;
    while ((s = scan.exec(out))) {
      if (s[0][1] === '/') { depth -= 1; if (depth === 0) { end = s.index + s[0].length; break; } }
      else if (!s[0].endsWith('/>')) depth += 1;
    }
    if (end < 0) throw new Error(`没有找到 </${name}> —— class="${cls}" 的元素没闭合？`);

    // 连同它前面那一段缩进一起拿掉，免得留下一行空白
    let from = hit.index;
    while (from > 0 && (out[from - 1] === ' ' || out[from - 1] === '\t')) from -= 1;
    if (out[from - 1] === '\n' && /^\s*$/.test(out.slice(end, out.indexOf('\n', end) + 1 || end))) from -= 1;
    out = out.slice(0, from) + out.slice(end);
  }
}

// ---------- 一种语言，一页 ----------
function build(lang) {
  const src = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  const other = lang === 'zh' ? 'en' : 'zh';
  const sub = lang === 'en';                       // English 住在 /en/，静态文件在上一级
  const up = sub ? '../' : '';

  let h = stripByClass(src, other);

  const meta = (name) => {
    const m = new RegExp(`<meta name="${name}" content="([^"]*)"\\s*/?>`).exec(src);
    if (!m) throw new Error(`源文件里没有 <meta name="${name}">`);
    return m[1];
  };
  const title = meta(`x-title-${lang}`);
  const desc = meta(`x-desc-${lang}`);

  // 挑完就把这四行删掉，别发出去
  h = h.replace(/\n\s*<!-- 两种语言的标题与描述[\s\S]*?-->\n/, '\n');
  h = h.replace(/\s*<meta name="x-(?:title|desc)-(?:zh|en)" content="[^"]*"\s*\/?>/g, '');

  h = h.replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`);
  h = h.replace(/<meta name="description" content="[^"]*"\s*\/?>/,
    `<meta name="description" content="${desc}" />`);
  h = h.replace(/<meta property="og:title" content="[^"]*"\s*\/?>/,
    `<meta property="og:title" content="${title}" />`);
  h = h.replace(/<meta property="og:description" content="[^"]*"\s*\/?>/,
    `<meta property="og:description" content="${desc}" />`);

  // 语言固定下来：<html lang> 说了算，data-fixed-lang 让 site.js 别再按浏览器语言去改它
  h = h.replace(/<html lang="[^"]*">/, `<html lang="${lang === 'zh' ? 'zh-Hans' : 'en'}" data-fixed-lang>`);

  // 每一页认自己，并互相指认
  const self = lang === 'zh' ? `${ORIGIN}/` : `${ORIGIN}/en/`;
  h = h.replace(/<link rel="canonical" href="[^"]*"\s*\/?>/,
    `<link rel="canonical" href="${self}" />\n`
    + `<link rel="alternate" hreflang="zh-Hans" href="${ORIGIN}/" />\n`
    + `<link rel="alternate" hreflang="en" href="${ORIGIN}/en/" />\n`
    + `<link rel="alternate" hreflang="x-default" href="${ORIGIN}/" />`);
  h = h.replace(/<meta property="og:type" content="website"\s*\/?>/,
    `<meta property="og:type" content="website" />\n`
    + `<meta property="og:url" content="${self}" />\n`
    + `<meta property="og:locale" content="${lang === 'zh' ? 'zh_CN' : 'en_US'}" />`);
  h = h.replace(/<meta property="og:image" content="og.png"\s*\/?>/,
    `<meta property="og:image" content="${ORIGIN}/og.png" />`);

  // 静态文件往上退一格（只有 en/ 那一页需要）
  if (sub) {
    for (const a of ASSETS) h = h.split(`"${a}"`).join(`"${up}${a}"`);
    h = h.replace(/href="#/g, 'href="#');           // 锚点不动
  }

  // 切换按钮换成一条真链接。源文件里它是 <button>，只为本地预览；
  // 发布出去的两页之间靠 href 走，不靠 JS。
  //
  // href 上带着 ?lang=：那是「他自己挑的」这件事唯一的载体。head 里那段自动判断见到就记下来，
  // 从此不再替他决定——否则从英文页点「中文」会被当场弹回英文。
  const to = lang === 'zh' ? 'en/?lang=en' : '../?lang=zh';
  h = h.replace(/<button type="button" id="langBtn" class="lang"[^>]*>([\s\S]*?)<\/button>/,
    `<a class="lang" href="${to}" hreflang="${other === 'zh' ? 'zh-Hans' : 'en'}">$1</a>`);
  h = h.replace(/<button type="button" class="lang" data-lang-toggle>([\s\S]*?)<\/button>/,
    `<a class="lang" href="${to}" hreflang="${other === 'zh' ? 'zh-Hans' : 'en'}">$1</a>`);

  return h;
}

// ---------- 写出去 ----------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'en'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'paper'), { recursive: true });

fs.writeFileSync(path.join(OUT, 'index.html'), build('zh'));
fs.writeFileSync(path.join(OUT, 'en', 'index.html'), build('en'));
for (const a of ASSETS) fs.copyFileSync(path.join(SRC, a), path.join(OUT, a));

// 404。两种语言都写在上面——走丢的人不一定是从哪一页走丢的。
// 它自己带一小段样式：整站的 css 是给一整页排版的，这里只有三行字。
const NOT_FOUND = `<!doctype html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>briffy — 404</title>
<meta name="robots" content="noindex" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="stylesheet" href="/paper/tokens.css" />
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; align-content: center;
    padding: clamp(20px, 5vw, 44px); gap: 14px;
    background: var(--ground); background-attachment: fixed; color: var(--ink);
    font: 400 16px/1.65 var(--sans); -webkit-font-smoothing: antialiased;
    text-autospace: normal; text-spacing-trim: space-first; }
  img { width: 84px; height: 84px; }
  p { margin: 0; color: var(--ink-2); }
  p.en { color: var(--ink-3); font-size: 13.5px; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; text-underline-offset: 3px; }
</style>
</head>
<body>
  <img src="/favicon.svg" alt="briffy" />
  <p>这一页没有记下来。<a href="/">回首页</a></p>
  <p class="en">This page was never written down. <a href="/en/">Home</a></p>
</body>
</html>
`;
fs.writeFileSync(path.join(OUT, '404.html'), NOT_FOUND);

// Pages 的响应头。资源名字里没有指纹，所以不给长缓存。
fs.writeFileSync(path.join(OUT, '_headers'), [
  '/*',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: strict-origin-when-cross-origin',
  '  X-Frame-Options: DENY',
  '',
].join('\n'));

for (const f of ['index.html', 'en/index.html']) {
  const n = fs.readFileSync(path.join(OUT, f), 'utf8');
  console.log(f.padEnd(16), (n.length / 1024).toFixed(1) + ' KB');
}
console.log('→', path.relative(ROOT, OUT));
