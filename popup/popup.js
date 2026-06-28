// dosya: popup/popup.js
// MangaLens TR — Popup Mantigi (v3, Gemini only)
// Auto-translate CTA, cache stats, selection mode, settings.

'use strict';

const DEFAULTS = {
  enabled:          true,
  cacheEnabled:     true,
  autoTranslate:    false,
};

const $ = id => document.getElementById(id);
const el = {
  toggle:        $('enabled-toggle'),
  statusDot:     $('status-dot'),
  statusText:    $('status-text'),
  btnAuto:       $('btn-auto-translate'),
  btnTranslate:  $('btn-translate-page'),
  progressBar:   $('progress-bar'),
  progressFill:  $('progress-fill'),
  progressText:  $('progress-text'),
  autoTranslate: $('auto-translate'),
  cacheEnabled:  $('cache-enabled'),
  cacheStats:    $('cache-stats'),
  cacheCount:    $('cache-count'),
  cacheBytes:    $('cache-bytes'),
  btnClearCache: $('btn-clear-cache'),
  btnResetCache: $('btn-reset-cache'),
  btnSave:       $('btn-save'),
  btnSelection:  $('btn-selection'),
  toast:         $('toast'),
};

let cachePollTimer = null;

// ── Baslat ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const settings = await loadSettings();
  applySettingsToUI(settings);
  bindEvents();
  updateStatus(settings);
  await refreshCacheStats();
  startCachePolling();
});

window.addEventListener('beforeunload', () => {
  if (cachePollTimer) clearInterval(cachePollTimer);
});

// ── Settings ──────────────────────────────────────────────────────────────────

function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get(DEFAULTS, resolve);
  });
}

function saveSettings() {
  const s = {
    enabled:          el.toggle.checked,
    cacheEnabled:     el.cacheEnabled.checked,
    autoTranslate:    el.autoTranslate.checked,
  };
  return new Promise(resolve => chrome.storage.sync.set(s, () => resolve(s)));
}

function applySettingsToUI(s) {
  el.toggle.checked         = s.enabled !== false;
  el.cacheEnabled.checked   = s.cacheEnabled !== false;
  el.autoTranslate.checked  = s.autoTranslate === true;
}

// ── Status ────────────────────────────────────────────────────────────────────

function updateStatus(s) {
  if (!s.enabled) {
    setStatus('inactive', 'Eklenti kapalı');
    el.btnTranslate.disabled = true;
    el.btnAuto.disabled = true;
    return;
  }
  setStatus('active', 'Aktif — Gemini 3.1 Flash Lite');
  el.btnTranslate.disabled = false;
  el.btnAuto.disabled = false;
}

function setStatus(type, text) {
  el.statusDot.className = 'status-dot';
  if (type === 'active') el.statusDot.classList.add('active');
  else if (type === 'error') el.statusDot.classList.add('error');
  else if (type === 'loading') el.statusDot.classList.add('loading');
  else if (type === 'inactive') el.statusDot.classList.add('inactive');
  el.statusText.textContent = text;
}

// ── Cache Stats ───────────────────────────────────────────────────────────────

async function refreshCacheStats() {
  try {
    const stats = await chrome.runtime.sendMessage({ type: 'GET_CACHE_STATS' });
    if (stats && stats.success) {
      el.cacheCount.textContent = stats.count || 0;
      const mb = ((stats.bytes || 0) / (1024 * 1024)).toFixed(1);
      el.cacheBytes.textContent = mb;
    }
  } catch {
    // Background henuz hazir degil
  }
}

function startCachePolling() {
  if (cachePollTimer) clearInterval(cachePollTimer);
  cachePollTimer = setInterval(refreshCacheStats, 3000);
}

// ── Event Handlers ────────────────────────────────────────────────────────────

// Content'tan PAGE_PROGRESS mesajlarını dinle
chrome.runtime.onMessage.addListener(function(message) {
  if (message && message.type === 'PAGE_PROGRESS') {
    var completed = message.completed || 0;
    var total = message.total || 9;
    var pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    if (el.progressFill) el.progressFill.style.width = pct + '%';
    if (el.progressText) {
      if (message.current) {
        el.progressText.textContent = (completed + 1) + '/' + total + ' parça işleniyor...';
      } else {
        el.progressText.textContent = completed + '/' + total + ' tamamlandı';
      }
    }
  }
});

function bindEvents() {
  // Sayfayi Otomatik Cevir (v2 - 3x3 grid, rate limited)
  el.btnAuto.addEventListener('click', async () => {
    el.btnAuto.disabled = true;
    el.btnTranslate.disabled = true;
    const originalText = el.btnAuto.innerHTML;
    el.btnAuto.innerHTML = '<span class="btn-spinner"></span> Başlatılıyor...';
    el.progressBar.hidden = false;
    el.progressFill.style.width = '0%';
    el.progressText.textContent = 'Ekran görüntüsü alınıyor...';

    try {
      const resp = await notifyActiveTabPromise({ type: 'TRANSLATE_PAGE' });
      if (resp?.ok) {
        showToast(`✓ ${resp.translated}/${resp.total} parça çevrildi (${resp.bubbles} balon)`, 'success');
        if (el.progressFill) el.progressFill.style.width = '100%';
        if (el.progressText) el.progressText.textContent = '✓ Tamamlandı';
      } else {
        showToast(`✗ ${resp?.error || 'Hata'}`, 'error');
        if (el.progressText) el.progressText.textContent = 'Hata: ' + (resp?.error || '');
      }
    } catch (e) {
      showToast(`✗ ${e.message}`, 'error');
    }

    setTimeout(() => {
      el.btnAuto.innerHTML = originalText;
      el.btnAuto.disabled = false;
      el.btnTranslate.disabled = false;
      el.progressBar.hidden = true;
    }, 3000);
  });

  // Alan Sec ve Cevir (v1 - manuel crop, fallback)
  el.btnTranslate.addEventListener('click', async () => {
    el.btnTranslate.disabled = true;
    const originalText = el.btnTranslate.innerHTML;
    el.btnTranslate.innerHTML = '<span class="btn-spinner"></span> Aktif ediliyor...';
    try {
      await notifyActiveTabPromise({ type: 'START_SELECTION_MODE' });
      showToast('✓ Alan seç — fare ile dikdörtgen çiz', 'success');
      setTimeout(() => window.close(), 600);
    } catch (e) {
      showToast(`✗ ${e.message}`, 'error');
    }
    setTimeout(() => {
      el.btnTranslate.innerHTML = originalText;
      el.btnTranslate.disabled = false;
    }, 800);
  });

  // Kaydet
  el.btnSave.addEventListener('click', async () => {
    el.btnSave.disabled = true;
    el.btnSave.textContent = 'Kaydediliyor...';
    const s = await saveSettings();
    updateStatus(s);
    showToast('✓ Ayarlar kaydedildi', 'success');
    el.btnSave.disabled = false;
    el.btnSave.innerHTML = 'Kaydet <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" stroke="currentColor" stroke-width="1.5"/><path d="M17 21v-8H7v8M7 3v5h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  });

  // Power toggle
  el.toggle.addEventListener('change', async () => {
    const enabled = el.toggle.checked;
    await chrome.storage.sync.set({ enabled });
    const s = await loadSettings();
    updateStatus({ ...s, enabled });
    showToast(enabled ? '▶ Çeviri aktif' : '■ Çeviri durduruldu', enabled ? 'success' : 'info');
  });

  // Cache temizle
  el.btnClearCache.addEventListener('click', async () => {
    el.btnClearCache.disabled = true;
    try {
      const r = await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' });
      showToast(`✓ ${r?.evicted || 0} öğe silindi`, 'success');
      await refreshCacheStats();
    } catch (e) {
      showToast(`✗ ${e.message}`, 'error');
    }
    el.btnClearCache.disabled = false;
  });

  // Yeniden Cevir: pageId cache temizle + sayfayi tekrar cevir
  el.btnResetCache?.addEventListener('click', async () => {
    el.btnResetCache.disabled = true;
    el.btnAuto.disabled = true;
    el.btnTranslate.disabled = true;
    try {
      // Content script'e translatedPages temizlemesi + tekrar cevir
      await notifyActiveTabPromise({ type: 'RESET_AND_RETRANSLATE' });
      showToast('✓ Cache temizlendi, yeniden çevriliyor...', 'success');
    } catch (e) {
      showToast(`✗ ${e.message}`, 'error');
    }
    setTimeout(() => {
      el.btnResetCache.disabled = false;
      el.btnAuto.disabled = false;
      el.btnTranslate.disabled = false;
    }, 3000);
  });

  // Alan Sec
  el.btnSelection.addEventListener('click', async () => {
    el.btnSelection.disabled = true;
    showToast('🔄 Alan seçim modu başlatılıyor...', 'info');
    try {
      await notifyActiveTabPromise({ type: 'START_SELECTION_MODE' });
      showToast('✓ Alan seçim modu aktif', 'success');
      setTimeout(() => window.close(), 800);
    } catch (e) {
      showToast(`✗ ${e.message}`, 'error');
      el.btnSelection.disabled = false;
    }
  });
}

// ── Aktif sekmeye mesaj ───────────────────────────────────────────────────────

function notifyActiveTab(message) {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, message).catch(() => {});
    }
  });
}

function notifyActiveTabPromise(message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (!tabs[0]?.id) return reject(new Error('Aktif sekme bulunamadı'));
      chrome.tabs.sendMessage(tabs[0].id, message).then(resolve).catch(reject);
    });
  });
}

// ── Toast ─────────────────────────────────────────────────────────────────────

let toastTimer = null;
function showToast(message, type = 'info') {
  clearTimeout(toastTimer);
  el.toast.textContent = message;
  el.toast.className = `toast ${type} show`;
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 3000);
}
