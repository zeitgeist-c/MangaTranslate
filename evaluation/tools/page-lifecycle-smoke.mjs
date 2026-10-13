import { chromium } from 'playwright-core';
import { readFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const profile = await mkdtemp(join(tmpdir(), 'mangalens-lifecycle-'));
const browser = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.BRAVE_EXECUTABLE, headless: true, viewport: { width: 1280, height: 900 }
});
try {
  const page = await browser.newPage();
  // This fixture has no network access, extension keys or provider credentials.
  await page.route('**/*', route => route.request().url() === 'https://fixture.invalid/chapter'
    ? route.fulfill({ contentType: 'text/html', body: '<html><body><img id="reader" width="900" height="1000"></body></html>' }) : route.abort());
  await page.goto('https://fixture.invalid/chapter');
  await page.evaluate(() => {
    const image = document.querySelector('img');
    image.src = 'https://fixture.invalid/image.png';
    Object.defineProperties(image, { naturalWidth: { value: 900 }, naturalHeight: { value: 1000 } });
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
    const config = { processingVersion: 'page-v6', provider: 'openrouter', model: 'synthetic', localDetector: 'fast', batching: { maxRegions: 1 } };
    globalThis.fixture = { prepares: 0, billed: 0, cancels: [], listeners: [],
      job: { config, pages: [{ source: image.src, state: 'queued' }], context: [] } };
    const f = fixture;
    f.report = { imageId: 'a'.repeat(64), width: 900, height: 1000,
      regions: [{ regionId: 'r1', crop: 'data:image/png;base64,AAAA', bubbleId: 'b1', textBox: [100, 100, 200, 200] }] };
    globalThis.chrome = { storage: { sync: { get: async () => ({ enabled: true }) } }, runtime: {
      onMessage: { addListener: fn => f.listeners.push(fn) },
      sendMessage: async message => {
        if (message.type === 'ML_CONFIG') return { ok: true, value: config };
        if (message.type === 'ML_JOB_GET') return { ok: true, value: structuredClone(f.job) };
        if (message.type === 'ML_JOB_SAVE') { f.job = structuredClone(message.job); return { ok: true }; }
        if (message.type === 'ML_CANCEL') { f.cancels.push(message.requestId); return { ok: true }; }
        if (message.type === 'ML_JOB_CONTROL') return { ok: true };
        if (message.type === 'ML_PREPARE') {
          f.prepares++; if (f.prepares === 1) return new Promise(resolve => { f.late = resolve; });
          return { ok: true, value: f.report };
        }
        if (message.type === 'ML_TRANSLATE') {
          if (f.refusal) return { ok: false, error: 'Bu model için OpenRouter hesabında 18+ yaş onayı gerekiyor.',
            code: 'AGE_CONFIRMATION_REQUIRED', stopJob: true, actionUrl: 'https://openrouter.ai/settings/preferences' };
          if (!f.translation) { f.billed++; f.translation = new Promise(resolve => { f.translated = resolve; }); }
          return f.translation;
        }
        if (message.type === 'ML_RENDER') return { ok: true, value: { patches: [], issues: [] } };
        throw new Error(message.type);
      }
    } };
  });
  await page.addScriptTag({ content: await readFile('../src/page-content.js', 'utf8') });
  await page.evaluate(() => fixture.listeners[0]({ type: 'START_PAGE_TRANSLATION', resume: true }, {}, () => {}));
  await page.waitForFunction(() => fixture.prepares === 1);
  await page.getByRole('button', { name: 'Paneli katla', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Paneli genişlet', exact: true }).getAttribute('aria-expanded'), 'false');
  assert.equal(await page.evaluate(() => fixture.cancels.length), 0, 'Folding must not pause');
  await page.getByRole('button', { name: 'Paneli genişlet', exact: true }).click();
  await page.getByRole('button', { name: 'Duraklat', exact: true }).click();
  await page.getByRole('button', { name: 'Devam et', exact: true }).click();
  await page.waitForFunction(() => fixture.billed === 1);
  await page.getByRole('button', { name: 'Duraklat', exact: true }).click();
  await page.getByRole('button', { name: 'Devam et', exact: true }).click();
  await page.waitForFunction(() => fixture.prepares === 3);
  await page.evaluate(() => fixture.translated({ ok: true, value: { regions: [{ regionId: 'r1', status: 'translated', sourceText: 'Hello', translatedText: 'Merhaba' }] } }));
  await page.waitForFunction(() => fixture.job.state === 'finished');
  const before = await page.getByRole('status').textContent();
  await page.evaluate(() => fixture.late({ ok: true, value: fixture.report }));
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole('status').textContent(), before);
  const result = await page.evaluate(() => ({ prepares: fixture.prepares, syntheticProviderOperations: fixture.billed,
    localCancellationCount: fixture.cancels.length, state: fixture.job.state, pageState: fixture.job.pages[0].state }));
  assert.equal(result.syntheticProviderOperations, 1); assert.equal(result.pageState, 'done');
  assert.equal(result.localCancellationCount, 1);
  await page.getByText('Görünüm ve kontrol araçları', { exact: true }).click();
  await page.getByRole('button', { name: 'Orijinal / çeviri', exact: true }).click();
  assert.ok(await page.locator('[data-mangalens-ui="layer"]').isHidden());
  await page.getByRole('button', { name: 'Orijinal / çeviri', exact: true }).click();
  await page.getByRole('button', { name: 'Kutuları göster / gizle', exact: true }).click();
  await page.getByRole('button', { name: 'Kontrol listesi', exact: true }).click();
  await page.evaluate(() => {
    fixture.refusal = true;
    const other = document.createElement('img'); other.src = 'https://fixture.invalid/second.png'; other.width = 900; other.height = 1000;
    Object.defineProperties(other, { naturalWidth: { value: 900 }, naturalHeight: { value: 1000 } }); document.body.append(other);
    fixture.listeners[0]({ type: 'START_PAGE_TRANSLATION' }, {}, () => {});
  });
  await page.waitForFunction(() => fixture.job.state === 'blocked');
  assert.equal(await page.evaluate(() => fixture.job.pages[1].state), 'queued');
  const link = page.getByRole('link', { name: 'OpenRouter ayarlarını aç' });
  assert.ok(await link.isVisible()); assert.equal(await link.getAttribute('href'), 'https://openrouter.ai/settings/preferences');
  assert.match(await page.getByRole('status').textContent(), /yaş onayı/);
  const stopped = await page.evaluate(() => fixture.prepares);
  await page.getByRole('button', { name: 'Devam et', exact: true }).click(); await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => fixture.prepares), stopped);
  result.ageRefusalStopsQueue = true; result.settingsLinkVisible = true;
  result.foldDoesNotPause = true; result.displayToolsWork = true;
  await page.getByRole('button', { name: 'Paneli katla', exact: true }).click();
  assert.ok(await link.isVisible()); assert.ok(await page.getByRole('status').isVisible());
  await page.getByRole('button', { name: 'Paneli genişlet', exact: true }).click();
  if (!await page.locator('[data-mangalens-ui="page"] details').evaluate(el => el.open)) await page.getByText('Görünüm ve kontrol araçları', { exact: true }).click();
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  assert.equal(await page.locator('[data-mangalens-ui="page"]').count(), 0);
  assert.equal(await page.evaluate(() => fixture.job.state), 'paused'); result.closePauses = true;
  await mkdir('reports', { recursive: true });
  await page.screenshot({ path: 'reports/page-lifecycle-smoke.png' });
  await writeFile('reports/page-lifecycle-smoke.json', JSON.stringify({ ...result, browser: browser.browser().version(), realProviderCalls: 0, profile }, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
