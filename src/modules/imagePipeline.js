// dosya: src/modules/imagePipeline.js
// MangaLens TR — Görsel Pipeline Yardımcıları
// imageToCanvas (CORS fallback dahil), resize, JPEG dataUrl, SHA-256 hashKey

'use strict';

import { MAX_IMG_SIDE, FALLBACK_SIDE, IMG_JPEG_QUALITY, MAX_PAYLOAD_BYTES } from './constants.js';

/**
 * <img>'yi HTMLCanvasElement'e çizer.
 * Mevcut content.js:382-410 kodunun birebir taşınmış hali.
 * - Doğal boyut (naturalWidth/Height) tercih edilir; yoksa clientWidth/Height
 * - CORS tainted ise crossOrigin Image ile tekrar denenir
 * - Başarısızsa null döner
 *
 * @param {HTMLImageElement} img
 * @returns {Promise<HTMLCanvasElement|null>}
 */
export function imageToCanvas(img) {
  return new Promise(resolve => {
    const w = img.naturalWidth  || img.clientWidth  || 0;
    const h = img.naturalHeight || img.clientHeight || 0;
    if (!w || !h) { resolve(null); return; }

    const canvas = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) { resolve(null); return; }

    // Okunabilirlik için hafif contrast artışı
    ctx.filter = 'contrast(1.10) brightness(1.02)';

    const draw = (src) => {
      try {
        ctx.drawImage(src, 0, 0, w, h);
        resolve(canvas);
      } catch {
        resolve(null);
      }
    };

    try {
      draw(img);
    } catch {
      // CORS engeli — crossOrigin ile tekrar dene
      const tmp = new Image();
      tmp.crossOrigin = 'anonymous';
      tmp.onload  = () => draw(tmp);
      tmp.onerror = () => resolve(null);
      tmp.src = img.src;
    }
  });
}

/**
 * Canvas'ı en uzun kenarı maxSide olacak şekilde küçültür.
 * Büyük görseller AI'a gönderilmeden önce zorunlu.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} maxSide
 * @returns {HTMLCanvasElement}  yeni canvas (küçültme gerekmiyorsa aynısı)
 */
export function resizeCanvas(canvas, maxSide = MAX_IMG_SIDE) {
  const w = canvas.width;
  const h = canvas.height;
  const longest = Math.max(w, h);

  if (longest <= maxSide) return canvas;

  const ratio = maxSide / longest;
  const nw = Math.round(w * ratio);
  const nh = Math.round(h * ratio);

  const out = document.createElement('canvas');
  out.width  = nw;
  out.height = nh;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, nw, nh);
  return out;
}

/**
 * Canvas'ı JPEG data URL'e çevirir.
 * CORS tainted canvas → SecurityError → null döner.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} quality   0..1
 * @returns {string|null}
 */
export function canvasToJpegDataUrl(canvas, quality = IMG_JPEG_QUALITY) {
  try {
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    // Tainted canvas (cross-origin img) — bu sayfanın <img>'si değiştirilemez
    return null;
  }
}

/**
 * Bir görseli, hedef payload boyutuna uygun şekilde hazırlar.
 * Önce maxSide'a küçültür, hâlâ büyükse daha agresif küçültür.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {HTMLCanvasElement}
 */
export function fitToPayload(canvas) {
  let cur = resizeCanvas(canvas, MAX_IMG_SIDE);
  if (cur.toDataURL('image/jpeg', IMG_JPEG_QUALITY).length > MAX_PAYLOAD_BYTES) {
    cur = resizeCanvas(canvas, FALLBACK_SIDE);
  }
  return cur;
}

/**
 * URL'den SHA-256 hex üretir. Cache anahtarı olarak kullanılır.
 * Boş/aynı URL → aynı key. Farklı sorgu param → farklı key.
 *
 * @param {string} url
 * @returns {Promise<string>} 64-char hex
 */
export async function hashKey(url) {
  if (!url) return '';
  const buf = new TextEncoder().encode(url);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Data URL'in yaklaşık byte cinsinden boyutunu döner (base64 3/4 oranı).
 *
 * @param {string} dataUrl
 * @returns {number}
 */
export function dataUrlBytes(dataUrl) {
  if (!dataUrl) return 0;
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  // base64 padding temizle
  const padded = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const padding = (padded.match(/=+$/) || [''])[0].length;
  return Math.floor((padded.length * 3) / 4) - padding;
}
