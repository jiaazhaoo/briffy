// Pulling the readable part out of a page, from inside the page.
//
// The app already has an extractor (src/main/web.js) but it works on HTML it fetched itself, which is
// no use here: the pages worth saving are the ones behind a login and built by script, where the server
// returns an empty shell. In the tab the content is already rendered and already authenticated.
//
// Defines BriffyExtract in the content script's isolated world; bookmark.js is the only caller.
(() => {
  // 一页最多留多少字。**2026-09-10 从 20000 提到 50 万**：一条 1723 条评论的 Hacker News 帖子
  // 量出来整页 474,209 字，20000 只留得下 4%——而收藏一个帖子，要的正是那些评论。
  // 50 万不是随手一个数：它盖得住上面那种量级的讨论页，而一条记录 500 KB 落在天文件里
  // （现在整个库的正文加起来才 0.49 MB）仍然读得动。到顶了要说出来，不能默默截断，
  // 所以 extract() 会带一个 truncated 回去。
  const MAX_TEXT = 500000;

  // The handful of sites where guessing is silly: they have one obvious container and a generic
  // density heuristic would drag in the sidebar of recommendations around it.
  // On a feed, the page is a hundred posts and the one that matters is the one whose save button was
  // clicked -- so every rule takes the clicked element and works outward from it, and only falls back
  // to "the first one on the page" when there is nothing to anchor to. Each also reports the item's own
  // permalink, because x.com/home is not a useful address for the thing you just saved.
  // ---------- the address of the thing itself ----------
  //
  // Bookmarking a tweet from its own page used to save https://x.com/user/status/123/analytics -- the
  // "Views" counter, a page only the author can open, so the link was dead for everyone else. On that
  // page the timestamp is plain text (you are already there), which leaves the counter as the first
  // /status/ link inside the article.
  //
  // That mistake is not specific to x.com: every site here hangs pages off a post, and every rule
  // below digs a link out of markup that also contains links to other things. So the rule is general
  // and the order matters -- when the page you are on *is* the post, the address bar is the answer,
  // and a link found in the markup only settles which post you meant in a feed.
  const POST_PATH = [
    { match: /(^|\.)(x|twitter)\.com$/, is: /\/status\/\d+/ },
    { match: /(^|\.)reddit\.com$/, is: /\/comments\/[a-z0-9]+/i },
    { match: /(^|\.)xiaohongshu\.com$/, is: /\/(explore|discovery\/item)\/[a-z0-9]+/i },
    { match: /(^|\.)zhihu\.com$/, is: /\/(question\/\d+\/answer\/\d+|answer\/\d+|p\/\d+|pin\/\d+)/ },
    { match: /(^|\.)bilibili\.com$/, is: /\/(video\/[A-Za-z0-9]+|read\/cv\d+|opus\/\d+)/ },
  ];

  // Pages that hang off a post: who liked it, how often it was seen, one of its pictures.
  const POST_VIEW = /\/(analytics|photo\/\d+|video\/\d+|retweets|likes|quotes|history|hidden|comment)\/?$/;

  // A query string is decoration on some sites and load-bearing on others: 小红书 links stop working
  // without xsec_token. So only the parameters that are known to be tracking come off, and whatever
  // else the site put there stays.
  const TRACKING = /^(utm_\w+|spm_id_from|vd_source|from_source|from_spmid|share_source|share_medium|share_plat|share_tag|share_session_id|timestamp|unique_k|s|t|ref|ref_src|ref_url|refer|refer_flag|xhsshare|appuid|apptime|si|feature|pp)$/i;

  const postPattern = (host) => (POST_PATH.find((p) => p.match.test(host)) || {}).is || null;

  function tidyUrl(url) {
    let u;
    try { u = new URL(String(url), location.origin); } catch (_) { return String(url || ''); }
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.pathname = u.pathname.replace(/\/$/, '') || '/';
    return u.href.replace(/\?$/, '');
  }

  /** The address if it is a post on this site, after trimming the sub-page and the tracking. '' if not. */
  function asPostUrl(url, is) {
    if (!url || !is) return '';
    const clean = tidyUrl(url);
    const [path, query] = [clean.split('?')[0], clean.includes('?') ? clean.slice(clean.indexOf('?')) : ''];
    const trimmed = path.replace(POST_VIEW, '');
    return is.test(trimmed) ? trimmed + query : '';
  }

  /** Where the post lives: the page you are on when that is the post, otherwise what the markup said. */
  function postUrl(host, fromMarkup) {
    const is = postPattern(host);
    return asPostUrl(location.href, is) || asPostUrl(fromMarkup, is) || tidyUrl(fromMarkup || location.href);
  }

  /** In a feed several posts are on screen; this settles which one the markup meant. */
  function tweetPermalink(art) {
    const links = [...art.querySelectorAll('a[href*="/status/"]')].map((a) => a.href);
    return links.find((u) => /\/status\/\d+$/.test(u.split('?')[0].replace(/\/$/, '')))
      || links.find((u) => POST_VIEW.test(u.split('?')[0]))
      || links[0] || '';
  }

  const SITES = [
    {
      match: /(^|\.)(x|twitter)\.com$/,
      pick: (doc, anchor) => {
        const art = (anchor && anchor.closest('article')) || doc.querySelector('article[data-testid="tweet"]') || doc.querySelector('article');
        if (!art) return null;
        const text = [...art.querySelectorAll('[data-testid="tweetText"]')].map((n) => n.innerText).join('\n\n');
        const who = art.querySelector('[data-testid="User-Name"]');
        const byline = who ? who.innerText.split('\n')[0] : '';
        const first = (text.split('\n').find(Boolean) || '').slice(0, 60);
        return {
          text, byline,
          title: [byline, first].filter(Boolean).join('：') || doc.title,
          url: tweetPermalink(art),
        };
      },
    },
    {
      match: /(^|\.)reddit\.com$/,
      pick: (doc, anchor) => {
        const post = (anchor && anchor.closest('shreddit-post, [data-testid="post-container"], article'))
          || doc.querySelector('shreddit-post') || doc.querySelector('[data-test-id="post-content"]');
        if (!post) return null;
        const title = post.querySelector('h1, [slot="title"]');
        const body = post.querySelector('[slot="text-body"], [data-post-click-location="text-body"]');
        const link = post.querySelector('a[href*="/comments/"]');
        return {
          title: title ? title.innerText.trim() : '',
          text: body ? body.innerText : (post.innerText || ''),
          url: link ? new URL(link.getAttribute('href'), location.origin).href : '',
        };
      },
    },
    {
      match: /(^|\.)xiaohongshu\.com$/,
      pick: (doc, anchor) => {
        const root = (anchor && anchor.closest('.note-item, .feeds-page section, #noteContainer')) || doc;
        const title = root.querySelector('#detail-title, .title');
        const body = root.querySelector('#detail-desc, .desc, .note-content');
        const link = root.querySelector('a[href*="/explore/"], a[href*="/discovery/item/"]');
        if (!title && !body) return null;
        return {
          title: title ? title.innerText.trim() : '',
          text: body ? body.innerText : '',
          url: link ? new URL(link.getAttribute('href'), location.origin).href : '',   // xsec_token has to survive
        };
      },
    },
    {
      match: /(^|\.)zhihu\.com$/,
      pick: (doc, anchor) => {
        const root = (anchor && anchor.closest('.AnswerItem, .Post-content, .ContentItem')) || doc;
        const body = root.querySelector('.RichText, .Post-RichText, .RichContent');
        const title = root.querySelector('h1, h2 .ContentItem-title');
        if (!body) return null;
        // In a feed every answer carries its own address in a meta tag; on its own page there is none
        // and the address bar is already right.
        const own = root.querySelector('meta[itemprop="url"]');
        const link = root.querySelector('a[href*="/answer/"], a[href*="/p/"]');
        return {
          text: body.innerText,
          title: title ? title.innerText.trim() : '',
          url: (own && own.content) || (link ? link.href : ''),
        };
      },
    },
    {
      // bilibili had no rule at all, so saving a video from a list kept the list's address -- an
      // uploader's page instead of the video that was on it.
      match: /(^|\.)bilibili\.com$/,
      pick: (doc, anchor) => {
        const card = anchor && anchor.closest('.bili-video-card, .video-card, .small-item, .video-page-card-small, [data-aid], li.card-box');
        const root = card || doc;
        const link = root.querySelector('a[href*="/video/"], a[href*="/read/cv"], a[href*="/opus/"]');
        const titleEl = root.querySelector('.bili-video-card__info--tit, .title, h1.video-title, h1');
        const title = (titleEl && (titleEl.getAttribute('title') || titleEl.innerText || '').trim())
          || (link && (link.getAttribute('title') || '').trim()) || '';
        const desc = doc.querySelector('#v_desc, .desc-info, .basic-desc-info');
        if (!link && !title) return null;
        return {
          title,
          text: card ? '' : (desc ? desc.innerText : ''),
          url: link ? link.href : '',
        };
      },
    },
  ];

  const meta = (doc, sel) => { const m = doc.querySelector(sel); return m ? (m.content || '').trim() : ''; };

  function pageTitle(doc) {
    return meta(doc, 'meta[property="og:title"]')
      || meta(doc, 'meta[name="twitter:title"]')
      || (doc.querySelector('h1') ? doc.querySelector('h1').innerText.trim() : '')
      || (doc.title || '').trim();
  }

  // How much of a block is link text. Navigation and related-post rails are almost all links; the
  // thing someone bookmarked is almost all prose.
  function linkDensity(el) {
    const total = (el.innerText || '').length;
    if (!total) return 1;
    let linked = 0;
    for (const a of el.querySelectorAll('a')) linked += (a.innerText || '').length;
    return linked / total;
  }

  // Chrome that sits inside the article's own container: a table of contents, a share bar, the
  // "related posts" rail. Scoring alone will not exclude them, because the block that holds the
  // article often holds these too -- so they are dropped when the text is finally read out.
  const JUNK_SEL = [
    'nav', 'aside', 'footer', 'header', 'form', 'script', 'style', 'noscript', 'template', 'svg',
    '[role="navigation"]', '[role="complementary"]', '[role="banner"]', '[role="search"]',
    '[aria-hidden="true"]', '[hidden]',
    '.toc', '#toc', '[class*="vector-toc"]', '[class*="table-of-contents"]',
    '[class*="navbox"]', '[class*="sidebar"]', '[class*="breadcrumb"]',
    '[class*="advert"]', '[class*="share"]', '[class*="related"]', '[class*="recommend"]',
    // **`[class*="comment"]` 2026-09-10 从这儿拿掉了**，和 SKIP 里那个是同一件事的两处。
    // 只拆 SKIP 那一处毫无用处：HN 的评论树是 `table.comment-tree`，它在这儿被整棵跳过，
    // 于是那一页 498,323 字只读出 104 字。改一个地方不动，是因为坏在两个地方。
    '[class*="newsletter"]', '[class*="subscribe"]', '[class*="cookie"]',
  ].join(', ');
  // 挑正文容器时按名字排掉的那些。**`comment` 2026-09-10 从这里拿掉了**：
  // 它原来和 nav、advert 并排，于是评论区被当成页面家具扔掉——在那条 HN 帖子上，
  // 这一个词命中了 1728 个元素。评论不是家具，收藏一个讨论帖要的就是它。
  // 它现在由 commentBlocks() 单独收，见下面。
  const SKIP = /(^|\s|-|_)(nav|header|footer|aside|menu|sidebar|related|recommend|advert|promo|share|toolbar|toc)(\s|-|_|$)/i;

  function isHidden(el, win) {
    try {
      const st = win.getComputedStyle(el);
      return st.display === 'none' || st.visibility === 'hidden';
    } catch (_) { return false; }
  }

  // Reads a container's text while skipping the chrome inside it. innerText would be simpler but takes
  // the whole subtree; this keeps its line breaks by walking block elements itself.
  const BLOCK = /^(P|DIV|LI|TR|SECTION|ARTICLE|H[1-6]|BLOCKQUOTE|PRE|BR|UL|OL|TABLE|FIGURE|DD|DT)$/;
  function readText(root, win, depth = 0) {
    let out = '';
    for (const node of root.childNodes) {
      if (node.nodeType === 3) { out += node.nodeValue; continue; }
      if (node.nodeType !== 1) continue;
      try { if (node.matches(JUNK_SEL)) continue; } catch (_) { /* selector unsupported here */ }
      if (depth < 4 && isHidden(node, win)) continue;
      if (BLOCK.test(node.tagName)) out += '\n';
      out += readText(node, win, depth + 1);
      if (BLOCK.test(node.tagName)) out += '\n';
    }
    return out;
  }

  // The page usually says where its content is; only guess when it does not.
  const CONTENT_SEL = ['article', 'main', '[role="main"]', '#mw-content-text', '.post-content', '.entry-content', '.article-content', '#content'];

  // 评论区在哪。**它几乎从来不在正文容器里面**，而是它的兄弟节点——所以「找到正文就返回」
  // 这件事本身就把评论漏掉了，哪怕 SKIP 不再排它。这一段单独去收，收完接在正文后面。
  //
  // 判据是名字：class 或 id 里带 comment / discussion / replies / 评论 / 回复。粗，但这一档
  // 宁可粗——漏掉一整个评论区的代价，比多带进来一块「相关推荐」大得多（而那一块本来就有
  // JUNK_SEL 在挡）。**取最外层那一个**：评论区里每一条评论自己也叫 comment，
  // 不去重的话同一段字会被收上几十遍。
  const COMMENT_SEL = '[class*="comment" i], [id*="comment" i], [class*="discussion" i], [id*="discussion" i], '
    + '[class*="replies" i], [id*="replies" i], [class*="评论"], [id*="评论"], [class*="回复"]';
  // 名字里带 comment 但不是评论的：每条评论旁边那个「删除 / 举报」菜单。**它们常常被 portal 到
  // 评论容器外面**，所以「已经在某个外层里」那一条去重吃不掉它们——2026-09-10 在一条小红书笔记上
  // 量到 14 块里有 13 块是这种，正文只有一块。
  const NOT_COMMENT = /(dropdown|popover|tooltip|modal|dialog|menu|toolbar|placeholder|editor|composer)/i;
  function commentBlocks(doc, win, inside) {
    const found = [];
    let els;
    try { els = [...doc.querySelectorAll(COMMENT_SEL)]; } catch (_) { return ''; }
    for (const el of els) {
      if (inside && (inside === el || inside.contains(el))) continue;      // 正文里那部分已经收过了
      const cls = `${typeof el.className === 'string' ? el.className : ''} ${el.id || ''}`;
      if (NOT_COMMENT.test(cls)) continue;
      if (found.some((f) => f.contains(el))) continue;                     // 已经在某个外层里
      if (el.innerText && el.innerText.length < 40) continue;
      for (let i = found.length - 1; i >= 0; i--) if (el.contains(found[i])) found.splice(i, 1);
      found.push(el);
      if (found.length > 40) break;
    }
    return found.map((el) => readText(el, win)).join('\n');
  }

  function genericBody(doc) {
    const win = doc.defaultView || window;
    for (const sel of CONTENT_SEL) {
      const el = doc.querySelector(sel);
      if (!el) continue;
      const text = readText(el, win);
      // **正文 + 评论，不是二选一。** 原来这里够 200 字就 return，而 article / main 装的
      // 通常只有帖子本身。
      if (text.replace(/\s+/g, '').length >= 200) {
        const talk = commentBlocks(doc, win, el);
        return talk ? `${text}\n${talk}` : text;
      }
    }
    const candidates = [...doc.querySelectorAll('div, section, td')];
    let best = null;
    let scanned = 0;
    for (const el of candidates) {
      if (++scanned > 3000) break;
      const cls = `${typeof el.className === 'string' ? el.className : ''} ${el.id || ''}`;
      if (SKIP.test(cls)) continue;
      const text = el.innerText || '';
      if (text.length < 120) continue;
      const density = linkDensity(el);
      if (density > 0.5) continue;
      const paragraphs = el.querySelectorAll('p, li').length;
      const score = text.length * (1 + Math.min(paragraphs, 40) / 40) * (1 - density);
      if (!best || score > best.score) best = { el, score };
    }
    if (!best) return doc.body ? doc.body.innerText : '';
    const talk = commentBlocks(doc, win, best.el);
    return talk ? `${readText(best.el, win)}\n${talk}` : readText(best.el, win);
  }

  /** 上一次 tidy 有没有截断过。extract() 读它，读完清零。 */
  let cut = false;
  function tidy(text) {
    const raw = String(text || '');
    if (raw.length > MAX_TEXT) cut = true;
    return raw
      .replace(/\r/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, MAX_TEXT);
  }

  /**
   * @param {Document} doc
   * @param {Element} [anchor] the element that was clicked, when there is one -- on a feed it is the
   *   only thing that says which of a hundred posts the person meant
   * @param {string} [host] defaults to this page's; an argument so dev/fixtures can exercise the
   *   per-site rules without being served from that site
   */
  function extract(doc = document, anchor = null, host = location.hostname) {
    let picked = null;
    let source = 'generic';
    for (const s of SITES) {
      if (!s.match.test(host)) continue;
      try { picked = s.pick(doc, anchor); } catch (_) { picked = null; }
      if (picked && (picked.text || picked.title)) { source = 'site'; break; }
      picked = null;
    }
    const title = (picked && picked.title) || pageTitle(doc);
    cut = false;
    // **站点规则挑中的是帖子本身，评论区从来不在它里面。** 上一版只把 commentBlocks 接在
    // genericBody 那一支上，于是有站点规则的那五个站（x / reddit / 小红书 / 知乎 / B 站）
    // 一条评论都拿不到——而那恰恰是最该拿到的几个。
    // 2026-09-10 在一条小红书笔记上量的：整页 2,549 字，站点规则拿到 284 字（11%），
    // 评论区另有 571 字，一个字都没进来。
    //
    // 这儿传 null 而不是帖子的根：评论区是那个根的兄弟节点，传进去反而把它自己排掉了。
    // 代价是在信息流页面上可能带进别的帖子的评论——而收藏几乎总是在详情页发生。
    const win = doc.defaultView || window;
    let text;
    if (picked && picked.text) {
      const talk = commentBlocks(doc, win, null);
      text = tidy(talk ? `${picked.text}\n${talk}` : picked.text);
    } else {
      text = tidy(genericBody(doc));
    }
    return {
      title: (title || '').slice(0, 300),
      url: postUrl(host, picked && picked.url),
      text,
      excerpt: meta(doc, 'meta[property="og:description"]') || meta(doc, 'meta[name="description"]'),
      byline: (picked && picked.byline) || meta(doc, 'meta[name="author"]'),
      image: meta(doc, 'meta[property="og:image"]'),
      site: host,
      source,
      // 到顶了就说出来。默默截断是这一整天在修的那种毛病：屏幕上写着一个数，实际是另一个。
      truncated: cut || undefined,
    };
  }

  window.BriffyExtract = { extract, tidy, linkDensity, pageTitle, tweetPermalink, postUrl, asPostUrl, tidyUrl, postPattern };
})();
