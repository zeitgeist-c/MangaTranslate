// dosya: popup/popup.js
// MangaLens TR — Popup Mantigi (v2)
// "Bu Sayfayi Cevir" CTA, OpenRouter ayarlari, cache stats, auto-translate toggle.

'use strict';

const MODEL_CHAIN = ['gemini', 'qwen', 'gpt-oss', 'nemotron', 'cloudflare'];

const DEFAULTS = {
  enabled:          true,
  provider:         '9router',
  ninerouterUrl:    'http://localhost:20128/v1',
  ninerouterModel:  MODEL_CHAIN[0],
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
  nrUrl:         $('ninerouter-url'),
  nrModel:       $('ninerouter-model'),
  btnTest:       $('btn-test'),
  autoTranslate: $('auto-translate'),
  cacheEnabled:  $('cache-enabled'),
  cacheStats:    $('cache-stats'),
  cacheCount:    $('cache-count'),
  cacheBytes:    $('cache-bytes'),
  btnClearCache: $('btn-clear-cache'),
  btnSave:       $('btn-save'),
  btnSelection:  $('btn-selection'),
  toast:         $('toast'),
};

let modelList = [];
let cachePollTimer = null;

// ── Baslat ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const settings = await loadSettings();
  applySettingsToUI(settings);
  bindEvents();
  updateStatus(settings);
  populateModelSelect();
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
    provider:         '9router',
    ninerouterUrl:    el.nrUrl.value.trim() || 'http://localhost:20128/v1',
    ninerouterModel:  el.nrModel.value,
    cacheEnabled:     el.cacheEnabled.checked,
    autoTranslate:    el.autoTranslate.checked,
  };
  return new Promise(resolve => chrome.storage.sync.set(s, () => resolve(s)));
}

function applySettingsToUI(s) {
  el.toggle.checked       = s.enabled !== false;
  el.nrUrl.value          = s.ninerouterUrl || 'http://localhost:20128/v1';
  el.nrModel.value        = s.ninerouterModel || MODEL_CHAIN[0];
  el.cacheEnabled.checked = s.cacheEnabled !== false;
  el.autoTranslate.checked = s.autoTranslate === true;
}

async function populateModelSelect() {
  // 9Router'dan canlı model listesi çek
  try {
    const result = await chrome.runtime.sendMessage({ type: 'GET_MODELS' });
    if (result?.success && result.models?.models?.length > 0) {
      modelList = result.models.models;
    } else {
      modelList = MODEL_CHAIN.map(id => ({ id, name: id, isFree: true }));
    }
  } catch {
    modelList = MODEL_CHAIN.map(id => ({ id, name: id, isFree: true }));
  }

  el.nrModel.innerHTML = modelList
    .map(m => `<option value="${m.id}">${m.name || m.id}</option>`)
    .join('');
  // Mevcut seçili modeli koru
  const s = await loadSettings();
  if (s.ninerouterModel && [...el.nrModel.options].some(o => o.value === s.ninerouterModel)) {
    el.nrModel.value = s.ninerouterModel;
  }
}

// ── Model Labels ──────────────────────────────────────────────────────────────

function modelLabel(id) {
  return {
    'gemini':     '⭐ Gemini (multimodal)',
    'qwen':       '⭐ Qwen-VL (multimodal)',
    'gpt-oss':    'GPT OSS',
    'nemotron':   '⭐ Nemotron (multimodal)',
    'cloudflare': 'Cloudflare Workers AI',
    'minimax':    '⭐ M3 (multimodal)',
    'gpt-5.5':    'GPT-5.5 (kaliteli)',
    'deepseek':   'DeepSeek',
    'kimi':       'Kimi',
    'opencode':   'OpenCode',
    'openrouter': 'OpenRouter',
    'ollama':     'Ollama (lokal)',
    'vip':        '🌟 VIP (combined)',
  }[id] || id;
}

// ── Status ────────────────────────────────────────────────────────────────────

function updateStatus(s) {
  if (!s.enabled) {
    setStatus('inactive', 'Eklenti kapalı');
    el.btnTranslate.disabled = true;
    return;
  }
  // 9Router durumunu test et (kısa ping)
  if (s.ninerouterUrl) {
    setStatus('active', `Aktif — ${modelLabel(s.ninerouterModel || MODEL_CHAIN[0])}`);
    el.btnTranslate.disabled = false;
  } else {
    setStatus('error', '9Router URL eksik');
    el.btnTranslate.disabled = true;
  }
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

  // Baglanti testi
  el.btnTest.addEventListener('click', async () => {
    el.btnTest.disabled = true;
    setStatus('loading', 'Test ediliyor...');
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'TEST_API', provider: '9router',
      });
      if (result?.success) {
        setStatus('active', 'Bağlantı başarılı');
        showToast(`✓ ${result.message}`, 'success');
      } else {
        setStatus('error', 'Bağlantı başarısız');
        showToast(`✗ ${result?.error || 'Bilinmeyen hata'}`, 'error');
      }
    } catch (e) {
      setStatus('error', 'Test başarısız');
      showToast(`✗ ${e.message}`, 'error');
    }
    el.btnTest.disabled = false;
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

  // Goz (sifre goster/gizle) — artık key yok, bos
  document.querySelectorAll('.eye-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });
}

// ── Progress polling ──────────────────────────────────────────────────────────

function startProgressPolling() {
  let ticks = 0;
  const interval = setInterval(async () => {
    ticks++;
    try {
      const state = await chrome.runtime.sendMessage({ type: 'GET_PAGE_STATE' });
      if (state) {
        const total = (state.queued || 0) + (state.processing || 0);
        if (total === 0) {
          el.progressFill.style.width = '100%';
          el.progressText.textContent = 'Tamamlandı';
          clearInterval(interval);
          setTimeout(() => { el.progressBar.hidden = true; refreshCacheStats(); }, 1500);
        } else {
          // Yaklasik tahmin: 5sn/gorsel, max %95'e kadar
          const est = Math.min(95, ticks * 12);
          el.progressFill.style.width = `${est}%`;
          el.progressText.textContent = `${total} görsel kaldı`;
        }
      }
    } catch {
      clearInterval(interval);
    }
    if (ticks > 60) clearInterval(interval);  // 60sn timeout
  }, 1000);
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
