// dosya: src/pagemode.js
// MangaLens TR — Sayfa Modu (tek tusla tum sayfayi cevir)
// Yuklenme: manifest content_scripts, src/content.js ve src/pagemode-core.js'ten SONRA.
// content.js ile AYNI izole dunyada calisir; su fonksiyonlari dogrudan kullanir:
//   collectMangaPages, getPageId, ensureRelativeParent, syncSelectionLayerPosition,
//   captureVisibleRect, sendRuntimeMessageWithTimeout, clampInt, exitSelectionMode,
//   stopQuickTranslateMode, selectionMode, quickTranslateMode
// Yeni tanimlar pm/PM onekli — cakisma yok.
'use strict';

const PM = self.MLPagemodeCore;

const PM_MAX_INFLIGHT = 4;              // ayni anda kuyruga verilen bant sayisi
const PM_JOB_WATCHDOG_MS = 90000;       // sonuc gelmezse is 'zaman asimi' sayilir
const PM_MAX_SIDE = 1600;               // AI'a gonderilen en uzun kenar
const PM_BAND_MAX_HEIGHT = 1800;        // uzun seritte bant yuksekligi
const PM_BAND_OVERLAP = 200;            // bantlar arasi ortusme
const PM_JPEG_QUALITY = 0.82;
const PM_MAX_PAYLOAD = 4 * 1024 * 1024;
const PM_MIN_AREA_RATIO = 0.25;         // 'gorunen sayfa' esigi
const PM_TALL_STRIP_RATIO = 2.0;        // h/w bu orandan buyukse bantlara bol
const PM_MAX_BANDS = 6;                 // sayfa basina en fazla bant (kota korumasi)
const PM_SNAP_WINDOW = 1200;            // oturtma kumesi: tek tuvalde islenecek en buyuk alan (px)
const PM_SNAP_PAD = 220;                // kume cevresine eklenecek pay (px)

const pageMode = {
  active: false,
  scope: 'onScroll',                    // 'visible' | 'onScroll' | 'chapter'
  pages: new Map(),                     // pageId -> page kaydi
  jobs: new Map(),                      // 'pageId#bandIndex' -> { job, watchdogId }
  queue: [],                            // bekleyen isler
  inflight: 0,
  stats: { total: 0, done: 0, bubbles: 0, errors: 0 },
  teardown: [],
  lastUrl: location.href,
  lastError: '',
};

function pmJobKey(pageId, bandIndex) { return String(pageId) + '#' + Number(bandIndex || 0); }

// ── Stiller ────────────────────────────────────────────────────────────────
// styles/pagemode.css manifest uzerinden enjekte edilir. Bazi ortamlarda (headless/
// bilesen eksikligi) manifest CSS'i sayfaya uygulanmaz; o durumda dosyayi kendimiz
// cekip <style> olarak basariz. Tek kaynak yine styles/pagemode.css'dir.
const PM_STYLE_ID = 'ml-pagemode-style';

async function pmEnsureStyles() {
  try {
    const applied = Array.prototype.some.call(document.styleSheets, function (s) {
      return s.href && String(s.href).indexOf('pagemode.css') !== -1;
    });
    if (applied || document.getElementById(PM_STYLE_ID)) return;
    const resp = await fetch(chrome.runtime.getURL('styles/pagemode.css'));
    if (!resp.ok) return;
    const css = await resp.text();
    if (document.getElementById(PM_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = PM_STYLE_ID;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    // Stil sonradan geldiyse yerlesim degisti: kutulari yeniden olcup yaziyi sigdir.
    if (typeof pmSyncAutoLayers === 'function') pmSyncAutoLayers();
  } catch (e) {
    console.warn('[MangaLens-pm] stil enjeksiyonu basarisiz:', e.message);
  }
}

function pmDebounce(fn, ms) {
  let t = null;
  return function () {
    if (t) clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

// ── Sayfa kayitlari ─────────────────────────────────────────────────────────

function pmPageRecord(el, pageId) {
  return {
    el: el,
    pageId: pageId,
    state: 'idle',           // idle | queued | working | done | empty | error
    bubbles: [],             // global (yuzde) balonlar: {text, translation, xPct, yPct, wPct, hPct}
    jobs: [],
    bandCount: 0,
    received: 0,
    attempts: 0,
    layer: null,
    imageWidth: 0,
    imageHeight: 0,
    image: null,             // { canvas, width, height } — oturtma kaynagi (finalize'da birakilir)
    snapStats: null,
  };
}

function pmCollectPageRecords() {
  const out = [];
  const list = collectMangaPages();                       // content.js'ten
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const el = p.el;
    if (!el || !el.isConnected) continue;
    const isImg = el.tagName === 'IMG';
    const w = isImg ? (el.naturalWidth || 0) : (el.width || 0);
    const h = isImg ? (el.naturalHeight || 0) : (el.height || 0);
    if (!w || !h) continue;                               // lazy-load hazir degil
    const src = isImg ? (el.currentSrc || el.src || '') : '';
    if (!PM.isMangaCandidate({ w: w, h: h, src: src, cls: el.className || '', alt: el.alt || '' })) continue;
    out.push(pmPageRecord(el, getPageId(el, p.index != null ? p.index : i)));
  }
  return out;
}

// ── Gorunurluk ──────────────────────────────────────────────────────────────

function pmIsVisibleRatio(el, minRatio) {
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  if (!rect.width || !rect.height) return false;
  const visibleW = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0));
  const visibleH = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
  const total = rect.width * rect.height;
  return total > 0 && ((visibleW * visibleH) / total) >= (minRatio == null ? PM_MIN_AREA_RATIO : minRatio);
}

function pmNearViewport(el) {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight || 0;
  return r.bottom > -vh * 0.5 && r.top < vh * 2;          // bir ekran yukari / iki ekran asagi
}

// ── Gorsel alma: once orijinal (SW fetch), sonra data:, canvas, gorunur-alan kirpmasi ──

function pmResizeCanvas(canvas, maxSide) {
  const s = PM.scaleForMaxSide(canvas.width, canvas.height, maxSide);
  if (s.scale === 1) return canvas;
  const out = document.createElement('canvas');
  out.width = s.width;
  out.height = s.height;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, s.width, s.height);
  return out;
}

function pmCanvasToJpegDataUrl(canvas) {
  const q = PM_JPEG_QUALITY;
  let dataUrl = canvas.toDataURL('image/jpeg', q);
  if (dataUrl.length * 0.75 <= PM_MAX_PAYLOAD) return dataUrl;
  const smaller = pmResizeCanvas(canvas, Math.round(Math.max(canvas.width, canvas.height) * 0.7));
  dataUrl = smaller.toDataURL('image/jpeg', 0.7);
  return dataUrl;
}

function pmDataUrlToCanvas(dataUrl) {
  return new Promise(function (resolve, reject) {
    const img = new Image();
    img.onload = function () {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || img.width;
      c.height = img.naturalHeight || img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = function () { reject(new Error('gorsel okunamadi')); };
    img.src = dataUrl;
  });
}

async function pmAcquireImage(page) {
  const el = page.el;
  const tag = el.tagName;

  if (tag === 'IMG') {
    const src = el.currentSrc || el.src || '';
    if (/^data:image\//i.test(src)) {
      const c = await pmDataUrlToCanvas(src);
      return { canvas: c, width: c.width, height: c.height, source: 'data-url', src: src };
    }
    if (/^https?:\/\//i.test(src)) {
      const resp = await sendRuntimeMessageWithTimeout(
        { type: 'FETCH_IMAGE', url: src }, 30000, 'Gorsel indirme zaman asimi');
      if (resp && resp.ok && resp.dataUrl) {
        const c = await pmDataUrlToCanvas(resp.dataUrl);
        return { canvas: c, width: c.width, height: c.height, source: 'original', src: src };
      }
      console.warn('[MangaLens-pm] orijinal gorsel alinamadi:', resp && resp.error);
    }
  }

  if (tag === 'CANVAS') {
    try {
      const c = await pmDataUrlToCanvas(el.toDataURL('image/jpeg', 0.9));
      return { canvas: c, width: c.width, height: c.height, source: 'canvas', src: 'canvas' };
    } catch (e) {
      console.warn('[MangaLens-pm] canvas okunamadi (tainted):', e.message);
    }
  }

  // Yedek: gorunur alan kirpmasi (yalnizca ekranda olan sayfalar)
  if (!pmIsVisibleRatio(el, 0.05)) throw new Error('sayfa ekranda degil');
  const rect = el.getBoundingClientRect();
  const content = pmContentRectFor(page);
  if (!content || !content.w || !content.h) throw new Error('resim alani bulunamadi');
  const vw = window.innerWidth, vh = window.innerHeight;
  const left = Math.max(0, rect.left + content.visible.x);
  const top = Math.max(0, rect.top + content.visible.y);
  const right = Math.min(vw, rect.left + content.visible.x + content.visible.w);
  const bottom = Math.min(vh, rect.top + content.visible.y + content.visible.h);
  const canvas = await captureVisibleRect({ left: left, top: top, right: right, bottom: bottom });
  // Do not associate a screenshot taken while scrolling with stale coordinates.
  const after = el.getBoundingClientRect();
  if (Math.abs(after.left - rect.left) > 1 || Math.abs(after.top - rect.top) > 1 ||
      Math.abs(after.width - rect.width) > 1 || Math.abs(after.height - rect.height) > 1 ||
      vw !== window.innerWidth || vh !== window.innerHeight) {
    throw new Error('Yakalama sirasinda sayfa hareket etti; durduktan sonra Yeniden ile deneyin');
  }
  return { canvas: canvas, width: canvas.width, height: canvas.height, source: 'viewport-crop', src: 'crop',
    region: { x: (left - rect.left - content.x) / content.w,
      y: (top - rect.top - content.y) / content.h,
      w: (right - left) / content.w, h: (bottom - top) / content.h } };
}

// ── Is planlama: bantlar (natural cozunurlukte kes, sonra gerekirse olcekle) ──

function pmPlanSlices(width, height) {
  const tallStrip = height > PM_MAX_SIDE && (height / width) > PM_TALL_STRIP_RATIO;
  if (!tallStrip) return [{ index: 0, count: 1, x: 0, y: 0, width: width, height: height }];
  let maxHeight = PM_BAND_MAX_HEIGHT;
  const naiveCount = Math.ceil((height - maxHeight) / (maxHeight - PM_BAND_OVERLAP)) + 1;
  if (naiveCount > PM_MAX_BANDS) {                    // cok uzun serit: bant yuksekligini buyut, sayiyi sinirla
    maxHeight = Math.round((height + (PM_MAX_BANDS - 1) * PM_BAND_OVERLAP) / PM_MAX_BANDS);
  }
  return PM.planBands(width, height, { maxHeight: maxHeight, overlapPx: PM_BAND_OVERLAP });
}

function pmBuildJobs(page, img) {
  const slices = pmPlanSlices(img.width, img.height);
  const isImg = page.el.tagName === 'IMG';
  const src = isImg ? (page.el.currentSrc || page.el.src || '') : 'canvas:' + page.pageId;
  page.cacheKey = PM.pageCacheKey({ src: src, w: img.width, h: img.height });
  page.captureRegion = img.region || null;
  if (page.captureRegion) {
    // Different visible portions (and old incorrect entries) must never share results.
    page.cacheKey += '|crop2:' + JSON.stringify(page.captureRegion);
  }
  page.imageWidth = img.width;
  page.imageHeight = img.height;
  page.image = img;                       // oturtma icin kaynak tuval (tam cozunurluk, kopya yok)

  return slices.map(function (slice) {
    const scaled = PM.scaleForMaxSide(slice.width, slice.height, PM_MAX_SIDE);
    const cell = document.createElement('canvas');
    cell.width = scaled.width;
    cell.height = scaled.height;
    const ctx = cell.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img.canvas, slice.x, slice.y, slice.width, slice.height, 0, 0, scaled.width, scaled.height);
    return {
      page: page,
      slice: slice,
      bandIndex: slice.index,
      bandCount: slices.length,
      cacheKey: page.cacheKey + '|b' + slice.index,
      dataUrl: pmCanvasToJpegDataUrl(cell),
      w: scaled.width,
      h: scaled.height,
      imageW: img.width,
      imageH: img.height,
      source: img.source,
    };
  });
}

async function pmEnqueuePage(page) {
  if (!page || page.state !== 'idle') return;
  page.state = 'queued';
  pageMode.stats.total++;
  pmUpdatePill();
  try {
    const img = await pmAcquireImage(page);
    const jobs = pmBuildJobs(page, img);
    page.jobs = jobs;
    page.bandCount = jobs.length;
    page.received = 0;
    page.state = 'working';
    jobs.forEach(function (job) { pageMode.queue.push(job); });
    pmPump();
  } catch (e) {
    page.state = 'error';
    page.attempts++;
    pageMode.stats.errors++;
    pmReportError('Sayfa alınamadı: ' + e.message);
    console.warn('[MangaLens-pm] hazirlik hatasi:', e.message);
  }
}

// ── Bindirme (overlay) ──────────────────────────────────────────────────────

function pmEnsureAutoLayer(page) {
  if (!page.el || !page.el.isConnected) return null;
  const parent = ensureRelativeParent(page.el);            // content.js'ten
  if (!parent) return null;
  const selector = '.ml-auto-layer[data-ml-auto-layer="' + String(page.pageId).replace(/"/g, '\\"') + '"]';
  let layer = parent.querySelector(selector);
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'ml-auto-layer';
    layer.dataset.mlAutoLayer = page.pageId;
    parent.appendChild(layer);
  }
  if (!parent.dataset.mlSelectionPrevZ && !parent.dataset.mlAutoPrevZ) {
    parent.dataset.mlAutoPrevZ = parent.style.zIndex || '';
    parent.style.zIndex = '2147483645';
  }
  pmPositionLayer(page, layer);                            // resmin ICERIK dikdortgenine hizala
  page.layer = layer;
  return layer;
}

function pmClearPageOverlay(page) {
  if (page && page.layer) {
    page.layer.remove();
    page.layer = null;
  }
}

function pmFitBubbleText(box) {
  if (box.dataset.mlEditing === 'true') return;
  const label = box.querySelector('.ml-auto-text');
  if (!label) return;
  const text = label.textContent || '';
  if (!text) return;
  const w = box.clientWidth;
  const h = box.clientHeight;
  if (!w || !h) {
    // Stil/yarlestim henuz hazir degil: zamanlayici ile tekrar dene (gizli sekmede rAF calismaz)
    const tries = Number(box.dataset.mlFitTries || 0);
    if (tries > 30) return;
    box.dataset.mlFitTries = String(tries + 1);
    setTimeout(function () { pmFitBubbleText(box); }, 120);
    return;
  }
  box.dataset.mlFitTries = '0';
  // Measure an unconstrained text span, not a centered flex box (which can hide overflow).
  const area = box._mlTextRect || { x: 0, y: 0, w: 1, h: 1 };
  const availableW = Math.max(1, w * area.w - 4);
  const availableH = Math.max(1, h * area.h - 4);
  label.style.setProperty('width', availableW + 'px', 'important');
  label.style.setProperty('left', ((area.x + area.w / 2) * w) + 'px', 'important');
  label.style.setProperty('top', ((area.y + area.h / 2) * h) + 'px', 'important');
  let low = 1, high = 32, best = 1;
  for (let i = 0; i < 9; i++) {
    const size = (low + high) / 2;
    label.style.setProperty('font-size', size + 'px', 'important');
    if (label.scrollHeight <= availableH && label.scrollWidth <= availableW + 0.5) {
      best = size; low = size;
    } else high = size;
  }
  label.style.setProperty('font-size', best + 'px', 'important');
}

const PM_EDITS_KEY = 'ml_page_edits_v1';

async function pmSavePageEdits(page) {
  if (!page || !page.cacheKey) return;
  if (!chrome.storage || !chrome.storage.local) return;
  const edits = page.bubbles.map(function (b, index) {
    return b._mlEdited ? { index: index, text: b.text, translation: b.translation,
      xPct: b.xPct, yPct: b.yPct, wPct: b.wPct, hPct: b.hPct } : null;
  }).filter(Boolean);
  try {
    const data = await chrome.storage.local.get([PM_EDITS_KEY]);
    const map = data[PM_EDITS_KEY] || {};
    if (edits.length) map[page.cacheKey] = { ts: Date.now(), edits: edits };
    const keys = Object.keys(map).sort(function (a, b) { return (map[a].ts || 0) - (map[b].ts || 0); });
    while (keys.length > 200) delete map[keys.shift()];
    await chrome.storage.local.set({ [PM_EDITS_KEY]: map });
  } catch (error) { console.warn('[MangaLens-pm] düzenleme kaydedilemedi:', error.message); }
}

async function pmApplyPageEdits(page) {
  if (!page || !page.cacheKey) return;
  if (!chrome.storage || !chrome.storage.local) return;
  try {
    const data = await chrome.storage.local.get([PM_EDITS_KEY]);
    const record = (data[PM_EDITS_KEY] || {})[page.cacheKey];
    if (!record || !Array.isArray(record.edits)) return;
    record.edits.forEach(function (edit) {
      let b = page.bubbles[edit.index];
      if (!b || b.text !== edit.text) b = page.bubbles.find(function (item) { return item.text === edit.text; });
      if (!b || ![edit.xPct, edit.yPct, edit.wPct, edit.hPct].every(Number.isFinite)) return;
      b.translation = String(edit.translation || b.translation || '');
      b.xPct = Math.max(0, Math.min(1, edit.xPct));
      b.yPct = Math.max(0, Math.min(1, edit.yPct));
      b.wPct = Math.max(0.001, Math.min(1 - b.xPct, edit.wPct));
      b.hPct = Math.max(0.001, Math.min(1 - b.yPct, edit.hPct));
      b._mlEdited = true;
    });
    if (page.layer) pmLayoutPage(page);
  } catch (error) { console.warn('[MangaLens-pm] düzenleme okunamadı:', error.message); }
}

function pmBindBubbleEditor(page, box) {
  box.addEventListener('dblclick', function (event) {
    event.preventDefault(); event.stopPropagation();
    const b = page.bubbles[Number(box.dataset.mlIndex)];
    const label = box.querySelector('.ml-auto-text');
    if (!b || !label) return;
    const before = b.translation || b.text || '';
    box.dataset.mlEditing = 'true';
    label.contentEditable = 'true';
    label.focus();
    const selection = window.getSelection();
    if (selection) { selection.selectAllChildren(label); selection.collapseToEnd(); }
    const finish = function (save) {
      if (box.dataset.mlEditing !== 'true') return;
      const changed = save ? (label.textContent || '').trim() : '';
      b.translation = changed || before;
      b._mlEdited = true;
      label.contentEditable = 'false';
      box.dataset.mlEditing = 'false';
      box.dataset.mlText = '';
      pmLayoutPage(page);
      pmSavePageEdits(page);
    };
    label.onkeydown = function (keyEvent) {
      if (keyEvent.key === 'Enter' && !keyEvent.shiftKey) { keyEvent.preventDefault(); finish(true); }
      if (keyEvent.key === 'Escape') { keyEvent.preventDefault(); finish(false); }
      keyEvent.stopPropagation();
    };
    label.onblur = function () { finish(true); };
  });
  box.addEventListener('pointerdown', function (event) {
    if (!event.altKey || box.dataset.mlEditing === 'true') return;
    event.preventDefault(); event.stopPropagation();
    const b = page.bubbles[Number(box.dataset.mlIndex)];
    const content = pmContentRectFor(page);
    if (!b || !content || !content.w || !content.h) return;
    const start = { x: event.clientX, y: event.clientY, xPct: b.xPct, yPct: b.yPct,
      wPct: b.wPct, hPct: b.hPct, resize: event.shiftKey };
    box.setPointerCapture(event.pointerId);
    const move = function (moving) {
      const dx = (moving.clientX - start.x) / content.w;
      const dy = (moving.clientY - start.y) / content.h;
      if (start.resize) {
        b.wPct = Math.max(0.015, Math.min(1 - b.xPct, start.wPct + dx));
        b.hPct = Math.max(0.015, Math.min(1 - b.yPct, start.hPct + dy));
      } else {
        b.xPct = Math.max(0, Math.min(1 - b.wPct, start.xPct + dx));
        b.yPct = Math.max(0, Math.min(1 - b.hPct, start.yPct + dy));
      }
      pmLayoutPage(page);
    };
    const end = function () {
      box.removeEventListener('pointermove', move);
      box.removeEventListener('pointerup', end);
      box.removeEventListener('pointercancel', end);
      b._mlEdited = true;
      pmSavePageEdits(page);
    };
    box.addEventListener('pointermove', move);
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
  });
}

function pmLayoutPage(page) {
  if (!page || !page.el || !page.el.isConnected) return;
  const layer = pmEnsureAutoLayer(page);
  if (!layer) return;
  const content = pmContentRectFor(page);
  if (!content) return;
  const wanted = page.bubbles.length;

  while (layer.children.length > wanted) layer.removeChild(layer.lastElementChild);

  for (let i = 0; i < wanted; i++) {
    const b = page.bubbles[i];
    let box = layer.children[i];
    if (!box) {
      box = document.createElement('div');
      box.className = 'ml-auto-bubble';
      const label = document.createElement('span');
      label.className = 'ml-auto-text';
      box.appendChild(label);
      layer.appendChild(box);
      pmBindBubbleEditor(page, box);
    }
    box.dataset.mlIndex = String(i);
    const text = b.translation || b.text || '';
    if (box.dataset.mlText !== text) {
      box.dataset.mlText = text;
      box.querySelector('.ml-auto-text').textContent = text;
    }
    const boxHint = (b.text || '') + '\nÇift tık: metni düzelt · Alt+sürükle: taşı · Alt+Shift+sürükle: boyutlandır';
    if (box.title !== boxHint) box.title = boxHint;
    if (box.dataset.snap !== (b.snap || 'model')) box.dataset.snap = b.snap || 'model';
    box._mlTextRect = b.interior ? b.interior.textRect : null;
    if (b.interior) {
      box.style.setProperty('clip-path', 'polygon(' + b.interior.polygon.map(function (p) {
        return (p[0] * 100) + '% ' + (p[1] * 100) + '%';
      }).join(',') + ')', 'important');
    } else box.style.removeProperty('clip-path');
    box.style.setProperty('background', b.background || '#fff', 'important');

    // Katman zaten resmin ICERIK dikdortgeninde konumlu; kutular katmana GORE yuzde ile yerlestirilir
    const kk = pmLayerScale(layer);
    const cw = content.w / kk.x, ch = content.h / kk.y;
    const x = b.xPct * cw;
    const y = b.yPct * ch;
    const w = Math.max(1, b.wPct * cw);
    const h = Math.max(1, b.hPct * ch);

    box.style.setProperty('left', x + 'px', 'important');
    box.style.setProperty('top', y + 'px', 'important');
    box.style.setProperty('width', w + 'px', 'important');
    box.style.setProperty('height', h + 'px', 'important');

    // object-fit: cover/none -> resmin bir kismi kirpilir; gorunmeyen kutuyu gizle
    const v = content.visible;
    const vx = (v.x - content.x) / kk.x, vy = (v.y - content.y) / kk.y;
    const vw = v.w / kk.x, vh = v.h / kk.y;
    const outside = v && (x + w <= vx || x >= vx + vw || y + h <= vy || y >= vy + vh);
    if (outside) box.style.setProperty('display', 'none', 'important');
    else box.style.removeProperty('display');
  }
  pmScheduleFit(layer);
}

// Kutu yazilarini sigdir: rAF + zamanlayici (gizli sekmede rAF calismaz)
function pmScheduleFit(layer) {
  if (!layer) return;
  const run = function () {
    if (!layer.isConnected) return;
    Array.prototype.forEach.call(layer.children, pmFitBubbleText);
  };
  requestAnimationFrame(run);
  setTimeout(run, 300);
}

// Katman px'leri ebeveynin YEREL uzayindadir; ebeveyn transform/zoom'lu ise gorsel px'i bole
function pmLayerScale(layer) {
  const parent = layer && layer.parentElement;
  if (!parent) return { x: 1, y: 1 };
  const r = parent.getBoundingClientRect();
  return {
    x: parent.offsetWidth && r.width ? r.width / parent.offsetWidth : 1,
    y: parent.offsetHeight && r.height ? r.height / parent.offsetHeight : 1,
  };
}

// Katmani resmin ICERIK dikdortgenine hizala (eleman kutusu degil)
function pmPositionLayer(page, layer) {
  const parent = layer.parentElement;
  if (!parent) return;
  const content = pmContentRectFor(page);
  if (!content) return;
  const imgRect = page.el.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();
  const k = pmLayerScale(layer);
  let borderLeft = 0, borderTop = 0;
  try {
    const cs = window.getComputedStyle(parent);
    borderLeft = parseFloat(cs.borderLeftWidth) || 0;
    borderTop = parseFloat(cs.borderTopWidth) || 0;
  } catch (e) { borderLeft = 0; borderTop = 0; }
  layer.style.left = ((imgRect.left - parentRect.left + content.x) / k.x - borderLeft + parent.scrollLeft) + 'px';
  layer.style.top = ((imgRect.top - parentRect.top + content.y) / k.y - borderTop + parent.scrollTop) + 'px';
  layer.style.width = (content.w / k.x) + 'px';
  layer.style.height = (content.h / k.y) + 'px';
}

// Sayfanin resim icerik dikdortgeni (object-fit farkindalikli)
function pmContentRectFor(page) {
  const el = page && page.el;
  if (!el || !el.getBoundingClientRect) return null;
  const r = el.getBoundingClientRect();
  const isImg = el.tagName === 'IMG';
  let cs = null;
  try { cs = window.getComputedStyle(el); } catch (e) { cs = null; }
  const num = function (v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  // object-fit, borders, padding and pixel object-position use local CSS pixels.
  // Convert to screen coordinates only after all local geometry is resolved.
  const localW = el.offsetWidth || r.width, localH = el.offsetHeight || r.height;
  const sx = localW ? r.width / localW : 1, sy = localH ? r.height / localH : 1;
  const rect = PM.contentRectOf({
    boxW: localW,
    boxH: localH,
    naturalW: isImg ? (el.naturalWidth || page.imageWidth || 0) : (el.width || 0),
    naturalH: isImg ? (el.naturalHeight || page.imageHeight || 0) : (el.height || 0),
    objectFit: cs ? cs.objectFit : 'fill',
    objectPosition: cs ? cs.objectPosition : '50% 50%',
    borderTop: cs ? num(cs.borderTopWidth) : 0,
    borderLeft: cs ? num(cs.borderLeftWidth) : 0,
    borderRight: cs ? num(cs.borderRightWidth) : 0,
    borderBottom: cs ? num(cs.borderBottomWidth) : 0,
    paddingTop: cs ? num(cs.paddingTop) : 0,
    paddingLeft: cs ? num(cs.paddingLeft) : 0,
    paddingRight: cs ? num(cs.paddingRight) : 0,
    paddingBottom: cs ? num(cs.paddingBottom) : 0,
  });
  if (!rect) return null;
  const scaleRect = function (v) { return { x: v.x * sx, y: v.y * sy, w: v.w * sx, h: v.h * sy }; };
  return Object.assign(scaleRect(rect), { visible: scaleRect(rect.visible), clipped: rect.clipped });
}

function pmSyncAutoLayers() {
  pageMode.pages.forEach(function (page) {
    if (!page.el || !page.el.isConnected) { pmClearPageOverlay(page); return; }
    if (page.layer && page.bubbles.length) pmLayoutPage(page);
    else if (page.layer) pmPositionLayer(page, page.layer);
  });
}

// ── Kuyruk: gonderim, sonuc, pompa ─────────────────────────────────────────

function pmPump() {
  if (!pageMode.active) return;
  while (pageMode.inflight < PM_MAX_INFLIGHT && pageMode.queue.length > 0) {
    pageMode.queue.sort(pmCompareJobs);
    const job = pageMode.queue.shift();
    if (!job || !job.page.el.isConnected) continue;
    const key = pmJobKey(job.page.pageId, job.bandIndex);
    if (pageMode.jobs.has(key)) continue;
    pageMode.inflight++;
    pmSendJob(job, key);
  }
}

function pmCompareJobs(a, b) {
  const ra = a.page.el.getBoundingClientRect();
  const rb = b.page.el.getBoundingClientRect();
  const vh = window.innerHeight || 0;
  const rank = function (r) {
    if (r.bottom > 0 && r.top < vh) return 0;
    return r.top >= vh ? 1 : 2;
  };
  const rankA = rank(ra);
  const rankB = rank(rb);
  if (rankA !== rankB) return rankA - rankB;
  if (rankA === 1) return ra.top - rb.top;
  if (rankA === 2) return rb.bottom - ra.bottom;
  return Math.abs(ra.top) - Math.abs(rb.top);
}

function pmSendJob(job, key) {
  const watchdogId = setTimeout(function () { pmDropJob(key, 'zaman asimi'); }, PM_JOB_WATCHDOG_MS);
  pageMode.jobs.set(key, { job: job, watchdogId: watchdogId });

  chrome.runtime.sendMessage({
    type: 'TRANSLATE_PAGE',
    cacheKey: job.cacheKey,
    pageKey: job.page.pageId,
    bandIndex: job.bandIndex,
    bandCount: job.bandCount,
    dataUrl: job.dataUrl,
    w: job.w,
    h: job.h,
  }).then(function (resp) {
    if (!resp || !resp.ok) {
      pmDropJob(key, (resp && resp.error) || 'istek kabul edilmedi');
      return;
    }
    if (resp.duplicate) return;                            // ayni is kuyrukta: watchdog bekler
    if (resp.cached) {
      pmHandleResult({
        pageKey: job.page.pageId,
        bandIndex: job.bandIndex,
        bubbles: resp.bubbles || [],
        cached: true,
      });
    }
  }).catch(function (e) {
    pmDropJob(key, (e && e.message) || 'gonderilemedi');
  });
}

function pmHandleResult(msg) {
  const key = pmJobKey(msg.pageKey, msg.bandIndex);
  const rec = pageMode.jobs.get(key);
  let job = rec ? rec.job : null;
  if (rec) {
    clearTimeout(rec.watchdogId);
    pageMode.jobs.delete(key);
    pageMode.inflight = Math.max(0, pageMode.inflight - 1);
  }
  const page = pageMode.pages.get(msg.pageKey);
  if (!page) { pmPump(); return; }
  if (!job) job = (page.jobs || [])[Number(msg.bandIndex) || 0] || null;
  const slice = job ? job.slice : { index: 0, count: 1, x: 0, y: 0, width: page.imageWidth, height: page.imageHeight };
  const imageW = job ? job.imageW : page.imageWidth;
  const imageH = job ? job.imageH : page.imageHeight;

  // Model koordinatlari GONDERILEN (olceklenmis) bant uzayindadir; once dogal uzaya cevrilir.
  const fx = (job && job.w) ? (slice.width / job.w) : 1;
  const fy = (job && job.h) ? (slice.height / job.h) : 1;
  const globalBubbles = (msg.bubbles || []).map(function (b) {
    const natural = {
      text: b.text,
      translation: b.translation,
      x: Number(b.x) * fx,
      y: Number(b.y) * fy,
      width: Number(b.width) * fx,
      height: Number(b.height) * fy,
    };
    const g = PM.bandToGlobal(natural, slice, imageW, imageH);
    const out = { text: g.text, translation: g.translation, xPct: g.xPct, yPct: g.yPct, wPct: g.wPct, hPct: g.hPct };
    if (b.localPlacement) out.localPlacement = true;
    // Model 0-1000 (binde-birim) koordinat dondurmus olabilir: alternatif yorumu da sakla.
    // Karar, kutularin icindeki yazi miktarina bakilarak sayfa duzeyinde verilir.
    const vals = [Number(b.x), Number(b.y), Number(b.width), Number(b.height)];
    const maxV = Math.max.apply(null, vals);
    const allFinite = vals.every(function (v) { return Number.isFinite(v) && v >= 0; });
    if (allFinite && maxV <= 1000 && maxV >= 250 && (slice.width > 1000 || slice.height > 1000)) {
      const nat2 = {
        x: Number(b.x) / 1000 * slice.width,
        y: Number(b.y) / 1000 * slice.height,
        width: Number(b.width) / 1000 * slice.width,
        height: Number(b.height) / 1000 * slice.height,
      };
      const g2 = PM.bandToGlobal(nat2, slice, imageW, imageH);
      out.alt = { xPct: g2.xPct, yPct: g2.yPct, wPct: g2.wPct, hPct: g2.hPct };
    }
    return out;
  });
  page.bubbles = page.bubbles.concat(globalBubbles);
  page.received++;
  if (page.received >= page.bandCount) pmFinalizePage(page);
  pmUpdatePill();
  pmPump();
}

function pmDropJob(key, reason) {
  const rec = pageMode.jobs.get(key);
  if (!rec) return;
  clearTimeout(rec.watchdogId);
  pageMode.jobs.delete(key);
  pageMode.inflight = Math.max(0, pageMode.inflight - 1);

  const page = rec.job ? rec.job.page : null;
  if (page) {
    const stillBusy = Array.from(pageMode.jobs.values()).some(function (r) { return r.job && r.job.page === page; });
    if (!stillBusy) {
      if (page.state !== 'done' && page.state !== 'empty') {
        page.state = 'error';
        page.attempts++;
        pageMode.stats.errors++;
      }
      pmFinalizePage(page);                                // elde olan bantlarla bitir
    }
  }
  const r = String(reason || '');
  pmReportError(r === 'zaman asimi' ? 'Yanıt gecikti; sunucudan sonuç gelirse gösterilecek.' : r);
  pmPump();
}

// Yuzdedeki kutulari gercek balon bolgesine oturt.
// Dev sayfalarda (webtoon 900x16000 gibi) tek tuval belleği patlatıyordu; bu yuzden
// balonlar konum komsuluguna gore KUMELENIR ve her kume icin kucuk bir tuval cizilir.
function pmSnapPageBubbles(page, bubbles) {
  const local = bubbles.filter(function (b) { return b.localPlacement; });
  if (local.length) {
    const remaining = bubbles.filter(function (b) { return !b.localPlacement; });
    // Keep detector ownership of the box. Use the existing pixel contour only
    // when it agrees closely; this avoids painting over artwork or the outline.
    const shaped = local.map(function (b) {
      if (!page.image) return b;
      const candidate = pmSnapPageBubbles({ image: page.image }, [Object.assign({}, b, { localPlacement: false })])[0];
      if (!candidate || !candidate.interior) return b;
      const a = { x: b.xPct, y: b.yPct, width: b.wPct, height: b.hPct };
      const c = { x: candidate.xPct, y: candidate.yPct, width: candidate.wPct, height: candidate.hPct };
      return PM.iou(a, c) >= 0.72 ? Object.assign({}, candidate, { localPlacement: true }) : b;
    });
    if (!remaining.length) { page.image = null; return shaped; }
    return shaped.concat(pmSnapPageBubbles(page, remaining));
  }
  const src = page && page.image;
  const W = src && src.width, H = src && src.height;
  if (!src || !src.canvas || !W || !H || !bubbles.length) return bubbles;

  // 1) kumeleme: y sirali, pencereye sigani ayni kumeye at.
  //    Koordinat yorumu secildikten SONRA cagrilir (bubbles dizisi guncellenmis olabilir).
  function buildGroups() {
    const items = bubbles.map(function (b, i) {
      return { idx: i, x: b.xPct * W, y: b.yPct * H, w: Math.max(1, b.wPct * W), h: Math.max(1, b.hPct * H) };
    });
    items.sort(function (a, b) { return a.y - b.y; });
    const gs = [];
    items.forEach(function (it) {
      let g = gs[gs.length - 1];
      const fits = g && ((it.y + it.h) - g.y0) <= PM_SNAP_WINDOW &&
                       Math.abs((it.x + it.w / 2) - g.cx) <= PM_SNAP_WINDOW;
      if (!fits) {
        g = { items: [], x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + it.h, cx: it.x + it.w / 2 };
        gs.push(g);
      }
      g.items.push(it);
      g.x0 = Math.min(g.x0, it.x);
      g.y0 = Math.min(g.y0, it.y);
      g.x1 = Math.max(g.x1, it.x + it.w);
      g.y1 = Math.max(g.y1, it.y + it.h);
      g.cx = (g.x0 + g.x1) / 2;
    });
    return gs;
  }

  const out = bubbles.slice();
  const stats = { groups: 0, snapped: 0, text: 0, kept: 0, merged: 0, pixels: 0, fills: 0 };

  // ── Koordinat uzayi secimi ────────────────────────────────────────────────
  // Model bazen piksel yerine 0-1000 (binde-birim) koordinat dondurur. Iki yorum
  // kutularin icindeki YAZI miktariyla karsilastirilir; binde yorumu belirgin
  // sekilde daha iyiyse kutular o yoruma cevrilir (eski onbellek girdileri de duzelir).
  let mapping = 'primary';
  const withAlt = bubbles.filter(function (b) { return b.alt; });
  if (withAlt.length >= Math.max(2, Math.ceil(bubbles.length * 0.5))) {
    // Her aday KENDI penceresinde puanlanir (iki adayin birlesik penceresi sanatla dolar, skoru bozar).
    const scoreBox = function (bx, by, bw2, bh2) {
      const pad = 0.18;
      const x0 = Math.max(0, Math.floor(bx - bw2 * pad));
      const y0 = Math.max(0, Math.floor(by - bh2 * pad));
      const x1 = Math.min(W, Math.ceil(bx + bw2 + bw2 * pad));
      const y1 = Math.min(H, Math.ceil(by + bh2 + bh2 * pad));
      const gw2 = x1 - x0, gh2 = y1 - y0;
      if (gw2 < 8 || gh2 < 8 || gw2 * gh2 > 1200000) return null;
      let d2 = null;
      try {
        const c = document.createElement('canvas');
        c.width = gw2; c.height = gh2;
        const cx = c.getContext('2d', { willReadFrequently: true });
        cx.drawImage(src.canvas, x0, y0, gw2, gh2, 0, 0, gw2, gh2);
        d2 = cx.getImageData(0, 0, gw2, gh2).data;
      } catch (e) { return null; }
      return PM.textScoreIn(d2, gw2, gh2, [{ x: bx - x0, y: by - y0, width: bw2, height: bh2 }]);
    };
    let sPri = 0, sAlt = 0, used = 0;
    withAlt.slice(0, 12).forEach(function (b) {
      const a = scoreBox(b.xPct * W, b.yPct * H, Math.max(8, b.wPct * W), Math.max(8, b.hPct * H));
      const c2 = scoreBox(b.alt.xPct * W, b.alt.yPct * H, Math.max(8, b.alt.wPct * W), Math.max(8, b.alt.hPct * H));
      if (a == null || c2 == null) return;
      sPri += a; sAlt += c2; used++;
    });
    if (used && sAlt > sPri * 1.25) mapping = 'alt';
    console.log('[MangaLens-pm] koordinat yorumu: ' + mapping + ' (piksel=' + sPri.toFixed(3) + ' binde=' + sAlt.toFixed(3) + ', ' + used + ' ornek)');
  }
  if (mapping === 'alt') {
    for (let i = 0; i < bubbles.length; i++) {
      const b = bubbles[i];
      if (!b.alt) continue;
      // Dizi elemanini da guncelle: kumeleme ve oturtma bu diziden okur.
      bubbles[i] = Object.assign({}, b, { xPct: b.alt.xPct, yPct: b.alt.yPct, wPct: b.alt.wPct, hPct: b.alt.hPct });
      out[i] = bubbles[i];
    }
  }
  stats.mapping = mapping;
  const groups = buildGroups();            // secilen yoruma gore kumeler yeniden kurulur

  groups.forEach(function (g) {
    const gx0 = Math.max(0, Math.floor(g.x0 - PM_SNAP_PAD));
    const gy0 = Math.max(0, Math.floor(g.y0 - PM_SNAP_PAD));
    const gx1 = Math.min(W, Math.ceil(g.x1 + PM_SNAP_PAD));
    const gy1 = Math.min(H, Math.ceil(g.y1 + PM_SNAP_PAD));
    const gw = gx1 - gx0, gh = gy1 - gy0;
    if (gw < 8 || gh < 8) return;
    const scale = Math.min(1, PM_SNAP_WINDOW / Math.max(gw, gh));
    const cw = Math.max(8, Math.round(gw * scale));
    const ch = Math.max(8, Math.round(gh * scale));
    let data = null;
    try {
      const cell = document.createElement('canvas');
      cell.width = cw;
      cell.height = ch;
      const ctx = cell.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src.canvas, gx0, gy0, gw, gh, 0, 0, cw, ch);
      data = ctx.getImageData(0, 0, cw, ch).data;
    } catch (e) {
      console.warn('[MangaLens-pm] snap tuvali kurulamadi:', e.message);
      return;
    }
    const local = g.items.map(function (it) {
      return {
        id: it.idx, text: bubbles[it.idx].text, translation: bubbles[it.idx].translation,
        x: (it.x - gx0) * scale, y: (it.y - gy0) * scale,
        width: Math.max(1, it.w * scale), height: Math.max(1, it.h * scale),
      };
    });
    let snapped = null;
    try {
      snapped = PM.snapBubbles({
        data: data, width: cw, height: ch, bubbles: local,
        opts: { margin: Math.max(1, Math.round(3 * scale)) },
      });
    } catch (e) {
      console.warn('[MangaLens-pm] snap atlandi:', e.message);
      return;
    }
    stats.groups++;
    stats.snapped += snapped.stats.snapped || 0;
    stats.text += snapped.stats.text || 0;
    stats.kept += snapped.stats.kept || 0;
    stats.merged += snapped.stats.merged || 0;
    stats.pixels += snapped.stats.pixels || 0;
    stats.fills += snapped.stats.fills || 0;
    // Remove consumed entries; carry the merged text into the one surviving overlay.
    g.items.forEach(function (it) { out[it.idx] = null; });
    const resolved = PM.resolveOverlaps(snapped.bubbles, { maxRatio: 0.25, minWidth: 24, minHeight: 14 });
    resolved.forEach(function (rb) {
      const idx = (typeof rb.id === 'number') ? rb.id : -1;
      if (idx < 0 || idx >= out.length) return;
      out[idx] = Object.assign({}, bubbles[idx], {
        text: rb.text, translation: rb.translation,
        interior: rb.interior || null, background: rb.background || null,
        xPct: (gx0 + rb.x / scale) / W,
        yPct: (gy0 + rb.y / scale) / H,
        wPct: (rb.width / scale) / W,
        hPct: (rb.height / scale) / H,
        snap: rb.snap || 'model',
      });
    });
  });
  page.snapStats = stats;
  console.log('[MangaLens-pm] snap:', JSON.stringify(stats));
  page.image = null;                      // kaynak tuvali birak
  return out.filter(Boolean);
}

function pmFinalizePage(page) {
  if (!page || page.state === 'done' || (page.state === 'empty' && !page.bubbles.length)) return;
  // The worker can still finish a queued/retried request after our watchdog.
  // An empty timed-out page must be allowed to display that eventual result.
  const wasCountedEmpty = page.state === 'empty';
  page.bubbles = pmDedupeGlobal(page.bubbles);
  page.bubbles = pmSnapPageBubbles(page, page.bubbles);
  if (page.captureRegion) {
    const r = page.captureRegion;
    page.bubbles = page.bubbles.map(function (b) {
      return Object.assign({}, b, { xPct: r.x + b.xPct * r.w, yPct: r.y + b.yPct * r.h,
        wPct: b.wPct * r.w, hPct: b.hPct * r.h });
    });
  }
  page.state = page.bubbles.length ? 'done' : 'empty';
  if (!wasCountedEmpty) pageMode.stats.done++;
  pageMode.stats.bubbles += page.bubbles.length;
  if (page.bubbles.length) pmLayoutPage(page);
  else pmClearPageOverlay(page);          // bos sonuc: gereksiz katman birakma
  if (page.bubbles.length) pmApplyPageEdits(page);
}

function pmDedupeGlobal(list) {
  const local = list.filter(function (b) { return b.localPlacement; });
  const uniqueLocal = [];
  local.forEach(function (b) {
    const rect = { x: b.xPct, y: b.yPct, width: b.wPct, height: b.hPct };
    if (!uniqueLocal.some(function (old) {
      return PM.iou(rect, { x: old.xPct, y: old.yPct, width: old.wPct, height: old.hPct }) >= 0.6;
    })) uniqueLocal.push(b);
  });
  list = list.filter(function (b) { return !b.localPlacement; });
  const scaled = list.map(function (b) {
    const s = { text: b.text, translation: b.translation, x: b.xPct * 10000, y: b.yPct * 10000, width: b.wPct * 10000, height: b.hPct * 10000 };
    if (b.alt) s.alt = b.alt;                    // koordinat yorumu secimi icin tasinir
    return s;
  });
  return uniqueLocal.concat(PM.dedupeBubbles(scaled, { iouThreshold: 0.6 }).map(function (b) {
    const out = { text: b.text, translation: b.translation, xPct: b.x / 10000, yPct: b.y / 10000, wPct: b.width / 10000, hPct: b.height / 10000 };
    if (b.alt) out.alt = b.alt;
    return out;
  }));
}

// ── Tarama ve gozlemciler ──────────────────────────────────────────────────

function pmScanAndEnqueue() {
  if (!pageMode.active) return;
  let found = [];
  try { found = pmCollectPageRecords(); } catch (e) { console.warn('[MangaLens-pm] tarama hatasi:', e.message); }
  found.forEach(function (rec) {
    if (!pageMode.pages.has(rec.pageId)) pageMode.pages.set(rec.pageId, rec);
  });

  const list = [];
  pageMode.pages.forEach(function (page) { list.push(page); });
  const ordered = PM.sortPagesForTranslation(list.map(function (p) {
    const r = p.el.getBoundingClientRect();
    return { page: p, rect: { top: r.top, bottom: r.bottom } };
  }), { top: 0, bottom: window.innerHeight }).map(function (x) { return x.page; });

  ordered.forEach(function (page) {
    if (page.state !== 'idle') return;
    if (pageMode.scope === 'chapter') { pmEnqueuePage(page); return; }
    if (pmIsVisibleRatio(page.el, PM_MIN_AREA_RATIO)) { pmEnqueuePage(page); return; }
    if (pageMode.scope === 'onScroll' && pmNearViewport(page.el)) pmEnqueuePage(page);
  });

  if (pageMode.pages.size === 0) pmUpdatePill('sayfa bulunamadi');
  pmSyncAutoLayers();
}

function pmCheckUrlChange() {
  if (location.href === pageMode.lastUrl) return;
  pageMode.lastUrl = location.href;
  pageMode.pages.forEach(pmClearPageOverlay);
  pageMode.pages.clear();
  pageMode.queue = [];
  pageMode.jobs.forEach(function (r) { clearTimeout(r.watchdogId); });
  pageMode.jobs.clear();
  pageMode.inflight = 0;
  pageMode.stats = { total: 0, done: 0, bubbles: 0, errors: 0 };
  chrome.runtime.sendMessage({ type: 'CANCEL_PAGE_JOBS', all: true }).catch(function () {});
  pmUpdatePill();
  pmScanAndEnqueue();
}

function pmSetupObservers() {
  const onScroll = pmDebounce(function () { pmScanAndEnqueue(); pmSyncAutoLayers(); }, 400);
  const onMutation = pmDebounce(function () { pmScanAndEnqueue(); }, 600);
  const mo = new MutationObserver(onMutation);
  mo.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('scroll', onScroll, { passive: true });

  const onResize = pmDebounce(pmSyncAutoLayers, 250);
  window.addEventListener('resize', onResize, { passive: true });

  const titleEl = document.querySelector('title');
  const urlWatch = new MutationObserver(function () { pmCheckUrlChange(); });
  if (titleEl) urlWatch.observe(titleEl, { childList: true, characterData: true });

  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function () {
    const r = origPush.apply(this, arguments);
    pmCheckUrlChange();
    return r;
  };
  history.replaceState = function () {
    const r = origReplace.apply(this, arguments);
    pmCheckUrlChange();
    return r;
  };
  const onPop = function () { pmCheckUrlChange(); };
  window.addEventListener('popstate', onPop);

  pageMode.teardown.push(function () {
    mo.disconnect();
    urlWatch.disconnect();
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('popstate', onPop);
    history.pushState = origPush;
    history.replaceState = origReplace;
  });
}

// ── Pill (alt bar) ─────────────────────────────────────────────────────────

function pmEnsurePill() {
  pmEnsureStyles();
  let pill = document.getElementById('ml-pill');
  if (pill) return pill;
  pill = document.createElement('div');
  pill.id = 'ml-pill';
  pill.className = 'ml-pill';
  pill.innerHTML =
    '<span class="ml-pill-text" id="ml-pill-text">Hazirlaniyor...</span>' +
    '<button type="button" class="ml-pill-btn" id="ml-pill-toggle">Gizle</button>' +
    '<button type="button" class="ml-pill-btn" id="ml-pill-retry">Yeniden</button>' +
    '<button type="button" class="ml-pill-btn" data-kind="danger" id="ml-pill-stop">Durdur</button>' +
    '<details class="ml-error-details" id="ml-error-details" hidden>' +
    '<summary>Hata ayrıntısı</summary><div class="ml-error-message" id="ml-error-message"></div></details>';
  document.body.appendChild(pill);

  document.getElementById('ml-pill-toggle').addEventListener('click', function () {
    const hidden = document.body.classList.toggle('ml-auto-hidden');
    this.textContent = hidden ? 'Goster' : 'Gizle';
  });
  document.getElementById('ml-pill-retry').addEventListener('click', function () {
    pageMode.pages.forEach(function (page) {
      if (page.state === 'error' || page.state === 'empty') {
        page.state = 'idle';
        page.bubbles = [];
        page.received = 0;
        pmClearPageOverlay(page);
      }
    });
    pmScanAndEnqueue();
  });
  document.getElementById('ml-pill-stop').addEventListener('click', function () { pmStopPageMode(true); });
  return pill;
}

function pmUpdatePill(note) {
  const pill = pmEnsurePill();
  const text = pill.querySelector('#ml-pill-text');
  if (!text) return;
  const parts = [pageMode.stats.done + '/' + Math.max(pageMode.stats.total, pageMode.stats.done) + ' sayfa',
                 pageMode.stats.bubbles + ' balon'];
  if (pageMode.stats.errors) parts.push(pageMode.stats.errors + ' hata');
  if (note && !(note === 'hata' && pageMode.stats.errors)) parts.push(note);
  text.textContent = 'MangaLens: ' + parts.join(' · ');
  const details = pill.querySelector('#ml-error-details');
  const errorText = pill.querySelector('#ml-error-message');
  if (details && errorText) {
    details.hidden = !pageMode.lastError;
    if (errorText.textContent !== pageMode.lastError) errorText.textContent = pageMode.lastError;
  }
}

function pmReportError(reason) {
  pageMode.lastError = String(reason || 'Bilinmeyen hata')
    .replace(/([?&]key=)[^&\s]+/gi, '$1[gizlendi]')
    .replace(/AIza[\w-]+/g, '[anahtar gizlendi]');
  pmUpdatePill();
  const details = document.getElementById('ml-error-details');
  if (details) details.open = true;
}

// ── Baslat / durdur ────────────────────────────────────────────────────────

function pmStartPageMode(scope) {
  pmEnsureStyles();
  if (typeof selectionMode !== 'undefined' && selectionMode.active && typeof exitSelectionMode === 'function') exitSelectionMode();
  if (typeof quickTranslateMode !== 'undefined' && quickTranslateMode.active && typeof stopQuickTranslateMode === 'function') stopQuickTranslateMode();

  pmStopPageMode(false);
  pageMode.active = true;
  pageMode.lastError = '';
  pageMode.scope = (scope === 'visible' || scope === 'chapter') ? scope : 'onScroll';
  pageMode.stats = { total: 0, done: 0, bubbles: 0, errors: 0 };
  pageMode.queue = [];
  pmEnsurePill();
  pmUpdatePill();
  pmSetupObservers();
  pmScanAndEnqueue();
  return { ok: true, scope: pageMode.scope };
}

function pmStopPageMode(removeOverlays) {
  pageMode.active = false;
  pageMode.teardown.forEach(function (fn) { try { fn(); } catch (e) {} });
  pageMode.teardown = [];
  chrome.runtime.sendMessage({ type: 'CANCEL_PAGE_JOBS', all: true }).catch(function () {});
  pageMode.jobs.forEach(function (r) { clearTimeout(r.watchdogId); });
  pageMode.jobs.clear();
  pageMode.queue = [];
  pageMode.inflight = 0;

  if (removeOverlays) {
    pageMode.pages.forEach(pmClearPageOverlay);
    pageMode.pages.clear();
    const pill = document.getElementById('ml-pill');
    if (pill) pill.remove();
    document.body.classList.remove('ml-auto-hidden');
  } else {
    pmUpdatePill('durduruldu');
  }
}

function pmHandleControlMessage(message, sendResponse) {
  if (!message || typeof message.type !== 'string') return false;
  if (message.type === 'START_PAGE_MODE') {
    sendResponse(pmStartPageMode(message.scope));
    return true;
  }
  if (message.type === 'STOP_PAGE_MODE') {
    pmStopPageMode(!!message.removeOverlays);
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'GET_PAGE_MODE_STATUS') {
    sendResponse({ ok: true, active: pageMode.active, scope: pageMode.scope, stats: pageMode.stats, error: pageMode.lastError });
    return true;
  }
  return false;
}

// ── SW'den gelen sonuclar ──────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || typeof message.type !== 'string') return false;
  if (message.type !== 'PAGE_RESULT' && message.type !== 'PAGE_JOB_FAILED' && message.type !== 'PAGE_PROGRESS') return false;
  if (!pageMode.active) return false;

  if (message.type === 'PAGE_PROGRESS') {
    const key = pmJobKey(message.pageKey, message.bandIndex);
    const rec = pageMode.jobs.get(key);
    if (rec) {
      clearTimeout(rec.watchdogId);
      rec.watchdogId = setTimeout(function () { pmDropJob(key, 'zaman asimi'); }, PM_JOB_WATCHDOG_MS);
      if (message.error) pmReportError(message.error);
      else pmUpdatePill(message.status === 'working' ? 'Çevriliyor…' : 'Sırada bekleniyor…');
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'PAGE_RESULT') {
    pmHandleResult(message);
  } else {
    pmDropJob(pmJobKey(message.pageKey, message.bandIndex), message.error || message.status || 'hata');
  }
  sendResponse({ ok: true });
  return true;
});
