'use strict';
const $ = id => document.getElementById(id), prefs = ['content-type', 'local-detector', 'font-size', 'series-name', 'translation-instructions', 'translation-glossary', 'contributor-consent', 'gemini-fallback'];
const T = (key, vars) => (globalThis.MLI18N ? globalThis.MLI18N.t(key, vars) : key);
let provider = 'gemini', section = 'keys', dirty = false, listing = 0, formSaving = false, adding = false;
const checking = new Set();
function notice(text) { $('notice').textContent = text; $('notice').hidden = !text; }
function markDirty(value) { dirty = value; $('dirty-status').textContent = dirty ? T('unsaved') : T('no_changes'); }
function preferenceValues() { return { contentType: $('content-type').value, localDetector: $('local-detector').value, translationFontSize: Number($('font-size').value),
  seriesName: $('series-name').value.trim(), translationInstructions: $('translation-instructions').value, translationGlossary: $('translation-glossary').value, contributorConsent: $('contributor-consent').checked, geminiFallback: $('gemini-fallback').checked }; }
async function loadPreferences() {
  if (dirty || formSaving) return; const s = await MLUI.settings(); if (dirty || formSaving) return;
  for (const [id, value] of [['content-type', s.contentType], ['local-detector', s.localDetector], ['font-size', s.translationFontSize], ['series-name', s.seriesName], ['translation-instructions', s.translationInstructions], ['translation-glossary', s.translationGlossary]]) $(id).value = value;
  $('contributor-consent').checked = s.contributorConsent; $('gemini-fallback').checked = s.geminiFallback === true;
}
async function renderKeys() {
  const token = ++listing, currentProvider = provider, list = await MLUI.keys(currentProvider);
  if (token !== listing || currentProvider !== provider) return;
  const parent = $('key-list'); parent.replaceChildren();
  if (!list.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = T('no_keys_yet'); parent.append(empty); }
  for (const entry of list) {
    const card = document.createElement('article'); card.className = 'card key-card'; card.dataset.keyId = entry.id;
    const info = document.createElement('div'); info.className = 'key-info';
    const heading = document.createElement('strong'); heading.textContent = entry.label;
    const masked = document.createElement('div'); masked.className = 'key-mask'; masked.textContent = entry.masked;
    info.append(heading, masked);
    const badge = (text, name) => { const el = document.createElement('span'); el.className = 'badge ' + name; el.textContent = text; info.append(el); };
    if (entry.active) badge(T('badge_active'), 'active'); badge(T('badge_saved'), ''); badge(MLUI.status(entry.status), entry.status);
    const detail = document.createElement('div'); detail.className = 'hint'; detail.textContent = entry.testedAt ? T('last_check', { when: new Date(entry.testedAt).toLocaleString(MLI18N.lang) }) : T('never_checked'); detail.title = entry.message; info.append(detail);
    const actions = document.createElement('div'); actions.className = 'key-actions';
    const button = (label, action, disabled = false, danger = false) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.disabled = disabled; if (danger) b.className = 'danger';
      b.onclick = async () => { b.disabled = true; try { await action(); notice(''); } catch (error) { notice(error.message); } finally { await renderKeys().catch(error => notice(error.message)); } }; actions.append(b);
    };
    const checkId = currentProvider + ':' + entry.id;
    button(checking.has(checkId) ? T('checking') : T('check_now'), async () => { checking.add(checkId); await renderKeys(); try { await MLUI.keys(currentProvider, 'CHECK', { id: entry.id }); } finally { checking.delete(checkId); } }, checking.has(checkId));
    button(entry.active ? T('badge_active') : T('make_active'), () => MLUI.keys(currentProvider, 'ACTIVATE', { id: entry.id }), entry.active);
    button(T('rename'), async () => { const label = prompt(T('rename_prompt'), entry.label); if (label !== null) await MLUI.keys(currentProvider, 'RENAME', { id: entry.id, label }); });
    button(T('delete'), async () => { if (confirm(entry.active && list.length > 1 ? T('delete_active_confirm') : T('delete_confirm'))) await MLUI.keys(currentProvider, 'DELETE', { id: entry.id }); }, false, true);
    card.append(info, actions); parent.append(card);
  }
  $('router-help').hidden = provider !== 'openrouter';
}
function applyRoute() {
  const [nextSection, nextProvider] = location.hash.slice(1).split('/');
  if (dirty && section === 'preferences' && nextSection !== 'preferences') {
    if (!confirm(T('confirm_unsaved_leave'))) { history.replaceState(null, '', '#preferences/' + provider); return; }
    markDirty(false); loadPreferences().catch(error => notice(error.message));
  }
  if (provider !== nextProvider && !adding) { $('new-key').value = ''; $('new-label').value = ''; }
  section = ['keys', 'preferences', 'about'].includes(nextSection) ? nextSection : 'keys'; provider = ['gemini', 'openrouter', 'ollama'].includes(nextProvider) ? nextProvider : 'gemini';
  for (const name of ['keys', 'preferences', 'about']) { $('section-' + name).hidden = section !== name; document.querySelector(`[data-section="${name}"]`).setAttribute('aria-selected', String(section === name)); }
  for (const name of ['gemini', 'openrouter', 'ollama']) $('keys-' + name).setAttribute('aria-pressed', String(provider === name));
  renderKeys().catch(error => notice(error.message));
}
function navigate(nextSection, nextProvider) {
  if (adding) return;
  if (dirty && section === 'preferences' && nextSection !== section && !confirm(T('confirm_unsaved_leave'))) return;
  if (dirty && section === 'preferences' && nextSection !== section) { markDirty(false); loadPreferences().catch(error => notice(error.message)); }
  if (provider !== nextProvider) { $('new-key').value = ''; $('new-label').value = ''; }
  location.hash = `${nextSection}/${nextProvider}`;
}
for (const b of document.querySelectorAll('[data-section]')) b.onclick = () => navigate(b.dataset.section, provider);
for (const name of ['gemini', 'openrouter', 'ollama']) $('keys-' + name).onclick = () => navigate('keys', name);
for (const id of prefs) $(id).addEventListener('input', () => markDirty(true));
$('series-name').addEventListener('change', async () => { const { seriesGlossaries = {} } = await chrome.storage.local.get('seriesGlossaries'); const name = $('series-name').value.trim(); if (Object.hasOwn(seriesGlossaries, name)) $('translation-glossary').value = seriesGlossaries[name]; });
$('add-form').onsubmit = async event => {
  event.preventDefault(); if (adding) return; adding = true; $('add-button').disabled = true;
  try { await MLUI.keys(provider, 'ADD', { key: $('new-key').value, label: $('new-label').value }); $('new-key').value = ''; $('new-label').value = ''; notice(T('key_saved')); }
  catch (error) { notice(error.message); }
  finally { adding = false; $('add-button').disabled = false; await renderKeys().catch(error => notice(error.message)); }
};
$('preferences-form').onsubmit = async event => {
  event.preventDefault(); if (formSaving) return; formSaving = true; $('save-preferences').disabled = true;
  const values = preferenceValues(), { translationGlossary, ...sync } = values;
  try {
    const { seriesGlossaries = {} } = await chrome.storage.local.get('seriesGlossaries');
    if (values.seriesName) Object.defineProperty(seriesGlossaries, values.seriesName, { value: translationGlossary, enumerable: true, writable: true, configurable: true });
    await chrome.storage.local.set({ translationGlossary, seriesGlossaries }); await chrome.storage.sync.set(sync);
    if (JSON.stringify(preferenceValues()) === JSON.stringify(values)) markDirty(false); notice(T('prefs_saved'));
  } catch (error) { notice(T('prefs_save_failed', { error: error.message })); }
  finally { formSaving = false; $('save-preferences').disabled = false; }
};
$('refresh-models').onclick = async () => {
  $('refresh-models').disabled = true;
  try { const response = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(15000) }); if (!response.ok) throw new Error(T('catalog_http', { status: response.status }));
    const { data } = await response.json(), available = MLProviders.catalog.openrouter.filter(([id]) => data.some(m => m.id === id && m.architecture?.input_modalities?.includes('image'))).length;
    $('model-availability').textContent = T('catalog_ok', { available, total: MLProviders.catalog.openrouter.length });
  } catch (error) { $('model-availability').textContent = error.message; } finally { $('refresh-models').disabled = false; }
};
window.addEventListener('beforeunload', event => { if (dirty || adding) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('hashchange', applyRoute);
chrome.storage.onChanged.addListener((changes, area) => { renderKeys().catch(error => notice(error.message)); loadPreferences().catch(error => notice(error.message)); if (area === 'sync' && changes && changes[MLI18N.KEY]) { MLI18N.init().then(() => fillLanguageSelect($('ui-language'), MLI18N.lang)).catch(() => {}); } });
$('version').textContent = 'v' + chrome.runtime.getManifest().version;
function fillLanguageSelect(select, current) {
  select.replaceChildren();
  for (const { code, label } of globalThis.MLI18N.LANGUAGES) {
    const option = document.createElement('option');
    option.value = code; option.lang = code; option.textContent = label;
    select.append(option);
  }
  select.value = current;
}
(async () => {
  await MLI18N.init();
  fillLanguageSelect($('ui-language'), MLI18N.lang);
  $('ui-language').onchange = async () => {
    MLI18N.set($('ui-language').value);
    await MLI18N.init();
    fillLanguageSelect($('ui-language'), MLI18N.lang);
    await loadPreferences().catch(error => notice(error.message));
  };
  applyRoute(); loadPreferences().catch(error => notice(error.message));
})();
