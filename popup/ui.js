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
  function models(select, provider, value, list) {
    select.replaceChildren();
    const entries = Array.isArray(list) ? list
      : MLProviders.catalog[provider].map(([id, label]) => ({ modelId: id, label, free: null }));
    if (!entries.some(e => e.modelId === value)) { const option = document.createElement('option'); option.value = ''; option.textContent = T('model_removed'); select.append(option); }
    for (const e of entries) {
      const option = document.createElement('option');
      option.value = e.modelId;
      const badge = e.free === true ? ` · ${T('models_free')}` : e.free === false ? ` · ${T('models_paid')}` : '';
      const tag = e.modelId === 'meta/muse-spark-1.3-contributor' ? ` · ${T('data_sharing_tag')}` : '';
      option.textContent = e.label + badge + tag;
      select.append(option);
    }
    select.value = entries.some(e => e.modelId === value) ? value : '';
  }
  async function modelsRefresh(provider) {
    const response = await chrome.runtime.sendMessage({ type: 'ML_MODELS_REFRESH', provider });
    if (!response?.ok) throw new Error(response?.error || T('conn_failed'));
    const v = response.value || {};
    if (v.ok === false) throw new Error(v.error || T('models_refresh_failed', { provider }));
    return v;
  }
  const STATUS_KEYS = { untested: 'status_untested', success: 'status_success', invalid: 'status_invalid', rate_limited: 'status_rate_limited', error: 'status_error' };
  const statuses = new Proxy({}, { get: (_t, code) => T(STATUS_KEYS[code] || 'status_untested') });
  function status(code) { return T(STATUS_KEYS[code] || 'status_untested'); }
  return { defaults, settings, keys, openSettings, models, modelsRefresh, statuses, status };
})();
