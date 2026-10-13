'use strict';
globalThis.MLPopup = (() => {
  const $ = id => document.getElementById(id);
  let provider = 'gemini';
  function apply(settings) {
    provider = settings.translationProvider === 'openrouter' ? 'openrouter' : 'gemini';
    for (const [id, show] of [['gemini-model-panel', provider === 'gemini'], ['openrouter-model-panel', provider === 'openrouter'],
      ['google-key-panel', provider === 'gemini'], ['router-key-panel', provider === 'openrouter']]) $(id).hidden = !show;
    for (const name of ['gemini', 'openrouter']) { $(`provider-${name}`).classList.toggle('active', provider === name); $(`provider-${name}`).setAttribute('aria-pressed', String(provider === name)); }
    $('openrouter-model').replaceChildren();
    for (const [id, label] of MLProviders.catalog.openrouter) { const option = document.createElement('option'); option.value = id; option.textContent = label; $('openrouter-model').append(option); }
    $('openrouter-model').value = settings.openrouterModel || 'qwen/qwen3.8-flash';
    $('content-type').value = settings.contentType || 'auto'; $('series-name').value = settings.seriesName || '';
    $('local-detector').value = settings.localDetector || 'standard';
    $('translation-instructions').value = settings.translationInstructions || ''; $('translation-glossary').value = settings.translationGlossary || '';
    $('contributor-consent').checked = settings.contributorConsent === true;
  }
  function values() { return { translationProvider: provider, geminiModel: $('gemini-model').value, openrouterModel: $('openrouter-model').value,
    contributorConsent: $('contributor-consent').checked, contentType: $('content-type').value, localDetector: $('local-detector').value, seriesName: $('series-name').value,
    translationInstructions: $('translation-instructions').value, translationGlossary: $('translation-glossary').value }; }
  function label(settings) { return provider === 'openrouter' ? MLProviders.catalog.openrouter.find(([id]) => id === (settings.openrouterModel || $('openrouter-model').value))?.[1] || 'OpenRouter' : null; }
  async function hasSelectedKey() {
    const stored = await chrome.storage.local.get(['openrouterApiKey', 'googleApiKeys', 'activeGoogleApiKeyId']);
    return provider === 'openrouter' ? !!stored.openrouterApiKey : (stored.googleApiKeys || []).some(key => key.id === stored.activeGoogleApiKeyId);
  }
  async function keyStatus() { const stored = await chrome.storage.local.get('openrouterApiKey'); $('router-key-status').textContent = stored.openrouterApiKey ? 'OpenRouter anahtarı kayıtlı.' : 'OpenRouter anahtarı eklenmedi.'; }
  async function rememberGlossary(settings) {
    const name = settings.seriesName.trim(); if (!name) return;
    const stored = await chrome.storage.local.get({ seriesGlossaries: {} });
    Object.defineProperty(stored.seriesGlossaries, name, { value: settings.translationGlossary, enumerable: true, writable: true, configurable: true });
    await chrome.storage.local.set({ seriesGlossaries: stored.seriesGlossaries });
  }
  document.addEventListener('DOMContentLoaded', async () => {
    await keyStatus();
    $('series-name').addEventListener('change', async () => {
      const stored = await chrome.storage.local.get({ seriesGlossaries: {} });
      const name = $('series-name').value.trim();
      $('translation-glossary').value = Object.hasOwn(stored.seriesGlossaries, name) ? stored.seriesGlossaries[name] : '';
    });
    for (const name of ['gemini', 'openrouter']) $(`provider-${name}`).onclick = async () => {
      const draft = { ...(await loadSettings()), ...values(), translationProvider: name };
      apply(draft); await saveSettings(); updateStatus(draft); await renderApiKeyList();
    };
    $('save-router-key').onclick = async () => {
      const key = $('router-api-key').value.trim();
      if (key.length < 20 || /\s/.test(key)) { showToast('Geçerli bir OpenRouter anahtarı girin.', 'error'); return; }
      await chrome.storage.local.set({ openrouterApiKey: key }); $('router-api-key').value = ''; await keyStatus(); await renderApiKeyList(); showToast('OpenRouter anahtarı kaydedildi.', 'success');
    };
    $('remove-router-key').onclick = async () => { await chrome.storage.local.remove('openrouterApiKey'); await keyStatus(); await renderApiKeyList(); };
    $('btn-full-chapter').onclick = async () => {
      try {
        const settings = await saveSettings(); MLProviders.settings(settings);
        if (!await checkApiKeyBefore()) return;
        await notifyActiveTabPromise({ type: 'START_PAGE_TRANSLATION' }); window.close();
      } catch (error) { showToast(error.message, 'error'); }
    };
    $('refresh-models').onclick = async () => {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`Katalog HTTP ${response.status}`);
        const catalog = (await response.json()).data;
        let available = 0;
        for (const option of $('openrouter-model').options) {
          const match = catalog.find(model => model.id === option.value && model.architecture.input_modalities.includes('image'));
          option.disabled = !match; if (match) available++;
          option.textContent = MLProviders.catalog.openrouter.find(([id]) => id === option.value)[1] + (match ? '' : ' · erişilemiyor');
        }
        $('model-availability').textContent = `${available}/${MLProviders.catalog.openrouter.length} model katalogda görüntü destekli. Hesabın kredi/kota durumu bu kontrolle ölçülmez.`;
      } catch (error) { $('model-availability').textContent = error.message; }
    };
  });
  return { apply, values, label, hasSelectedKey, rememberGlossary };
})();
