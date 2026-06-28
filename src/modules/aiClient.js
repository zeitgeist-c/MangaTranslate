// dosya: src/modules/aiClient.js
// MangaLens TR — AI İstemcisi (Content Tarafı)
// Canvas → resize → JPEG → background'a EXTRACT_BUBBLES → Bubble[].

'use strict';

import {
  canvasToJpegDataUrl,
  fitToPayload,
} from './imagePipeline.js';

/**
 * Verilen canvas'tan multimodal AI ile balon listesi çıkarır.
 *
 * Akış:
 *   1. Canvas'ı payload'a sığacak şekilde küçült (en uzun kenar 1600px veya 1200px)
 *   2. JPEG data URL'e çevir (q=0.85)
 *   3. Background'a EXTRACT_BUBBLES mesajı gönder
 *   4. Gelen Bubble[] dizisini doğrula ve döndür
 *
 * @param {HTMLCanvasElement} canvas      Doğal boyutlu manga sayfası
 * @returns {Promise<Bubble[]>}            Boş olabilir; hata durumunda []
 */
export async function extractBubbles(canvas) {
  if (!canvas || !canvas.width || !canvas.height) return [];

  const sized = fitToPayload(canvas);
  const dataUrl = canvasToJpegDataUrl(sized);
  if (!dataUrl) {
    console.warn('[MangaLens] Canvas tainted (CORS) — AI çağrısı atlanıyor');
    return [];
  }

  let response;
  try {
    response = await chrome.runtime.sendMessage({
      type: 'EXTRACT_BUBBLES',
      dataUrl,
      w: sized.width,
      h: sized.height,
    });
  } catch (e) {
    console.warn('[MangaLens] Mesaj gönderilemedi:', e.message);
    return [];
  }

  if (!response || !response.success) {
    console.warn('[MangaLens] AI hatası:', response?.error || 'yanıt yok');
    return [];
  }

  const bubbles = Array.isArray(response.bubbles) ? response.bubbles : [];
  // Boyut doğrulaması: AI verdiği bbox scaled canvas'a göre.
  // Orijinal canvas'a geri ölçekle.
  const sx = canvas.width  / sized.width;
  const sy = canvas.height / sized.height;
  if (Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return bubbles;

  return bubbles.map(b => ({
    text:   b.text,
    x:      Math.round(b.x      * sx),
    y:      Math.round(b.y      * sy),
    width:  Math.round(b.width  * sx),
    height: Math.round(b.height * sy),
  }));
}

/**
 * Tek bir görsel için sadece boyut küçültme + JPEG (test/önizleme için).
 * Background'a mesaj göndermez.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {{ dataUrl: string|null, width: number, height: number }}
 */
export function preparePayload(canvas) {
  const sized = fitToPayload(canvas);
  return {
    dataUrl: canvasToJpegDataUrl(sized),
    width:   sized.width,
    height:  sized.height,
  };
}
