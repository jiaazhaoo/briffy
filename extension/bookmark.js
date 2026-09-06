// Noticing that you just saved something, and keeping what you saved.
//
// This does not watch browsing. It sits still until a save gesture happens, and only then reads the
// page. A click anywhere else is looked at just long enough to decide it is not a save button.
//
// Telling "save" from "unsave" is most of the problem: on nearly every site the same button does both,
// so the label after the click ("取消收藏", "Unsave") and aria-pressed are what actually decide it.
(() => {
  if (window.__briffyBookmark) return;
  window.__briffyBookmark = true;
  if (window.top !== window) return;          // the page itself, not its ad frames

  const { saveControl, pressedState, labelOf, UNDO_WORDS } = window.BriffySaveDetect;

  let lastSent = 0;
  let lastUrl = '';

  // Reading the post has to happen at click time. The site re-renders its own control the moment the
  // state flips -- on x.com the whole action bar is replaced within 350ms -- so by the time we check
  // which way the toggle went, the element we were handed is no longer in the document and walking up
  // from it finds nothing. That fallback quietly saved the first post on the page instead of yours.
  function read(el) {
    let page = { title: document.title, text: '', url: location.href };
    try { page = window.BriffyExtract.extract(document, el || null); } catch (e) { page.error = e.message; }
    return { ...page, url: page.url || location.href, pageUrl: location.href };
  }

  function send(page, why) {
    const now = Date.now();
    if (page.url === lastUrl && now - lastSent < 4000) return;   // one gesture, not three events
    lastSent = now; lastUrl = page.url;
    chrome.runtime.sendMessage({
      type: 'bookmarked',
      page: { ...page, why, at: new Date().toISOString() },
    }).catch(() => { /* worker asleep or extension reloaded */ });
  }

  // Which way did the toggle land? The control we clicked is usually gone by now, so ask the freshly
  // rendered DOM instead, finding the post again by the permalink we read at click time.
  function landedSaved(hit, page) {
    if (page.url && /\/(status|comments)\//.test(page.url)) {
      const link = [...document.querySelectorAll('a[href*="/status/"], a[href*="/comments/"]')]
        .find((a) => a.href.split('?')[0] === page.url);
      const post = link && link.closest('article, shreddit-post');
      if (post) {
        if (post.querySelector('[data-testid="removeBookmark"], [aria-label*="Unsave" i]')) return true;
        if (post.querySelector('[data-testid="bookmark"]')) return false;
      }
    }
    if (hit.el.isConnected) {
      const state = pressedState(hit.el);
      if (state !== null) return state;
      if (UNDO_WORDS.test(labelOf(hit.el)) && !hit.bySite) return false;
    }
    return null;   // cannot tell -- the click itself said "save", so take it
  }

  document.addEventListener('click', (e) => {
    if (!e.isTrusted) return;                         // a real click, not the page scripting itself
    const hit = saveControl(e.target);
    if (!hit) return;
    if (hit.undo) return;                             // that was an un-save
    const page = read(hit.el);                        // now, while the post is still on the page
    setTimeout(() => { if (landedSaved(hit, page) !== false) send(page, 'click'); }, 350);
  }, true);

  // Ctrl/Cmd+D is the browser's own bookmark, which fires no click anywhere in the page.
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'd' || e.key === 'D')) send(read(null), 'hotkey');
  }, true);
})();
