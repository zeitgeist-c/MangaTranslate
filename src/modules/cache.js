// dosya: src/modules/cache.js
// MangaLens TR — Data URL Cache Modülü
// chrome.storage.local'da SHA-256 anahtarlı görsel cache.
// unlimitedStorage izni sayesinde 10MB sınırı yok (kullanıcı diski kadar).
// QuotaExceededError olursa LRU eviction (en eski %20 sil), tekrar dene.

'use strict';

import { hashKey, dataUrlBytes } from './imagePipeline.js';

const STORAGE_KEY = 'ml_image_cache_v1';   // versiyonlu — gelecekte migration için
const INDEX_KEY   = 'ml_image_cache_index_v1';
const STATS_KEY   = 'ml_cache_stats_v1';
const EVICT_RATIO = 0.20;                   // quota aşılırsa en eski %20'yi sil
const MAX_EVICT_ATTEMPTS = 3;

// ── Dahili: storage helper ───────────────────────────────────────────────────
function storageGet(keys) {
  return new Promise(resolve => {
    chrome.storage.local.get(keys, resolve);
  });
}

function storageSet(obj) {
  return new Promise(resolve => {
    chrome.storage.local.set(obj, resolve);
  });
}

function storageRemove(keys) {
  return new Promise(resolve => {
    chrome.storage.local.remove(keys, resolve);
  });
}

// ── Index (LRU için): { hashKey: { ts, bytes } } ────────────────────────────
async function readIndex() {
  const res = await storageGet([INDEX_KEY, STATS_KEY]);
  return {
    index: res[INDEX_KEY] || {},
    stats: res[STATS_KEY] || { count: 0, bytes: 0 },
  };
}

async function writeIndex(index, stats) {
  await storageSet({
    [INDEX_KEY]: index,
    [STATS_KEY]: stats,
  });
}

function computeStats(index) {
  let count = 0, bytes = 0;
  for (const k of Object.keys(index)) {
    count += 1;
    bytes += index[k].bytes || 0;
  }
  return { count, bytes };
}

// LRU: en eski %20'yi seç (ts'ye göre artan)
function pickEvictionVictims(index) {
  const entries = Object.entries(index)
    .sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
  const n = Math.max(1, Math.ceil(entries.length * EVICT_RATIO));
  return entries.slice(0, n).map(([k]) => k);
}

// ══════════════════════════════════════════════════════════════════════════════
//  Public API
// ══════════════════════════════════════════════════════════════════════════════

/**
 * img.src → SHA-256 → cache'de varsa dataUrl döner. Hit olursa ts güncellenir.
 *
 * @param {string} src
 * @returns {Promise<string|null>}
 */
export async function getCached(src) {
  if (!src) return null;
  const key = await hashKey(src);
  if (!key) return null;

  const res = await storageGet([STORAGE_KEY]);
  const dataUrl = res[STORAGE_KEY]?.[key];
  if (!dataUrl) return null;

  // LRU: hit'te ts güncelle
  const { index, stats } = await readIndex();
  if (index[key]) {
    index[key].ts = Date.now();
    await writeIndex(index, stats);
  }
  return dataUrl;
}

/**
 * Data URL'i cache'e yazar. QuotaExceeded olursa LRU eviction ile tekrar dener.
 *
 * @param {string} src
 * @param {string} dataUrl
 * @returns {Promise<{ ok: boolean, evicted?: number, error?: string }>}
 */
export async function setCached(src, dataUrl) {
  if (!src || !dataUrl) return { ok: false, error: 'src veya dataUrl eksik' };

  const key = await hashKey(src);
  if (!key) return { ok: false, error: 'hash üretilemedi' };

  const bytes = dataUrlBytes(dataUrl);
  let { index, stats } = await readIndex();

  const existing = await storageGet([STORAGE_KEY]);
  const map = existing[STORAGE_KEY] || {};
  map[key] = dataUrl;

  // 1. deneme
  let evicted = 0;
  for (let attempt = 0; attempt <= MAX_EVICT_ATTEMPTS; attempt++) {
    try {
      await storageSet({ [STORAGE_KEY]: map });
      index[key] = { ts: Date.now(), bytes };
      const newStats = computeStats(index);
      await writeIndex(index, newStats);
      return { ok: true, evicted };
    } catch (e) {
      // QuotaExceededError → LRU eviction yapıp tekrar dene
      const victims = pickEvictionVictims(index);
      if (victims.length === 0) {
        return { ok: false, error: `Quota aşıldı, eviction başarısız: ${e.message}` };
      }
      for (const v of victims) {
        delete map[v];
        delete index[v];
        evicted++;
      }
      // Sonraki denemede yine başarısız olursa diye bayrak (loop MAX_EVICT_ATTEMPTS sonra durur)
    }
  }
  return { ok: false, error: `Quota aşıldı, ${evicted} öğe silindi ama yazılamadı` };
}

/**
 * Tüm cache'i temizler.
 *
 * @returns {Promise<{ evicted: number }>}
 */
export async function clearCache() {
  const { index } = await readIndex();
  const evicted = Object.keys(index).length;
  await storageRemove([STORAGE_KEY, INDEX_KEY, STATS_KEY]);
  return { evicted };
}

/**
 * Cache istatistikleri.
 *
 * @returns {Promise<{ count: number, bytes: number }>}
 */
export async function getCacheStats() {
  const { stats } = await readIndex();
  return stats;
}

/**
 * Belirli bir girdiyi sil (örn. img hata verirse).
 *
 * @param {string} src
 * @returns {Promise<boolean>}
 */
export async function deleteCached(src) {
  if (!src) return false;
  const key = await hashKey(src);
  if (!key) return false;

  const existing = await storageGet([STORAGE_KEY]);
  const map = existing[STORAGE_KEY] || {};
  if (!map[key]) return false;

  delete map[key];
  await storageSet({ [STORAGE_KEY]: map });

  const { index, stats } = await readIndex();
  delete index[key];
  await writeIndex(index, computeStats(index));
  return true;
}
