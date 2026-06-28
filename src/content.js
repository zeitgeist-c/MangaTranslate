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
  console.log('[MangaLens] showOverlay cagirildi, area:', area, 'bubbles:', bubbles.length);

  // Eger daha once bir overlay kaldiysa kaldir
  var existing = document.getElementById('ml-result-overlay');
  if (existing) existing.remove();

  var container = document.createElement('div');
  container.id = 'ml-result-overlay';
  container.className = 'ml-overlay-result';
  // Inline style ile tum CSS'i override et — site stilleri engel olmasin
  container.setAttribute('style',
    'all:initial!important;' +
    'position:fixed!important;' +
    'left:' + area.x + 'px!important;' +
    'top:' + area.y + 'px!important;' +
    'width:' + area.width + 'px!important;' +
    'height:' + area.height + 'px!important;' +
    'border:3px solid #7c3aed!important;' +
    'background:rgba(20,10,40,0.95)!important;' +
    'z-index:2147483647!important;' +
    'overflow:visible!important;' +
    'border-radius:6px!important;' +
    'pointer-events:auto!important;' +
    'display:block!important;' +
    'visibility:visible!important;' +
    'opacity:1!important;' +
    'box-sizing:border-box!important;' +
    'font-family:system-ui,-apple-system,sans-serif!important;' +
    'color:inherit!important;' +
    'text-align:inherit!important;'
  );

  console.log('[MangaLens] container olusturuldu, html ye ekleniyor...');

  // Kapatma butonu
  var closeBtn = document.createElement('div');
  closeBtn.textContent = 'x Kapat';
  closeBtn.style.cssText =
    'position:absolute!important;top:-28px!important;right:0!important;' +
    'background:#7c3aed!important;color:white!important;' +
    'padding:4px 10px!important;border-radius:4px!important;' +
    'font-size:11px!important;cursor:pointer!important;z-index:100001!important;';
  closeBtn.addEventListener('click', function() { container.remove(); });
  container.appendChild(closeBtn);

  // Her balon icin kutu — bbox'lar artik crop koordinatinda, direkt koy
  // Crop boyutu area boyutundan farkli olabilir (DPR nedeniyle)
  var dpr = window.devicePixelRatio || 1;
  bubbles.forEach(function(b) {
    var div = document.createElement('div');
    div.textContent = b.text || '(bos)';
    // Crop koordinatini CSS koordinatina cevir (DPR'ye bol)
    var px = b.x / dpr;
    var py = b.y / dpr;
    var pw = b.width / dpr;
    var ph = b.height / dpr;
    div.setAttribute('style',
      'all:initial!important;' +
      'position:absolute!important;' +
      'left:' + px + 'px!important;' +
      'top:' + py + 'px!important;' +
      'width:' + pw + 'px!important;' +
      'min-height:' + ph + 'px!important;' +
      'background:rgba(255,255,255,0.98)!important;' +
      'color:#000!important;' +
      'padding:4px!important;' +
      'font-family:system-ui,sans-serif!important;' +
      'font-size:13px!important;' +
      'font-weight:600!important;' +
      'border-radius:3px!important;' +
      'display:flex!important;' +
      'align-items:center!important;' +
      'justify-content:center!important;' +
      'text-align:center!important;' +
      'line-height:1.3!important;' +
      'box-sizing:border-box!important;' +
      'border:1px solid #7c3aed!important;' +
      'overflow:hidden!important;'
    );
    container.appendChild(div);
  });

  // documentElement'e ekle (body degil) — en ust seviyede
  var parent = document.body || document.documentElement;
  parent.appendChild(container);
  console.log('[MangaLens] container eklendi. Rect:', container.getBoundingClientRect());

  // TEST: Minimal bir div ekle — site CSS engelliyor mu kontrol et
  var testDiv = document.createElement('div');
  testDiv.id = 'ml-test-div';
  testDiv.textContent = 'ML_TEST_VISIBLE';
  testDiv.setAttribute('style',
    'all:initial!important;' +
    'position:fixed!important;' +
    'left:10px!important;top:10px!important;' +
    'background:red!important;color:white!important;' +
    'padding:20px!important;font-size:30px!important;' +
    'z-index:2147483647!important;' +
    'display:block!important;visibility:visible!important;opacity:1!important;'
  );
  document.body.appendChild(testDiv);
  console.log('[MangaLens] TEST div eklendi. Goruyor musun? Rect:', testDiv.getBoundingClientRect());
  // 5 sn sonra kaldir
  setTimeout(function() {
    testDiv.remove();
    console.log('[MangaLens] TEST div 5sn sonra kaldirildi.');
  }, 5000);

  // 1 sn sonra hâlâ DOM'da mı kontrol et
  setTimeout(function() {
    var still = document.getElementById('ml-result-overlay');
    if (still) {
      console.log('[MangaLens] 1sn sonra overlay hâlâ DOM\'da. Rect:', still.getBoundingClientRect());
      console.log('[MangaLens] Parent:', still.parentElement?.tagName, 'ComputedStyle:', getComputedStyle(still).display, getComputedStyle(still).visibility, getComputedStyle(still).opacity, getComputedStyle(still).zIndex);
    } else {
      console.warn('[MangaLens] 1sn sonra overlay DOM\'dan SİLİNMİŞ! Sayfa JS tarafından kaldırıldı.');
    }
  }, 1000);

  // Iframe içinde miyiz?
  console.log('[MangaLens] window === top?', window === window.top, 'iframe?', window !== window.top);

  // Re-attach watchdog: 3 sn boyunca container DOM'dan kaybolursa yeniden ekle
  var watchdog = setInterval(function() {
    var c = document.getElementById('ml-result-overlay');
    if (!c || !c.isConnected) {
      console.warn('[MangaLens] watchdog: container kayip, yeniden ekleniyor...');
      try { (document.body || document.documentElement).appendChild(container); } catch (e) {}
    }
  }, 200);
  setTimeout(function() { clearInterval(watchdog); }, 3000);
}

console.log('[MangaLens] v3 minimal content.js hazir');
