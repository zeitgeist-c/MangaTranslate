'use strict';
const $ = id => document.getElementById(id), prefs = ['content-type', 'local-detector', 'font-size', 'series-name', 'translation-instructions', 'translation-glossary', 'contributor-consent'];
let provider = 'gemini', section = 'keys', dirty = false, listing = 0, formSaving = false, adding = false;
const checking = new Set();
function notice(text) { $('notice').textContent = text; $('notice').hidden = !text; }
function markDirty(value) { dirty = value; $('dirty-status').textContent = dirty ? 'Kaydedilmemiş değişiklikler' : 'Değişiklik yok'; }
function preferenceValues() { return { contentType: $('content-type').value, localDetector: $('local-detector').value, translationFontSize: Number($('font-size').value),
  seriesName: $('series-name').value.trim(), translationInstructions: $('translation-instructions').value, translationGlossary: $('translation-glossary').value, contributorConsent: $('contributor-consent').checked }; }
async function loadPreferences() {
  if (dirty || formSaving) return; const s = await MLUI.settings(); if (dirty || formSaving) return;
  for (const [id, value] of [['content-type', s.contentType], ['local-detector', s.localDetector], ['font-size', s.translationFontSize], ['series-name', s.seriesName], ['translation-instructions', s.translationInstructions], ['translation-glossary', s.translationGlossary]]) $(id).value = value;
  $('contributor-consent').checked = s.contributorConsent;
}
async function renderKeys() {
  const token = ++listing, currentProvider = provider, list = await MLUI.keys(currentProvider);
  if (token !== listing || currentProvider !== provider) return;
  const parent = $('key-list'); parent.replaceChildren();
  if (!list.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'Henüz anahtar eklenmedi. Aşağıdan ilk anahtarını ekleyebilirsin.'; parent.append(empty); }
  for (const entry of list) {
    const card = document.createElement('article'); card.className = 'card key-card'; card.dataset.keyId = entry.id;
    const info = document.createElement('div'); info.className = 'key-info';
    const heading = document.createElement('strong'); heading.textContent = entry.label;
    const masked = document.createElement('div'); masked.className = 'key-mask'; masked.textContent = entry.masked;
    info.append(heading, masked);
    const badge = (text, name) => { const el = document.createElement('span'); el.className = 'badge ' + name; el.textContent = text; info.append(el); };
    if (entry.active) badge('Aktif', 'active'); badge('Kayıtlı', ''); badge(MLUI.statuses[entry.status] || 'Kontrol edilmedi', entry.status);
    const detail = document.createElement('div'); detail.className = 'hint'; detail.textContent = entry.testedAt ? `Son kontrol: ${new Date(entry.testedAt).toLocaleString('tr-TR')}` : 'Bağlantı henüz kontrol edilmedi.'; detail.title = entry.message; info.append(detail);
    const actions = document.createElement('div'); actions.className = 'key-actions';
    const button = (label, action, disabled = false, danger = false) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.disabled = disabled; if (danger) b.className = 'danger';
      b.onclick = async () => { b.disabled = true; try { await action(); notice(''); } catch (error) { notice(error.message); } finally { await renderKeys().catch(error => notice(error.message)); } }; actions.append(b);
    };
    const checkId = currentProvider + ':' + entry.id;
    button(checking.has(checkId) ? 'Kontrol ediliyor…' : 'Kontrol et', async () => { checking.add(checkId); await renderKeys(); try { await MLUI.keys(currentProvider, 'CHECK', { id: entry.id }); } finally { checking.delete(checkId); } }, checking.has(checkId));
    button(entry.active ? 'Aktif' : 'Aktif yap', () => MLUI.keys(currentProvider, 'ACTIVATE', { id: entry.id }), entry.active);
    button('Adını değiştir', async () => { const label = prompt('Anahtar etiketi (en fazla 80 karakter):', entry.label); if (label !== null) await MLUI.keys(currentProvider, 'RENAME', { id: entry.id, label }); });
    button('Sil', async () => { if (confirm(entry.active && list.length > 1 ? 'Bu aktif anahtar silinsin mi? İlk kalan anahtar aktif olacak.' : 'Bu anahtar silinsin mi? Son anahtarı silersen bu sağlayıcıyla çeviri başlatılamaz.')) await MLUI.keys(currentProvider, 'DELETE', { id: entry.id }); }, false, true);
    card.append(info, actions); parent.append(card);
  }
  $('router-help').hidden = provider !== 'openrouter';
}
function applyRoute() {
  const [nextSection, nextProvider] = location.hash.slice(1).split('/');
  if (dirty && section === 'preferences' && nextSection !== 'preferences') {
    if (!confirm('Kaydedilmemiş değişikliklerin var. Kaydetmeden ayrılmak istiyor musun?')) { history.replaceState(null, '', '#preferences/' + provider); return; }
    markDirty(false); loadPreferences().catch(error => notice(error.message));
  }
  if (provider !== nextProvider && !adding) { $('new-key').value = ''; $('new-label').value = ''; }
  section = ['keys', 'preferences', 'about'].includes(nextSection) ? nextSection : 'keys'; provider = nextProvider === 'openrouter' ? 'openrouter' : 'gemini';
  for (const name of ['keys', 'preferences', 'about']) { $('section-' + name).hidden = section !== name; document.querySelector(`[data-section="${name}"]`).setAttribute('aria-selected', String(section === name)); }
  for (const name of ['gemini', 'openrouter']) $('keys-' + name).setAttribute('aria-pressed', String(provider === name));
  renderKeys().catch(error => notice(error.message));
}
function navigate(nextSection, nextProvider) {
  if (adding) return;
  if (dirty && section === 'preferences' && nextSection !== section && !confirm('Kaydedilmemiş değişikliklerin var. Kaydetmeden ayrılmak istiyor musun?')) return;
  if (dirty && section === 'preferences' && nextSection !== section) { markDirty(false); loadPreferences().catch(error => notice(error.message)); }
  if (provider !== nextProvider) { $('new-key').value = ''; $('new-label').value = ''; }
  location.hash = `${nextSection}/${nextProvider}`;
}
for (const b of document.querySelectorAll('[data-section]')) b.onclick = () => navigate(b.dataset.section, provider);
for (const name of ['gemini', 'openrouter']) $('keys-' + name).onclick = () => navigate('keys', name);
for (const id of prefs) $(id).addEventListener('input', () => markDirty(true));
$('series-name').addEventListener('change', async () => { const { seriesGlossaries = {} } = await chrome.storage.local.get('seriesGlossaries'); const name = $('series-name').value.trim(); if (Object.hasOwn(seriesGlossaries, name)) $('translation-glossary').value = seriesGlossaries[name]; });
$('add-form').onsubmit = async event => {
  event.preventDefault(); if (adding) return; adding = true; $('add-button').disabled = true;
  try { await MLUI.keys(provider, 'ADD', { key: $('new-key').value, label: $('new-label').value }); $('new-key').value = ''; $('new-label').value = ''; notice('Anahtar kaydedildi.'); }
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
    if (JSON.stringify(preferenceValues()) === JSON.stringify(values)) markDirty(false); notice('Tercihler kaydedildi.');
  } catch (error) { notice('Tercihler kaydedilemedi: ' + error.message); }
  finally { formSaving = false; $('save-preferences').disabled = false; }
};
$('refresh-models').onclick = async () => {
  $('refresh-models').disabled = true;
  try { const response = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(15000) }); if (!response.ok) throw new Error(`Katalog HTTP ${response.status}`);
    const { data } = await response.json(), available = MLProviders.catalog.openrouter.filter(([id]) => data.some(m => m.id === id && m.architecture?.input_modalities?.includes('image'))).length;
    $('model-availability').textContent = `${available}/${MLProviders.catalog.openrouter.length} model katalogda görüntü destekli. Hesap erişimi bu kontrolle doğrulanmaz.`;
  } catch (error) { $('model-availability').textContent = error.message; } finally { $('refresh-models').disabled = false; }
};
window.addEventListener('beforeunload', event => { if (dirty || adding) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('hashchange', applyRoute);
chrome.storage.onChanged.addListener(() => { renderKeys().catch(error => notice(error.message)); loadPreferences().catch(error => notice(error.message)); });
$('version').textContent = 'v' + chrome.runtime.getManifest().version; applyRoute(); loadPreferences().catch(error => notice(error.message));
