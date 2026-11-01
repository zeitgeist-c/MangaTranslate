import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

// C episode: language picker lives in Settings only; the popup stays language-free.
test('popup has no language picker or onboarding card', async () => {
  const html = await readFile(new URL('popup/popup.html', root), 'utf8');
  const js = await readFile(new URL('popup/popup.js', root), 'utf8');
  assert.ok(!html.includes('id="ui-language"'), 'popup must not ship a language select');
  assert.ok(!html.includes('id="onboarding"'), 'popup must not ship the first-launch language card');
  assert.ok(!js.includes('fillLanguageSelect') && !js.includes('onboarding-done'), 'popup must not run picker logic');
  assert.ok(html.includes('id="manage-models"') && html.includes('id="catalog-state"'), 'popup links to model management');
  assert.ok(js.includes("'src/i18n.js', 'src/i18n-strings-all.js', 'src/content.js', 'src/page-content.js'"), 'fallback injection loads i18n before content scripts');
});

// C episode: model management lives in Settings.
test('settings owns the language picker and the models section', async () => {
  const html = await readFile(new URL('options/settings.html', root), 'utf8');
  assert.ok(html.includes('id="ui-language"'), 'settings keeps the language select');
  assert.ok(html.includes('id="section-models"') && html.includes('id="model-list"'), 'settings has a models section');
  assert.ok(html.includes('data-section="models"'), 'settings nav reaches the models section');
  assert.ok(html.includes('id="model-search"'), 'models section filters by search');
  assert.ok(!html.includes('model-free-only'), 'global free-only toggle is gone (per-card chips replace it)');
  const js = await readFile(new URL('options/settings.js', root), 'utf8');
  assert.ok(js.includes('modelFilter'), 'per-card bucket state exists');
  assert.ok(js.includes("'all', 'free', 'paid'") && js.includes('models_select_visible') && js.includes('models_clear_visible'), 'chips and visible-only bulk actions exist');
  assert.ok(js.includes('models_visible'), 'visible/total counter exists');
  assert.ok(!html.includes('id="refresh-models"'), 'legacy catalog button is gone');
});

test('page panel survives a scope without i18n (injected fallback)', async () => {
  const js = await readFile(new URL('src/page-content.js', root), 'utf8');
  assert.ok(js.includes('globalThis.MLI18N ? globalThis.MLI18N.lang : undefined'), 'log timestamp degrades without MLI18N instead of throwing');
});
