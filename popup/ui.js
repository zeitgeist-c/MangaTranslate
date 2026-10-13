'use strict';
globalThis.MLUI = (() => {
  const defaults = { enabled: true, translationProvider: 'gemini', geminiModel: 'gemini-3.5-flash-lite', openrouterModel: 'qwen/qwen3.8-flash', contributorConsent: false,
    contentType: 'auto', localDetector: 'fast', seriesName: '', translationInstructions: '', translationGlossary: '', translationFontSize: 16 };
  async function settings() { const [sync, local] = await Promise.all([chrome.storage.sync.get(defaults), chrome.storage.local.get('translationGlossary')]); return { ...sync, localDetector: ['small', 'detailed'].includes(sync.localDetector) ? sync.localDetector : 'fast', translationGlossary: local.translationGlossary ?? sync.translationGlossary }; }
  async function keys(provider, type = 'LIST', data = {}) { const response = await chrome.runtime.sendMessage({ type: `ML_KEYS_${type}`, provider, ...data }); if (!response?.ok) throw new Error(response?.error || 'Uzantı bağlantısı kurulamadı.'); return response.value; }
  async function openSettings(provider, section = 'keys') {
    const base = chrome.runtime.getURL('options/settings.html'), url = `${base}#${section}/${provider}`;
    const existing = (await chrome.tabs.query({})).find(tab => tab.url?.split('#')[0] === base);
    if (existing) { await chrome.tabs.update(existing.id, { active: true, url }); await chrome.windows.update(existing.windowId, { focused: true }); }
    else await chrome.tabs.create({ url });
  }
  function models(select, provider, value) { select.replaceChildren(); for (const [id, label] of MLProviders.catalog[provider]) { const option = document.createElement('option'); option.value = id; option.textContent = label; select.append(option); } select.value = value; }
  const statuses = { untested: 'Kontrol edilmedi', success: 'Bağlantı doğrulandı', invalid: 'Geçersiz anahtar', rate_limited: 'İstek sınırı', error: 'Bağlantı hatası' };
  return { defaults, settings, keys, openSettings, models, statuses };
})();
