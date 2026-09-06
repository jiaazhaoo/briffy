// Runs in the extension's world at document_start, alongside hook.js. hook.js can see the page's
// requests but cannot talk to the service worker; this can. Findings are batched so a player pulling a
// segment every few seconds does not wake the worker on every one of them.
(() => {
  const TAG = 'briffy-hook';
  let queue = [];
  let timer = null;

  function flush() {
    timer = null;
    const items = queue;
    queue = [];
    if (!items.length) return;
    try {
      chrome.runtime.sendMessage({ type: 'hooked', items, pageUrl: location.href }).catch(() => {});
    } catch (_) { /* extension reloaded out from under the page */ }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== TAG || !d.url) return;
    queue.push({ url: d.url, how: d.how || '', mse: !!d.mse });
    if (queue.length > 60) queue = queue.slice(-60);
    if (!timer) timer = setTimeout(flush, 700);
  });
})();
