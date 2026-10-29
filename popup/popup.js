'use strict';
const $ = id => document.getElementById(id);
const T = (key, vars) => (globalThis.MLI18N ? globalThis.MLI18N.t(key, vars) : key);
let saved, saving = false, generation = 0, quick = false;
function notice(text) { $('notice').textContent = text; $('notice').hidden = !text; }

/* Dil seçici + ilk açılış adımı: kayıt yoksa İngilizce varsayılanla sor. */
function fillLanguageSelect(select, current) {
  select.replaceChildren();
  for (const { code, label } of globalThis.MLI18N.LANGUAGES) {
    const option = document.createElement('option');
    option.value = code; option.lang = code; option.textContent = label;
    select.append(option);
  }
  select.value = current;
}
async function refresh() {
  const token = ++generation, config = await MLUI.settings(), keys = await MLUI.keys(config.translationProvider);
  if (token !== generation) return;
  saved = config; $('enabled-toggle').checked = config.enabled;
  for (const provider of ['gemini', 'openrouter', 'ollama']) $(`provider-${provider}`).setAttribute('aria-pressed', String(provider === config.translationProvider));
  MLUI.models($('model'), config.translationProvider, config[MLProviders.providerModelKey(config.translationProvider)]);
  if (!$('model').value) {
    const moved = MLProviders.migrate(config);
    if (moved.migrated) { await save({ [MLProviders.providerModelKey(config.translationProvider)]: moved.model }); notice(T('model_auto_pick', { model: moved.model })); return; }
  }
  $('contributor-row').hidden = !String($('model').value).endsWith('-contributor'); $('contributor-consent').checked = config.contributorConsent;
  const active = keys.find(k => k.active);
  $('key-summary').textContent = active ? T('keys_active_summary', { label: active.label }) : T('keys_none');
  $('key-dot').classList.toggle('ready', !!active); $('add-key').hidden = !!active;
  for (const id of ['btn-full-chapter', 'btn-translate-page', 'btn-quick-translate']) $(id).disabled = saving || !active || !config.enabled || !$('model').value;
  $('model').disabled = saving; $('enabled-toggle').disabled = saving; $('contributor-consent').disabled = saving;
  for (const provider of ['gemini', 'openrouter', 'ollama']) $(`provider-${provider}`).disabled = saving;
}
async function save(patch) {
  if (saving) return; saving = true; generation++;
  for (const id of ['enabled-toggle', 'model', 'contributor-consent', 'provider-gemini', 'provider-openrouter', 'provider-ollama', 'btn-full-chapter', 'btn-translate-page', 'btn-quick-translate']) $(id).disabled = true;
  try { await chrome.storage.sync.set(patch); notice(''); }
  catch (error) { notice(T('settings_save_failed', { error: error.message })); }
  finally { saving = false; await refresh().catch(error => notice(error.message)); }
}
async function start(type) {
  try {
    const config = await MLUI.settings(); MLProviders.settings(config);
    if (!config.enabled || !(await MLUI.keys(config.translationProvider)).some(k => k.active)) throw new Error(T('need_key_enabled'));
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:\/\//i.test(tab.url || '')) throw new Error(T('need_manga_page'));
    try { await chrome.tabs.sendMessage(tab.id, { type: 'PING_CONTENT' }); }
    catch { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content.js', 'src/page-content.js'] }); }
    if (type === 'START_QUICK_TRANSLATE_MODE' || type === 'STOP_QUICK_TRANSLATE_MODE') {
      const current = await chrome.tabs.sendMessage(tab.id, { type: 'GET_TRANSLATION_MODE' });
      type = current?.mode === 'quick' ? 'STOP_QUICK_TRANSLATE_MODE' : 'START_QUICK_TRANSLATE_MODE';
    }
    const response = await chrome.tabs.sendMessage(tab.id, { type });
    if (response?.ok === false || response?.success === false) throw new Error(response.error || T('op_failed'));
    if (type === 'START_QUICK_TRANSLATE_MODE' || type === 'STOP_QUICK_TRANSLATE_MODE') { quick = type === 'START_QUICK_TRANSLATE_MODE'; $('btn-quick-translate').textContent = quick ? T('quick_stop') : T('quick'); }
    else window.close();
  } catch (error) { notice(error.message); }
}
async function stats() {
  const { translationStats: s = {} } = await chrome.storage.local.get('translationStats');
  const now = new Date(), day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  $('ml-stat-minute').textContent = s.minute?.bucket === `${day}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` ? s.minute.count || 0 : 0;
  $('ml-stat-day').textContent = s.day?.bucket === day ? s.day.count || 0 : 0; $('ml-stat-lifetime').textContent = s.lifetime?.count || 0;
}
$('version').textContent = 'v' + chrome.runtime.getManifest().version;
for (const provider of ['gemini', 'openrouter', 'ollama']) $(`provider-${provider}`).onclick = () => save({ translationProvider: provider });
$('model').onchange = () => save({ [MLProviders.providerModelKey(saved.translationProvider)]: $('model').value });
$('enabled-toggle').onchange = () => save({ enabled: $('enabled-toggle').checked }); $('contributor-consent').onchange = () => save({ contributorConsent: $('contributor-consent').checked });
for (const id of ['settings', 'add-key']) $(id).onclick = () => MLUI.openSettings(saved?.translationProvider || 'gemini').catch(error => notice(error.message));
$('btn-full-chapter').onclick = () => start('START_PAGE_TRANSLATION'); $('btn-translate-page').onclick = () => start('START_SELECTION_MODE'); $('btn-quick-translate').onclick = () => start(quick ? 'STOP_QUICK_TRANSLATE_MODE' : 'START_QUICK_TRANSLATE_MODE');
chrome.storage.onChanged.addListener((changes, area) => { if (!saving) { refresh().catch(error => notice(error.message)); stats().catch(() => {}); } if (area === 'sync' && changes && changes[MLI18N.KEY]) { MLI18N.init().then(() => fillLanguageSelect($('ui-language'), MLI18N.lang)).catch(() => {}); } });

/* Dil önce: statik metinler, seçici, ilk açılış adımı; sonra normal akış. */
(async () => {
  const had = (await chrome.storage.sync.get({ [MLI18N.KEY]: null }))[MLI18N.KEY];
  const lang = await MLI18N.init();
  fillLanguageSelect($('ui-language'), lang);
  $('ui-language').onchange = async () => {
    MLI18N.set($('ui-language').value);
    await MLI18N.init();
    fillLanguageSelect($('ui-language'), MLI18N.lang);
    await refresh().catch(error => notice(error.message));
  };
  if (!had) {
    $('onboarding').hidden = false;
    $('onboarding-done').onclick = async () => {
      MLI18N.set($('ui-language').value);
      await MLI18N.init();
      $('onboarding').hidden = true;
      await refresh().catch(error => notice(error.message));
    };
  }
  refresh().catch(error => notice(error.message)); stats().catch(() => {});
})();
chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
  if (!tab?.id || !/^https?:/.test(tab.url || '')) return;
  const result = await chrome.tabs.sendMessage(tab.id, { type: 'GET_TRANSLATION_MODE' }); quick = result?.mode === 'quick';
  $('btn-quick-translate').textContent = quick ? T('quick_stop') : T('quick');
}).catch(() => {});
