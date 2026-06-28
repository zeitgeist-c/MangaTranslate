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

// 9Router endpoint — yerel 9Router instance (OpenAI uyumlu API)
// Kullanıcı kendi 9Router'ını http://localhost:20128'de çalıştırıyor.
// Combo kısa adları (gemini, gpt-5.5, deepseek, minimax vs.) 9Router'ın
// dahili key'leriyle çalışır, bizim ayrıca API key vermemiz gerekmez.
export const NINEROUTER_BASE_URL = 'http://localhost:20128/v1';
export const NINEROUTER_KEY = '';     // boş — 9Router kendi key'ini kullanır

// 9Router combo model zinciri (sırayla denenir)
// 9Router her combo için arka planda load balancing + failover yapar.
// gemini → Google Gemini 3 Flash Preview (multimodal, hızlı)
// qwen → Qwen-VL multimodal
// gpt-oss → OpenAI GPT OSS (text-only)
// nemotron → NVIDIA Nemotron (multimodal)
// cloudflare → Cloudflare Workers AI
// Herhangi biri 429/timeout alırsa sonrakine geçer.
export const MODEL_CHAIN = Object.freeze([
  'gemini',
  'qwen',
  'gpt-oss',
  'nemotron',
  'cloudflare',
]);

// Yeniden deneme için kabul edilen hatalar
export const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 408]);

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

// Zaman aşımı
export const REQUEST_TIMEOUT_MS    = 45_000;   // tek istek
export const HUNG_REQUEST_TIMEOUT  = 60_000;   // tüm çağrı zinciri
