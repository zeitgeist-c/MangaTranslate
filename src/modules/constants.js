// dosya: src/modules/constants.js
// MangaLens TR — Modül sabitleri
// Tüm paylaşılan sabitler burada. Başka modüller buradan import eder.

'use strict';

// DOM işaretleme
export const ATTR = 'data-ml-state';           // <img> üzerindeki işlem durumu attribute'u
export const NS   = 'mangalens';                // CSS sınıf prefix'i

// Görsel filtreleme eşikleri (FIX-12)
export const MIN_IMG_W    = 150;
export const MIN_IMG_H    = 150;
export const MIN_IMG_AREA = 150 * 150;

// Görsel işleme sınırları
export const MAX_IMG_SIDE     = 1600;          // AI'a gönderilecek max kenar (px)
export const FALLBACK_SIDE    = 1200;          // 4MB'dan büyükse düş
export const IMG_JPEG_QUALITY = 0.85;          // PNG yerine JPEG kalitesi
export const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024; // 4 MB

// Cache sınırları
export const MAX_CACHE_BYTES = 500 * 1024 * 1024; // 500 MB hedef (unlimitedStorage ile)

// Selection mode
export const MAX_SELECTIONS = 10;

// Manga imgesi tespitinde kullanılan anahtar kelimeler (FIX-12 ile düzeltilmiş)
export const POSITIVE_KEYWORDS = [
  'page','chapter','manga','manhwa','manhua','webtoon',
  'comic','panel','reader','scan','content','artwork',
  'episode','slide','viewer','reader-content',
  'images','pages','image',
  'blob:','data:image',
];

export const NEGATIVE_KEYWORDS = [
  'avatar','icon','logo','banner','advertisement','sponsor',
  'thumbnail','profile','button','navbar','header','footer',
  'sidebar','comment','emoji','smiley','flag','favicon',
  'loading','spinner','placeholder',
];
