// dosya: src/modules/urlChange.js
// MangaLens TR — SPA URL Degisimi Izleyici (FIX-06)
// title MutationObserver + history.pushState/replaceState patch + popstate.
// Manga siteleri SPA; kullanici "Sonraki Bolum" tiklayinca yeni img'ler gelir.

'use strict';

/**
 * URL degisimini izler; cagirildiginda cache sifirlanip yeniden taranir.
 *
 * @param {() => void} onUrlChange
 * @returns {() => void}   teardown
 */
export function setupUrlObserver(onUrlChange) {
  let lastUrl = location.href;

  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      onUrlChange();
    }
  });

  // Sadece <title> degisikliklerini izle (cok hafif, body subtree'sinden KACIN)
  const titleEl = document.querySelector('title');
  if (titleEl) {
    urlObserver.observe(titleEl, { childList: true, characterData: true });
  }
  // <head> altina yeni <title> eklenirse yakala
  urlObserver.observe(document.head || document.documentElement, { childList: true });

  // pushState / replaceState patch
  const _pushState    = history.pushState.bind(history);
  const _replaceState = history.replaceState.bind(history);
  history.pushState = function(...args) {
    _pushState(...args);
    if (location.href !== lastUrl) { lastUrl = location.href; onUrlChange(); }
  };
  history.replaceState = function(...args) {
    _replaceState(...args);
    if (location.href !== lastUrl) { lastUrl = location.href; onUrlChange(); }
  };
  const onPop = () => {
    if (location.href !== lastUrl) { lastUrl = location.href; onUrlChange(); }
  };
  window.addEventListener('popstate', onPop);

  return () => {
    urlObserver.disconnect();
    window.removeEventListener('popstate', onPop);
  };
}
