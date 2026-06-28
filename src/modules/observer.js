// dosya: src/modules/observer.js
// MangaLens TR — Sayfa Tarama + DOM İzleyici
// scanPage (isMangaImage FIX-12 korunur), MutationObserver, scroll listener.
// Çağıran orchestrator'a sonuçları callback ile bildirir.

'use strict';

import {
  ATTR,
  MIN_IMG_W,
  MIN_IMG_H,
  MIN_IMG_AREA,
  POSITIVE_KEYWORDS,
  NEGATIVE_KEYWORDS,
} from './constants.js';

/**
 * <img>'nin manga sayfası olup olmadığını tahmin eder.
 * FIX-12: boyut/display mantığı ayrılmış, anahtar kelime filtresi önce.
 *
 * @param {HTMLImageElement} img
 * @returns {boolean}
 */
export function isMangaImage(img) {
  if (img.hasAttribute(ATTR)) return false;

  const natW = img.naturalWidth  || 0;
  const natH = img.naturalHeight || 0;
  const cliW = img.clientWidth  || 0;
  const cliH = img.clientHeight || 0;
  const rect = img.getBoundingClientRect();
  const dispW = rect.width  || 0;
  const dispH = rect.height || 0;

  // Öncelik: natural → client → display → attr
  const w = natW || cliW || dispW || img.width  || 0;
  const h = natH || cliH || dispH || img.height || 0;

  if (w < MIN_IMG_W || h < MIN_IMG_H) return false;
  if (w * h < MIN_IMG_AREA) return false;

  const ratio = w / h;
  if (ratio < 0.2 || ratio > 5) return false;

  // İmza: src + class + id + parent class/id + alt + title
  const sig = [
    img.src || '',
    img.className || '',
    img.id || '',
    img.closest('[class]')?.className || '',
    img.closest('[id]')?.id || '',
    img.alt || '',
    img.title || '',
  ].join(' ').toLowerCase();

  const hasPositive = POSITIVE_KEYWORDS.some(k => sig.includes(k));
  const hasNegative = NEGATIVE_KEYWORDS.some(k => sig.includes(k));

  if (hasNegative && !hasPositive) return false;
  if (hasPositive) return true;

  // Anahtar kelime yoksa: büyük görsel kabul et
  return w >= 400 && h >= 400;
}

/**
 * Sayfadaki tüm manga img'lerini bulur.
 *
 * @returns {HTMLImageElement[]}
 */
export function scanPage() {
  return Array.from(document.querySelectorAll('img')).filter(isMangaImage);
}

/**
 * MutationObserver kurar — sayfaya yeni img eklenirse callback çağrılır.
 *
 * @param {(img: HTMLImageElement) => void} onNewImage
 * @returns {() => void} disconnect fonksiyonu
 */
export function setupMutationObserver(onNewImage) {
  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.tagName === 'IMG') {
          if (isMangaImage(node)) onNewImage(node);
        } else if (node.querySelectorAll) {
          node.querySelectorAll('img').forEach(img => {
            if (isMangaImage(img)) onNewImage(img);
          });
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/**
 * Scroll listener — debounced, scroll durduktan 500ms sonra callback.
 *
 * @param {() => void} onScrollSettle
 * @returns {() => void} kaldırma fonksiyonu
 */
export function setupScrollListener(onScrollSettle) {
  let timer = null;
  const handler = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onScrollSettle, 500);
  };
  window.addEventListener('scroll', handler, { passive: true });
  return () => {
    window.removeEventListener('scroll', handler);
    if (timer) clearTimeout(timer);
  };
}

/**
 * Tüm observer'ları birleşik olarak kurup tek disconnect döner.
 *
 * @param {(img: HTMLImageElement) => void} onNewImage
 * @param {() => void} onScrollSettle
 * @returns {() => void}
 */
export function setupAll(onNewImage, onScrollSettle) {
  const stopMutation = setupMutationObserver(onNewImage);
  const stopScroll   = setupScrollListener(onScrollSettle);
  return () => {
    stopMutation();
    stopScroll();
  };
}
