// dosya: popup/popup.js
// MangaLens TR — Popup Mantigi (v3, Gemini only)
// Selection modes, preferences, translation stats, and API key management.

'use strict';

const GEMINI_MODELS = Object.freeze({
  DEFAULT: 'gemini-3.5-flash-lite',
  FALLBACK: 'gemini-3.1-flash-lite',
  GEMMA: 'gemma-4-31b-it',
});
const GEMINI_MODEL_LABELS = Object.freeze({
  [GEMINI_MODELS.DEFAULT]: 'Gemini 3.5 Flash Lite',
  [GEMINI_MODELS.FALLBACK]: 'Gemini 3.1 Flash Lite',
  [GEMINI_MODELS.GEMMA]: 'Gemma 4 31B',
});

const DEFAULTS = {
  enabled:          true,
  geminiModel:      GEMINI_MODELS.DEFAULT,
  translationFontSize: 16,
};

const $ = id => document.getElementById(id);
const el = {
  toggle:        $('enabled-toggle'),
  statusDot:     $('status-dot'),
  statusText:    $('status-text'),

  btnTranslate:  $('btn-translate-page'),




  resultLine:    $('result-line'),
  modelSelect:   $('gemini-model'),
  modelNote:     $('model-note'),

  fontSizeOptions: Array.from(document.querySelectorAll('input[name="translation-font-size"]')),





  btnQuick:      $('btn-quick-translate'),
  btnSave:       $('btn-save'),

  statMinute:    $('ml-stat-minute'),
  statDay:       $('ml-stat-day'),
  statLifetime:  $('ml-stat-lifetime'),
  toast:         $('toast'),
  // v2.5: API key yonetimi
  apiKeyList:    $('api-key-list'),
  apiEmptyMsg:   $('api-empty-msg'),
  newApiKey:     $('new-api-key'),
  newApiLabel:   $('new-api-label'),
  btnAddKey:     $('btn-add-key'),
};

const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));


let statsPollTimer = null;


let quickModeActive = false;

function setActiveTranslationMode(mode) {
  quickModeActive = mode === 'quick';
  el.btnTranslate?.classList.toggle('active', mode === 'selection');
  el.btnQuick?.classList.toggle('active', mode === 'quick');
  if (el.btnQuick) {
    el.btnQuick.innerHTML = mode === 'quick'
      ? '<span class="btn-icon" aria-hidden="true">Q</span> Oto Açık'
      : '<span class="btn-icon" aria-hidden="true">Q</span> Oto Çevir';
  }
}

async function syncTranslationModeState() {
  try {
    const state = await notifyActiveTabPromise({ type: 'GET_TRANSLATION_MODE' });
    setActiveTranslationMode(state?.mode || null);
  } catch (_) {
    setActiveTranslationMode(null);
  }
}

// ── Baslat ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  syncVersionLabel();
  const settings = await loadSettings();
  applySettingsToUI(settings);
  bindEvents();
  bindTabs();
  await syncTranslationModeState();
  updateStatus(settings);
  await migrateLegacyApiKey();   // v2.6: eski tekil alanlardan tasima
  await renderApiKeyList();
  await chooseInitialTab();


  await loadTranslationStatsToUI();

  startStatsPolling();
});

function syncVersionLabel() {
  const version = chrome.runtime.getManifest().version;
  const versionEl = document.getElementById('brand-sub');
  if (versionEl) {
    versionEl.textContent = `Görsel çeviri v${version}`;
  }
}

window.addEventListener('beforeunload', () => {

  if (statsPollTimer) clearInterval(statsPollTimer);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.translationStats) {
    loadTranslationStatsToUI();
  }
});

// ── Settings ──────────────────────────────────────────────────────────────────

function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get(DEFAULTS, resolve);
  });
}

function saveSettings() {
  const selectedFontSize = el.fontSizeOptions.find(input => input.checked);
  const s = {
    enabled:          el.toggle.checked,
    geminiModel:      normalizeGeminiModel(el.modelSelect?.value),
    translationFontSize: normalizeTranslationFontSize(selectedFontSize?.value),
  };
  return new Promise(resolve => chrome.storage.sync.set(s, () => resolve(s)));
}

function applySettingsToUI(s) {
  el.toggle.checked = s.enabled !== false;
  const model = normalizeGeminiModel(s.geminiModel);
  if (el.modelSelect) el.modelSelect.value = model;
  updateModelNote(model);

  const fontSize = normalizeTranslationFontSize(s.translationFontSize);
  el.fontSizeOptions.forEach(input => {
    input.checked = Number(input.value) === fontSize;
  });
}

function normalizeTranslationFontSize(value) {
  const size = Number(value);
  return [16, 20].includes(size) ? size : 16;
}

function normalizeGeminiModel(model) {
  return Object.prototype.hasOwnProperty.call(GEMINI_MODEL_LABELS, model)
    ? model
    : GEMINI_MODELS.DEFAULT;
}

function getGeminiModelLabel(model) {
  return GEMINI_MODEL_LABELS[normalizeGeminiModel(model)];
}

function updateModelNote(model) {
  if (el.modelNote) el.modelNote.textContent = getGeminiModelLabel(model);
}

function bindTabs() {
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });
}

function activateTab(tabName) {
  tabButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  tabPanels.forEach(panel => {
    panel.classList.toggle('active', panel.dataset.tabPanel === tabName);
  });
}

async function chooseInitialTab() {
  const { list, activeId } = await loadApiKeys();
  const hasActiveKey = list.some(k => k.id === activeId);
  activateTab(hasActiveKey ? 'translate' : 'api');
}

// ── Status ────────────────────────────────────────────────────────────────────

function updateStatus(s) {
  if (!s.enabled) {
    setStatus('inactive', 'Eklenti kapalı');
    el.btnTranslate.disabled = true;

    if (el.btnQuick) el.btnQuick.disabled = true;
    return;
  }
  const model = normalizeGeminiModel(s.geminiModel);
  setStatus('active', 'Aktif — ' + getGeminiModelLabel(model));
  updateModelNote(model);
  el.btnTranslate.disabled = false;

  if (el.btnQuick) el.btnQuick.disabled = false;
}

function setStatus(type, text) {
  el.statusDot.className = 'status-dot';
  if (type === 'active') el.statusDot.classList.add('active');
  else if (type === 'error') el.statusDot.classList.add('error');
  else if (type === 'loading') el.statusDot.classList.add('loading');
  else if (type === 'inactive') el.statusDot.classList.add('inactive');
  el.statusText.textContent = text;
}

// ── Cooldown ───────────────────────────────────────────────────────────────────

function currentMinuteBucket(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function currentDayBucket(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function loadTranslationStatsToUI() {
  try {
    const data = await chrome.storage.local.get(['translationStats']);
    const stats = data.translationStats || {};
    const minuteBucket = currentMinuteBucket();
    const dayBucket = currentDayBucket();
    const minuteCount = stats.minute && stats.minute.bucket === minuteBucket ? stats.minute.count || 0 : 0;
    const dayCount = stats.day && stats.day.bucket === dayBucket ? stats.day.count || 0 : 0;
    const lifetimeCount = stats.lifetime ? stats.lifetime.count || 0 : 0;
    if (el.statMinute) el.statMinute.textContent = minuteCount;
    if (el.statDay) el.statDay.textContent = dayCount;
    if (el.statLifetime) el.statLifetime.textContent = lifetimeCount;
  } catch (e) {
    console.warn('[MangaLens-popup] stats okunamadi:', e.message);
  }
}

function startStatsPolling() {
  if (statsPollTimer) clearInterval(statsPollTimer);
  statsPollTimer = setInterval(loadTranslationStatsToUI, 15000);
}

// ── Event Handlers ────────────────────────────────────────────────────────────

function bindEvents() {
  // Alan Sec ve Cevir (v1 - manuel crop, fallback)
  el.btnTranslate.addEventListener('click', async () => {
    el.btnTranslate.disabled = true;
    const originalText = el.btnTranslate.innerHTML;
    setActiveTranslationMode('selection');
    el.btnTranslate.innerHTML = '<span class="btn-spinner"></span> Aktif ediliyor...';
    try {
      await notifyActiveTabPromise({ type: 'START_SELECTION_MODE' });
      showToast('✓ Alan seç — fare ile dikdörtgen çiz', 'success');
      setTimeout(() => window.close(), 600);
    } catch (e) {
      setActiveTranslationMode(null);
      showToast(`✗ ${e.message}`, 'error');
    }
    setTimeout(() => {
      el.btnTranslate.innerHTML = originalText;
      el.btnTranslate.disabled = false;
    }, 800);
  });

  el.btnQuick?.addEventListener('click', async () => {
    try {
      if (!await checkApiKeyBefore()) return;
    } catch(e) {
      showToast('API key kontrolu basarisiz', 'error');
      return;
    }
    try {
      if (!quickModeActive) {
        await notifyActiveTabPromise({ type: 'START_QUICK_TRANSLATE_MODE' });
        setActiveTranslationMode('quick');
        showToast('Oto cevir modu aktif. Esc ile kapat.', 'success');
        setResultLine('Oto cevir aktif: alan secince otomatik cevirir.');
      } else {
        await notifyActiveTabPromise({ type: 'STOP_QUICK_TRANSLATE_MODE' });
        setActiveTranslationMode(null);
        showToast('Oto cevir kapatildi', 'info');
        setResultLine('Oto cevir kapatildi.');
      }
    } catch (e) {
      showToast(`✗ ${e.message}`, 'error');
        setActiveTranslationMode(null);
    }
  });

  // Kaydet
  el.btnSave.addEventListener('click', async () => {
    el.btnSave.disabled = true;
    el.btnSave.textContent = 'Kaydediliyor...';
    const s = await saveSettings();
    updateStatus(s);
    await renderApiKeyList();
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
    await renderApiKeyList();
    showToast(enabled ? '▶ Çeviri aktif' : '■ Çeviri durduruldu', enabled ? 'success' : 'info');
  });

  // v2.5: API key ekle
  el.btnAddKey.addEventListener('click', addApiKey);
  el.newApiKey.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addApiKey();
  });




}

// ── Aktif sekmeye mesaj ───────────────────────────────────────────────────────

async function notifyActiveTabPromise(message) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) throw new Error('Aktif sekme bulunamadı');
  if (!canUseContentScriptOnTab(tab)) {
    throw new Error('Bu sayfada MangaLens çalışmaz. Bir manga/web sayfası açıp tekrar deneyin.');
  }

  await pingContentScript(tab.id);

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (e) {
    throw normalizeTabMessageError(e);
  }
}

// Enjeksiyon sonrasi content gec yuklenebilir: PING'i artan beklemeyle 3 kez dene.
async function pingContentScript(tabId) {
  const delays = [0, 150, 500];
  let lastError = null;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await wait(delays[i]);
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING_CONTENT' });
      return;
    } catch (e) {
      lastError = e;
      if (!isMissingContentScriptError(e)) throw normalizeTabMessageError(e);
      if (i === 0) await injectContentScript(tabId);
    }
  }
  throw normalizeTabMessageError(lastError);
}

function canUseContentScriptOnTab(tab) {
  const url = tab.url || '';
  return /^https?:\/\//i.test(url) || /^file:\/\//i.test(url);
}

function isMissingContentScriptError(error) {
  const msg = String(error && error.message || error || '');
  return /receiving end does not exist|could not establish connection|message port closed/i.test(msg);
}

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['src/content.js'],
    });
  } catch (e) {
    throw normalizeTabMessageError(e);
  }
}

function normalizeTabMessageError(error) {
  const msg = String(error && error.message || error || '');
  if (/receiving end does not exist|could not establish connection/i.test(msg)) {
    return new Error('MangaLens içerik bağlantısı kurulamadı. Sayfayı yenileyip tekrar deneyin.');
  }
  if (/cannot access|extension manifest|permission|chrome:|edge:/i.test(msg)) {
    return new Error('Bu sayfada MangaLens çalışmaz. Bir manga/web sayfası açıp tekrar deneyin.');
  }
  return new Error(msg || 'Aktif sekmeye mesaj gönderilemedi.');
}

function wait(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function setResultLine(text) {
  if (el.resultLine) el.resultLine.textContent = text;
}

let toastTimer = null;
function showToast(message, type = 'info') {
  clearTimeout(toastTimer);
  el.toast.textContent = message;
  el.toast.className = `toast ${type} show`;
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 3000);
}

// ══════════════════════════════════════════════════════════════════════════════
//  v2.5: Google API Key Yonetimi
// ══════════════════════════════════════════════════════════════════════════════

/**
 * v2.6: Eski tekil alanlari (googleApiKey, apiKey, geminiApiKey) yeni dizi formuna tasi.
 * Bir kere calisir, sonra artik dizi formatinda devam eder.
 */
async function migrateLegacyApiKey() {
  const data = await new Promise(resolve => {
    chrome.storage.local.get(
      ['googleApiKeys', 'activeGoogleApiKeyId', 'googleApiKey', 'apiKey', 'geminiApiKey'],
      d => resolve(d)
    );
  });

  // Zaten yeni formattaysa gerek yok
  if (Array.isArray(data.googleApiKeys) && data.googleApiKeys.length > 0) {
    // Yine de eski alanlari temizle (yine de kalma ihtimali var)
    if (data.googleApiKey || data.apiKey || data.geminiApiKey) {
      await chrome.storage.local.remove(['googleApiKey', 'apiKey', 'geminiApiKey']);
    }
    return;
  }

  const legacy = data.googleApiKey || data.apiKey || data.geminiApiKey;
  if (!legacy || typeof legacy !== 'string') return;

  const normalized = String(legacy).trim().replace(/\s+/g, '');
  if (!normalized || normalized.length < 20) {
    // Cok kisa, migration yapma ama eski alanlari temizle
    await chrome.storage.local.remove(['googleApiKey', 'apiKey', 'geminiApiKey']);
    return;
  }

  const newEntry = {
    id: crypto.randomUUID(),
    key: normalized,
    label: 'Migrated',
    isActive: true,
    lastTestStatus: 'untested',
    lastTestMessage: 'Eski formattan tasindi.',
    lastTestedAt: null,
    createdAt: Date.now(),
  };

  await chrome.storage.local.set({
    googleApiKeys: [newEntry],
    activeGoogleApiKeyId: newEntry.id,
  });

  // Eski alanlari temizle
  await chrome.storage.local.remove(['googleApiKey', 'apiKey', 'geminiApiKey']);

}

async function loadApiKeys() {
  const data = await new Promise(resolve => {
    chrome.storage.local.get(['googleApiKeys', 'activeGoogleApiKeyId'], d => resolve(d));
  });
  return { list: data.googleApiKeys || [], activeId: data.activeGoogleApiKeyId || null };
}

async function saveApiKeys(list, activeId) {
  return new Promise(resolve => {
    chrome.storage.local.set(
      { googleApiKeys: list, activeGoogleApiKeyId: activeId },
      () => resolve()
    );
  });
}

function maskKey(key) {
  if (!key || key.length < 12) return '****';
  return key.slice(0, 6) + '...' + key.slice(-4);
}

function statusLabel(s) {
  return ({
    untested:      'Test edilmedi',
    success:       '✓ Çalışıyor',
    error:         '✗ Hata',
    rate_limited:  '⏱ Rate limit',
    invalid:       '⛔ Geçersiz key',
  })[s] || s;
}

async function renderApiKeyList() {
  const { list, activeId } = await loadApiKeys();
  const settings = await loadSettings();
  const hasActiveKey = list.some(k => k.id === activeId);

  // Bos state uyarisi
  el.apiEmptyMsg.hidden = hasActiveKey;

  el.btnTranslate.disabled = !hasActiveKey || settings.enabled === false;
  if (el.btnQuick) el.btnQuick.disabled = !hasActiveKey || settings.enabled === false;

  // Listeyi render et
  el.apiKeyList.innerHTML = '';
  list.forEach(entry => {
    const isActive = entry.id === activeId;
    const item = document.createElement('div');
    item.className = 'api-key-item' + (isActive ? ' api-key-active' : '');

    const info = document.createElement('div');
    info.className = 'api-key-info';

    const label = document.createElement('div');
    label.className = 'api-key-label';
    label.textContent = entry.label || 'Adsız anahtar';

    const masked = document.createElement('div');
    masked.className = 'api-key-mask';
    masked.textContent = maskKey(entry.key);

    const status = document.createElement('div');
    status.className = 'api-key-status status-' + (entry.lastTestStatus || 'untested');
    status.textContent = statusLabel(entry.lastTestStatus || 'untested');
    if (entry.lastTestedAt) {
      const d = new Date(entry.lastTestedAt);
      status.title = 'Son test: ' + d.toLocaleString();
    }

    info.appendChild(label);
    info.appendChild(masked);
    info.appendChild(status);

    const actions = document.createElement('div');
    actions.className = 'api-key-actions';

    // Test butonu
    const testBtn = document.createElement('button');
    testBtn.className = 'btn-icon-sm';
    testBtn.textContent = 'Test';
    testBtn.title = 'API key test et';
    testBtn.addEventListener('click', () => testApiKeyById(entry.id));

    // Aktif yap
    const actBtn = document.createElement('button');
    actBtn.className = 'btn-icon-sm btn-icon-primary';
    actBtn.textContent = isActive ? '✓ Aktif' : 'Aktif Yap';
    actBtn.disabled = isActive;
    actBtn.addEventListener('click', () => activateApiKey(entry.id));

    // Sil
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-icon-sm btn-icon-danger';
    delBtn.textContent = 'Sil';
    delBtn.addEventListener('click', () => deleteApiKey(entry.id));

    actions.appendChild(testBtn);
    actions.appendChild(actBtn);
    actions.appendChild(delBtn);

    item.appendChild(info);
    item.appendChild(actions);
    el.apiKeyList.appendChild(item);
  });
}

// v2.5.1: API key normalize + flexible validation (AIza sarti yok)
function normalizeApiKey(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '');   // \n, \t, space dahil tum whitespace kaldir
}

function validateApiKeyForSave(value) {
  const apiKey = normalizeApiKey(value);
  if (!apiKey) {
    return { ok: false, message: 'API anahtarı boş olamaz.' };
  }
  if (apiKey.length < 20) {
    return { ok: false, message: 'API anahtarı çok kısa görünüyor.' };
  }
  return { ok: true, apiKey: apiKey };
}

async function addApiKey() {
  const validation = validateApiKeyForSave(el.newApiKey.value);
  if (!validation.ok) {
    showToast('⚠ ' + validation.message, 'error');
    return;
  }
  const apiKey = validation.apiKey;

  const { list, activeId } = await loadApiKeys();

  // v2.6: Duplicate kontrolü
  if (list.some(k => k.key === apiKey)) {
    showToast('⚠ Bu API anahtarı zaten kayıtlı.', 'error');
    return;
  }

  const label = (el.newApiLabel.value || '').trim()
    || ('Google API ' + (list.length + 1));

  const newEntry = {
    id: crypto.randomUUID(),
    key: apiKey,
    label: label,
    isActive: false,
    lastTestStatus: 'untested',
    lastTestMessage: 'Henüz test edilmedi.',
    lastTestedAt: null,
    createdAt: Date.now(),
  };

  // v2.6: Aktif mantigi: ilk key VEYA aktif key yoksa → yeni key aktif
  const activeExists = activeId && list.some(k => k.id === activeId);
  const shouldMakeActive = !activeExists;

  // isActive flag'lerini normalize et
  const normalizedList = list.map(k => ({ ...k, isActive: k.id === activeId && activeExists }));
  const nextActiveId = shouldMakeActive ? newEntry.id : activeId;
  newEntry.isActive = shouldMakeActive;

  const nextKeys = [...normalizedList, newEntry];

  await saveApiKeys(nextKeys, nextActiveId);
  el.newApiKey.value = '';
  el.newApiLabel.value = '';
  await renderApiKeyList();
  if (shouldMakeActive) activateTab('translate');
  showToast(
    shouldMakeActive
      ? '✓ API anahtarı eklendi ve aktif yapıldı.'
      : '✓ API anahtarı eklendi.',
    'success'
  );
}

async function activateApiKey(id) {
  const { list } = await loadApiKeys();
  if (!list.some(k => k.id === id)) return;

  // v2.6: isActive flag'lerini normalize et (sadece secili true)
  const normalizedList = list.map(k => ({ ...k, isActive: k.id === id }));
  await saveApiKeys(normalizedList, id);
  await renderApiKeyList();
  activateTab('translate');
  showToast('✓ Aktif API anahtarı değiştirildi.', 'success');
}

async function deleteApiKey(id) {
  if (!confirm('Bu API anahtarını silmek istediğine emin misin?')) return;
  const { list, activeId } = await loadApiKeys();
  const remaining = list.filter(k => k.id !== id);

  let newActiveId = activeId;
  // v2.6: Silinen aktiftse → ilk kalan key aktif olur (yoksa null)
  if (activeId === id) {
    newActiveId = remaining.length > 0 ? remaining[0].id : null;
  }

  // isActive flag'lerini normalize et
  const normalizedList = remaining.map(k => ({
    ...k,
    isActive: k.id === newActiveId,
  }));

  await saveApiKeys(normalizedList, newActiveId);
  await renderApiKeyList();
  if (!newActiveId) activateTab('api');
  showToast(remaining.length === 0
    ? '🗑 Son API anahtarı silindi.'
    : '🗑 API anahtarı silindi.',
    'info');
}

async function testApiKeyById(id) {
  const { list } = await loadApiKeys();
  const entry = list.find(k => k.id === id);
  if (!entry) return;
  const result = await chrome.runtime.sendMessage({ type: 'TEST_API_KEY', apiKey: entry.key });
  if (!result) {
    showToast('Test çağrısı başarısız', 'error');
    return;
  }
  // Status güncelle
  const idx = list.findIndex(k => k.id === id);
  if (idx >= 0) {
    list[idx].lastTestStatus = result.status || 'error';
    list[idx].lastTestMessage = result.message || '';
    list[idx].lastTestedAt = Date.now();
    const { activeId } = await loadApiKeys();
    await saveApiKeys(list, activeId);
  }
  await renderApiKeyList();

  // v2.6: Status'a ozel toast mesajlari
  if (result.status === 'success' && result.fallbackUsed) {
    showToast('✓ API, ' + getGeminiModelLabel(result.model) + ' yedek modeli ile çalışıyor', 'success');
  }
  else if (result.status === 'success')        showToast('✓ API çalışıyor — ' + getGeminiModelLabel(result.model), 'success');
  else if (result.fallbackAttempted)           showToast('✗ ' + result.message, 'error');
  else if (result.status === 'invalid')        showToast('⛔ API key geçersiz', 'error');
  else if (result.status === 'rate_limited')   showToast('⏱ Rate limit / kota dolu', 'error');
  else if (result.status === 'error')          showToast('✗ ' + (result.message || 'Test başarısız'), 'error');
  else                                         showToast('✗ Test başarısız', 'error');
}

async function checkApiKeyBefore() {
  const { list, activeId } = await loadApiKeys();
  if (!list.find(k => k.id === activeId)) {
    showToast('⚠ Önce Google Gemini API anahtarı ekleyin ve aktif yapın.', 'error');
    activateTab('api');
    return false;
  }
  return true;
}
