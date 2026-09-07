'use strict';
// briffy 官网的那点脚本。四件事，没有别的：
//   1. 两种语言 —— 只改 <html lang>，两份文案本来就都在 DOM 里，藏哪一份由 CSS 说了算。
//   2. 那枚回形针 —— 直接用应用自己的 assets/brand/briffy-anim.js（本目录是它的拷贝），
//      所以站点上的表情和桌面上那只是同一段代码算出来的，不是照着画的。
//   3. 波形 —— 一段确定的伪随机，每次打开长得一样。
//   4. 瀑布流 —— 和 workspace.js 里那套一样：占两列的挑一对相邻列里最矮的那对。
//      卡片按**应用里的真实尺寸**排（一列 240px），窄屏减列数，不缩尺寸。

(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // 瀑布流的三个常量提到最前面：setLang() 在初始化时就会排一次版，
  // 声明留在文件底下的话，那一次会读到还在暂时性死区里的 grid。
  const COL = 240;               // 应用里一列就是这么宽，站点不放大它
  const GAP = 26;                // = --a4
  const grid = $('#mix');

  /* ── 1 · 语言 ─────────────────────────────────────────────────────────── */
  const LANGS = { zh: 'zh-Hans', en: 'en' };
  const KEY = 'briffy.site.lang';

  function readLang() {
    try { const v = localStorage.getItem(KEY); if (v === 'zh' || v === 'en') return v; } catch (e) { /* 隐私窗口 */ }
    return /^zh\b/i.test(navigator.language || '') ? 'zh' : 'en';
  }
  function setLang(v) {
    document.documentElement.lang = LANGS[v] || LANGS.zh;
    try { localStorage.setItem(KEY, v); } catch (e) { /* 存不下就算了，这一次照样切 */ }
    layout();
  }
  const lang = () => (document.documentElement.lang === 'en' ? 'en' : 'zh');

  // 发布出去的是两个真正的单语页面（build-site.js 把另一种语言整个删掉，并在 <html> 上
  // 打一个 data-fixed-lang）。那种页面上这段必须闭嘴：按浏览器语言去改 <html lang>，
  // 会把仅存的那一份文案也用 CSS 藏掉，剩下一张空白的纸。
  if (!document.documentElement.hasAttribute('data-fixed-lang')) {
    setLang(readLang());
    for (const b of [$('#langBtn'), ...$$('[data-lang-toggle]')]) {
      if (b) b.addEventListener('click', () => setLang(lang() === 'zh' ? 'en' : 'zh'));
    }
  }

  /* ── 2 · 回形针 ───────────────────────────────────────────────────────── */
  const anim = window.briffyAnim;
  const marks = {};
  if (anim) {
    for (const [name, sel] of [['small', '#markSmall'], ['hero', '#markSlot'], ['foot', '#markFoot']]) {
      const host = $(sel);
      if (host) marks[name] = anim.attach(host, { colour: 'currentColor' });
    }
  }
  // 标记本身是 #2A6CF0；顶栏和页脚那两只小的跟着墨色走，一屏一个彩色的额度留给链接。
  for (const sel of ['#markSmall', '#markFoot']) { const n = $(sel); if (n) n.style.color = 'var(--ink)'; }
  const heroHost = $('#markSlot'); if (heroHost) heroHost.style.color = '#2A6CF0';

  // 头一屏那只：点一下走一遍真实的流程——快门、存好了、回到静止。
  const heroBtn = $('#mark');
  if (heroBtn && marks.hero) {
    let t1 = 0, t2 = 0;
    heroBtn.addEventListener('click', () => {
      clearTimeout(t1); clearTimeout(t2);
      marks.hero.set('idle');
      marks.hero.set('capturing');
      t1 = setTimeout(() => marks.hero.set('success'), 620);
      t2 = setTimeout(() => marks.hero.set('idle'), 2000);
    });
  }

  /* ── 3 · 波形 ─────────────────────────────────────────────────────────── */
  for (const w of $$('.wave')) {
    const n = +w.dataset.n || 44;
    let s = +w.dataset.seed || 7;
    let html = '';
    for (let i = 0; i < n; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      html += '<i style="height:' + (14 + ((s >> 16) % 100) / 100 * 74).toFixed(0) + '%"></i>';
    }
    w.innerHTML = html;
  }

  /* ── 4 · 瀑布流 ───────────────────────────────────────────────────────── */
  function columns(avail) {
    for (let n = 4; n > 1; n--) if (n * COL + (n - 1) * GAP <= avail) return n;
    return 1;
  }

  function layout() {
    if (!grid) return;
    const avail = grid.parentElement.clientWidth;
    const N = columns(avail);
    const width = N * COL + (N - 1) * GAP;
    grid.style.width = width + 'px';

    const cards = [...grid.children];
    for (const c of cards) {
      const span = Math.min(N, +c.dataset.span || 1);
      c.style.width = (span * COL + (span - 1) * GAP) + 'px';
    }
    const h = new Array(N).fill(0);
    for (const c of cards) {
      const span = Math.min(N, +c.dataset.span || 1);
      let bi = 0, bv = Infinity;
      for (let i = 0; i + span <= N; i++) {
        const v = Math.max(...h.slice(i, i + span));
        if (v < bv - 0.5) { bv = v; bi = i; }
      }
      c.style.left = (bi * (COL + GAP)) + 'px';
      c.style.top = bv + 'px';
      const next = bv + c.offsetHeight + GAP;
      for (let i = bi; i < bi + span; i++) h[i] = next;
    }
    grid.style.height = (Math.max(...h) - GAP) + 'px';
  }

  layout();
  window.addEventListener('resize', layout);
  window.addEventListener('load', layout);
  // 卡片的高度由字撑开，字体换了高度就变了——不重排一次，卡片之间会留下一道缝。
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
  for (const img of $$('#mix img')) img.addEventListener('load', layout);
})();
