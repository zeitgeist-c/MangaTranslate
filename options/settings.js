'use strict';
const $ = id => document.getElementById(id), prefs = ['content-type', 'local-detector', 'font-size', 'series-name', 'translation-instructions', 'translation-glossary', 'contributor-consent', 'gemini-fallback'];
/* T() comes from i18n.js (loaded first in settings.html); do not redeclare. */
let provider = 'gemini', section = 'keys', dirty = false, listing = 0, formSaving = false, adding = false;
let modelListing = 0, modelCollapsed = { gemini: true };
const modelFilter = {};
const modelBusy = new Set();
const MODEL_COLLAPSE_AFTER = 5;
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
/* Model management (Hera pattern, vanilla): fetch per provider, free/paid badges, on/off. */
async function renderModels() {
  const token = ++modelListing, parent = $('model-list');
  const prefs = await MLProviders.modelPreferences().catch(() => MLProviders.defaultPrefs());
  if (token !== modelListing) return;
  const query = $('model-search').value || '';
  const enabled = new Set(prefs.enabled || []);
  parent.replaceChildren();
  for (const name of ['gemini', 'openrouter', 'ollama']) {
    const all = MLProviders.allModels(name, prefs);
    const bucket = modelFilter[name] || 'all';
    const visible = MLProviders.filterModels(all, query, bucket);
    const freeCount = all.filter(m => MLProviders.isFreeModel(m)).length;
    const collapsed = modelCollapsed[name] === true && !query && bucket === 'all';
    const shown = collapsed ? visible.slice(0, MODEL_COLLAPSE_AFTER) : visible;
    const onTotal = all.filter(m => enabled.has(`${name}:${m.modelId}`)).length;
    const onVisible = visible.filter(m => enabled.has(`${name}:${m.modelId}`)).length;
    const card = document.createElement('article'); card.className = 'card';
    const head = document.createElement('div'); head.className = 'key-info';
    const title = document.createElement('strong'); title.textContent = name[0].toUpperCase() + name.slice(1); head.append(title);
    const count = document.createElement('span'); count.className = 'badge'; count.textContent = T('models_count', { count: all.length }); head.append(count);
    if (name === 'openrouter' && freeCount > 0) { const fc = document.createElement('span'); fc.className = 'badge active'; fc.textContent = T('models_free_count', { count: freeCount }); head.append(fc); }
    const stamp = prefs.refreshedAt && prefs.refreshedAt[name];
    const state = document.createElement('span'); state.className = 'hint';
    state.textContent = modelBusy.has(name) ? T('models_loading') : stamp ? T('models_updated', { date: new Date(stamp).toLocaleString(MLI18N.lang) }) : T('models_never');
    head.append(state);
    const actions = document.createElement('div'); actions.className = 'key-actions';
    const refreshButton = document.createElement('button'); refreshButton.type = 'button'; refreshButton.textContent = T('models_refresh'); refreshButton.disabled = modelBusy.has(name);
    refreshButton.onclick = async () => {
      if (modelBusy.has(name)) return; modelBusy.add(name); await renderModels();
      try { await MLUI.modelsRefresh(name); notice(''); }
      catch (error) { notice(error.message); }
      finally { modelBusy.delete(name); await renderModels().catch(err => notice(err.message)); }
    };
    actions.append(refreshButton); card.append(head, actions);
    const tools = document.createElement('div'); tools.className = 'model-tools';
    const seg = document.createElement('div'); seg.className = 'seg'; seg.setAttribute('role', 'group');
    for (const b of ['all', 'free', 'paid']) {
      const chip = document.createElement('button'); chip.type = 'button';
      chip.textContent = b === 'all' ? T('models_all') : b === 'free' ? T('models_free') : T('models_paid');
      chip.classList.toggle('on', bucket === b);
      chip.onclick = () => { modelFilter[name] = b; renderModels().catch(error => notice(error.message)); };
      seg.append(chip);
    }
    tools.append(seg);
    const applyBulk = async on => {
      const next = await MLProviders.modelPreferences().catch(() => MLProviders.defaultPrefs());
      const set = new Set(next.enabled || []);
      for (const m of visible) { const k = `${name}:${m.modelId}`; if (on) set.add(k); else set.delete(k); }
      if (!set.size) { notice(T('models_keep_one')); return; }
      next.enabled = [...set];
      await MLProviders.saveModelPreferences(next); notice('');
      await renderModels().catch(error => notice(error.message));
    };
    const selectAll = document.createElement('button'); selectAll.type = 'button'; selectAll.className = 'bulk'; selectAll.textContent = T('models_select_visible');
    selectAll.onclick = () => applyBulk(true).catch(error => notice(error.message));
    const clearAll = document.createElement('button'); clearAll.type = 'button'; clearAll.className = 'bulk ghost'; clearAll.textContent = T('models_clear_visible');
    clearAll.onclick = () => applyBulk(false).catch(error => notice(error.message));
    tools.append(selectAll, clearAll); card.append(tools);
    for (const m of shown) {
      const row = document.createElement('label'); row.className = 'model-pick';
      const box = document.createElement('input'); box.type = 'checkbox'; box.checked = enabled.has(`${name}:${m.modelId}`);
      box.onchange = async () => {
        const next = await MLProviders.modelPreferences().catch(() => MLProviders.defaultPrefs());
        const set = new Set(next.enabled || []), key = `${name}:${m.modelId}`;
        if (box.checked) set.add(key); else set.delete(key);
        if (!set.size) { notice(T('models_keep_one')); await renderModels().catch(() => {}); return; }
        next.enabled = [...set];
        await MLProviders.saveModelPreferences(next); notice('');
        await renderModels().catch(error => notice(error.message));
      };
      const text = document.createElement('span');
      const label = document.createElement('strong'); label.textContent = m.label; text.append(label);
      const meta = document.createElement('div'); meta.className = 'hint';
      meta.textContent = m.modelId + (MLProviders.isFreeModel(m) ? ` · ${T('models_free')}` : '') + (MLProviders.isPaidModel(m) ? ` · ${T('models_paid')}` : '');
      text.append(meta); row.append(box, text); card.append(row);
    }
    if (!visible.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = T('models_empty'); card.append(empty); }
    if (visible.length > MODEL_COLLAPSE_AFTER && !query && bucket === 'all') {
      const more = document.createElement('button'); more.type = 'button'; more.className = 'text-button';
      more.textContent = collapsed ? T('models_show_more', { count: visible.length - MODEL_COLLAPSE_AFTER }) : T('models_show_less');
      more.onclick = () => { modelCollapsed[name] = !collapsed; renderModels().catch(error => notice(error.message)); };
      card.append(more);
    }
    const counter = document.createElement('p'); counter.className = 'res-line';
    counter.textContent = T('models_visible', { on: onVisible, shown: visible.length, totalOn: onTotal, total: all.length });
    card.append(counter);
    parent.append(card);
  }
}
function applyRoute() {
  const [nextSection, nextProvider] = location.hash.slice(1).split('/');
  if (dirty && section === 'preferences' && nextSection !== 'preferences') {
    if (!confirm(T('confirm_unsaved_leave'))) { history.replaceState(null, '', '#preferences/' + provider); return; }
    markDirty(false); loadPreferences().catch(error => notice(error.message));
  }
  if (provider !== nextProvider && !adding) { $('new-key').value = ''; $('new-label').value = ''; }
  section = ['keys', 'preferences', 'models', 'about'].includes(nextSection) ? nextSection : 'keys'; provider = ['gemini', 'openrouter', 'ollama'].includes(nextProvider) ? nextProvider : 'gemini';
  for (const name of ['keys', 'preferences', 'models', 'about']) { $('section-' + name).hidden = section !== name; document.querySelector(`[data-section="${name}"]`).setAttribute('aria-selected', String(section === name)); }
  for (const name of ['gemini', 'openrouter', 'ollama']) $('keys-' + name).setAttribute('aria-pressed', String(provider === name));
  renderKeys().catch(error => notice(error.message));
  renderModels().catch(error => notice(error.message));
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
window.addEventListener('beforeunload', event => { if (dirty || adding) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('hashchange', applyRoute);
chrome.storage.onChanged.addListener((changes, area) => { renderKeys().catch(error => notice(error.message)); renderModels().catch(error => notice(error.message)); loadPreferences().catch(error => notice(error.message)); if (area === 'sync' && changes && changes[MLI18N.KEY]) { MLI18N.init().then(() => fillLanguageSelect($('ui-language'), MLI18N.lang)).catch(() => {}); } });
$('model-search').addEventListener('input', () => renderModels().catch(error => notice(error.message)));
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
