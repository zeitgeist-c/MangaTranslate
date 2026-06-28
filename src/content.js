// dosya: src/content.js (v3 - minimal)
// Selection Mode + Selection Translate
// Bu dosya TAMAMEN sıfırdan minimal yazıldı. Test için.

'use strict';

console.log('[MangaLens] v3 minimal content.js yukleniyor...');

const NS = 'mangalens';

let sm_active = false;
let sm_areas = [];
let sm_overlay = null;
let sm_controls = null;

// ── Mesaj dinleyici ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  console.log('[MangaLens] mesaj:', message.type);

  if (message.type === 'START_SELECTION_MODE') {
    enterSelectionMode();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'STOP_SELECTION_MODE') {
    exitSelectionMode();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'TRANSLATE_SELECTION') {
    translateSelection()
      .then(function(result) {
        sendResponse({ ok: true, count: result });
      })
      .catch(function(err) {
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }

  // v2: Otomatik 3x3 grid ceviri
  if (message.type === 'TRANSLATE_PAGE') {
    console.log('[MangaLens-v2] TRANSLATE_PAGE aldi');
    translatePage()
      .then(function(result) { sendResponse(result); })
      .catch(function(err) { sendResponse({ ok: false, error: err.message }); });
    return true;
  }

  // v2.2: Cache temizle + yeniden cevir
  if (message.type === 'RESET_AND_RETRANSLATE') {
    console.log('[MangaLens-v2.2] RESET_AND_RETRANSLATE');
    translatedPages.clear();
    translateVisiblePages()
      .then(function(result) { sendResponse(result); })
      .catch(function(err) { sendResponse({ ok: false, error: err.message }); });
    return true;
  }

  return true;
});

// ── Selection Mode UI ────────────────────────────────────────────────────────

function enterSelectionMode() {
  if (sm_active) return;
  sm_active = true;
  sm_areas = [];

  document.body.style.cursor = 'crosshair';

  // Overlay (koyu arka plan)
  sm_overlay = document.createElement('div');
  sm_overlay.style.cssText =
    'position:fixed!important;top:0!important;left:0!important;' +
    'width:100%!important;height:100%!important;' +
    'background:rgba(0,0,0,0.3)!important;z-index:99998!important;' +
    'pointer-events:none!important;';
  document.body.appendChild(sm_overlay);

  // Alt kontrol
  sm_controls = document.createElement('div');
  sm_controls.style.cssText =
    'position:fixed!important;bottom:20px!important;left:50%!important;' +
    'transform:translateX(-50%)!important;' +
    'background:rgba(20,10,40,0.95)!important;' +
    'border:1px solid rgba(124,58,237,0.4)!important;border-radius:8px!important;' +
    'padding:10px 16px!important;display:flex!important;gap:10px!important;' +
    'z-index:99999!important;';
  sm_controls.innerHTML =
    '<span style="color:#c4b5fd;font-size:12px;align-self:center;">' +
    'Secili: <span id="ml-count">0</span></span>' +
    '<button id="ml-cancel" style="padding:6px 16px;border-radius:4px;' +
    'border:1px solid rgba(124,58,237,0.4);font-size:12px;font-weight:600;' +
    'cursor:pointer;background:rgba(124,58,237,0.2);color:#c4b5fd;">' +
    'Iptal (Esc)</button>' +
    '<button id="ml-confirm" style="padding:6px 16px;border-radius:4px;' +
    'border:none;font-size:12px;font-weight:600;cursor:pointer;' +
    'background:#e5193a;color:white;">Cevir (Enter)</button>';
  document.body.appendChild(sm_controls);

  document.getElementById('ml-cancel').addEventListener('click', exitSelectionMode);
  document.getElementById('ml-confirm').addEventListener('click', function() {
    confirmSelection();
  });

  document.addEventListener('mousedown', onSmStart, true);
  document.addEventListener('mousemove', onSmMove, true);
  document.addEventListener('mouseup', onSmEnd, true);
  document.addEventListener('keydown', onSmKey, true);
}

function exitSelectionMode() {
  if (!sm_active) return;
  sm_active = false;

  document.body.style.cursor = '';
  document.removeEventListener('mousedown', onSmStart, true);
  document.removeEventListener('mousemove', onSmMove, true);
  document.removeEventListener('mouseup', onSmEnd, true);
  document.removeEventListener('keydown', onSmKey, true);

  document.querySelectorAll('.ml-box').forEach(function(el) { el.remove(); });
  if (sm_overlay) sm_overlay.remove();
  if (sm_controls) sm_controls.remove();
  sm_overlay = null;
  sm_controls = null;
}

let sm_start = null;
let sm_box = null;

function onSmStart(e) {
  if (e.target.closest('.ml-box')) return;
  if (e.target.closest('#ml-cancel') || e.target.closest('#ml-confirm')) return;
  if (e.button !== 0) return;
  sm_start = { x: e.clientX, y: e.clientY };

  sm_box = document.createElement('div');
  sm_box.className = 'ml-box';
  sm_box.style.cssText =
    'position:absolute!important;border:2px solid #e5193a!important;' +
    'background:rgba(229,25,58,0.1)!important;pointer-events:auto!important;' +
    'cursor:move!important;z-index:99999!important;';
  document.body.appendChild(sm_box);
}

function onSmMove(e) {
  if (!sm_start || !sm_box) return;
  var x = Math.min(sm_start.x, e.clientX);
  var y = Math.min(sm_start.y, e.clientY);
  var w = Math.abs(e.clientX - sm_start.x);
  var h = Math.abs(e.clientY - sm_start.y);
  sm_box.style.left = x + 'px';
  sm_box.style.top = y + 'px';
  sm_box.style.width = w + 'px';
  sm_box.style.height = h + 'px';
}

function onSmEnd() {
  if (!sm_start || !sm_box) return;
  var rect = sm_box.getBoundingClientRect();
  var area = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  if (area.width > 20 && area.height > 20) {
    sm_areas.push(area);
    var c = document.getElementById('ml-count');
    if (c) c.textContent = sm_areas.length;
  } else {
    sm_box.remove();
  }
  sm_box = null;
  sm_start = null;
}

function onSmKey(e) {
  if (e.key === 'Escape') exitSelectionMode();
  else if (e.key === 'Enter') confirmSelection();
}

function confirmSelection() {
  if (sm_areas.length === 0) {
    exitSelectionMode();
    return;
  }
  var areas = sm_areas.slice();
  exitSelectionMode();
  translateAreas(areas);
}

async function translateAreas(areas) {
  for (var i = 0; i < areas.length; i++) {
    await translateOne(areas[i]);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  v2: Otomatik Sayfa Çevirisi (Grid Tabanlı)
// ══════════════════════════════════════════════════════════════════════════════

// Grid ayarları
const GRID_COLS = 3;
const GRID_ROWS = 3;
const GRID_OVERLAP = 16;   // px, kenarda kalan balonları yakala

// SHA-256 hash (hex) - cache key uretimi
async function sha256Hex(input) {
  try {
    var buf = new TextEncoder().encode(input);
    var digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map(function(b) { return b.toString(16).padStart(2, '0'); })
      .join('');
  } catch (e) {
    return '';  // hash yoksa cache calismaz, AI cagirilir
  }
}

async function translatePage() {
  // v2.2: viewport'taki gorunur manga img'lerini bul, her birini ayri cevir
  return await translateVisiblePages();
}

// ══════════════════════════════════════════════════════════════════════════════
//  v2.2: Viewport Bazlı Çoklu Sayfa Çevirisi (PageId + ImageWrapperLevel)
// ══════════════════════════════════════════════════════════════════════════════

// Bu oturumda cevrilmis sayfalarin pageId'si
const translatedPages = new Set();

function isElementVisibleInViewport(el) {
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const vw = window.innerWidth  || document.documentElement.clientWidth;

  if (rect.width === 0 || rect.height === 0) return false;

  const visibleHeight = Math.min(rect.bottom, vh) - Math.max(rect.top, 0);
  const visibleWidth  = Math.min(rect.right,  vw) - Math.max(rect.left, 0);

  if (visibleHeight <= 0 || visibleWidth <= 0) return false;

  const visibleArea = visibleHeight * visibleWidth;
  const totalArea   = rect.width * rect.height;
  return totalArea > 0 && (visibleArea / totalArea) > 0.25;
}

// Lazy-load tamamlanmis mi? naturalWidth/Height > 0 olmali.
function isImageReady(img) {
  if (!img) return false;
  if (img.tagName === 'IMG') {
    if (!img.complete) return false;
    if (!img.naturalWidth || !img.naturalHeight) return false;
  } else if (img.tagName === 'CANVAS') {
    if (!img.width || !img.height) return false;
  }
  return true;
}

// Sayfadaki tum manga img/canvas adaylarini topla
function collectMangaPages() {
  // data-ml-page="1" olanlara oncelik ver (site manifest'ten), yoksa tum img/canvas
  var candidates = [];
  var marked = document.querySelectorAll('[data-ml-page]');
  if (marked.length > 0) {
    marked.forEach(function(el, i) {
      candidates.push({ el: el, index: candidates.length, source: 'marked' });
    });
  } else {
    var allImgs = document.querySelectorAll('img');
    allImgs.forEach(function(img, i) {
      // Buyuk goruntuler (manga sayfalari genelde 400+ px)
      var nW = img.naturalWidth || img.width || 0;
      var nH = img.naturalHeight || img.height || 0;
      if (nW >= 400 && nH >= 200) {
        candidates.push({ el: img, index: candidates.length, source: 'img' });
      }
    });
    var allCanvas = document.querySelectorAll('canvas');
    allCanvas.forEach(function(c) {
      if (c.width >= 400 && c.height >= 200) {
        candidates.push({ el: c, index: candidates.length, source: 'canvas' });
      }
    });
  }
  return candidates;
}

// Sayfa kimligi: URL + index + src + boyut
function getPageId(el, index) {
  var src = '';
  if (el.tagName === 'IMG') {
    src = el.currentSrc || el.src || el.dataset.src || '';
  } else if (el.tagName === 'CANVAS') {
    src = el.toDataURL ? 'canvas-' + index : 'canvas';
  }
  var w = el.naturalWidth || el.width || (el.getBoundingClientRect().width | 0);
  var h = el.naturalHeight || el.height || (el.getBoundingClientRect().height | 0);
  return location.href.split('#')[0] + '::' + index + '::' + src + '::' + w + 'x' + h;
}

async function translateVisiblePages() {
  console.log('[MangaLens-v2.2] translateVisiblePages basladi');
  console.log('[MangaLens-v2.2] scrollY:', window.scrollY,
              'innerWidth:', window.innerWidth, 'innerHeight:', window.innerHeight);

  // 1. Tum manga sayfa adaylarini topla
  var candidates = collectMangaPages();
  console.log('[MangaLens-v2.2] toplam manga sayfa:', candidates.length);

  // 2. Viewport'ta gorunen olanlari filtrele
  var visiblePages = candidates.filter(function(p) {
    return isElementReady(p.el) && isElementVisibleInViewport(p.el);
  });
  console.log('[MangaLens-v2.2] viewport\'ta gorunen sayfa:', visiblePages.length);

  // 3. Cevrilmemis olanlari sec
  var untranslatedPages = [];
  visiblePages.forEach(function(p) {
    p.pageId = getPageId(p.el, p.index);
    if (translatedPages.has(p.pageId)) {
      console.log('[MangaLens-v2.2] zaten cevrilmis, atlanıyor:', p.pageId);
      return;
    }
    untranslatedPages.push(p);
  });
  console.log('[MangaLens-v2.2] cevrilmemis sayfa:', untranslatedPages.length);

  // 4. Popup'a baslangic durumu bildir
  chrome.runtime.sendMessage({
    type: 'PAGE_PROGRESS',
    completed: 0,
    total: untranslatedPages.length,
    current: null,
  }).catch(() => {});

  if (untranslatedPages.length === 0) {
    console.log('[MangaLens-v2.2] cevrilecek yeni sayfa yok');
    return {
      ok: true,
      total: 0,
      translated: 0,
      bubbles: 0,
      errors: 0,
      message: 'Gorunur alanda cevrilmemis yeni sayfa yok',
    };
  }

  // 5. Sirayla her sayfa icin grid cevirisi yap
  var totalBubbles = 0;
  var totalErrors = 0;
  for (var i = 0; i < untranslatedPages.length; i++) {
    var page = untranslatedPages[i];
    var rect = page.el.getBoundingClientRect();
    console.log('[MangaLens-v2.2] === Sayfa', i + 1, '/', untranslatedPages.length, '===');
    console.log('[MangaLens-v2.2] src:', (page.el.src || page.el.currentSrc || '').slice(0, 80));
    console.log('[MangaLens-v2.2] rect: top=', rect.top.toFixed(1),
                'bottom=', rect.bottom.toFixed(1),
                'width=', rect.width, 'height=', rect.height);
    console.log('[MangaLens-v2.2] pageId:', page.pageId);

    chrome.runtime.sendMessage({
      type: 'PAGE_PROGRESS',
      completed: i,
      total: untranslatedPages.length,
      current: { index: i, src: (page.el.src || '').slice(0, 50) },
    }).catch(() => {});

    try {
      var result = await translateSinglePage(page.el, page.pageId);
      if (result && result.bubbles) totalBubbles += result.bubbles;
      if (result && result.errors) totalErrors += result.errors;
      translatedPages.add(page.pageId);  // cache: ayni sayfa bir daha cevrilmez
    } catch (e) {
      console.warn('[MangaLens-v2.2] sayfa ceviri hatasi:', e.message);
      totalErrors++;
    }
  }

  // 6. Tamamlandi bildir
  chrome.runtime.sendMessage({
    type: 'PAGE_PROGRESS',
    completed: untranslatedPages.length,
    total: untranslatedPages.length,
    current: null,
  }).catch(() => {});

  console.log('[MangaLens-v2.2] tamamlandi:', untranslatedPages.length, 'sayfa,',
              totalBubbles, 'balon,', totalErrors, 'hata');

  return {
    ok: true,
    total: untranslatedPages.length,
    translated: untranslatedPages.length - totalErrors,
    bubbles: totalBubbles,
    errors: totalErrors,
  };
}

function isElementReady(el) {
  if (!el) return false;
  if (el.tagName === 'IMG') return isImageReady(el);
  if (el.tagName === 'CANVAS') return el.width > 0 && el.height > 0;
  return false;
}

/**
 * Tek bir manga sayfasini cevirir:
 *   1. Capture visible tab
 *   2. Capture image'den sayfanin oldugu bolumu crop'la
 *   3. 3x3 grid uzerinden AI cagirisi yap
 *   4. Sonucu sayfanin img parent'ina overlay olarak bas
 */
async function translateSinglePage(targetEl, pageId) {
  console.log('[MangaLens-v2.2] translateSinglePage:', pageId);

  // 1. Tam viewport screenshot al
  var fullDataUrl = null;
  try {
    var resp = await chrome.runtime.sendMessage({ type: 'CAPTURE_TAB' });
    if (resp && resp.dataUrl) fullDataUrl = resp.dataUrl;
  } catch (e) {
    console.warn('[MangaLens-v2.2] captureVisibleTab hatasi:', e.message);
    return { ok: false, error: e.message, bubbles: 0, errors: 1 };
  }
  if (!fullDataUrl) {
    return { ok: false, error: 'Screenshot alinamadi', bubbles: 0, errors: 1 };
  }

  // 2. Image yukle
  var img = new Image();
  await new Promise(function(resolve) {
    img.onload = resolve;
    img.onerror = resolve;
    img.src = fullDataUrl;
  });

  // 3. Target elemanin viewport koordinatlarini al
  var dpr = window.devicePixelRatio || 1;
  var tRect = targetEl.getBoundingClientRect();
  var elX = Math.max(0, Math.round(tRect.left * dpr));
  var elY = Math.max(0, Math.round(tRect.top  * dpr));
  var elW = Math.round(tRect.width  * dpr);
  var elH = Math.round(tRect.height * dpr);

  // Capture viewport sinirlari
  if (elX + elW > img.naturalWidth)  elW = img.naturalWidth  - elX;
  if (elY + elH > img.naturalHeight) elH = img.naturalHeight - elY;
  if (elW < 10 || elH < 10) {
    console.warn('[MangaLens-v2.2] hedef img cok kucuk:', elW, 'x', elH);
    return { ok: false, error: 'img cok kucuk', bubbles: 0, errors: 1 };
  }

  console.log('[MangaLens-v2.2] target capture:', elX, elY, elW, 'x', elH, 'dpr:', dpr);

  // 4. Hedef sayfa icin 3x3 grid hesapla (capture koordinatinda)
  var cellCaptureW = Math.floor(elW / GRID_COLS);
  var cellCaptureH = Math.floor(elH / GRID_ROWS);

  var cells = [];
  for (var row = 0; row < GRID_ROWS; row++) {
    for (var col = 0; col < GRID_COLS; col++) {
      var cx = elX + col * cellCaptureW;
      var cy = elY + row * cellCaptureH;
      var cw = cellCaptureW;
      var ch = cellCaptureH;
      if (col < GRID_COLS - 1) cw += GRID_OVERLAP;
      if (row < GRID_ROWS - 1) ch += GRID_OVERLAP;
      // capture sinirlari
      if (cx + cw > elX + elW) cw = (elX + elW) - cx;
      if (cy + ch > elY + elH) ch = (elY + elH) - cy;
      if (cw < 10 || ch < 10) continue;
      cells.push({
        row: row, col: col,
        // Capture koordinatlari (gercek piksel)
        px: cx, py: cy, pw: cw, ph: ch,
      });
    }
  }
  console.log('[MangaLens-v2.2]', cells.length, 'hucre (capture koordinatinda)');

  // 5. Her hucre icin AI cagirisi (cache + rate limit)
  var allBubbles = [];
  var errors = 0;
  for (var i = 0; i < cells.length; i++) {
    var cell = cells[i];

    // PageId + cell koordinatlari = unique cache key
    var cacheKey = await sha256Hex(pageId + '|cell|' + cell.px + ',' + cell.py + ',' + cell.pw + 'x' + cell.ph);

    // Once cache kontrol
    var bubbles = null;
    try {
      var cacheResp = await chrome.runtime.sendMessage({ type: 'GET_CACHED_CELL', cacheKey: cacheKey });
      if (cacheResp && cacheResp.success && cacheResp.bubbles) {
        bubbles = cacheResp.bubbles;
        console.log('[MangaLens-v2.2] cell', i, 'cache HIT,', bubbles.length, 'balon');
      }
    } catch (e) { /* cache miss */ }

    if (!bubbles) {
      // Cache miss → crop + AI
      var cropDataUrl = cropCellRaw(img, cell.px, cell.py, cell.pw, cell.ph);
      if (!cropDataUrl) {
        errors++;
        continue;
      }

      var aiResp;
      try {
        aiResp = await chrome.runtime.sendMessage({
          type: 'EXTRACT_BUBBLES',
          dataUrl: cropDataUrl,
          w: cell.pw,
          h: cell.ph,
        });
      } catch (e) {
        errors++;
        continue;
      }

      if (aiResp && aiResp.success && aiResp.bubbles) {
        bubbles = aiResp.bubbles;
        chrome.runtime.sendMessage({
          type: 'STORE_CACHED_CELL',
          cacheKey: cacheKey,
          bubbles: bubbles,
        }).catch(() => {});
      } else {
        errors++;
      }
    }

    if (bubbles && bubbles.length > 0) {
      // Capture koordinatindan viewport CSS koordinatina cevir
      var cssBubbles = bubbles.map(function(b) {
        return {
          text: b.text,
          x: b.x / dpr,         // capture piksel → CSS piksel
          y: b.y / dpr,
          width:  b.width  / dpr,
          height: b.height / dpr,
        };
      });
      allBubbles = allBubbles.concat(cssBubbles);
    }
  }

  console.log('[MangaLens-v2.2] sayfa', pageId, ':', allBubbles.length, 'balon,', errors, 'hata');

  // 6. Overlay'i hedef img'nin parent'ina bas
  if (allBubbles.length > 0) {
    var captureW = img.naturalWidth;
    var captureH = img.naturalHeight;
    showOverlayOnImage(allBubbles, { width: window.innerWidth, height: window.innerHeight },
                       captureW, captureH, pageId, targetEl);
  }

  return { ok: true, bubbles: allBubbles.length, errors: errors };
}

// Capture koordinatinda (gercek piksel) crop
function cropCellRaw(img, px, py, pw, ph) {
  var c = document.createElement('canvas');
  c.width = pw;
  c.height = ph;
  var ctx = c.getContext('2d');
  try {
    ctx.drawImage(img, px, py, pw, ph, 0, 0, pw, ph);
    return c.toDataURL('image/jpeg', 0.85);
  } catch (e) {
    console.warn('[MangaLens-v2.2] crop hatasi:', e.message);
    return null;
  }
}

// Yeniden cevir butonu icin (translatedPages temizle)
function resetTranslatedPages() {
  translatedPages.clear();
  console.log('[MangaLens-v2.2] translatedPages temizlendi');
}

function cropCell(img, cell) {
  var c = document.createElement('canvas');
  c.width = cell.pw;
  c.height = cell.ph;
  var ctx = c.getContext('2d');
  try {
    ctx.drawImage(img, cell.px, cell.py, cell.pw, cell.ph, 0, 0, cell.pw, cell.ph);
    return c.toDataURL('image/jpeg', 0.85);
  } catch (e) {
    console.warn('[MangaLens-v2] crop hatasi:', e.message);
    return null;
  }
}

// AI'dan gelen bbox'lar crop koordinatinda (piksel).
// Bunlari CSS viewport koordinatlarina cevirip tüm sayfa overlay'inde dogru
// yere koyabilmek icin offset ekliyoruz.
function shiftBubblesToViewport(bubbles, cell, dpr) {
  return bubbles.map(function(b) {
    return {
      text:   b.text,
      x:      cell.cssX + (b.x / dpr),
      y:      cell.cssY + (b.y / dpr),
      width:  b.width / dpr,
      height: b.height / dpr,
    };
  });
}

// Tek overlay: tum hucrelerin bubble'lari birlesik, viewport'u kaplar
// ══════════════════════════════════════════════════════════════════════════════
//  v2.1: Overlay Refactor — Image-Wrapper Level
// ══════════════════════════════════════════════════════════════════════════════

// Eski overlay'leri temizle
function clearAllOverlays() {
  document.querySelectorAll('[id^="ml-result-overlay"], [id^="ml-overlay-"]').forEach(function(el) {
    el.remove();
  });
}

/**
 * Sayfadaki en buyuk gorunur manga img'sini bul.
 * AI viewport screenshot'u aliyor → captureVisibleTab gorunur viewport'u alir.
 * Bu viewport'a en yakin/en buyuk img bizim manga imajimiz.
 */
function findMangaImage() {
  var imgs = Array.from(document.querySelectorAll('img'));
  var best = null;
  var bestArea = 0;

  imgs.forEach(function(img) {
    // naturalWidth/Height ya da displayed width/height
    var nW = img.naturalWidth || img.width;
    var nH = img.naturalHeight || img.height;
    if (!nW || !nH) return;

    var rect = img.getBoundingClientRect();
    var dW = rect.width;
    var dH = rect.height;

    // Görünür viewport'ta olmali
    if (dW === 0 || dH === 0) return;
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;
    if (rect.right < 0 || rect.left > window.innerWidth) return;

    // Buyukluk skoru: natural alan x displayed alan
    var area = dW * dH;
    if (area > bestArea) {
      bestArea = area;
      best = img;
    }
  });

  return best;
}

/**
 * Manga img'sinin parent'ini overlay-parent olarak hazirla.
 * position: relative olmalı (yoksa ekle).
 */
function ensureRelativeParent(img) {
  var parent = img.parentElement;
  if (!parent) return null;
  var pos = window.getComputedStyle(parent).position;
  if (pos === 'static' || !pos) {
    parent.style.position = 'relative';
    parent.style.zIndex = '1';
  }
  return parent;
}

/**
 * Overlay'i manga img parent'ina ekler, bbox'lari img koordinat sistemine cevirir.
 *
 * captureVisibleTab viewport koordinati verir. Img parent'i relative ise,
 * viewport koordinati → img koordinati = bbox - img.rect.left/top.
 * Scroll offset gerekmez cunku parent relative.
 *
 * pageId + targetEl opsiyonel: spesifik sayfa icin (v2.2 translateSinglePage)
 * Belirtilmezse en buyuk gorunur img secilir (v1 selection mode fallback)
 */
function showOverlayOnImage(allBubbles, viewport, captureW, captureH, pageId, targetEl) {
  console.log('[MangaLens-v2.2] showOverlayOnImage:', allBubbles.length, 'balon,',
              'pageId:', pageId || '(yok)', 'targetEl:', targetEl ? targetEl.tagName : '(yok)');

  // Eski ayni sayfanın overlay'ini temizle (yenisi yerine)
  if (pageId) {
    document.querySelectorAll('[data-page-id="' + CSS.escape(pageId) + '"]').forEach(function(el) {
      el.remove();
    });
  } else {
    clearAllOverlays();
  }

  var img = targetEl || findMangaImage();
  if (!img || img.tagName === 'CANVAS' && !img.parentElement) {
    console.warn('[MangaLens-v2.2] hedef img bulunamadi, viewport fixed fallback');
    showFixedOverlayFallback(allBubbles, viewport);
    return;
  }

  console.log('[MangaLens-v2.2] hedef img bulundu:',
              (img.src || img.currentSrc || '').slice(0, 80),
              'natural:', img.naturalWidth, 'x', img.naturalHeight);

  var imgRect = img.getBoundingClientRect();
  var renderedW = imgRect.width;
  var renderedH = imgRect.height;
  var captureW_safe = captureW || viewport.width;
  var captureH_safe = captureH || viewport.height;

  // scaleX / scaleY: capture (gercek piksel) → rendered (CSS piksel)
  var scaleX = renderedW / captureW_safe;
  var scaleY = renderedH / captureH_safe;

  console.log('[MangaLens-v2.2] capture:', captureW_safe, 'x', captureH_safe,
              'rendered:', renderedW, 'x', renderedH,
              'scale:', scaleX.toFixed(3), 'x', scaleY.toFixed(3));

  // Parent: img parent (position relative yapildi)
  var parent = ensureRelativeParent(img);
  if (!parent) {
    console.warn('[MangaLens-v2.2] parent yok, fallback');
    showFixedOverlayFallback(allBubbles, viewport);
    return;
  }

  var container = document.createElement('div');
  container.id = 'ml-overlay-' + Date.now();
  if (pageId) {
    container.dataset.pageId = pageId;
  }
  container.dataset.mangaSrc = (img.src || img.currentSrc || '').slice(0, 80);
  container.dataset.captureW = String(captureW_safe);
  container.dataset.captureH = String(captureH_safe);
  container.setAttribute('style',
    'position:absolute!important;' +
    'left:0!important;top:0!important;' +
    'width:' + renderedW + 'px!important;' +
    'height:' + renderedH + 'px!important;' +
    'pointer-events:none!important;' +
    'z-index:2147483647!important;' +
    'display:block!important;visibility:visible!important;opacity:1!important;'
  );

  // Her balon
  var rendered = 0;
  allBubbles.forEach(function(b, idx) {
    if (!b.text || !b.text.trim()) return; // bos text → atla

    // AI bbox viewport (capture) koordinatinda
    // → rendered koordinata cevir
    var boxLeft = b.x * scaleX;
    var boxTop  = b.y * scaleY;
    var boxW    = b.width  * scaleX;
    var boxH    = b.height * scaleY;

    // Debug log (her bbox)
    console.log('[MangaLens-v2.2] bbox #' + idx,
                'raw:', JSON.stringify(b),
                'scaled: x=' + boxLeft.toFixed(1), 'y=' + boxTop.toFixed(1),
                'w=' + boxW.toFixed(1), 'h=' + boxH.toFixed(1),
                'parent:', parent.tagName + '.' + (parent.className || ''));

    var div = document.createElement('div');
    div.className = 'ml-bubble';
    div.textContent = b.text;
    div.dataset.raw = JSON.stringify(b);   // resize/reposition icin kaydet
    div.setAttribute('style',
      'position:absolute!important;' +
      'left:' + boxLeft + 'px!important;' +
      'top:' + boxTop + 'px!important;' +
      'width:' + boxW + 'px!important;' +
      'height:' + boxH + 'px!important;' +
      'background:rgba(255,235,150,0.92)!important;' +
      'color:#000!important;' +
      'padding:2px!important;' +
      'font-family:system-ui,sans-serif!important;' +
      'font-size:12px!important;' +
      'font-weight:600!important;' +
      'border-radius:3px!important;' +
      'border:1px solid #b91c1c!important;' +
      'display:flex!important;' +
      'align-items:center!important;' +
      'justify-content:center!important;' +
      'text-align:center!important;' +
      'line-height:1.2!important;' +
      'box-sizing:border-box!important;' +
      'overflow:hidden!important;' +
      'pointer-events:auto!important;' +
      'z-index:100000!important;'
    );
    container.appendChild(div);
    rendered++;
  });

  console.log('[MangaLens-v2.2]', rendered, 'balon overlay eklendi');

  // Kapatma butonu
  var closeBtn = document.createElement('div');
  closeBtn.textContent = 'x Kapat';
  closeBtn.setAttribute('style',
    'position:absolute!important;' +
    'top:-32px!important;right:0!important;' +
    'background:#7c3aed!important;color:white!important;' +
    'padding:6px 12px!important;border-radius:6px!important;' +
    'font-family:system-ui,sans-serif!important;font-size:12px!important;font-weight:600!important;' +
    'cursor:pointer!important;pointer-events:auto!important;z-index:100002!important;'
  );
  closeBtn.addEventListener('click', function() {
    container.remove();
  });
  container.appendChild(closeBtn);

  parent.appendChild(container);

  // Watchdog: scroll/resize'da overlay pozisyonunu guncelle
  setupOverlayWatchdog(container, img);
}

/**
 * Overlay pozisyonunu scroll/resize'da img ile senkron tutar.
 * Img scaled, moved, hidden olursa overlay yeniden konumlanir.
 */
function setupOverlayWatchdog(container, img) {
  var lastRect = null;

  function reposition() {
    var rect = img.getBoundingClientRect();
    if (lastRect &&
        Math.abs(rect.width - lastRect.width) < 1 &&
        Math.abs(rect.height - lastRect.height) < 1 &&
        Math.abs(rect.left - lastRect.left) < 1 &&
        Math.abs(rect.top - lastRect.top) < 1) {
      return; // degisiklik yok
    }
    lastRect = { width: rect.width, height: rect.height, left: rect.left, top: rect.top };

    if (rect.width === 0 || rect.height === 0) {
      container.style.display = 'none';
      return;
    }
    container.style.display = 'block';
    container.style.width = rect.width + 'px';
    container.style.height = rect.height + 'px';

    // Bubble'lari scaleX/Y ile yeniden hesapla
    var captureW = parseFloat(container.dataset.captureW || '0');
    var captureH = parseFloat(container.dataset.captureH || '0');
    if (!captureW || !captureH) return;

    var scaleX = rect.width / captureW;
    var scaleY = rect.height / captureH;

    var bubbles = container.querySelectorAll('.ml-bubble');
    bubbles.forEach(function(bubble, idx) {
      var raw = JSON.parse(bubble.dataset.raw || '{}');
      if (!raw.x) return;
      bubble.style.left = (raw.x * scaleX) + 'px';
      bubble.style.top  = (raw.y * scaleY) + 'px';
      bubble.style.width  = (raw.width  * scaleX) + 'px';
      bubble.style.height = (raw.height * scaleY) + 'px';
    });
  }

  // Ilk hesapla
  setTimeout(reposition, 100);

  // resize/scroll'da guncelle
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);
  // ResizeObserver ile img de resize olursa yakala
  if (window.ResizeObserver) {
    try {
      var ro = new ResizeObserver(reposition);
      ro.observe(img);
    } catch (e) {}
  }
}

/**
 * Manga img bulunamazsa fallback: viewport'un en ust solune fixed overlay.
 */
function showFixedOverlayFallback(allBubbles, viewport) {
  console.log('[MangaLens-v2.1] fixed fallback overlay');

  var container = document.createElement('div');
  container.id = 'ml-overlay-fallback-' + Date.now();
  container.setAttribute('style',
    'position:fixed!important;' +
    'left:0!important;top:0!important;' +
    'width:' + viewport.width + 'px!important;' +
    'height:' + viewport.height + 'px!important;' +
    'pointer-events:none!important;' +
    'z-index:2147483647!important;'
  );

  allBubbles.forEach(function(b) {
    if (!b.text || !b.text.trim()) return;
    var div = document.createElement('div');
    div.textContent = b.text;
    div.setAttribute('style',
      'position:absolute!important;' +
      'left:' + b.x + 'px!important;' +
      'top:' + b.y + 'px!important;' +
      'width:' + b.width + 'px!important;' +
      'height:' + b.height + 'px!important;' +
      'background:rgba(255,235,150,0.92)!important;' +
      'color:#000!important;padding:2px!important;' +
      'font-family:system-ui,sans-serif!important;font-size:12px!important;' +
      'border:1px solid #b91c1c!important;'
    );
    container.appendChild(div);
  });

  var closeBtn = document.createElement('div');
  closeBtn.textContent = 'x Kapat';
  closeBtn.setAttribute('style',
    'position:absolute!important;top:10px;right:10px;' +
    'background:#7c3aed!important;color:white!important;padding:6px 12px;border-radius:6px;' +
    'cursor:pointer!important;pointer-events:auto!important;z-index:100002!important;'
  );
  closeBtn.addEventListener('click', function() { container.remove(); });
  container.appendChild(closeBtn);

  document.body.appendChild(container);
}

// Popup'a ilerleme gönder (varsa)
function notifyProgress(completed, total, currentCell) {
  try {
    chrome.runtime.sendMessage({
      type: 'PAGE_PROGRESS',
      completed: completed,
      total: total,
      current: currentCell ? { row: currentCell.row, col: currentCell.col } : null,
    });
  } catch (e) { /* popup kapali olabilir */ }
}

async function translateOne(area) {
  console.log('[MangaLens] translateOne basladi, alan:', area);

  // 1. captureVisibleTab ile viewport screenshot al
  var fullDataUrl = null;
  try {
    var resp = await chrome.runtime.sendMessage({ type: 'CAPTURE_TAB' });
    if (resp && resp.dataUrl) fullDataUrl = resp.dataUrl;
  } catch (e) {
    console.warn('[MangaLens] captureVisibleTab hatasi:', e.message);
  }
  if (!fullDataUrl) return;

  console.log('[MangaLens] fullDataUrl alindi, uzunluk:', fullDataUrl.length);

  // 2. Crop: sadece area'yi kirp
  var img = new Image();
  await new Promise(function(resolve) {
    img.onload = resolve;
    img.onerror = resolve;
    img.src = fullDataUrl;
  });

  var dpr = window.devicePixelRatio || 1;
  // captureVisibleTab gercek piksel doner (DPR dahil)
  // area ise CSS piksel — DPR ile carpmamiz gerek
  var cropX = Math.round(area.x * dpr);
  var cropY = Math.round(area.y * dpr);
  var cropW = Math.round(area.width * dpr);
  var cropH = Math.round(area.height * dpr);

  // Sinirlari kontrol et
  if (cropX < 0) cropX = 0;
  if (cropY < 0) cropY = 0;
  if (cropX + cropW > img.naturalWidth) cropW = img.naturalWidth - cropX;
  if (cropY + cropH > img.naturalHeight) cropH = img.naturalHeight - cropY;
  if (cropW < 10 || cropH < 10) {
    console.warn('[MangaLens] crop cok kucuk:', cropW, 'x', cropH);
    return;
  }

  var cropCanvas = document.createElement('canvas');
  cropCanvas.width = cropW;
  cropCanvas.height = cropH;
  var cctx = cropCanvas.getContext('2d');
  cctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  var cropDataUrl = cropCanvas.toDataURL('image/jpeg', 0.85);
  console.log('[MangaLens] crop tamamlandi, boyut:', cropW, 'x', cropH, 'dataUrl:', cropDataUrl.length);

  // 3. AI'a sadece crop'u gonder
  var aiResp;
  try {
    aiResp = await chrome.runtime.sendMessage({
      type: 'EXTRACT_BUBBLES',
      dataUrl: cropDataUrl,
      w: cropW,
      h: cropH,
    });
  } catch (e) {
    console.warn('[MangaLens] AI hatasi:', e.message);
    return;
  }

  if (!aiResp || !aiResp.success) {
    console.warn('[MangaLens] AI yanit yok:', aiResp && aiResp.error);
    return;
  }

  var bubbles = aiResp.bubbles || [];
  console.log('[MangaLens] AI', bubbles.length, 'balon buldu');

  // 4. Overlay goster — bubbles zaten crop koordinatinda, direkt kullan
  showOverlay(area, bubbles);
}

function showOverlay(area, bubbles) {
  // v2.1: v1 selection mode icin de image-wrapper-level overlay kullan
  console.log('[MangaLens-v2.1] showOverlay (v1 selection mode):', bubbles.length, 'balon');

  // Eski overlay'leri temizle
  clearAllOverlays();

  if (!bubbles || bubbles.length === 0) return;

  // v1: bubbles crop koordinatinda geldi (captureVisibleTab crop).
  // captureW = area.width * dpr
  // captureH = area.height * dpr
  var dpr = window.devicePixelRatio || 1;
  var captureW = area.width * dpr;
  var captureH = area.height * dpr;

  // Oncelikle crop koordinatlarini viewport CSS koordinatlarina cevir
  var viewportBubbles = bubbles.map(function(b) {
    return {
      text: b.text,
      x: area.x + (b.x / dpr),
      y: area.y + (b.y / dpr),
      width: b.width / dpr,
      height: b.height / dpr,
    };
  });

  // Sonra image-wrapper-level overlay'e gec
  showOverlayOnImage(viewportBubbles, { width: window.innerWidth, height: window.innerHeight }, captureW, captureH);
}

console.log('[MangaLens] v3 minimal content.js hazir');
