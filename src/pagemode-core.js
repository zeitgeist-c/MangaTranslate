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

  // ── Resim icerik dikdortgeni (object-fit / object-position / border farkindalikli) ──
  // Doner: { x, y, w, h, visible:{x,y,w,h}, clipped }  (x,y elemanin border-box'una gore CSS px)
  function parseObjectPosition(value) {
    const KW = { left: 0, right: 1, top: 0, bottom: 1, center: 0.5 };
    const parts = String(value || '50% 50%').trim().split(/\s+/);
    const one = function (token, fallback) {
      if (!token) return { f: fallback, px: 0 };
      const t = String(token).toLowerCase();
      if (t in KW) return { f: KW[t], px: 0 };
      const m = /^(-?[\d.]+)(px|%)?$/.exec(t);
      if (!m) return { f: fallback, px: 0 };
      const n = Number(m[1]);
      if (!Number.isFinite(n)) return { f: fallback, px: 0 };
      return m[2] === 'px' ? { f: 0, px: n } : { f: n / 100, px: 0 };
    };
    return { x: one(parts[0], 0.5), y: one(parts[1] || 'center', 0.5) };
  }

  function contentRectOf(info) {
    const i = info || {};
    const boxW = Number(i.boxW) || 0;
    const boxH = Number(i.boxH) || 0;
    if (!boxW || !boxH) return null;
    const bt = Number(i.borderTop) || 0;
    const bl = Number(i.borderLeft) || 0;
    const br = Number(i.borderRight) || 0;
    const bb = Number(i.borderBottom) || 0;
    const pt = Number(i.paddingTop) || 0;
    const pl = Number(i.paddingLeft) || 0;
    const pr = Number(i.paddingRight) || 0;
    const pb = Number(i.paddingBottom) || 0;
    const innerW = Math.max(1, boxW - bl - br - pl - pr);
    const innerH = Math.max(1, boxH - bt - bb - pt - pb);
    const nw = Number(i.naturalW) || 0;
    const nh = Number(i.naturalH) || 0;
    if (!nw || !nh) {
      return { x: bl + pl, y: bt + pt, w: innerW, h: innerH, visible: { x: bl + pl, y: bt + pt, w: innerW, h: innerH }, clipped: false };
    }
    const fit = String(i.objectFit || 'fill').toLowerCase();
    let drawW = innerW, drawH = innerH;
    if (fit !== 'fill') {
      const sx = innerW / nw, sy = innerH / nh;
      const contain = Math.min(sx, sy);
      const cover = Math.max(sx, sy);
      let scale = contain;
      if (fit === 'cover') scale = cover;
      else if (fit === 'none') scale = 1;
      else if (fit === 'scale-down') scale = Math.min(1, contain);
      drawW = nw * scale;
      drawH = nh * scale;
    }
    const pos = parseObjectPosition(i.objectPosition);
    const x = bl + pl + pos.x.f * (innerW - drawW) + pos.x.px;
    const y = bt + pt + pos.y.f * (innerH - drawH) + pos.y.px;
    const ix0 = Math.max(bl + pl, x), iy0 = Math.max(bt + pt, y);
    const ix1 = Math.min(bl + pl + innerW, x + drawW), iy1 = Math.min(bt + pt + innerH, y + drawH);
    return {
      x: x, y: y, w: drawW, h: drawH,
      visible: { x: ix0, y: iy0, w: Math.max(0, ix1 - ix0), h: Math.max(0, iy1 - iy0) },
      clipped: x < bl + pl - 0.5 || y < bt + pt - 0.5 || x + drawW > bl + pl + innerW + 0.5 || y + drawH > bt + pt + innerH + 0.5,
    };
  }

  // ── Piksel analiziyle balona oturtma (saf; DOM/canvas yok) ────────────────
  const SNAP_DEFAULTS = {
    brightLuma: 205,      // beyaz esigi
    brightSpread: 80,     // beyaz sayilmasi icin kanal farki (renkli/acik balonlar da gecsin)
    inkLuma: 120,         // yazi/siyah esigi
    minAreaRatio: 0.25,   // dolgu alani / model kutusu alani alt siniri
    maxAreaRatio: 10,     // aday bolge alani / model kutusu alani ust siniri
    minOutline: 0.5,      // bolgenin cerceveyle kapali olma orani (panel/zemin ayrimi)
    maxCost: 1.1,         // kabul edilen adayin en yuksek maliyeti
    goodCost: 0.35,       // bu maliyetin altinda aday "yeterince iyi": erken cik
    maxShiftRatio: 1.2,   // aday merkezi model kutusundan en fazla bu kadar (kosegen orani) uzak olabilir
    seedsPerBubble: 8,    // balon basina en fazla tohum denemesi
    maxRegionInkRatio: 8, // bolge alani / icindeki yazi bbox alani: buyukse panel/zemin
    runawayRatio: 0.35,   // pencere alanina gore bunu asarsa "arka plan"
    margin: 3,            // balon cercevesini korumak icin iceri alinacak pay (px)
    minSide: 8,
    textPad: 0.35,        // yazi bbox'ina eklenecek oransal pay
    textPadRatio: 0.28,   // metin blogu bulundugunda eklenecek pay (blok yuksekligine oranla)
    textMinInk: 40,       // metin blogu sayilmasi icin en az murekkep pikseli
    textMinCover: 0.10,   // blok, model kutusunun en az bu oranini kaplamali
    mergeIou: 0.5,
    maxFills: 200,        // sayfa basina en fazla dolgu denemesi (maliyet siniri)
    budgetPx: 1500000,    // toplam islenen piksel butcesi
  };

  function floodFillBright(seed, isBright, wx0, wy0, wx1, wy1, runawayArea, seen, rowMin, rowMax) {
    const w = wx1 - wx0 + 1;
    const start = ((seed.y - wy0) * w) + (seed.x - wx0);
    if (seen[start]) return null;                            // bu bolge zaten tarandi
    seen[start] = 1;
    const stack = [start];
    let area = 0, x0 = wx1, y0 = wy1, x1 = wx0, y1 = wy0, aborted = false;
    while (stack.length) {
      const idx = stack.pop();
      const lx = idx % w;
      const ly = (idx - lx) / w;
      const x = wx0 + lx, y = wy0 + ly;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (rowMin && lx < rowMin[ly]) rowMin[ly] = lx;         // kenar (cerceve) testi icin satir sinirlari
      if (rowMax && lx > rowMax[ly]) rowMax[ly] = lx;
      if (runawayArea && area > runawayArea) { aborted = true; break; }
      const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
      for (let i = 0; i < 4; i++) {
        const nx = nb[i][0], ny = nb[i][1];
        if (nx < wx0 || ny < wy0 || nx > wx1 || ny > wy1) continue;
        const nidx = (ny - wy0) * w + (nx - wx0);
        if (seen[nidx]) continue;
        seen[nidx] = 1;
        if (isBright(nx, ny)) stack.push(nidx);
      }
    }
    return { area: area, bbox: { x0: x0, y0: y0, x1: x1, y1: y1 }, aborted: aborted };
  }

  // ── Metin blogu bulma (renkli sanatta da calisir; balon cercevesi gerektirmez) ──
  // Model kutusu cevresindeki murekkep bilesenlerini bulur, satirlara/bloklara kumeler.
  function inkBlocksIn(data, W, H, box, opts) {
    const o = opts || {};
    const bx0 = Math.max(0, Math.floor(box.x)), by0 = Math.max(0, Math.floor(box.y));
    const bx1 = Math.min(W - 1, Math.ceil(box.x + box.width)), by1 = Math.min(H - 1, Math.ceil(box.y + box.height));
    const w = bx1 - bx0 + 1, h = by1 - by0 + 1;
    if (w < 6 || h < 6 || w * h > 4000000) return [];
    const lumaAt = function (x, y) {
      const i = (y * W + x) * 4;
      return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    };
    // Pencerenin ortalama parlakligi: kutupluluk karari icin
    let sum = 0, cnt = 0;
    for (let y = 0; y < h; y += 3) {
      for (let x = 0; x < w; x += 3) { sum += lumaAt(bx0 + x, by0 + y); cnt++; }
    }
    const bgLuma = cnt ? sum / cnt : 255;
    const maxGh = Math.max(12, Math.round(0.5 * box.height));
    const maxGw = Math.max(12, Math.round(1.0 * box.width));

    // Bilesenleri verilen kutuplulukta cikar (koyu murekkep ya da acik murekkep)
    function compsFor(mode) {
      const thr = mode === 'dark'
        ? Math.max(40, Math.min(200, bgLuma - 30))
        : Math.min(240, Math.max(60, bgLuma + 30));
      const seen = new Uint8Array(w * h);
      const list = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          if (seen[idx]) { continue; }
          seen[idx] = 1;
          const l0 = lumaAt(bx0 + x, by0 + y);
          if (mode === 'dark' ? l0 > thr : l0 < thr) continue;
          const stack = [idx];
          let n = 0, cx0 = x, cx1 = x, cy0 = y, cy1 = y;
          while (stack.length) {
            const cur = stack.pop();
            const lx = cur % w, ly = (cur - lx) / w;
            n++;
            if (lx < cx0) cx0 = lx;
            if (lx > cx1) cx1 = lx;
            if (ly < cy0) cy0 = ly;
            if (ly > cy1) cy1 = ly;
            const nb = [[lx - 1, ly], [lx + 1, ly], [lx, ly - 1], [lx, ly + 1]];
            for (let k = 0; k < 4; k++) {
              const nx = nb[k][0], ny = nb[k][1];
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              const nidx = ny * w + nx;
              if (seen[nidx]) continue;
              seen[nidx] = 1;
              const l1 = lumaAt(bx0 + nx, by0 + ny);
              if (mode === 'dark' ? l1 <= thr : l1 >= thr) stack.push(nidx);
            }
          }
          const cw = cx1 - cx0 + 1, ch = cy1 - cy0 + 1;
          if (n < 4 || ch > maxGh || cw > maxGw) continue;        // sanat cizgilerini ele
          list.push({ x: bx0 + cx0, y: by0 + cy0, w: cw, h: ch, n: n });
        }
      }
      return list;
    }

    // "Yaziya benzerlik": ayni boyutta cok sayida kucuk bilesen = harfler
    function textiness(list) {
      if (list.length < 4) return 0;
      const hs = list.map(function (c) { return c.h; }).sort(function (a, b) { return a - b; });
      const med = hs[Math.floor(hs.length / 2)] || 1;
      let good = 0, area = 0;
      list.forEach(function (c) {
        if (c.h >= med * 0.5 && c.h <= med * 1.8) good++;
        area += c.n;
      });
      return good * Math.log(1 + area);
    }

    const darkComps = compsFor('dark');
    const lightComps = compsFor('light');
    const useDark = textiness(darkComps) >= textiness(lightComps);
    const comps = useDark ? darkComps : lightComps;
    if (!comps.length) return [];
    // satirlara kumele
    const merge = function (list, gapX, gapY, minOverlap) {
      let changed = true;
      let cur = list.slice();
      while (changed) {
        changed = false;
        const out = [];
        for (let i = 0; i < cur.length; i++) {
          let a = cur[i];
          let merged = false;
          for (let j = 0; j < out.length; j++) {
            const b = out[j];
            const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
            const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
            const nearX = (b.x - (a.x + a.w)) <= gapX && (a.x - (b.x + b.w)) <= gapX;
            const nearY = (b.y - (a.y + a.h)) <= gapY && (a.y - (b.y + b.h)) <= gapY;
            const okOverlap = minOverlap ? (ox >= minOverlap * Math.min(a.w, b.w)) : true;
            if (ox > -gapX && oy > -gapY && nearX && nearY && okOverlap) {
              out[j] = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
                         w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x),
                         h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y),
                         n: a.n + b.n };
              merged = true;
              changed = true;
              break;
            }
          }
          if (!merged) out.push(a);
        }
        cur = out;
      }
      return cur;
    };
    const lines = merge(comps, Math.round(maxGh * 1.4), Math.round(maxGh * 0.6), 0);
    const blocks = merge(lines, Math.round(maxGh * 2.2), Math.round(maxGh * 1.2), 0.35);
    // pencere kenarina yapisik bloklar zemin/sanat olur; kac kenara dokundugunu isaretle
    return blocks.filter(function (b) { return b.n >= (o.textMinInk || 40); }).map(function (b) {
      const touch = (b.x <= bx0 + 1 ? 1 : 0) + (b.y <= by0 + 1 ? 1 : 0) +
                    (b.x + b.w >= bx1 ? 1 : 0) + (b.y + b.h >= by1 ? 1 : 0);
      return { x: b.x, y: b.y, w: b.w, h: b.h, n: b.n, touch: touch };
    });
  }

  // Haritalama kalitesi: kutularin icindeki "yazi gibi" murekkep orani (kutupluluk farkindalikli).
  // Iki farkli koordinat yorumunu (ornegin piksel ve binde-birim) karsilastirmak icin kullanilir.
  function textScoreIn(data, W, H, boxes, opts) {
    const o = opts || {};
    let total = 0, used = 0;
    (boxes || []).forEach(function (b) {
      const x0 = Math.max(0, Math.floor(b.x)), y0 = Math.max(0, Math.floor(b.y));
      const w = Math.max(1, Math.round(b.width)), h = Math.max(1, Math.round(b.height));
      const area = w * h;
      if (area < 400) return;
      const blocks = inkBlocksIn(data, W, H, { x: x0, y: y0, width: w, height: h }, o);
      let ink = 0;
      blocks.forEach(function (bl) {
        const ox = Math.min(bl.x + bl.w, x0 + w) - Math.max(bl.x, x0);
        const oy = Math.min(bl.y + bl.h, y0 + h) - Math.max(bl.y, y0);
        if (ox > 0 && oy > 0) ink += bl.n;
      });
      total += Math.min(0.5, ink / area);
      used++;
    });
    return used ? total / used : 0;
  }

  // Keep the detected interior rather than painting its rectangular bounding box.
  // Row envelopes bridge letter holes; a small inset preserves the printed outline.
  function bubbleInterior(rows, width, height, margin) {
    const inset = Math.max(1, Math.round(margin || 1));
    const safe = rows.map(function (row, y) {
      let left = row[0], right = row[1];
      for (let k = y - inset; k <= y + inset; k++) {
        if (!rows[k]) return [width, -1];
        left = Math.max(left, rows[k][0]);
        right = Math.min(right, rows[k][1]);
      }
      return [left + inset, right - inset];
    });
    // Find the broad body, independently of the bbox center: tails must not pull
    // the text down or sideways. Every row of the chosen rectangle stays inside.
    let best = null;
    for (let top = 0; top < height; top++) {
      let left = 0, right = width - 1;
      for (let bottom = top; bottom < height; bottom++) {
        left = Math.max(left, safe[bottom][0]);
        right = Math.min(right, safe[bottom][1]);
        if (right < left) break;
        const area = (right - left + 1) * (bottom - top + 1);
        if (!best || area > best.area) {
          best = { x: left / width, y: top / height,
            w: (right - left + 1) / width, h: (bottom - top + 1) / height, area: area };
        }
      }
    }
    if (!best || best.w * width < 4 || best.h * height < 4) return null;
    const l = [], r = [];
    safe.forEach(function (row, y) {
      if (row[1] < row[0]) return;
      l.push([row[0] / width, y / height], [row[0] / width, (y + 1) / height]);
      r.push([(row[1] + 1) / width, y / height], [(row[1] + 1) / width, (y + 1) / height]);
    });
    return { polygon: l.concat(r.reverse()), textRect: { x: best.x, y: best.y, w: best.w, h: best.h } };
  }

  function snapBubbles(input) {
    const opts = Object.assign({}, SNAP_DEFAULTS, (input && input.opts) || {});
    const data = input && input.data;
    const W = Math.max(1, Number(input && input.width) || 0);
    const H = Math.max(1, Number(input && input.height) || 0);
    const src = Array.isArray(input && input.bubbles) ? input.bubbles : [];
    const stats = { snapped: 0, text: 0, kept: 0, merged: 0, rejected: 0, pixels: 0, fills: 0 };
    if (!data || !W || !H || !src.length) return { bubbles: src.slice(), stats: stats };

    const isBright = function (x, y) {
      const i = (y * W + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      return (0.299 * r + 0.587 * g + 0.114 * b) >= opts.brightLuma && (mx - mn) <= opts.brightSpread;
    };
    const isInk = function (x, y) {
      const i = (y * W + x) * 4;
      return (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) <= opts.inkLuma;
    };
    // Bir dikdortgendeki murekkep (yazi) piksellerinin sayimi + bbox'i
    const inkIn = function (ix0, iy0, ix1, iy1) {
      let count = 0, bx0 = W, by0 = H, bx1 = -1, by1 = -1;
      for (let y = iy0; y <= iy1; y++) {
        for (let x = ix0; x <= ix1; x++) {
          if (!isInk(x, y)) continue;
          count++;
          if (x < bx0) bx0 = x;
          if (x > bx1) bx1 = x;
          if (y < by0) by0 = y;
          if (y > by1) by1 = y;
        }
      }
      return { count: count, bx0: bx0, by0: by0, bx1: bx1, by1: by1 };
    };

    const out = src.map(function (b) {
      const bx = Math.round(Number(b.x) || 0), by = Math.round(Number(b.y) || 0);
      const bw = Math.max(1, Math.round(Number(b.width) || 1)), bh = Math.max(1, Math.round(Number(b.height) || 1));
      const x0 = Math.max(0, bx), y0 = Math.max(0, by);
      const x1 = Math.min(W - 1, bx + bw - 1), y1 = Math.min(H - 1, by + bh - 1);
      if (x1 <= x0 || y1 <= y0) { stats.kept++; return Object.assign({}, b, { snap: 'model' }); }

      // Pencere, model kutusunun ~1.3 kati kadar genis olsun: balon kutunun biraz disinda kalabilir
      const pad = Math.max(28, Math.min(300, Math.round(1.3 * Math.max(bw, bh))));
      const wx0 = Math.max(0, x0 - pad), wy0 = Math.max(0, y0 - pad);
      const wx1 = Math.min(W - 1, x1 + pad), wy1 = Math.min(H - 1, y1 + pad);
      const winArea = (wx1 - wx0 + 1) * (wy1 - wy0 + 1);
      if (stats.pixels + winArea > opts.budgetPx) { stats.kept++; return Object.assign({}, b, { snap: 'model' }); }

      // 1) Dolgu adaylari: merkez -> ceyrek -> kenar ortasi -> genis capraz.
      //    Her aday olculur; yeterince iyi aday bulununca erken cikilir (maliyet siniri).
      const ccx = Math.round((x0 + x1) / 2);
      const ccy = Math.round((y0 + y1) / 2);
      const hx = Math.max(2, Math.round(bw / 2)), hy = Math.max(2, Math.round(bh / 2));
      const dxs = Math.max(2, Math.round(bw * 0.85)), dys = Math.max(2, Math.round(bh * 0.85));
      const qx = Math.max(2, Math.round(bw * 0.25)), qy = Math.max(2, Math.round(bh * 0.25));
      const seedList = [
        [ccx, ccy],
        [ccx - qx, ccy - qy], [ccx + qx, ccy - qy], [ccx - qx, ccy + qy], [ccx + qx, ccy + qy],
        [ccx - hx, ccy], [ccx + hx, ccy], [ccx, ccy - hy], [ccx, ccy + hy],
        [ccx - dxs, ccy - dys], [ccx + dxs, ccy - dys], [ccx - dxs, ccy + dys], [ccx + dxs, ccy + dys],
      ];
      const wW = wx1 - wx0 + 1, wH = wy1 - wy0 + 1;
      const seen = new Uint8Array(wW * wH);
      const rowMin = new Int32Array(wH), rowMax = new Int32Array(wH);
      const boxArea = Math.max(1, bw * bh);
      const boxDiag = Math.max(1, Math.sqrt(bw * bw + bh * bh));
      // Model kutusu cevresindeki yazi (murekkep) olcumu: yazi yedegi icin bir kez
      const inx0 = Math.max(0, x0 - Math.round(bw * 0.2)), iny0 = Math.max(0, y0 - Math.round(bh * 0.2));
      const inx1 = Math.min(W - 1, x1 + Math.round(bw * 0.2)), iny1 = Math.min(H - 1, y1 + Math.round(bh * 0.2));
      const inkNear = inkIn(inx0, iny0, inx1, iny1);
      const cands = [];
      let tried = 0;
      const maxAttempts = Math.min(seedList.length, opts.seedsPerBubble);
      for (let si = 0; si < seedList.length; si++) {
        if (tried >= maxAttempts) break;
        if (stats.fills >= opts.maxFills) break;         // sayfa geneli guvenlik siniri
        const sx = seedList[si][0], sy = seedList[si][1];
        if (sx < wx0 || sx > wx1 || sy < wy0 || sy > wy1) continue;
        if (!isBright(sx, sy)) continue;
        stats.fills++;
        tried++;
        for (let k = 0; k < wH; k++) { rowMin[k] = wW; rowMax[k] = -1; }
        const filled = floodFillBright({ x: sx, y: sy }, isBright, wx0, wy0, wx1, wy1, winArea * opts.runawayRatio, seen, rowMin, rowMax);
        if (!filled) continue;
        stats.pixels += filled.area;
        if (filled.aborted) continue;
        if (filled.area > boxArea * opts.maxAreaRatio) continue;
        const bot = filled.bbox;
        const rw = bot.x1 - bot.x0 + 1, rh = bot.y1 - bot.y0 + 1;
        if (rw < opts.minSide || rh < opts.minSide) continue;
        if (filled.area < boxArea * opts.minAreaRatio * 0.5) continue;
        const edgeCount = (bot.x0 <= wx0 + 1 ? 1 : 0) + (bot.x1 >= wx1 - 1 ? 1 : 0) + (bot.y0 <= wy0 + 1 ? 1 : 0) + (bot.y1 >= wy1 - 1 ? 1 : 0);
        if (edgeCount >= 3) continue;
        // cerceve testi: bolgenin sol/sag komsulari cogunlukla murekkep olmali (balon hatti)
        let dark = 0, total = 0;
        for (let k = 0; k < wH; k++) {
          if (rowMax[k] < 0) continue;
          const yy = wy0 + k;
          total += 2;
          // Anti-aliased outlines have a gray transition pixel before dark ink.
          let darkLeft = false, darkRight = false;
          for (let step = 1; step <= 3; step++) {
            if (rowMin[k] >= step && isInk(wx0 + rowMin[k] - step, yy)) darkLeft = true;
            if (rowMax[k] + step < wW && isInk(wx0 + rowMax[k] + step, yy)) darkRight = true;
          }
          if (darkLeft) dark++;
          if (darkRight) dark++;
        }
        const coverage = total ? dark / total : 0;
        if (coverage < opts.minOutline) continue;
        // boyut cezasi: dolgu alani degil KUTU alani model kutusuna ne kadar yakin
        const bboxRatio = (rw * rh) / boxArea;
        const areaPenalty = bboxRatio > 1 ? Math.log(bboxRatio) * 0.55 : -Math.log(bboxRatio) * 0.10;
        const dist = Math.sqrt(Math.pow(bot.x0 + rw / 2 - ccx, 2) + Math.pow(bot.y0 + rh / 2 - ccy, 2));
        if (dist > boxDiag * (opts.maxShiftRatio || 0.6)) continue;   // baska ogeye atlamayi engelle
        const cost = (dist / boxDiag) * 0.9 + areaPenalty + (1 - coverage) * 0.6;
        const rows = [];
        for (let y = bot.y0; y <= bot.y1; y++) {
          rows.push([wx0 + rowMin[y - wy0] - bot.x0, wx0 + rowMax[y - wy0] - bot.x0]);
        }
        const pixel = (sy * W + sx) * 4;
        cands.push({ x: bot.x0, y: bot.y0, width: rw, height: rh, area: filled.area, coverage: coverage, cost: cost,
          rows: rows, background: 'rgb(' + data[pixel] + ',' + data[pixel + 1] + ',' + data[pixel + 2] + ')' });
        if (cost <= opts.goodCost) break;                // yeterince iyi aday: erken cik
      }
      cands.sort(function (a, b) { return a.cost - b.cost; });
      if (!cands.length && tried) stats.rejected++;
      if (opts.debug) stats.cands = (stats.cands || []).concat([{ id: b.id || null, list: cands.slice(0, 6).map(function (c) { return { x: c.x, y: c.y, w: c.width, h: c.height, cost: Math.round(c.cost * 100) / 100, cov: Math.round(c.coverage * 100) / 100 }; }) }]);

      // 2) En iyi aday: en yakin + boyutu model kutusuna en yakin olan.
      //    Bolge, icindeki yaziya gore cok buyukse (panel/zemin) balon sayilmaz.
      let snapped = null;
      for (let ci = 0; ci < cands.length; ci++) {
        const c = cands[ci];
        if (c.cost > opts.maxCost) break;
        const ink = inkIn(c.x, c.y, c.x + c.width - 1, c.y + c.height - 1);
        if (ink.count) {
          const inkBoxArea = Math.max(1, (ink.bx1 - ink.bx0 + 1) * (ink.by1 - ink.by0 + 1));
          // Sparse text is normal in rounded speech balloons. Apply the panel
          // rejection only to nearly rectangular regions, not oval interiors.
          const rectangular = c.area / (c.width * c.height) > 0.88;
          if (rectangular && (c.width * c.height) / inkBoxArea > opts.maxRegionInkRatio) continue;
        }
        const interior = bubbleInterior(c.rows, c.width, c.height, opts.margin);
        if (!interior) continue;
        snapped = {
          x: c.x, y: c.y, width: c.width, height: c.height, snap: 'bubble',
          interior: interior, background: c.background,
        };
        break;
      }

      // 3a) Metin blogu oturtma — renkli sanatta balon cercevesi bulunamazsa yaziya otur.
      //     Model kutusu cevresindeki murekkep bilesenleri satir/blok olarak kumelenir,
      //     model kutusunun icinde kalan en iyi blok yeni kutu olur.
      if (!snapped) {
        const tpadX = Math.round(bw * 0.25), tpadY = Math.round(bh * 0.25);
        const blocks = inkBlocksIn(data, W, H,
          { x: x0 - tpadX, y: y0 - tpadY, width: bw + 2 * tpadX, height: bh + 2 * tpadY }, opts);
        let best = null, bestScore = 0;
        for (let bi2 = 0; bi2 < blocks.length; bi2++) {
          const bl = blocks[bi2];
          if (bl.touch >= 2) continue;                            // zemin/sanat blogu
          const ox = Math.min(bl.x + bl.w, x1 + 1) - Math.max(bl.x, x0);
          const oy = Math.min(bl.y + bl.h, y1 + 1) - Math.max(bl.y, y0);
          const inter = Math.max(0, ox) * Math.max(0, oy);
          const cover = inter / Math.max(1, bl.w * bl.h);         // blogun ne kadari model kutusunda
          if (cover < 0.55) continue;                             // blok buyuk olcude kutunun icinde olmali
          const rel = (bl.w * bl.h) / Math.max(1, bw * bh);
          if (rel < 0.12 || rel > 1.4) continue;                  // boyut benzer olmali (parca/panel degil)
          const bdcx = bl.x + bl.w / 2, bdcy = bl.y + bl.h / 2;
          const dist = Math.sqrt(Math.pow(bdcx - (x0 + bw / 2), 2) + Math.pow(bdcy - (y0 + bh / 2), 2));
          if (dist > boxDiag * (opts.maxShiftRatio || 0.6)) continue;  // uzaktaki bloga atlama
          const score = cover * Math.min(1, rel) * (1 - dist / (1.2 * boxDiag));
          if (score > bestScore) { bestScore = score; best = bl; }
        }
        if (best && bestScore >= (opts.textMinCover || 0.10)) {
          const pad = Math.max(2, Math.round(best.h * (opts.textPadRatio || 0.28)));
          const cand = { x: best.x - pad, y: best.y - pad, width: best.w + 2 * pad, height: best.h + 2 * pad };
          if (cand.width <= bw * 1.6 && cand.height <= bh * 1.6 && cand.width >= opts.minSide && cand.height >= opts.minSide) {
            snapped = Object.assign({}, cand, { snap: 'text' });
          }
        }
      }

      // 3) Yazi (ink) yedegi — balonsuz yazi / SFX
      if (!snapped && inkNear.count >= 12 && inkNear.count <= ((inx1 - inx0 + 1) * (iny1 - iny0 + 1)) * 0.6 && inkNear.bx1 > inkNear.bx0 && inkNear.by1 > inkNear.by0) {
        const inkW = inkNear.bx1 - inkNear.bx0 + 1, inkH = inkNear.by1 - inkNear.by0 + 1;
        // pay: oransal, ama model kutusunun %15 buyume sinirini asmamali
        const padX = Math.max(2, Math.min(Math.round(inkW * opts.textPad), Math.floor((bw * 1.15 - inkW) / 2)));
        const padY = Math.max(2, Math.min(Math.round(inkH * opts.textPad), Math.floor((bh * 1.15 - inkH) / 2)));
        const cand = {
          x: inkNear.bx0 - padX, y: inkNear.by0 - padY,
          width: inkW + 2 * padX, height: inkH + 2 * padY,
        };
        // Yazi yedegi model kutusunu BUYUTMEZ (en fazla %15) ve alani 3 katini gecmez;
        // aksi halde bulunan sey sanat/zemin olur, model kutusu korunur.
        if (cand.width <= bw * 1.15 && cand.height <= bh * 1.15 && (cand.width * cand.height) <= (bw * bh * 3)) {
          snapped = Object.assign({}, cand, { snap: 'text' });
        }
      }

      if (!snapped) { stats.kept++; return Object.assign({}, b, { snap: 'model' }); }
      if (snapped.snap === 'bubble') stats.snapped++; else stats.text++;
      const cx = Math.max(0, Math.min(W - 1, Math.round(snapped.x)));
      const cy = Math.max(0, Math.min(H - 1, Math.round(snapped.y)));
      const cw = Math.max(4, Math.min(W - cx, Math.round(snapped.width)));
      const ch = Math.max(4, Math.min(H - cy, Math.round(snapped.height)));
      return Object.assign({}, b, { x: cx, y: cy, width: cw, height: ch, snap: snapped.snap,
        interior: snapped.interior || null, background: snapped.background || null });
    });

    // 3) ayni bolgeye oturanlari birlestir (buyuk kutunun cevirisi korunur)
    const merged = [];
    out.slice().sort(function (a, b) { return (b.width * b.height) - (a.width * a.height); }).forEach(function (b) {
      const hit = merged.find(function (m) { return iou(m, b) >= opts.mergeIou; });
      if (hit) {
        if (b.translation && String(hit.translation || '').indexOf(b.translation) === -1) hit.translation = ((hit.translation || '') + ' ' + b.translation).trim();
        if (b.text && String(hit.text || '').indexOf(b.text) === -1) hit.text = ((hit.text || '') + ' ' + b.text).trim();
        stats.merged++;
      } else {
        merged.push(Object.assign({}, b));
      }
    });
    return { bubbles: merged, stats: stats };
  }

  // ── Ortusen kutulari ayir (kucuk kutudan ortusen serit kesilir) ────────────
  function resolveOverlaps(list, opts) {
    const o = opts || {};
    const maxRatio = o.maxRatio == null ? 0.25 : o.maxRatio;
    const minW = o.minWidth || 24, minH = o.minHeight || 14;
    const out = (Array.isArray(list) ? list : []).map(function (b) { return Object.assign({}, b); });
    const order = out.slice().sort(function (a, b) { return (b.width * b.height) - (a.width * a.height); });
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const big = order[i], small = order[j];
        // A detected contour must not be stretched or moved to resolve bbox overlap.
        if (small.interior) continue;
        const ox = Math.min(big.x + big.width, small.x + small.width) - Math.max(big.x, small.x);
        const oy = Math.min(big.y + big.height, small.y + small.height) - Math.max(big.y, small.y);
        if (ox <= 0 || oy <= 0) continue;
        const ratio = (ox * oy) / Math.max(1, Math.min(big.width * big.height, small.width * small.height));
        if (ratio <= maxRatio) continue;
        if (ox <= oy) {
          const amount = Math.min(ox, Math.max(0, small.width - minW));
          if (big.x <= small.x) { small.x += amount; small.width -= amount; }
          else { small.width -= amount; }
        } else {
          const amount = Math.min(oy, Math.max(0, small.height - minH));
          if (big.y <= small.y) { small.y += amount; small.height -= amount; }
          else { small.height -= amount; }
        }
      }
    }
    return out;
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
    contentRectOf: contentRectOf,
    snapBubbles: snapBubbles,
    bubbleInterior: bubbleInterior,
    inkBlocksIn: inkBlocksIn,
    textScoreIn: textScoreIn,
    resolveOverlaps: resolveOverlaps,
    isMangaCandidate: isMangaCandidate,
  };

  root.MLPagemodeCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
