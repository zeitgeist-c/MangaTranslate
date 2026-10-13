import { chromium } from 'playwright-core';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('..'), profile = await mkdtemp(join(tmpdir(), 'mangalens-settings-'));
const browser = await chromium.launchPersistentContext(profile, { executablePath: process.env.BRAVE_EXECUTABLE, headless: true,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`], ignoreDefaultArgs: ['--disable-extensions'], viewport: { width: 1000, height: 900 } });
const errors = [];
try {
  let worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host, base = `chrome-extension://${extensionId}/`;
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ openrouterApiKey: 'sk-or-synthetic-12345678901234567890', googleApiKeys: [{ id: 'g1', key: 'AIza-synthetic-12345678901234567890', label: 'İzleme', lastTestStatus: 'success' }], activeGoogleApiKeyId: 'g1' });
    await chrome.storage.sync.set({ translationProvider: 'openrouter', openrouterModel: 'qwen/qwen3.8-flash', enabled: true });
    globalThis.__checks = [];
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith('/api/v1/key') || String(url).endsWith('/v1beta/models')) {
        __checks.push({ url: String(url), method: options.method }); return new Response(JSON.stringify({ data: {}, models: [] }), { headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error('Test blocks all other provider requests');
    };
  });
  const options = await browser.newPage(); options.on('pageerror', error => errors.push(error.message));
  await options.goto(base + 'options/settings.html#keys/openrouter');
  await options.waitForFunction(() => document.querySelectorAll('.key-card').length === 1);
  assert.match(await options.locator('#key-list').textContent(), /OpenRouter API 1/);
  assert.equal(await options.locator('#new-key').inputValue(), '');
  assert.ok(!(await options.locator('body').innerText()).includes('sk-or-synthetic-12345678901234567890'));
  const popup = await browser.newPage(); popup.on('pageerror', error => errors.push(error.message));
  await popup.goto(base + 'popup/popup.html');
  await popup.waitForFunction(() => document.querySelector('#key-summary').textContent.includes('Kayıtlı'));
  assert.equal(await popup.locator('input[type=password]').count(), 0); assert.equal(await popup.locator('#model option').count(), 6);
  await worker.evaluate(() => chrome.storage.sync.set({ openrouterModel: 'google/gemini-2.5-flash-lite' }));
  await popup.waitForFunction(() => document.querySelector('#model').value === '' && document.querySelector('#btn-full-chapter').disabled);
  assert.match(await popup.locator('#model').textContent(), /Model kaldırıldı/);
  assert.equal(await worker.evaluate(async () => (await chrome.storage.sync.get('openrouterModel')).openrouterModel), 'google/gemini-2.5-flash-lite');
  await popup.locator('#model').selectOption('qwen/qwen3.8-flash');
  await popup.waitForFunction(() => !document.querySelector('#btn-full-chapter').disabled);
  await options.getByRole('button', { name: 'Kontrol et', exact: true }).click();
  await options.waitForFunction(() => document.querySelector('#key-list').textContent.includes('Bağlantı doğrulandı'));
  await options.locator('#new-label').fill('Yedek'); await options.locator('#new-key').fill('sk-or-synthetic-second-123456789012345'); await options.locator('#add-button').click();
  await options.waitForFunction(() => document.querySelectorAll('.key-card').length === 2);
  assert.equal(await options.locator('#new-key').inputValue(), '');
  await options.locator('.key-card').nth(1).getByRole('button', { name: 'Aktif yap' }).click();
  await popup.waitForFunction(() => document.querySelector('#key-summary').textContent.includes('Yedek'));
  options.once('dialog', dialog => dialog.accept('Yeniden adlandırıldı'));
  await options.locator('.key-card').nth(1).getByRole('button', { name: 'Adını değiştir' }).click();
  await popup.waitForFunction(() => document.querySelector('#key-summary').textContent.includes('Yeniden adlandırıldı'));
  await options.locator('#new-key').fill('sk-or-synthetic-second-123456789012345'); await options.locator('#add-button').click();
  await options.waitForFunction(() => document.querySelector('#notice').textContent.includes('zaten kayıtlı'));
  await options.locator('#new-key').fill('');
  const other = await browser.newPage(); await other.goto(base + 'options/settings.html#keys/openrouter');
  await Promise.all([options.evaluate(() => MLUI.keys('openrouter', 'ADD', { key: 'sk-or-synthetic-concurrent-A-12345', label: 'A'.repeat(80) })),
    other.evaluate(() => MLUI.keys('openrouter', 'ADD', { key: 'sk-or-synthetic-concurrent-B-12345', label: 'İkinci sekme' }))]);
  await options.waitForFunction(() => document.querySelectorAll('.key-card').length === 4);
  await other.waitForFunction(() => document.querySelectorAll('.key-card').length === 4);
  await mkdir('reports', { recursive: true });
  await options.screenshot({ path: 'reports/settings-desktop.png', fullPage: true });
  for (const width of [500, 360]) {
    await options.setViewportSize({ width, height: 900 });
    assert.ok(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No overflow at ${width}`);
  }
  await options.evaluate(() => document.documentElement.style.fontSize = '28px');
  assert.ok(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No overflow with enlarged text');
  await options.screenshot({ path: 'reports/settings-narrow.png', fullPage: true });
  await options.evaluate(() => document.documentElement.style.fontSize = '');
  await options.setViewportSize({ width: 1000, height: 900 });
  await options.getByRole('button', { name: 'Gemini', exact: true }).click();
  await options.waitForFunction(() => document.querySelectorAll('.key-card').length === 1);
  assert.match(await options.locator('#key-list').textContent(), /İzleme/); assert.match(await options.locator('#key-list').textContent(), /Kontrol edilmedi/);
  await options.getByRole('button', { name: 'Kontrol et', exact: true }).click();
  await options.waitForFunction(() => document.querySelector('#key-list').textContent.includes('Bağlantı doğrulandı'));
  await options.locator('#new-label').fill('Google yedek'); await options.locator('#new-key').fill('AIza-synthetic-second-123456789012345'); await options.locator('#new-key').press('Enter');
  await options.waitForFunction(() => document.querySelectorAll('.key-card').length === 2);
  await options.locator('.key-card').nth(1).getByRole('button', { name: 'Aktif yap' }).click();
  await popup.locator('#provider-gemini').click();
  await popup.waitForFunction(() => document.querySelector('#key-summary').textContent.includes('Google yedek'));
  assert.equal(await popup.locator('#model option').count(), 3);
  options.once('dialog', dialog => dialog.accept()); await options.locator('.key-card').first().getByRole('button', { name: 'Sil', exact: true }).click();
  await options.waitForFunction(() => document.querySelectorAll('.key-card').length === 1);
  await popup.locator('#provider-openrouter').click();
  await popup.waitForFunction(() => document.querySelector('#model').value === 'qwen/qwen3.8-flash');
  await options.getByRole('button', { name: 'Çeviri Tercihleri', exact: true }).click();
  await options.locator('#series-name').fill('__proto__'); await options.locator('#translation-glossary').fill('Knight = Şövalye');
  await options.locator('#translation-instructions').fill('Karakter sesini koru');
  await other.evaluate(() => chrome.storage.sync.set({ enabled: false }));
  assert.equal(await options.locator('#translation-instructions').inputValue(), 'Karakter sesini koru');
  options.once('dialog', dialog => dialog.dismiss()); await options.getByRole('button', { name: 'Hakkında', exact: true }).click();
  assert.ok(await options.locator('#section-preferences').isVisible());
  await options.locator('#save-preferences').click();
  await options.waitForFunction(() => document.querySelector('#dirty-status').textContent === 'Değişiklik yok');
  const glossary = await worker.evaluate(async () => { const d = (await chrome.storage.local.get('seriesGlossaries')).seriesGlossaries; return Object.hasOwn(d, '__proto__') ? d['__proto__'] : 'missing'; });
  assert.equal(glossary, 'Knight = Şövalye');
  await other.evaluate(() => chrome.storage.sync.set({ enabled: true }));
  await popup.waitForFunction(() => !document.querySelector('#model').disabled);
  // Force a storage failure only inside this isolated extension page.
  await popup.evaluate(() => { globalThis.__syncSet = chrome.storage.sync.set; chrome.storage.sync.set = async () => { throw new Error('Synthetic write failure'); }; });
  await popup.locator('#model').selectOption('qwen/qwen3.7-flash');
  await popup.waitForFunction(() => document.querySelector('#notice').textContent.includes('Synthetic write failure'));
  assert.equal(await popup.locator('#model').inputValue(), 'qwen/qwen3.8-flash');
  await popup.evaluate(() => chrome.storage.sync.set = __syncSet);
  await popup.reload(); await popup.waitForFunction(() => document.querySelector('#key-summary').textContent.includes('Kayıtlı'));
  const snapshot = await worker.evaluate(() => MLKeys.action({ type: 'ML_KEYS_LIST', provider: 'openrouter' }));
  await Promise.all(snapshot.map(k => other.evaluate(id => MLUI.keys('openrouter', 'DELETE', { id }), k.id)));
  await popup.waitForFunction(() => document.querySelector('#add-key').hidden === false);
  assert.ok(await popup.locator('#btn-full-chapter').isDisabled());
  await other.evaluate(() => MLUI.keys('openrouter', 'ADD', { key: 'sk-or-synthetic-restored-1234567890', label: 'Son anahtar' }));
  await popup.waitForFunction(() => document.querySelector('#key-summary').textContent.includes('Son anahtar'));
  await popup.setViewportSize({ width: 360, height: 650 });
  assert.ok(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const version = await worker.evaluate(() => chrome.runtime.getManifest().version);
  await popup.locator('body').screenshot({ path: `reports/popup-${version}.png` });
  // Settings action focuses an existing page rather than creating a duplicate.
  const count = browser.pages().length; await popup.locator('#settings').click(); await popup.waitForTimeout(100);
  assert.equal(browser.pages().length, count);
  await options.getByRole('button', { name: 'Hakkında', exact: true }).click();
  const catalog = await options.evaluate(() => MLProviders.catalog.openrouter.map(([id]) => ({ id, architecture: { input_modalities: ['text', 'image'] } })));
  await options.route('https://openrouter.ai/api/v1/models', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: catalog }) }));
  await options.locator('#refresh-models').click(); await options.waitForFunction(() => document.querySelector('#model-availability').textContent.startsWith('6/6'));
  const reader = await browser.newPage(); await reader.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Isolated reader fixture</body></html>' }));
  await reader.goto('https://fixture.invalid/chapter');
  const tab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url), reader.url());
  await popup.evaluate(tab => {
    const actual = chrome.tabs.query; chrome.tabs.query = async query => query.active ? [tab] : actual(query);
    window.close = () => { globalThis.__closedCount = (globalThis.__closedCount || 0) + 1; };
  }, tab);
  await popup.locator('#enabled-toggle').uncheck(); await popup.waitForFunction(() => document.querySelector('#btn-full-chapter').disabled);
  await popup.locator('#enabled-toggle').check(); await popup.waitForFunction(() => !document.querySelector('#btn-full-chapter').disabled);
  await popup.locator('#model').selectOption('meta/muse-spark-1.3-contributor');
  await popup.waitForFunction(() => !document.querySelector('#contributor-row').hidden);
  await popup.locator('#contributor-consent').check();
  await popup.waitForFunction(() => !document.querySelector('#model').disabled);
  await popup.locator('#model').selectOption('qwen/qwen3.8-flash');
  await popup.waitForFunction(() => document.querySelector('#contributor-row').hidden);
  await popup.locator('#btn-translate-page').click();
  assert.equal(await worker.evaluate(id => chrome.tabs.sendMessage(id, { type: 'GET_TRANSLATION_MODE' }), tab.id).then(r => r.mode), 'selection');
  await popup.locator('#btn-quick-translate').click();
  await popup.waitForFunction(() => document.querySelector('#btn-quick-translate').textContent.includes('durdur'));
  assert.equal(await worker.evaluate(id => chrome.tabs.sendMessage(id, { type: 'GET_TRANSLATION_MODE' }), tab.id).then(r => r.mode), 'quick');
  await popup.locator('#btn-quick-translate').click();
  await popup.waitForFunction(() => document.querySelector('#btn-quick-translate').textContent === 'Oto Çevir');
  await popup.locator('#btn-full-chapter').click();
  await reader.waitForSelector('[data-mangalens-ui="page"]');
  const checks = await worker.evaluate(() => __checks);
  const session = await browser.newCDPSession(other); await session.send('ServiceWorker.enable'); await session.send('ServiceWorker.stopAllWorkers');
  const afterRestart = await other.evaluate(() => MLUI.keys('openrouter')); assert.equal(afterRestart.length, 1); assert.equal(afterRestart[0].label, 'Son anahtar');
  assert.equal(checks.length, 2); assert.ok(checks.every(r => r.method === 'GET')); assert.deepEqual(errors, []);
  const result = { version, migration: true, multiKeyBothProviders: true, concurrentTabs: true, noSecretInDOM: true,
    metadataChecks: checks.length, responsiveWidths: [1000, 500, 360], enlargedText: true, failedSaveRestoresSelection: true,
    dirtyPreferencesPreserved: true, lastKeyDisablesTranslation: true, settingsTabReused: true, workerRestart: true, keyboardAdd: true,
    popupTranslationActions: true, contributorConsent: true, modelCatalog: true, realProviderCalls: 0, browser: browser.browser().version() };
  await writeFile('reports/settings-smoke.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); }
