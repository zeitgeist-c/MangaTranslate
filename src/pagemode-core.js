// dosya: src/pagemode-core.js
// MangaLens TR — Sayfa modu saf yardimcilari (DOM yok, chrome yok).
// Yuklenir: manifest content_scripts (content.js'ten sonra) + background.js importScripts + node testleri (require).
'use strict';

(function (root) {
  const CACHE_PREFIX = 'pc1:';

  // ── Hash: FNV-1a tabanli 64-bit benzeri (crypto.subtle GEREKTIRMEZ; http sayfalarda da calisir) ──
  function fnv1aHex(input) {
    const s = String(input == null ? '' : input);
    let a = 0x811c9dc5;
    let b = 0xcbf29ce4;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ (c + i), 0x85ebca6b) >>> 0;
    }
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
  }

  // ── Cache anahtari: ayni gorsel farkli index'te olsa da ayni anahtar ──
  function pageCacheKey(info) {
    const i = info || {};
    return CACHE_PREFIX + fnv1aHex(String(i.src || '') + '|' + Number(i.w || 0) + 'x' + Number(i.h || 0));
  }

  function clampInt(v, min, max) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  // ── Olcekleme: en uzun kenar maxSide'yi gecmesin (kucuk gorsel buyutulmez) ──
  function scaleForMaxSide(w, h, maxSide) {
    const W = Math.max(1, Number(w) || 0);
    const H = Math.max(1, Number(h) || 0);
    const longest = Math.max(W, H);
    if (longest <= maxSide) return { scale: 1, width: W, height: H };
    const scale = maxSide / longest;
    return { scale: scale, width: Math.max(1, Math.round(W * scale)), height: Math.max(1, Math.round(H * scale)) };
  }

  // ── Bant plani: dikey dilimler, esit aralikli, ortusmeli, bosluksuz, tam kapsar ──
  function planBands(w, h, opts) {
    const o = opts || {};
    const W = Math.max(1, Math.round(Number(w) || 0));
    const H = Math.max(1, Math.round(Number(h) || 0));
    const maxHeight = Math.max(200, Math.round(o.maxHeight || 1800));
    const overlapPx = Math.max(0, Math.round(o.overlapPx == null ? 200 : o.overlapPx));
    if (H <= maxHeight) {
      return [{ index: 0, count: 1, x: 0, y: 0, width: W, height: H }];
    }
    const step = Math.max(50, maxHeight - overlapPx);
    const spans = Math.max(1, Math.ceil((H - maxHeight) / step));
    const count = spans + 1;
    const out = [];
    for (let i = 0; i < count; i++) {
      const y = (i === count - 1) ? (H - maxHeight) : Math.round((i * (H - maxHeight)) / spans);
      out.push({ index: i, count: count, x: 0, y: y, width: W, height: maxHeight });
    }
    return out;
  }

  // ── Koordinat uzayi tespiti: kanit yoksa 'pixels' (geriye uyumlu varsayilan) ──
  function detectCoordSpace(sample) {
    const arr = Array.isArray(sample) ? sample : [];
    let sawFinite = false;
    for (let i = 0; i < arr.length; i++) {
      const b = arr[i] || {};
      const vals = [b.x, b.y, b.width, b.height, b.left, b.top];
      for (let j = 0; j < vals.length; j++) {
        const v = Number(vals[j]);
        if (!Number.isFinite(v)) continue;
        sawFinite = true;
        if (v > 1.0001) return 'pixels';
      }
    }
    return sawFinite ? 'normalized' : 'pixels';
  }

  function truncateMarked(text, maxLen) {
    const s = String(text == null ? '' : text).trim();
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen) + '…';
  }

  // ── Balon temizleme: alan adlarini normalize et, kirp/kaydir, kucukleri at ──
  // Not: resim disina tasan kutu ATILMAZ, iceri kaydirilir (ceviri kaybi olmasin).
  function sanitizeBubbles(arr, opts) {
    const o = opts || {};
    const W = Math.max(1, Number(o.w) || 0);
    const H = Math.max(1, Number(o.h) || 0);
    const space = o.coordSpace || 'pixels';
    const maxLen = o.maxLen == null ? 200 : o.maxLen;
    const minSizePct = o.minSizePct == null ? 0.004 : o.minSizePct;
    const sx = space === 'normalized' ? W : 1;
    const sy = space === 'normalized' ? H : 1;
    const minW = Math.max(2, Math.round(W * minSizePct));
    const minH = Math.max(2, Math.round(H * minSizePct));

    const out = [];
    (Array.isArray(arr) ? arr : []).forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      let x = Number(it.x != null ? it.x : it.left);
      let y = Number(it.y != null ? it.y : it.top);
      let bw = Number(it.width != null ? it.width : (it.w != null ? it.w : (Number(it.right) - Number(it.x))));
      let bh = Number(it.height != null ? it.height : (it.h != null ? it.h : (Number(it.bottom) - Number(it.y))));
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (!Number.isFinite(bw) || bw <= 0) bw = Math.max(1, (W / sx) - x);
      if (!Number.isFinite(bh) || bh <= 0) bh = Math.max(1, (H / sy) - y);

      // Normalize -> piksel
      const px = x * sx, py = y * sy, pw = bw * sx, ph = bh * sy;
      if (pw < minW || ph < minH) return;                 // gurultu/cok kucuk kutu

      let cw = clampInt(pw, 1, W);
      let ch = clampInt(ph, 1, H);
      let cx = clampInt(px, 0, W - 1);
      let cy = clampInt(py, 0, H - 1);
      if (cx + cw > W) cx = Math.max(0, W - cw);          // sagdan tasarsa iceri kaydir
      if (cy + ch > H) cy = Math.max(0, H - ch);          // alttan tasarsa iceri kaydir
      if (cw < minW || ch < minH) return;

      const text = truncateMarked(it.text, maxLen);
      const translation = truncateMarked(it.translation, maxLen);
      if (!text && !translation) return;

      out.push({ text: text, translation: translation, x: cx, y: cy, width: cw, height: ch });
    });
    return out;
  }

  function iou(a, b) {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width);
    const y2 = Math.min(a.y + a.height, b.y + b.height);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    if (!inter) return 0;
    const union = a.width * a.height + b.width * b.height - inter;
    return union > 0 ? inter / union : 0;
  }

  // ── Bant ortusmesinden dogan tekrarlari birlestir (en buyuk kutu kalir) ──
  function dedupeBubbles(list, opts) {
    const o = opts || {};
    const thr = o.iouThreshold == null ? 0.6 : o.iouThreshold;
    const src = (Array.isArray(list) ? list : []).slice()
      .sort(function (a, b) { return (b.width * b.height) - (a.width * a.height); });
    const kept = [];
    src.forEach(function (b) {
      const dup = kept.some(function (k) { return iou(k, b) >= thr; });
      if (!dup) kept.push(b);
    });
    return kept;
  }

  // ── Bant koordinati -> sayfa yuzdesi (bindirme icin) ──
  function bandToGlobal(bubble, band, imageW, imageH) {
    const W = Math.max(1, Number(imageW) || 1);
    const H = Math.max(1, Number(imageH) || 1);
    const bx = Number(band.x) || 0;
    const by = Number(band.y) || 0;
    return {
      text: bubble.text || '',
      translation: bubble.translation || '',
      xPct: (bx + Number(bubble.x)) / W,
      yPct: (by + Number(bubble.y)) / H,
      wPct: Number(bubble.width) / W,
      hPct: Number(bubble.height) / H,
    };
  }

  // ── Sira: gorunen (merkeze yakinlik) -> alttakiler -> usttekiler ──
  function sortPagesForTranslation(pages, viewport) {
    const vp = viewport || { top: 0, bottom: 0 };
    const arr = (Array.isArray(pages) ? pages : []).slice();
    const vpMid = (vp.top + vp.bottom) / 2;
    const rank = function (p) {
      const r = p.rect || { top: 0, bottom: 0 };
      if (r.bottom > vp.top && r.top < vp.bottom) return 0;
      if (r.top >= vp.bottom) return 1;
      return 2;
    };
    return arr.sort(function (a, b) {
      const ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      const rectA = a.rect || {}, rectB = b.rect || {};
      if (ra === 0) return Math.abs(((rectA.top + rectA.bottom) / 2) - vpMid) - Math.abs(((rectB.top + rectB.bottom) / 2) - vpMid);
      if (ra === 1) return rectA.top - rectB.top;
      return rectB.bottom - rectA.bottom;
    });
  }

  // ── Font tahmini (gercek olcum DOM tarafinda; bu baslangic degeridir) ──
  function estimateFontSize(boxW, boxH, chars, opts) {
    const o = opts || {};
    const min = o.min == null ? 9 : o.min;
    const max = o.max == null ? 18 : o.max;
    const w = Math.max(1, Number(boxW) || 0);
    const h = Math.max(1, Number(boxH) || 0);
    const n = Math.max(1, Number(chars) || 1);
    const byHeight = h * 0.42;
    const byWidth = Math.sqrt((w * h) / (n * 0.62));
    return clampInt(Math.min(byHeight, byWidth), min, max);
  }

  // ── Manga gorseli adayi mi? (v2.7 isMangaImage fikri, DOM'suz halde) ──
  const NEGATIVE = ['avatar', 'icon', 'logo', 'banner', 'advert', 'sponsor', 'thumbnail', 'profile', 'button', 'navbar', 'footer', 'sidebar', 'comment', 'emoji', 'flag', 'favicon', 'loading', 'spinner', 'placeholder'];
  const POSITIVE = ['page', 'chapter', 'manga', 'manhwa', 'manhua', 'webtoon', 'comic', 'panel', 'reader', 'scan', 'episode', 'viewer', 'images'];

  function isMangaCandidate(info) {
    const i = info || {};
    const w = Number(i.w) || 0;
    const h = Number(i.h) || 0;
    if (w < 150 || h < 150) return false;
    if (w * h < 150 * 150) return false;
    const ratio = w / h;
    if (ratio < 0.02 || ratio > 8) return false;       // uzun serit (webtoon) de gecerli: 1:50'ye kadar
    const sig = (String(i.src || '') + ' ' + String(i.cls || '') + ' ' + String(i.alt || '')).toLowerCase();
    const hasPositive = POSITIVE.some(function (k) { return sig.indexOf(k) !== -1; });
    const hasNegative = NEGATIVE.some(function (k) { return sig.indexOf(k) !== -1; });
    if (hasNegative && !hasPositive) return false;
    if (hasPositive) return true;
    return w >= 400 && h >= 400;
  }

  const api = {
    fnv1aHex: fnv1aHex,
    pageCacheKey: pageCacheKey,
    clampInt: clampInt,
    scaleForMaxSide: scaleForMaxSide,
    planBands: planBands,
    detectCoordSpace: detectCoordSpace,
    sanitizeBubbles: sanitizeBubbles,
    dedupeBubbles: dedupeBubbles,
    iou: iou,
    bandToGlobal: bandToGlobal,
    sortPagesForTranslation: sortPagesForTranslation,
    estimateFontSize: estimateFontSize,
    isMangaCandidate: isMangaCandidate,
  };

  root.MLPagemodeCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
