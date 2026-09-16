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
    const innerW = Math.max(1, boxW - bl - br);
    const innerH = Math.max(1, boxH - bt - bb);
    const nw = Number(i.naturalW) || 0;
    const nh = Number(i.naturalH) || 0;
    if (!nw || !nh) {
      return { x: bl, y: bt, w: innerW, h: innerH, visible: { x: bl, y: bt, w: innerW, h: innerH }, clipped: false };
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
    const x = bl + pos.x.f * (innerW - drawW) + pos.x.px;
    const y = bt + pos.y.f * (innerH - drawH) + pos.y.px;
    const ix0 = Math.max(bl, x), iy0 = Math.max(bt, y);
    const ix1 = Math.min(bl + innerW, x + drawW), iy1 = Math.min(bt + innerH, y + drawH);
    return {
      x: x, y: y, w: drawW, h: drawH,
      visible: { x: ix0, y: iy0, w: Math.max(0, ix1 - ix0), h: Math.max(0, iy1 - iy0) },
      clipped: x < bl - 0.5 || y < bt - 0.5 || x + drawW > bl + innerW + 0.5 || y + drawH > bt + innerH + 0.5,
    };
  }

  // ── Piksel analiziyle balona oturtma (saf; DOM/canvas yok) ────────────────
  const SNAP_DEFAULTS = {
    brightLuma: 205,      // beyaz esigi
    brightSpread: 45,     // beyaz sayilmasi icin kanal farki
    inkLuma: 120,         // yazi/siyah esigi
    minAreaRatio: 0.25,   // dolgu alani / model kutusu alani alt siniri
    maxAreaRatio: 3.5,    // ust sinir
    runawayRatio: 0.35,   // pencere alanina gore bunu asarsa "arka plan"
    margin: 3,            // bulunan bolgeye eklenecek kenar payi (px)
    minSide: 8,
    textPad: 0.35,        // yazi bbox'ina eklenecek oransal pay
    mergeIou: 0.5,
    maxFills: 40,         // sayfa basina en fazla dolgu denemesi (maliyet siniri)
    budgetPx: 1500000,    // toplam islenen piksel butcesi
  };

  function floodFillBright(seed, isBright, wx0, wy0, wx1, wy1, runawayArea, seen) {
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

    const out = src.map(function (b) {
      const bx = Math.round(Number(b.x) || 0), by = Math.round(Number(b.y) || 0);
      const bw = Math.max(1, Math.round(Number(b.width) || 1)), bh = Math.max(1, Math.round(Number(b.height) || 1));
      const x0 = Math.max(0, bx), y0 = Math.max(0, by);
      const x1 = Math.min(W - 1, bx + bw - 1), y1 = Math.min(H - 1, by + bh - 1);
      if (x1 <= x0 || y1 <= y0) { stats.kept++; return Object.assign({}, b, { snap: 'model' }); }

      const pad = Math.max(24, Math.min(160, Math.round(0.9 * Math.max(bw, bh))));
      const wx0 = Math.max(0, x0 - pad), wy0 = Math.max(0, y0 - pad);
      const wx1 = Math.min(W - 1, x1 + pad), wy1 = Math.min(H - 1, y1 + pad);
      const winArea = (wx1 - wx0 + 1) * (wy1 - wy0 + 1);
      if (stats.pixels + winArea > opts.budgetPx) { stats.kept++; return Object.assign({}, b, { snap: 'model' }); }

      // 1) tohum adaylari: merkez -> capraz -> kenar ortasi -> ceyrek halka.
      //    Beyaz sayfa zemininde merkez zemine dusebilir; sirayla denenir, ilk KABUL edilen kazanir.
      const ccx = Math.round((x0 + x1) / 2);
      const ccy = Math.round((y0 + y1) / 2);
      const hx = Math.max(2, Math.round(bw / 2)), hy = Math.max(2, Math.round(bh / 2));
      const dx = Math.max(2, Math.round(bw * 0.85)), dy = Math.max(2, Math.round(bh * 0.85));
      const qx = Math.max(2, Math.round(bw * 0.25)), qy = Math.max(2, Math.round(bh * 0.25));
      const seedList = [
        [ccx, ccy],
        [ccx - dx, ccy - dy], [ccx + dx, ccy - dy], [ccx - dx, ccy + dy], [ccx + dx, ccy + dy],
        [ccx - hx, ccy], [ccx + hx, ccy], [ccx, ccy - hy], [ccx, ccy + hy],
        [ccx - qx, ccy - qy], [ccx + qx, ccy - qy], [ccx - qx, ccy + qy], [ccx + qx, ccy + qy],
      ];
      const seen = new Uint8Array((wx1 - wx0 + 1) * (wy1 - wy0 + 1));
      let snapped = null;
      let tried = 0;
      for (let si = 0; si < seedList.length && !snapped; si++) {
        if (stats.fills >= opts.maxFills) break;
        const sx = seedList[si][0], sy = seedList[si][1];
        if (sx < wx0 || sx > wx1 || sy < wy0 || sy > wy1) continue;
        if (!isBright(sx, sy)) continue;
        stats.fills++;
        tried++;
        const filled = floodFillBright({ x: sx, y: sy }, isBright, wx0, wy0, wx1, wy1, winArea * opts.runawayRatio, seen);
        if (!filled) continue;
        stats.pixels += filled.area;
        const bot = filled.bbox;
        const bw2 = bot.x1 - bot.x0 + 1, bh2 = bot.y1 - bot.y0 + 1;
        const areaRatio = filled.area / (bw * bh);
        const edgeCount = (bot.x0 <= wx0 + 1 ? 1 : 0) + (bot.x1 >= wx1 - 1 ? 1 : 0) + (bot.y0 <= wy0 + 1 ? 1 : 0) + (bot.y1 >= wy1 - 1 ? 1 : 0);
        const ok = !filled.aborted && areaRatio >= opts.minAreaRatio && areaRatio <= opts.maxAreaRatio && bw2 >= opts.minSide && bh2 >= opts.minSide && edgeCount < 3;
        if (ok) {
          snapped = { x: bot.x0 - opts.margin, y: bot.y0 - opts.margin, width: bw2 + 2 * opts.margin, height: bh2 + 2 * opts.margin, snap: 'bubble' };
        }
      }
      if (!snapped && tried) stats.rejected++;

      // 2) yazi (ink) kutusu yedegi — balonsuz yazi / SFX
      if (!snapped) {
        const ix0 = Math.max(0, x0 - Math.round(bw * 0.2)), iy0 = Math.max(0, y0 - Math.round(bh * 0.2));
        const ix1 = Math.min(W - 1, x1 + Math.round(bw * 0.2)), iy1 = Math.min(H - 1, y1 + Math.round(bh * 0.2));
        const searched = (ix1 - ix0 + 1) * (iy1 - iy0 + 1);
        let inkCount = 0, tx0 = W, ty0 = H, tx1 = -1, ty1 = -1;
        for (let y = iy0; y <= iy1; y++) {
          for (let x = ix0; x <= ix1; x++) {
            if (!isInk(x, y)) continue;
            inkCount++;
            if (x < tx0) tx0 = x;
            if (x > tx1) tx1 = x;
            if (y < ty0) ty0 = y;
            if (y > ty1) ty1 = y;
          }
        }
        // koyu zemin "tamamen murekkep" sayilmasin: alanin en fazla %60'i yazi olabilir
        if (inkCount >= 12 && inkCount <= searched * 0.6 && tx1 > tx0 && ty1 > ty0) {
          const padX = Math.max(4, Math.round((tx1 - tx0 + 1) * opts.textPad));
          const padY = Math.max(4, Math.round((ty1 - ty0 + 1) * opts.textPad));
          const cand = {
            x: tx0 - padX, y: ty0 - padY,
            width: (tx1 - tx0 + 1) + 2 * padX, height: (ty1 - ty0 + 1) + 2 * padY,
          };
          // Yazi yedegi model kutusunu BUYUTMEZ (en fazla %15) ve alani 3 katini gecmez;
          // aksi halde bulunan sey sanat/zemin olur, model kutusu korunur.
          if (cand.width <= bw * 1.15 && cand.height <= bh * 1.15 && (cand.width * cand.height) <= (bw * bh * 3)) {
            snapped = Object.assign({}, cand, { snap: 'text' });
          }
        }
      }

      if (!snapped) { stats.kept++; return Object.assign({}, b, { snap: 'model' }); }
      if (snapped.snap === 'bubble') stats.snapped++; else stats.text++;
      const cx = Math.max(0, Math.min(W - 1, Math.round(snapped.x)));
      const cy = Math.max(0, Math.min(H - 1, Math.round(snapped.y)));
      const cw = Math.max(4, Math.min(W - cx, Math.round(snapped.width)));
      const ch = Math.max(4, Math.min(H - cy, Math.round(snapped.height)));
      return Object.assign({}, b, { x: cx, y: cy, width: cw, height: ch, snap: snapped.snap });
    });

    // 3) ayni bolgeye oturanlari birlestir (buyuk kutunun cevirisi korunur)
    const merged = [];
    out.slice().sort(function (a, b) { return (b.width * b.height) - (a.width * a.height); }).forEach(function (b) {
      const hit = merged.find(function (m) { return iou(m, b) >= opts.mergeIou; });
      if (hit) {
        if (b.translation && hit.translation.indexOf(b.translation) === -1) hit.translation = (hit.translation + ' ' + b.translation).trim();
        if (b.text && hit.text.indexOf(b.text) === -1) hit.text = (hit.text + ' ' + b.text).trim();
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
    resolveOverlaps: resolveOverlaps,
    isMangaCandidate: isMangaCandidate,
  };

  root.MLPagemodeCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
