// MangaLens content script — Alan Seç, Oto Çevir ve sonuç araçları

'use strict';




let sm_overlay = null;
let sm_controls = null;

const MAX_SELECTIONS = 12;
const MIN_SELECTION_SIZE = 24;
const QUICK_CAPTURE_TIMEOUT_MS = 12000;
// v3.1.4: ceviri beklemesi kuyruk derinligine gore buyur — sabit 75sn, kuyrukta bekleyen
// son isteklerde erken dusup "Gemini zaman asimi" gosteriyordu (SW isi bitirse de sonuc kayboluyordu).
const QUICK_TRANSLATE_TIMEOUT_MS = 75000;      // taban bekleme (kuyruk bos)
const TRANSLATE_TIMEOUT_PER_JOB_MS = 16000;    // kuyrukta bekleyen her ek is icin pay
const TRANSLATE_TIMEOUT_MAX_MS = 240000;
let selectionMode = {
  active: false,
  selections: [],
  drawing: null,
  selectedId: null,
  interaction: null,
};

let manualCaptureInFlight = 0;
let manualTranslationInFlight = false;
let quickTranslateMode = {
  active: false,
  drawing: null,
  jobs: [],
  hitLayer: null,
};



let translationFontSize = 16;

chrome.storage.sync.get({ translationFontSize: 16 }, function(data) {
  applyTranslationFontSize(data && data.translationFontSize);
});

chrome.storage.onChanged.addListener(function(changes, area) {
  if (area === 'sync' && changes.translationFontSize) {
    applyTranslationFontSize(changes.translationFontSize.newValue);
  }
});

function normalizeTranslationFontSize(value) {
  var size = Number(value);
  return [16, 20].indexOf(size) !== -1 ? size : 16;
}

function applyTranslationFontSize(value) {
  translationFontSize = normalizeTranslationFontSize(value);
  document.querySelectorAll('.ml-selection-result').forEach(function(bubble) {
    bubble.style.setProperty('font-size', translationFontSize + 'px', 'important');
  });
}

// ── Mesaj dinleyici ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.type === 'PING_CONTENT') {
    sendResponse({ ok: true, name: 'MangaLens content' });
    return true;
  }

  if (message.type === 'GET_TRANSLATION_MODE') {
    sendResponse({
      ok: true,
      mode: selectionMode.active ? 'selection' : (quickTranslateMode.active ? 'quick' : null),
    });
    return true;
  }

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

  if (message.type === 'START_QUICK_TRANSLATE_MODE') {
    startQuickTranslateMode();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'STOP_QUICK_TRANSLATE_MODE') {
    stopQuickTranslateMode();
    sendResponse({ ok: true });
    return true;
  }

  return true;
});

// ── Selection Mode UI ────────────────────────────────────────────────────────

function enterSelectionMode() {
  if (selectionMode.active || sm_overlay || sm_controls) {
    exitSelectionMode({ force: true });
  }
  if (quickTranslateMode.active) stopQuickTranslateMode();
  removeSelectionLayers();
  selectionMode.active = true;
  selectionMode.selections = [];
  selectionMode.drawing = null;
  selectionMode.selectedId = null;
  selectionMode.interaction = null;

  document.body.style.cursor = 'crosshair';

  sm_overlay = document.createElement('div');
  sm_overlay.style.cssText =
    'position:fixed!important;top:0!important;left:0!important;' +
    'width:100%!important;height:100%!important;' +
    'background:rgba(0,0,0,0.18)!important;z-index:2147483644!important;' +
    'pointer-events:none!important;';
  document.body.appendChild(sm_overlay);

  createSelectionControls();

  document.addEventListener('mousedown', onSmStart, true);
  document.addEventListener('mousemove', onSmMove, true);
  document.addEventListener('mouseup', onSmEnd, true);
  document.addEventListener('keydown', onSmKey, true);
  window.addEventListener('resize', syncSelectionLayers, true);
  window.addEventListener('scroll', syncSelectionLayers, true);
  updateSelectionControls();
}

function exitSelectionMode(options) {
  options = options || {};
  if (!selectionMode.active && !options.force) return;
  selectionMode.active = false;

  document.body.style.cursor = '';
  document.removeEventListener('mousedown', onSmStart, true);
  document.removeEventListener('mousemove', onSmMove, true);
  document.removeEventListener('mouseup', onSmEnd, true);
  document.removeEventListener('keydown', onSmKey, true);
  window.removeEventListener('resize', syncSelectionLayers, true);
  window.removeEventListener('scroll', syncSelectionLayers, true);

  if (!options.keepSelections) {
    selectionMode.selections.forEach(disposeManualSelectionCapture);
    removeSelectionLayers();
    selectionMode.selections = [];
  }
  if (selectionMode.drawing && selectionMode.drawing.boxEl) selectionMode.drawing.boxEl.remove();
  selectionMode.drawing = null;
  selectionMode.selectedId = null;
  selectionMode.interaction = null;
  if (sm_overlay) sm_overlay.remove();
  if (sm_controls) sm_controls.remove();
  sm_overlay = null;
  sm_controls = null;
}

function createSelectionControls() {
  sm_controls = document.createElement('div');
  sm_controls.id = 'ml-selection-controls';
  sm_controls.style.cssText =
    'position:fixed!important;bottom:18px!important;left:50%!important;' +
    'transform:translateX(-50%)!important;' +
    'background:rgba(17,24,39,0.96)!important;color:#f9fafb!important;' +
    'border:1px solid rgba(255,255,255,0.16)!important;border-radius:8px!important;' +
    'padding:10px!important;display:flex!important;align-items:center!important;' +
    'gap:8px!important;z-index:2147483647!important;font-family:system-ui,sans-serif!important;' +
    'box-shadow:0 14px 40px rgba(0,0,0,0.34)!important;';
  sm_controls.innerHTML =
    '<span id="ml-selection-count" style="font-size:12px;font-weight:700;white-space:nowrap;">Secili: 0 / ' + MAX_SELECTIONS + '</span>' +
    '<span id="ml-selection-msg" style="font-size:12px;color:#a7f3d0;min-width:88px;"></span>' +
    '<button id="ml-undo" type="button" style="' + selectionControlButtonStyle(false) + '">Son Alani Geri Al</button>' +
    '<button id="ml-clear" type="button" style="' + selectionControlButtonStyle(false) + '">Tumunu Temizle</button>' +
    '<button id="ml-cancel" type="button" style="' + selectionControlButtonStyle(false) + '">Iptal Esc</button>' +
    '<button id="ml-confirm" type="button" style="' + selectionControlButtonStyle(true) + '">Cevir Enter</button>';
  document.body.appendChild(sm_controls);
  document.getElementById('ml-undo').addEventListener('click', undoLastSelection);
  document.getElementById('ml-clear').addEventListener('click', clearSelections);
  document.getElementById('ml-cancel').addEventListener('click', function() { exitSelectionMode(); });
  document.getElementById('ml-confirm').addEventListener('click', confirmSelection);
}

function selectionControlButtonStyle(primary) {
  return 'height:30px!important;padding:0 10px!important;border-radius:6px!important;' +
    'border:1px solid ' + (primary ? '#2563eb' : 'rgba(255,255,255,0.18)') + '!important;' +
    'background:' + (primary ? '#2563eb' : 'rgba(255,255,255,0.08)') + '!important;' +
    'color:#fff!important;font-size:12px!important;font-weight:700!important;cursor:pointer!important;';
}

function updateSelectionControls(message) {
  var count = document.getElementById('ml-selection-count');
  if (count) count.textContent = 'Secili: ' + selectionMode.selections.length + ' / ' + MAX_SELECTIONS;
  if (message) setSelectionMessage(message);
}

function setSelectionMessage(message) {
  var msg = document.getElementById('ml-selection-msg');
  if (!msg) return;
  msg.textContent = message || '';
  if (message) {
    clearTimeout(setSelectionMessage.timer);
    setSelectionMessage.timer = setTimeout(function() {
      var current = document.getElementById('ml-selection-msg');
      if (current) current.textContent = '';
    }, 2200);
  }
}

function onSmStart(e) {
  if (!selectionMode.active) return;
  if (e.target.closest('.ml-selection-box')) return;
  if (e.target.closest('#ml-selection-controls')) return;
  if (e.button !== 0) return;
  if (manualCaptureInFlight > 0) {
    updateSelectionControls('Alan hazırlanıyor...');
    return;
  }
  if (selectionMode.selections.length >= MAX_SELECTIONS) {
    updateSelectionControls('En fazla ' + MAX_SELECTIONS + ' alan');
    return;
  }

  var page = findMangaPageAtPoint(e.clientX, e.clientY);
  if (!page) {
    updateSelectionControls('Bu noktada çevrilebilir görsel bulunamadı');
    return;
  }
  e.preventDefault();
  e.stopPropagation();

  page.pageId = getPageId(page.el, page.index);
  var local = clientToImageLocal(page.el, e.clientX, e.clientY);
  var layer = ensureSelectionLayer(page.el, page.pageId);
  if (!layer) {
    updateSelectionControls('Gorsel hazir degil');
    return;
  }
  var draft = {
    id: makeSelectionId(),
    pageId: page.pageId,
    imgEl: page.el,
    layerEl: layer,
    boxEl: null,
    startX: local.x,
    startY: local.y,
    x: local.x,
    y: local.y,
    width: 0,
    height: 0,
    xPct: 0,
    yPct: 0,
    wPct: 0,
    hPct: 0,
    captureDataUrl: null,
    captureWidth: 0,
    captureHeight: 0,
    capturePromise: null,
    captureError: null,
    captureDirty: true,
    captureVersion: 0,
    captureDisposed: false,
  };
  draft.boxEl = createSelectionBox(draft, true);
  layer.appendChild(draft.boxEl);
  selectionMode.drawing = draft;
  setActiveSelection(draft.id);
}

function onSmMove(e) {
  if (!selectionMode.drawing) return;
  e.preventDefault();
  var s = selectionMode.drawing;
  var local = clientToImageLocal(s.imgEl, e.clientX, e.clientY);
  s.x = Math.min(s.startX, local.x);
  s.y = Math.min(s.startY, local.y);
  s.width = Math.abs(local.x - s.startX);
  s.height = Math.abs(local.y - s.startY);
  updateSelectionPercent(s);
  renderSelectionBox(s);
}

function onSmEnd(e) {
  if (!selectionMode.drawing) return;
  e.preventDefault();
  var s = selectionMode.drawing;
  selectionMode.drawing = null;
  if (s.width < MIN_SELECTION_SIZE || s.height < MIN_SELECTION_SIZE) {
    if (s.boxEl) s.boxEl.remove();
    updateSelectionControls('Alan cok kucuk');
    return;
  }
  s.boxEl.classList.remove('ml-selection-draft');
  installSelectionBoxHandlers(s);
  selectionMode.selections.push(s);
  setActiveSelection(s.id);
  updateSelectionControls();
  prepareManualSelectionCapture(s);
}

function onSmKey(e) {
  if (!selectionMode.active) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    exitSelectionMode();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    confirmSelection();
  } else if ((e.ctrlKey && e.key.toLowerCase() === 'z') || e.key === 'Backspace') {
    e.preventDefault();
    undoLastSelection();
  } else if (e.key === 'Delete') {
    e.preventDefault();
    deleteActiveSelection();
  }
}

function confirmSelection() {
  if (manualTranslationInFlight) return;
  if (selectionMode.selections.length === 0) {
    exitSelectionMode();
    return;
  }
  var selections = selectionMode.selections.slice();
  manualTranslationInFlight = true;
  exitSelectionMode({ keepSelections: true });
  translateSelectionItems(selections).finally(function() {
    manualTranslationInFlight = false;
  });
}

function makeSelectionId() {
  return 'mlsel-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function findMangaPageAtPoint(clientX, clientY) {
  var pages = collectMangaPages();
  var pointElements = document.elementsFromPoint
    ? document.elementsFromPoint(clientX, clientY)
    : [];

  for (var p = 0; p < pointElements.length; p++) {
    var pointEl = pointElements[p];
    var tagName = pointEl && pointEl.tagName ? pointEl.tagName.toUpperCase() : '';
    if (tagName !== 'IMG' && tagName !== 'CANVAS') continue;
    var pointRect = pointEl.getBoundingClientRect();
    if (pointRect.width < 80 || pointRect.height < 40 || (pointRect.width * pointRect.height) < 3200) continue;
    var existingIndex = pages.findIndex(function(page) { return page.el === pointEl; });
    if (existingIndex >= 0) return pages[existingIndex];
    return {
      el: pointEl,
      index: pages.length,
      source: 'point-visible',
    };
  }

  for (var i = pages.length - 1; i >= 0; i--) {
    var rect = pages[i].el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
      return pages[i];
    }
  }
  return null;
}

function clientToImageLocal(imgEl, clientX, clientY) {
  var rect = imgEl.getBoundingClientRect();
  return {
    x: clampInt(clientX - rect.left, 0, rect.width),
    y: clampInt(clientY - rect.top, 0, rect.height),
    imageWidth: rect.width,
    imageHeight: rect.height,
  };
}

function ensureSelectionLayer(imgEl, pageId) {
  var parent = ensureRelativeParent(imgEl);
  if (!parent) return null;
  if (!parent.dataset.mlSelectionPrevZ) {
    parent.dataset.mlSelectionPrevZ = parent.style.zIndex || '';
  }
  parent.style.zIndex = '2147483645';
  var selector = '[data-ml-selection-layer="' + cssEscapeSafe(pageId) + '"]';
  var layer = parent.querySelector(selector);
  if (!layer) {
    layer = document.createElement('div');
    layer.dataset.mlSelectionLayer = pageId;
    layer.className = 'ml-selection-layer';
    layer.style.cssText =
      'position:absolute!important;pointer-events:none!important;' +
      'z-index:2147483646!important;box-sizing:border-box!important;';
    parent.appendChild(layer);
  }
  syncSelectionLayerPosition(imgEl, layer);
  return layer;
}

function cssEscapeSafe(value) {
  if (window.CSS && CSS.escape) return CSS.escape(String(value));
  return String(value).replace(/"/g, '\\"');
}

function syncSelectionLayerPosition(imgEl, layer) {
  var parent = layer.parentElement;
  if (!parent) return;
  var imgRect = imgEl.getBoundingClientRect();
  var parentRect = parent.getBoundingClientRect();
  var left = imgRect.left - parentRect.left + parent.scrollLeft;
  var top = imgRect.top - parentRect.top + parent.scrollTop;
  layer.style.left = left + 'px';
  layer.style.top = top + 'px';
  layer.style.width = imgRect.width + 'px';
  layer.style.height = imgRect.height + 'px';
}

function syncSelectionLayers() {
  selectionMode.selections.forEach(function(s) {
    if (!s.imgEl || !s.layerEl) return;
    syncSelectionLayerPosition(s.imgEl, s.layerEl);
    updateSelectionFromPercent(s);
  });
  if (selectionMode.drawing && selectionMode.drawing.layerEl) {
    syncSelectionLayerPosition(selectionMode.drawing.imgEl, selectionMode.drawing.layerEl);
  }
}

function updateSelectionPercent(s) {
  var rect = s.imgEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  s.xPct = s.x / rect.width;
  s.yPct = s.y / rect.height;
  s.wPct = s.width / rect.width;
  s.hPct = s.height / rect.height;
}

function updateSelectionFromPercent(s) {
  var rect = s.imgEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  s.x = s.xPct * rect.width;
  s.y = s.yPct * rect.height;
  s.width = s.wPct * rect.width;
  s.height = s.hPct * rect.height;
  renderSelectionBox(s);
}

function createSelectionBox(s, isDraft) {
  var box = document.createElement('div');
  box.className = 'ml-selection-box' + (isDraft ? ' ml-selection-draft' : '');
  box.dataset.selectionId = s.id;
  box.style.cssText =
    'position:absolute!important;box-sizing:border-box!important;' +
    'border:2px solid #38bdf8!important;background:rgba(56,189,248,0.16)!important;' +
    'box-shadow:0 0 0 1px rgba(0,0,0,0.25),0 8px 24px rgba(0,0,0,0.24)!important;' +
    'pointer-events:auto!important;cursor:move!important;border-radius:4px!important;';
  box.innerHTML =
    '<button type="button" class="ml-selection-retry" title="Alternatif çeviri üret" aria-label="Alternatif çeviri üret" style="' +
    'display:none;position:absolute!important;right:31px!important;top:3px!important;width:22px!important;height:22px!important;z-index:4!important;' +
    'border:none!important;border-radius:999px!important;background:#2563eb!important;color:white!important;' +
    'font-size:16px!important;line-height:20px!important;font-weight:800!important;cursor:pointer!important;padding:0!important;pointer-events:auto!important;">↻</button>' +
    '<button type="button" class="ml-selection-delete" title="Kapat" aria-label="Bu çeviri sonucunu kapat" style="' +
    'position:absolute!important;right:3px!important;top:3px!important;width:22px!important;height:22px!important;z-index:4!important;' +
    'border:none!important;border-radius:999px!important;background:#ef4444!important;color:white!important;' +
    'font-size:16px!important;line-height:20px!important;font-weight:800!important;cursor:pointer!important;padding:0!important;pointer-events:auto!important;">×</button>' +
    '<div class="ml-selection-result" style="display:none!important;"></div>' +
    '<div class="ml-selection-meta" style="display:none!important;"></div>' +
    makeResizeHandle('tl') + makeResizeHandle('tr') + makeResizeHandle('bl') + makeResizeHandle('br');
  s.boxEl = box;
  renderSelectionBox(s);
  return box;
}
function makeResizeHandle(pos) {
  var cursor = (pos === 'tl' || pos === 'br') ? 'nwse-resize' : 'nesw-resize';
  var left = pos === 'tl' || pos === 'bl' ? '-6px' : 'auto';
  var right = pos === 'tr' || pos === 'br' ? '-6px' : 'auto';
  var top = pos === 'tl' || pos === 'tr' ? '-6px' : 'auto';
  var bottom = pos === 'bl' || pos === 'br' ? '-6px' : 'auto';
  return '<span data-resize-handle="' + pos + '" style="' +
    'position:absolute!important;left:' + left + '!important;right:' + right + '!important;' +
    'top:' + top + '!important;bottom:' + bottom + '!important;width:12px!important;height:12px!important;' +
    'border-radius:999px!important;background:#f8fafc!important;border:2px solid #0ea5e9!important;' +
    'box-sizing:border-box!important;cursor:' + cursor + '!important;"></span>';
}

function renderSelectionBox(s) {
  if (!s.boxEl) return;
  s.boxEl.style.left = s.x + 'px';
  s.boxEl.style.top = s.y + 'px';
  s.boxEl.style.width = s.width + 'px';
  s.boxEl.style.height = s.height + 'px';
  s.boxEl.style.borderColor = selectionMode.selectedId === s.id ? '#fbbf24' : '#38bdf8';
}

function installSelectionBoxHandlers(s) {
  if (!s.boxEl || s.boxEl.dataset.handlersReady === '1') return;
  s.boxEl.dataset.handlersReady = '1';
  var deleteBtn = s.boxEl.querySelector('.ml-selection-delete');
  var retryBtn = s.boxEl.querySelector('.ml-selection-retry');
  var suppressToolEvent = function(e) {
    e.preventDefault();
    e.stopPropagation();
  };
  if (deleteBtn) {
    var dismissSelection = function(e) {
      suppressToolEvent(e);
      deleteSelection(s.id);
    };
    deleteBtn.addEventListener('pointerdown', dismissSelection);
    deleteBtn.addEventListener('mousedown', dismissSelection);
    deleteBtn.addEventListener('click', dismissSelection);
  }
  if (retryBtn) {
    retryBtn.addEventListener('pointerdown', suppressToolEvent);
    retryBtn.addEventListener('mousedown', suppressToolEvent);
    retryBtn.addEventListener('click', function(e) {
      suppressToolEvent(e);
      if (s.inFlight) return;
      s.alternativeAttempt = (s.alternativeAttempt || 0) + 1;
      translateOneSelection(s, 1, 1, 'alternative', s.alternativeAttempt);
    });
  }
  s.boxEl.addEventListener('mousedown', function(e) {
    if (e.target.closest('.ml-selection-delete, .ml-selection-retry')) return;
    if (!selectionMode.active) return;
    e.preventDefault();
    e.stopPropagation();
    setActiveSelection(s.id);
    var handle = e.target && e.target.dataset ? e.target.dataset.resizeHandle : null;
    startSelectionInteraction(s, handle || 'move', e.clientX, e.clientY);
  });
}
function startSelectionInteraction(s, type, clientX, clientY) {
  if (manualCaptureInFlight > 0) {
    updateSelectionControls('Alan hazırlanıyor...');
    return;
  }
  invalidateManualSelectionCapture(s);
  selectionMode.interaction = {
    id: s.id,
    type: type,
    startX: clientX,
    startY: clientY,
    origX: s.x,
    origY: s.y,
    origW: s.width,
    origH: s.height,
  };
  document.addEventListener('mousemove', onSelectionInteractionMove, true);
  document.addEventListener('mouseup', onSelectionInteractionEnd, true);
}

function onSelectionInteractionMove(e) {
  var it = selectionMode.interaction;
  if (!it) return;
  var s = findSelectionById(it.id);
  if (!s) return;
  e.preventDefault();
  var dx = e.clientX - it.startX;
  var dy = e.clientY - it.startY;
  var rect = s.imgEl.getBoundingClientRect();
  if (it.type === 'move') {
    s.x = clampInt(it.origX + dx, 0, rect.width - s.width);
    s.y = clampInt(it.origY + dy, 0, rect.height - s.height);
  } else {
    resizeSelectionByHandle(s, it, dx, dy, rect);
  }
  updateSelectionPercent(s);
  renderSelectionBox(s);
}

function onSelectionInteractionEnd() {
  var interaction = selectionMode.interaction;
  document.removeEventListener('mousemove', onSelectionInteractionMove, true);
  document.removeEventListener('mouseup', onSelectionInteractionEnd, true);
  selectionMode.interaction = null;
  if (interaction) {
    var selection = findSelectionById(interaction.id);
    if (selection) prepareManualSelectionCapture(selection);
  }
}

function resizeSelectionByHandle(s, it, dx, dy, rect) {
  var x = it.origX;
  var y = it.origY;
  var w = it.origW;
  var h = it.origH;
  if (it.type.indexOf('l') !== -1) {
    x = clampInt(it.origX + dx, 0, it.origX + it.origW - MIN_SELECTION_SIZE);
    w = it.origW + (it.origX - x);
  }
  if (it.type.indexOf('r') !== -1) {
    w = clampInt(it.origW + dx, MIN_SELECTION_SIZE, rect.width - it.origX);
  }
  if (it.type.indexOf('t') !== -1) {
    y = clampInt(it.origY + dy, 0, it.origY + it.origH - MIN_SELECTION_SIZE);
    h = it.origH + (it.origY - y);
  }
  if (it.type.indexOf('b') !== -1) {
    h = clampInt(it.origH + dy, MIN_SELECTION_SIZE, rect.height - it.origY);
  }
  s.x = clampInt(x, 0, rect.width - MIN_SELECTION_SIZE);
  s.y = clampInt(y, 0, rect.height - MIN_SELECTION_SIZE);
  s.width = clampInt(w, MIN_SELECTION_SIZE, rect.width - s.x);
  s.height = clampInt(h, MIN_SELECTION_SIZE, rect.height - s.y);
}

function setActiveSelection(id) {
  selectionMode.selectedId = id;
  selectionMode.selections.forEach(renderSelectionBox);
  if (selectionMode.drawing) renderSelectionBox(selectionMode.drawing);
}

function findSelectionById(id) {
  return selectionMode.selections.find(function(s) { return s.id === id; }) || null;
}

function deleteSelection(id) {
  var idx = selectionMode.selections.findIndex(function(s) { return s.id === id; });
  if (idx < 0) return;
  var s = selectionMode.selections[idx];
  disposeManualSelectionCapture(s);
  if (s.boxEl) s.boxEl.remove();
  selectionMode.selections.splice(idx, 1);
  if (selectionMode.selectedId === id) {
    selectionMode.selectedId = selectionMode.selections.length
      ? selectionMode.selections[selectionMode.selections.length - 1].id
      : null;
  }
  cleanupEmptySelectionLayers();
  updateSelectionControls();
  setActiveSelection(selectionMode.selectedId);
}

function deleteActiveSelection() {
  if (selectionMode.selectedId) deleteSelection(selectionMode.selectedId);
}

function undoLastSelection() {
  var last = selectionMode.selections[selectionMode.selections.length - 1];
  if (last) deleteSelection(last.id);
}

function clearSelections() {
  selectionMode.selections.forEach(function(s) {
    disposeManualSelectionCapture(s);
    if (s.boxEl) s.boxEl.remove();
  });
  selectionMode.selections = [];
  selectionMode.selectedId = null;
  cleanupEmptySelectionLayers();
  updateSelectionControls();
}

function removeSelectionLayers() {
  document.querySelectorAll('.ml-selection-layer').forEach(function(el) {
    var parent = el.parentElement;
    el.remove();
    if (parent && parent.dataset.mlSelectionPrevZ != null) {
      parent.style.zIndex = parent.dataset.mlSelectionPrevZ;
      delete parent.dataset.mlSelectionPrevZ;
    }
  });
}

function cleanupEmptySelectionLayers() {
  document.querySelectorAll('.ml-selection-layer').forEach(function(layer) {
    if (!layer.querySelector('.ml-selection-box')) {
      var parent = layer.parentElement;
      layer.remove();
      if (parent && parent.dataset.mlSelectionPrevZ != null) {
        parent.style.zIndex = parent.dataset.mlSelectionPrevZ;
        delete parent.dataset.mlSelectionPrevZ;
      }
    }
  });
}

function getManualSelectionViewportRect(selection) {
  var imageRect = selection.imgEl.getBoundingClientRect();
  return {
    left: imageRect.left + (selection.xPct * imageRect.width),
    top: imageRect.top + (selection.yPct * imageRect.height),
    right: imageRect.left + ((selection.xPct + selection.wPct) * imageRect.width),
    bottom: imageRect.top + ((selection.yPct + selection.hPct) * imageRect.height),
  };
}

function invalidateManualSelectionCapture(selection) {
  if (!selection) return;
  selection.captureVersion = (selection.captureVersion || 0) + 1;
  selection.captureDataUrl = null;
  selection.captureWidth = 0;
  selection.captureHeight = 0;
  selection.captureError = null;
  selection.captureDirty = true;
}

function disposeManualSelectionCapture(selection) {
  if (!selection) return;
  invalidateManualSelectionCapture(selection);
  selection.captureDisposed = true;
  selection.capturePromise = null;
}

function prepareManualSelectionCapture(selection) {
  if (!selection || selection.captureDisposed || !selection.boxEl) return Promise.resolve(false);
  invalidateManualSelectionCapture(selection);
  selection.captureDirty = false;
  var version = selection.captureVersion;
  var hiddenUi = [];
  [sm_overlay, sm_controls].concat(Array.from(document.querySelectorAll('.ml-selection-box'))).forEach(function(el) {
    if (!el || hiddenUi.some(function(item) { return item.el === el; })) return;
    hiddenUi.push({ el: el, visibility: el.style.visibility });
  });
  manualCaptureInFlight += 1;
  setSelectionBoxState(selection, 'preparing', 'Alan hazırlanıyor...');

  var capturePromise = (async function() {
    try {
      hiddenUi.forEach(function(item) { item.el.style.visibility = 'hidden'; });
      await waitForNextPaint();
      var canvas = await captureVisibleRect(getManualSelectionViewportRect(selection));
      var scaled = maybeUpscale(canvas, MIN_CELL_SIZE);
      var dataUrl = scaled.canvas.toDataURL('image/jpeg', 0.86);
      if (!dataUrl) throw new Error('Seçili alan kırpılamadı');
      if (selection.captureDisposed || selection.captureVersion !== version) return false;
      selection.captureDataUrl = dataUrl;
      selection.captureWidth = scaled.canvas.width;
      selection.captureHeight = scaled.canvas.height;
      selection.captureError = null;
      selection.captureDirty = false;
      setSelectionBoxState(selection, 'ready', '');
      return true;
    } catch (error) {
      if (!selection.captureDisposed && selection.captureVersion === version) {
        selection.captureError = error;
        selection.captureDirty = true;
        setSelectionBoxState(selection, 'error', 'Alan görüntüsü alınamadı');
      }
      return false;
    } finally {
      hiddenUi.forEach(function(item) {
        if (item.el && item.el.isConnected) item.el.style.visibility = item.visibility || '';
      });
      manualCaptureInFlight = Math.max(0, manualCaptureInFlight - 1);
      if (selection.capturePromise === capturePromise) selection.capturePromise = null;
    }
  })();
  selection.capturePromise = capturePromise;
  return capturePromise;
}
async function translateSelectionItems(selections) {
  for (var i = 0; i < selections.length; i++) {
    await translateOneSelection(selections[i], i + 1, selections.length);
  }
}

function startQuickTranslateMode() {
  if (quickTranslateMode.active) return;
  if (selectionMode.active) exitSelectionMode();
  quickTranslateMode.active = true;
  quickTranslateMode.drawing = null;
  quickTranslateMode.hitLayer = createQuickHitLayer();
  document.body.style.cursor = 'crosshair';
  document.addEventListener('mousedown', onQuickStart, true);
  document.addEventListener('mousemove', onQuickMove, true);
  document.addEventListener('mouseup', onQuickEnd, true);
  document.addEventListener('keydown', onQuickKey, true);
  window.addEventListener('mouseup', onQuickEnd, true);
  window.addEventListener('blur', cancelQuickDrawing, true);
  window.addEventListener('resize', syncQuickJobLayers, true);
  window.addEventListener('scroll', syncQuickJobLayers, true);
}

function stopQuickTranslateMode() {
  if (!quickTranslateMode.active) return;
  quickTranslateMode.active = false;
  document.body.style.cursor = '';
  document.removeEventListener('mousedown', onQuickStart, true);
  document.removeEventListener('mousemove', onQuickMove, true);
  document.removeEventListener('mouseup', onQuickEnd, true);
  document.removeEventListener('keydown', onQuickKey, true);
  window.removeEventListener('mouseup', onQuickEnd, true);
  window.removeEventListener('blur', cancelQuickDrawing, true);
  window.removeEventListener('resize', syncQuickJobLayers, true);
  window.removeEventListener('scroll', syncQuickJobLayers, true);
  if (quickTranslateMode.hitLayer) {
    quickTranslateMode.hitLayer.remove();
    quickTranslateMode.hitLayer = null;
  }
  cancelQuickDrawing();
}

function createQuickHitLayer() {
  var layer = document.createElement('div');
  layer.id = 'ml-quick-hit-layer';
  layer.style.cssText =
    'position:fixed!important;inset:0!important;z-index:2147483643!important;' +
    'background:transparent!important;cursor:crosshair!important;pointer-events:auto!important;';
  layer.addEventListener('mousedown', onQuickStart, true);
  layer.addEventListener('mousemove', onQuickMove, true);
  layer.addEventListener('mouseup', onQuickEnd, true);
  document.documentElement.appendChild(layer);
  return layer;
}

function onQuickKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    stopQuickTranslateMode();
  }
}

function onQuickStart(e) {
  if (!quickTranslateMode.active) return;
  if (quickTranslateMode.drawing) return;
  if (e.button !== 0) return;
  if (e.target.closest('#ml-selection-controls') || e.target.closest('.ml-selection-box')) return;
  var page = findMangaPageAtPoint(e.clientX, e.clientY);
  if (!page) return;
  e.preventDefault();
  e.stopPropagation();

  page.pageId = getPageId(page.el, page.index);
  var layer = ensureSelectionLayer(page.el, page.pageId);
  if (!layer) return;
  var local = clientToImageLocal(page.el, e.clientX, e.clientY);
  var draft = {
    id: makeSelectionId(),
    pageId: page.pageId,
    imgEl: page.el,
    layerEl: layer,
    boxEl: null,
    startX: local.x,
    startY: local.y,
    x: local.x,
    y: local.y,
    width: 0,
    height: 0,
    xPct: 0,
    yPct: 0,
    wPct: 0,
    hPct: 0,
    timeoutId: null,
  };
  draft.boxEl = createQuickJobBox(draft, 'Seciliyor...');
  layer.appendChild(draft.boxEl);
  quickTranslateMode.drawing = draft;
  draft.timeoutId = setTimeout(function() {
    if (quickTranslateMode.drawing && quickTranslateMode.drawing.id === draft.id) {
      cancelQuickDrawing();
    }
  }, 15000);
}

function onQuickMove(e) {
  var draft = quickTranslateMode.drawing;
  if (!draft) return;
  e.preventDefault();
  updateQuickDraftFromClient(draft, e.clientX, e.clientY);
}

function updateQuickDraftFromClient(draft, clientX, clientY) {
  if (!draft || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
  var local = clientToImageLocal(draft.imgEl, clientX, clientY);
  draft.x = Math.min(draft.startX, local.x);
  draft.y = Math.min(draft.startY, local.y);
  draft.width = Math.abs(local.x - draft.startX);
  draft.height = Math.abs(local.y - draft.startY);
  updateSelectionPercent(draft);
  renderQuickJobBox(draft);
}

function onQuickEnd(e) {
  var draft = quickTranslateMode.drawing;
  if (!draft) return;
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
  if (e && Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
    updateQuickDraftFromClient(draft, e.clientX, e.clientY);
  }
  if (draft.timeoutId) {
    clearTimeout(draft.timeoutId);
    draft.timeoutId = null;
  }
  quickTranslateMode.drawing = null;
  if (draft.width < MIN_SELECTION_SIZE || draft.height < MIN_SELECTION_SIZE) {
    if (draft.boxEl) draft.boxEl.remove();
    cleanupEmptySelectionLayers();
    return;
  }
  updateQuickJobState(draft, 'queued', 'Sirada...');
  quickTranslateMode.jobs.push(draft);
  translateQuickJob(draft);
}

function cancelQuickDrawing() {
  var draft = quickTranslateMode.drawing;
  if (!draft) return;
  if (draft.timeoutId) {
    clearTimeout(draft.timeoutId);
    draft.timeoutId = null;
  }
  if (draft.boxEl) draft.boxEl.remove();
  quickTranslateMode.drawing = null;
  cleanupEmptySelectionLayers();
}

function createQuickJobBox(job, text) {
  var box = document.createElement('div');
  box.className = 'ml-selection-box ml-quick-job';
  box.dataset.quickJobId = job.id;
  box.style.cssText =
    'position:absolute!important;box-sizing:border-box!important;' +
    'border:2px solid #22c55e!important;background:rgba(255,255,255,0.24)!important;' +
    'box-shadow:0 8px 24px rgba(0,0,0,0.22)!important;' +
    'pointer-events:none!important;border-radius:4px!important;overflow:hidden!important;';
  box.innerHTML =
    '<button type="button" class="ml-quick-retry" title="Alternatif çeviri üret" aria-label="Alternatif çeviri üret" style="' +
    'display:none;position:absolute!important;right:31px!important;top:3px!important;width:22px!important;height:22px!important;z-index:4!important;' +
    'border:none!important;border-radius:999px!important;background:#2563eb!important;color:white!important;' +
    'font-size:16px!important;line-height:20px!important;font-weight:800!important;cursor:pointer!important;padding:0!important;pointer-events:auto!important;">↻</button>' +
    '<button type="button" class="ml-quick-close" title="Kapat" aria-label="Bu çeviri sonucunu kapat" style="' +
    'position:absolute!important;right:3px!important;top:3px!important;width:22px!important;height:22px!important;z-index:4!important;' +
    'border:none!important;border-radius:999px!important;background:#ef4444!important;color:white!important;' +
    'font-size:16px!important;line-height:20px!important;font-weight:800!important;cursor:pointer!important;padding:0!important;pointer-events:auto!important;">×</button>' +
    '<div class="ml-selection-result" style="display:none!important;"></div>' +
    '<div class="ml-selection-meta" style="display:none!important;"></div>';
  var closeBtn = box.querySelector('.ml-quick-close');
  var retryBtn = box.querySelector('.ml-quick-retry');
  var suppressToolEvent = function(e) {
    e.preventDefault();
    e.stopPropagation();
  };
  var dismissQuickJob = function(e) {
    suppressToolEvent(e);
    removeQuickJob(job);
  };
  closeBtn.addEventListener('pointerdown', dismissQuickJob);
  closeBtn.addEventListener('mousedown', dismissQuickJob);
  closeBtn.addEventListener('click', dismissQuickJob);
  retryBtn.addEventListener('pointerdown', suppressToolEvent);
  retryBtn.addEventListener('mousedown', suppressToolEvent);
  retryBtn.addEventListener('click', function(e) {
    suppressToolEvent(e);
    if (job.inFlight) return;
    job.alternativeAttempt = (job.alternativeAttempt || 0) + 1;
    translateQuickJob(job, 'alternative', job.alternativeAttempt);
  });
  job.boxEl = box;
  renderQuickJobBox(job);
  updateQuickJobState(job, 'drawing', text);
  return box;
}
function removeQuickJob(job) {
  if (!job) return;
  if (job.timeoutId) {
    clearTimeout(job.timeoutId);
    job.timeoutId = null;
  }
  if (quickTranslateMode.drawing && quickTranslateMode.drawing.id === job.id) {
    quickTranslateMode.drawing = null;
  }
  quickTranslateMode.jobs = quickTranslateMode.jobs.filter(function(item) {
    return item.id !== job.id;
  });
  if (job.boxEl) job.boxEl.remove();
  job.boxEl = null;
  cleanupEmptySelectionLayers();
}

function renderQuickJobBox(job) {
  if (!job.boxEl) return;
  job.boxEl.style.left = job.x + 'px';
  job.boxEl.style.top = job.y + 'px';
  job.boxEl.style.width = job.width + 'px';
  job.boxEl.style.height = job.height + 'px';
}

function syncQuickJobLayers() {
  quickTranslateMode.jobs.forEach(function(job) {
    if (!job.imgEl || !job.layerEl) return;
    syncSelectionLayerPosition(job.imgEl, job.layerEl);
    var rect = job.imgEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    job.x = job.xPct * rect.width;
    job.y = job.yPct * rect.height;
    job.width = job.wPct * rect.width;
    job.height = job.hPct * rect.height;
    renderQuickJobBox(job);
  });
  if (quickTranslateMode.drawing && quickTranslateMode.drawing.layerEl) {
    syncSelectionLayerPosition(quickTranslateMode.drawing.imgEl, quickTranslateMode.drawing.layerEl);
    renderQuickJobBox(quickTranslateMode.drawing);
  }
}

async function translateQuickJob(job, translationMode, alternativeAttempt) {
  if (!job || job.inFlight) return;
  job.inFlight = true;
  updateQuickJobState(job, 'processing', translationMode === 'alternative' ? 'Alternatif çeviri üretiliyor...' : 'Çeviriliyor...');
  try {
    await translateQuickJobFromViewport(job, translationMode, alternativeAttempt);
  } catch (e) {
    updateQuickJobState(job, 'error', e.message || 'Çeviri hatası');
    console.warn('[MangaLens] Quick translate error', e.message);
  } finally {
    job.inFlight = false;
  }
}
async function translateQuickJobFromViewport(job, translationMode, alternativeAttempt) {
  var imgRect = job.imgEl.getBoundingClientRect();
  var targetRect = {
    left: imgRect.left + job.x,
    top: imgRect.top + job.y,
    right: imgRect.left + job.x + job.width,
    bottom: imgRect.top + job.y + job.height,
  };
  var restoreBox = hideQuickJobForCapture(job);
  var canvas;
  try {
    await waitForNextPaint();
    canvas = await captureVisibleRect(targetRect);
  } finally {
    restoreBox();
  }

  var scaled = maybeUpscale(canvas, MIN_CELL_SIZE);
  var dataUrl = scaled.canvas.toDataURL('image/jpeg', 0.86);
  if (!dataUrl) throw new Error('Seçili alan kırpılamadı');

  var waitMs = await getTranslationTimeoutMs();
  var aiResp = await sendRuntimeMessageWithTimeout(
    {
      type: 'EXTRACT_BUBBLES',
      dataUrl: dataUrl,
      w: scaled.canvas.width,
      h: scaled.canvas.height,
      translationMode: translationMode || 'standard',
      alternativeAttempt: alternativeAttempt || 0,
    },
    waitMs,
    'Gemini zaman aşımı'
  );

  if (!aiResp || !aiResp.success) {
    throw new Error((aiResp && aiResp.error) || 'Gemini yanıt vermedi');
  }

  var bubbles = aiResp.bubbles || [];
  if (!bubbles.length) {
    updateQuickJobState(job, 'empty', 'Metin bulunamadı');
    return;
  }

  var translatedText = bubbles
    .map(function(b) { return (b.translation || b.text || '').trim(); })
    .filter(Boolean)
    .join('\n');
  updateQuickJobState(job, 'done', translatedText || 'Çeviri boş', aiResp);
}

function hideQuickJobForCapture(job) {
  if (!job || !job.boxEl) return function() {};
  var prevVisibility = job.boxEl.style.visibility;
  job.boxEl.style.visibility = 'hidden';
  return function() {
    if (job.boxEl) job.boxEl.style.visibility = prevVisibility || '';
  };
}

async function captureVisibleRect(rect) {
  var viewportW = window.innerWidth || document.documentElement.clientWidth;
  var viewportH = window.innerHeight || document.documentElement.clientHeight;
  var left = Math.max(0, rect.left);
  var top = Math.max(0, rect.top);
  var right = Math.min(viewportW, rect.right);
  var bottom = Math.min(viewportH, rect.bottom);
  if (right - left < 10 || bottom - top < 10) {
    throw new Error('Seçili alan ekranda görünür olmalı');
  }

  var resp = await sendRuntimeMessageWithTimeout(
    { type: 'CAPTURE_TAB' },
    QUICK_CAPTURE_TIMEOUT_MS,
    'Ekran görüntüsü zaman aşımı'
  );
  if (!resp || !resp.dataUrl) {
    throw new Error((resp && resp.error) || 'Ekran görüntüsü alınamadı');
  }

  var screenshot = new Image();
  await new Promise(function(resolve, reject) {
    screenshot.onload = resolve;
    screenshot.onerror = function() { reject(new Error('Ekran görüntüsü okunamadı')); };
    screenshot.src = resp.dataUrl;
  });

  var scaleX = screenshot.naturalWidth / viewportW;
  var scaleY = screenshot.naturalHeight / viewportH;
  var cropX = clampInt(Math.round(left * scaleX), 0, screenshot.naturalWidth - 1);
  var cropY = clampInt(Math.round(top * scaleY), 0, screenshot.naturalHeight - 1);
  var cropW = clampInt(Math.round((right - left) * scaleX), 1, screenshot.naturalWidth - cropX);
  var cropH = clampInt(Math.round((bottom - top) * scaleY), 1, screenshot.naturalHeight - cropY);
  if (cropW < 10 || cropH < 10) throw new Error('Seçili alan çok küçük');

  var canvas = document.createElement('canvas');
  canvas.width = cropW;
  canvas.height = cropH;
  canvas.getContext('2d').drawImage(
    screenshot,
    cropX, cropY, cropW, cropH,
    0, 0, cropW, cropH
  );
  return canvas;
}
function waitForNextPaint() {
  return new Promise(function(resolve) {
    requestAnimationFrame(function() {
      requestAnimationFrame(resolve);
    });
  });
}

// v3.1.4: kuyruk derinligine gore ceviri bekleme suresi (SW'den sorulur)
function translationTimeoutMsForQueueDepth(depth) {
  var queued = Number(depth) > 0 ? Math.floor(Number(depth)) : 0;
  return Math.min(TRANSLATE_TIMEOUT_MAX_MS, QUICK_TRANSLATE_TIMEOUT_MS + TRANSLATE_TIMEOUT_PER_JOB_MS * queued);
}

function getTranslationTimeoutMs() {
  return chrome.runtime.sendMessage({ type: 'GET_QUEUE_STATE' })
    .then(function(state) {
      return translationTimeoutMsForQueueDepth(state && state.queueDepth);
    })
    .catch(function() {
      return QUICK_TRANSLATE_TIMEOUT_MS;
    });
}

function sendRuntimeMessageWithTimeout(message, timeoutMs, timeoutMessage) {
  return new Promise(function(resolve, reject) {
    var settled = false;
    var timer = setTimeout(function() {
      if (settled) return;
      settled = true;
      reject(new Error(timeoutMessage || 'Istek zaman asimi'));
    }, timeoutMs);

    chrome.runtime.sendMessage(message)
      .then(function(resp) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(resp);
      })
      .catch(function(err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
  });
}

// v3.1.4: sonuc kutusunda cevaplayan model + sure bilgisi (uyari: elapsedMs kuyruk beklemesini de icerir)
function resultMetaText(info) {
  if (!info || !info.modelLabel) return '';
  var parts = [String(info.modelLabel)];
  if (info.fallbackUsed) parts.push('yedek model');
  var ms = Number(info.elapsedMs);
  if (Number.isFinite(ms) && ms > 0) parts.push((ms / 1000).toFixed(1) + ' sn');
  return parts.join(' · ');
}

function setResultMeta(boxEl, info) {
  if (!boxEl) return;
  var meta = boxEl.querySelector('.ml-selection-meta');
  if (!meta) return;
  var text = resultMetaText(info);
  meta.textContent = text;
  meta.title = text || '';
  meta.style.cssText = text
    ? 'display:block!important;position:absolute!important;left:4px!important;right:4px!important;bottom:2px!important;' +
      'text-align:right!important;font-family:system-ui,sans-serif!important;font-size:10px!important;line-height:1.2!important;' +
      'font-weight:700!important;color:#334155!important;pointer-events:none!important;z-index:3!important;' +
      'overflow:hidden!important;white-space:nowrap!important;text-overflow:ellipsis!important;text-shadow:0 1px 2px rgba(255,255,255,0.85)!important;'
    : 'display:none!important;';
}

function updateQuickJobState(job, state, text, info) {
  if (!job.boxEl) return;
  job.boxEl.dataset.state = state;
  var result = job.boxEl.querySelector('.ml-selection-result');
  var retryBtn = job.boxEl.querySelector('.ml-quick-retry');
  if (!result) return;
  setResultMeta(job.boxEl, state === 'done' ? info : null);
  if (retryBtn) {
    retryBtn.disabled = state === 'processing' || state === 'queued' || state === 'drawing';
    retryBtn.style.setProperty('display', state === 'done' || state === 'error' || state === 'empty' ? 'block' : 'none', 'important');
  }
  result.textContent = text || '';
  result.style.cssText =
    'display:' + (state === 'ready' ? 'none' : 'flex') + '!important;position:absolute!important;inset:0!important;' +
    'align-items:center!important;justify-content:center!important;text-align:center!important;' +
    'white-space:pre-wrap!important;overflow:hidden!important;padding:30px 8px 18px 8px!important;' +
    'box-sizing:border-box!important;font-family:system-ui,sans-serif!important;' +
    'font-size:' + translationFontSize + 'px!important;line-height:1.25!important;font-weight:750!important;' +
    'color:#111827!important;background:' + (
      state === 'error' ? 'rgba(254,226,226,0.96)' :
      state === 'done' ? 'rgba(255,255,255,0.96)' :
      state === 'empty' ? 'rgba(254,243,199,0.96)' :
      state === 'processing' || state === 'preparing' ? 'rgba(219,234,254,0.96)' :
      state === 'queued' ? 'rgba(240,253,244,0.96)' :
      'rgba(255,255,255,0.84)'
    ) + '!important;border-radius:2px!important;pointer-events:none!important;';
}

// ══════════════════════════════════════════════════════════════════════════════
//  v2: Otomatik Sayfa Çevirisi (Grid Tabanlı)
// ══════════════════════════════════════════════════════════════════════════════

const MIN_CELL_SIZE = 640; // px - upscale small cells for Gemini readability

function clampInt(v, min, max) {
  var n = Math.round(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

// v2.7: Orijinal img fetch (CORS izinli siteler icin)
function maybeUpscale(canvas, minSize) {
  if (!minSize) minSize = MIN_CELL_SIZE;
  var side = Math.min(canvas.width, canvas.height);
  var scale = side < minSize ? Math.ceil(minSize / side) : 1;
  if (scale <= 1) return { canvas: canvas, scale: 1 };
  var out = document.createElement('canvas');
  out.width = canvas.width * scale;
  out.height = canvas.height * scale;
  var ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return { canvas: out, scale: scale };
}
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
      // Manga sayfalari buyuk olabilir; bazi sitelerde balonlar ayri kucuk image olarak gelir.
      var nW = img.naturalWidth || img.width || 0;
      var nH = img.naturalHeight || img.height || 0;
      if (nW >= 80 && nH >= 40 && (nW * nH) >= 3200) {
        candidates.push({ el: img, index: candidates.length, source: 'img' });
      }
    });
    var allCanvas = document.querySelectorAll('canvas');
    allCanvas.forEach(function(c) {
      if (c.width >= 80 && c.height >= 40 && (c.width * c.height) >= 3200) {
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

async function translateOneSelection(selection, index, total, translationMode, alternativeAttempt) {
  if (!selection || selection.inFlight || !selection.boxEl || selection.captureDisposed) return;
  selection.inFlight = true;
  try {
    if (selection.capturePromise) {
      setSelectionBoxState(selection, 'preparing', 'Alan hazırlanıyor...');
      await selection.capturePromise;
    }
    if (!selection.captureDataUrl || selection.captureDirty) {
      setSelectionBoxState(selection, 'preparing', 'Alan hazırlanıyor...');
      await prepareManualSelectionCapture(selection);
    }
    if (!selection.captureDataUrl || !selection.captureWidth || !selection.captureHeight) {
      setSelectionBoxState(selection, 'error', 'Alan görüntüsü alınamadı');
      return;
    }
    if (selection.captureDisposed || !selection.boxEl) return;

    var statusText = translationMode === 'alternative'
      ? 'Alternatif çeviri üretiliyor...'
      : 'Çeviriliyor ' + index + '/' + total + '...';
    setSelectionBoxState(selection, 'processing', statusText);

    var waitMs = await getTranslationTimeoutMs();
    var aiResp = await sendRuntimeMessageWithTimeout(
      {
        type: 'EXTRACT_BUBBLES',
        dataUrl: selection.captureDataUrl,
        w: selection.captureWidth,
        h: selection.captureHeight,
        translationMode: translationMode || 'standard',
        alternativeAttempt: alternativeAttempt || 0,
      },
      waitMs,
      'Gemini zaman aşımı (kuyruk yoğunsa tekrar deneyin)'
    );

    if (!aiResp || !aiResp.success) {
      throw new Error((aiResp && aiResp.error) || 'Gemini yanıt vermedi');
    }

    var bubbles = aiResp.bubbles || [];
    if (!bubbles.length) {
      setSelectionBoxState(selection, 'empty', 'Metin bulunamadı');
      return;
    }

    var translatedText = bubbles
      .map(function(b) { return (b.translation || b.text || '').trim(); })
      .filter(Boolean)
      .join('\n');
    setSelectionBoxState(selection, 'done', translatedText || 'Çeviri boş', aiResp);
  } catch (e) {
    console.warn('[MangaLens] selection translate failed:', e.message);
    setSelectionBoxState(selection, 'error', e.message || 'Çeviri hatası');
  } finally {
    selection.inFlight = false;
  }
}
function setSelectionBoxState(selection, state, text, info) {
  if (!selection.boxEl) return;
  var result = selection.boxEl.querySelector('.ml-selection-result');
  var retryBtn = selection.boxEl.querySelector('.ml-selection-retry');
  if (!result) return;
  setResultMeta(selection.boxEl, state === 'done' ? info : null);
  if (retryBtn) {
    retryBtn.disabled = state === 'processing' || state === 'preparing';
    retryBtn.style.setProperty('display', state === 'done' || state === 'error' || state === 'empty' ? 'block' : 'none', 'important');
  }
  selection.boxEl.dataset.state = state;
  selection.boxEl.style.borderColor =
    state === 'error' ? '#ef4444' :
    state === 'done' ? '#22c55e' :
    state === 'empty' ? '#f59e0b' :
    '#38bdf8';
  result.textContent = text || '';
  result.style.cssText =
    'display:' + (state === 'ready' ? 'none' : 'flex') + '!important;position:absolute!important;inset:0!important;' +
    'align-items:center!important;justify-content:center!important;text-align:center!important;' +
    'white-space:pre-wrap!important;overflow:hidden!important;padding:30px 8px 18px 8px!important;' +
    'box-sizing:border-box!important;font-family:system-ui,sans-serif!important;' +
    'font-size:' + translationFontSize + 'px!important;line-height:1.25!important;font-weight:750!important;' +
    'color:#111827!important;background:' + (
      state === 'error' ? 'rgba(254,226,226,0.96)' :
      state === 'empty' ? 'rgba(254,243,199,0.96)' :
      state === 'processing' || state === 'preparing' ? 'rgba(219,234,254,0.96)' :
      'rgba(255,255,255,0.96)'
    ) + '!important;border-radius:2px!important;pointer-events:none!important;';
}

