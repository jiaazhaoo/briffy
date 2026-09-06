// Deciding whether a click was "save this" or "un-save this".
//
// This is the whole risk of the feature: on nearly every site the same control does both, so getting it
// wrong means either missing what you saved or saving what you just removed. Kept apart from
// bookmark.js so dev/fixtures can put it against the real markup of each site without faking events.
(() => {
  // Words a save control uses, and the words it uses once the thing is already saved.
  const SAVE_WORDS = /(收藏|收藏本页|加入收藏|稍后再看|^save$|save (post|to|for)|bookmark|add to (bookmarks|favou?rites|reading list)|お気に入り|즐겨찾기)/i;
  // Sites put words between the verb and the noun ("Remove Tweet from Bookmarks"), and getting this
  // wrong is the expensive direction: it saves the thing at the moment you decided to un-save it.
  const UNDO_WORDS = /(取消收藏|已收藏|移除收藏|从收藏中移除|取消稍后再看|已加入|unsave|un-?bookmark|un-?favou?rite|(remove|delete)\b[\w\s'’]{0,24}\b(bookmark|favou?rite|saved|reading list)|saved to)/i;

  // Where a site's own selectors beat guessing from the label.
  const SITE_HINTS = [
    { match: /(^|\.)(x|twitter)\.com$/, sel: '[data-testid="bookmark"]', undo: '[data-testid="removeBookmark"]' },
    { match: /(^|\.)reddit\.com$/, sel: '[aria-label*="Save" i], shreddit-post-save-button, [data-post-click-location="save"]', undo: '[aria-label*="Unsave" i]' },
    { match: /(^|\.)xiaohongshu\.com$/, sel: '.collect-wrapper, .collect, [class*="collect"]', undo: '.collected, [class*="collected"]' },
    { match: /(^|\.)zhihu\.com$/, sel: '[aria-label*="收藏"], .Button--withLabel[class*="Favorite"]', undo: '' },
    // bilibili's collect button carries the count, not the word: its only text is "4242". Nothing in the
    // generic vocabulary can find it, and the word 收藏 on that page belongs to a link in the header
    // that goes to your favourites list -- which is why clicking near it looked like saving.
    { match: /(^|\.)bilibili\.com$/, sel: '.video-fav, .video-toolbar .fav, [class*="video-fav"]', undo: '.video-fav.on, .video-fav.actived' },
  ];
  const hintsFor = (host) => SITE_HINTS.filter((h) => h.match.test(host || location.hostname));

  // Only a control's own words count. aria-label, title and data-testid belong to the element that
  // carries them, but innerText is everything underneath -- and on a page of video cards every card's
  // container contains the word 收藏, because one of its buttons says so. Reading that as a label meant
  // clicking empty space anywhere near a save button looked like saving.
  // Requiring a <button> was too strict -- 小红书's collect control is a plain div -- so the test is on
  // shape rather than tag name: a widget holds a handful of nodes and a couple of words, a card holds a
  // page. Both have to be true, or a card containing one short button counts as a button.
  function ownText(el) {
    const t = (el.innerText || '').trim();
    if (!t || t.length > 14) return '';
    let kids = 0;
    try { kids = el.querySelectorAll('*').length; } catch (_) { return ''; }
    return kids <= 4 ? t : '';
  }
  const labelOf = (el) => [
    el.getAttribute && el.getAttribute('aria-label'),
    el.getAttribute && el.getAttribute('title'),
    el.getAttribute && el.getAttribute('data-testid'),
    ownText(el),
  ].filter(Boolean).join(' ').slice(0, 200);

  // Walk out from whatever was clicked: the handler is usually on a button several levels above the
  // icon that actually received the event.
  // A link that goes somewhere is navigation, not a control. Sites put "收藏" / "Saved" in the header as
  // a link to the list of what you saved; following it is not saving anything.
  function isNavigation(el) {
    if (!el.matches || !el.matches('a[href]')) return false;
    const href = el.getAttribute('href') || '';
    return !!href && !/^#|^javascript:/i.test(href);
  }

  function saveControl(target, host) {
    const hints = hintsFor(host);
    let el = target;
    for (let i = 0; el && i < 6; i++, el = el.parentElement) {
      if (!el.getAttribute) continue;
      if (isNavigation(el)) return null;
      for (const h of hints) {
        try {
          if (h.undo && el.closest(h.undo)) return { el, undo: true };
          if (el.closest(h.sel)) return { el, undo: false, bySite: true };
        } catch (_) { /* a selector this browser dislikes */ }
      }
      const label = labelOf(el);
      if (!label) continue;
      if (UNDO_WORDS.test(label)) return { el, undo: true };
      if (SAVE_WORDS.test(label)) return { el, undo: false };
    }
    return null;
  }

  // aria-pressed / aria-checked after the click is the site telling us which way the toggle went.
  function pressedState(el) {
    for (let n = el, i = 0; n && i < 6; i++, n = n.parentElement) {
      if (!n.getAttribute) continue;
      const v = n.getAttribute('aria-pressed') || n.getAttribute('aria-checked') || n.getAttribute('aria-selected');
      if (v === 'true') return true;
      if (v === 'false') return false;
    }
    return null;
  }


  window.BriffySaveDetect = { saveControl, pressedState, labelOf, isNavigation, SAVE_WORDS, UNDO_WORDS, SITE_HINTS, hintsFor };
})();
