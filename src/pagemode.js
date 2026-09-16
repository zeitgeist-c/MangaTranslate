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
  const canvas = await captureVisibleRect({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
  return { canvas: canvas, width: canvas.width, height: canvas.height, source: 'viewport-crop', src: 'crop' };
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
  page.imageWidth = img.width;
  page.imageHeight = img.height;

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
    pmUpdatePill('sayfa alinamadi');
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
  syncSelectionLayerPosition(page.el, layer);              // content.js'ten
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
  const text = box.textContent || '';
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
  let size = PM.estimateFontSize(w, h, text.length, { min: 9, max: 18 });
  box.style.setProperty('font-size', size + 'px', 'important');
  for (let i = 0; i < 10; i++) {
    if (box.scrollHeight <= box.clientHeight + 1 && box.scrollWidth <= box.clientWidth + 1) break;
    size -= 1;
    if (size < 9) break;
    box.style.setProperty('font-size', size + 'px', 'important');
  }
}

function pmLayoutPage(page) {
  if (!page || !page.el || !page.el.isConnected) return;
  const layer = pmEnsureAutoLayer(page);
  if (!layer) return;
  const rect = page.el.getBoundingClientRect();
  const wanted = page.bubbles.length;

  while (layer.children.length > wanted) layer.removeChild(layer.lastElementChild);

  for (let i = 0; i < wanted; i++) {
    const b = page.bubbles[i];
    let box = layer.children[i];
    if (!box) {
      box = document.createElement('div');
      box.className = 'ml-auto-bubble';
      layer.appendChild(box);
    }
    const text = b.translation || b.text || '';
    if (box.dataset.mlText !== text) {
      box.dataset.mlText = text;
      box.textContent = text;
    }
    if (box.title !== (b.text || '')) box.title = b.text || '';

    let x = Math.round(b.xPct * rect.width);
    let y = Math.round(b.yPct * rect.height);
    let w = Math.max(24, Math.round(b.wPct * rect.width));
    let h = Math.max(16, Math.round(b.hPct * rect.height));
    if (w < 70 || h < 26) {                                // cok kucuk balon: hafif buyut
      w = Math.min(Math.max(w, 70), Math.max(24, Math.round(rect.width - x)));
      h = Math.min(Math.max(h, 26), Math.max(16, Math.round(rect.height - y)));
    }
    box.style.setProperty('left', x + 'px', 'important');
    box.style.setProperty('top', y + 'px', 'important');
    box.style.setProperty('width', w + 'px', 'important');
    box.style.setProperty('height', h + 'px', 'important');
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

function pmSyncAutoLayers() {
  pageMode.pages.forEach(function (page) {
    if (!page.el || !page.el.isConnected) { pmClearPageOverlay(page); return; }
    if (page.layer && page.bubbles.length) pmLayoutPage(page);
    else if (page.layer) syncSelectionLayerPosition(page.el, page.layer);
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
    return { text: g.text, translation: g.translation, xPct: g.xPct, yPct: g.yPct, wPct: g.wPct, hPct: g.hPct };
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
  pmUpdatePill(r === 'zaman asimi' ? 'zaman asimi'
    : (/kota|rate|429/i.test(r) ? 'kota/limit' : 'hata'));
  pmPump();
}

function pmFinalizePage(page) {
  if (!page || page.state === 'done' || page.state === 'empty') return;
  page.bubbles = pmDedupeGlobal(page.bubbles);
  page.state = page.bubbles.length ? 'done' : 'empty';
  pageMode.stats.done++;
  pageMode.stats.bubbles += page.bubbles.length;
  if (page.bubbles.length) pmLayoutPage(page);
  else pmClearPageOverlay(page);          // bos sonuc: gereksiz katman birakma
}

function pmDedupeGlobal(list) {
  const scaled = list.map(function (b) {
    return { text: b.text, translation: b.translation, x: b.xPct * 10000, y: b.yPct * 10000, width: b.wPct * 10000, height: b.hPct * 10000 };
  });
  return PM.dedupeBubbles(scaled, { iouThreshold: 0.6 }).map(function (b) {
    return { text: b.text, translation: b.translation, xPct: b.x / 10000, yPct: b.y / 10000, wPct: b.width / 10000, hPct: b.height / 10000 };
  });
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
    '<button type="button" class="ml-pill-btn" data-kind="danger" id="ml-pill-stop">Durdur</button>';
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
}

// ── Baslat / durdur ────────────────────────────────────────────────────────

function pmStartPageMode(scope) {
  pmEnsureStyles();
  if (typeof selectionMode !== 'undefined' && selectionMode.active && typeof exitSelectionMode === 'function') exitSelectionMode();
  if (typeof quickTranslateMode !== 'undefined' && quickTranslateMode.active && typeof stopQuickTranslateMode === 'function') stopQuickTranslateMode();

  pmStopPageMode(false);
  pageMode.active = true;
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
    sendResponse({ ok: true, active: pageMode.active, scope: pageMode.scope, stats: pageMode.stats });
    return true;
  }
  return false;
}

// ── SW'den gelen sonuclar ──────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || typeof message.type !== 'string') return false;
  if (message.type !== 'PAGE_RESULT' && message.type !== 'PAGE_JOB_FAILED') return false;
  if (!pageMode.active) return false;

  if (message.type === 'PAGE_RESULT') {
    pmHandleResult(message);
  } else {
    pmDropJob(pmJobKey(message.pageKey, message.bandIndex), message.status === 'rate_limited' ? 'kota/limit' : (message.error || 'hata'));
  }
  sendResponse({ ok: true });
  return true;
});
