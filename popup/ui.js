'use strict';
globalThis.MLUI = (() => {
  const T = (key, vars) => (globalThis.MLI18N ? globalThis.MLI18N.t(key, vars) : key);
  const defaults = { enabled: true, translationProvider: 'gemini', geminiModel: 'gemini-3.5-flash-lite', openrouterModel: 'openai/gpt-6-luna', ollamaModel: 'gemma4:31b', contributorConsent: false, geminiFallback: false,
    contentType: 'auto', localDetector: 'fast', seriesName: '', translationInstructions: '', translationGlossary: '', translationFontSize: 16 };
  async function settings() { const [sync, local] = await Promise.all([chrome.storage.sync.get(defaults), chrome.storage.local.get('translationGlossary')]); return { ...sync, localDetector: ['small', 'detailed'].includes(sync.localDetector) ? sync.localDetector : 'fast', translationGlossary: local.translationGlossary ?? sync.translationGlossary }; }
  async function keys(provider, type = 'LIST', data = {}) { const response = await chrome.runtime.sendMessage({ type: `ML_KEYS_${type}`, provider, ...data }); if (!response?.ok) throw new Error(response?.error || T('conn_failed')); return response.value; }
  async function openSettings(provider, section = 'keys') {
    const base = chrome.runtime.getURL('options/settings.html'), url = `${base}#${section}/${provider}`;
    const existing = (await chrome.tabs.query({})).find(tab => tab.url?.split('#')[0] === base);
    if (existing) { await chrome.tabs.update(existing.id, { active: true, url }); await chrome.windows.update(existing.windowId, { focused: true }); }
    else await chrome.tabs.create({ url });
  }
  function models(select, provider, value) { select.replaceChildren(); if (!MLProviders.catalog[provider].some(([id]) => id === value)) { const option = document.createElement('option'); option.value = ''; option.textContent = T('model_removed'); select.append(option); } for (const [id, label] of MLProviders.catalog[provider]) { const option = document.createElement('option'); option.value = id; option.textContent = id === 'meta/muse-spark-1.3-contributor' ? `${label} · ${T('data_sharing_tag')}` : label; select.append(option); } select.value = MLProviders.catalog[provider].some(([id]) => id === value) ? value : ''; }
  const STATUS_KEYS = { untested: 'status_untested', success: 'status_success', invalid: 'status_invalid', rate_limited: 'status_rate_limited', error: 'status_error' };
  const statuses = new Proxy({}, { get: (_t, code) => T(STATUS_KEYS[code] || 'status_untested') });
  function status(code) { return T(STATUS_KEYS[code] || 'status_untested'); }
  return { defaults, settings, keys, openSettings, models, statuses, status };
})();
