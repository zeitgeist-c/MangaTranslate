import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
if (!process.env.ML_TEST_PROFILE) throw new Error('Use an existing isolated synthetic profile with completed fixture cache');
const source = JSON.parse(await readFile('.local/chapter-174/manifest.json', 'utf8')).pages[1].url;
const url = 'https://asurascans.com/comics/revenge-of-the-iron-blooded-sword-hound-1bb35e56/chapter/174';
const root = resolve('..');
let browser;
try {
  browser = await chromium.launchPersistentContext(process.env.ML_TEST_PROFILE, { executablePath: process.env.BRAVE_EXECUTABLE, headless: true,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`], ignoreDefaultArgs: ['--disable-extensions'], viewport: { width: 1280, height: 900 } });
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  await worker.evaluate(async () => {
    await chrome.storage.sync.set({ enabled: true, translationProvider: 'openrouter', openrouterModel: 'qwen/qwen3.8-flash', localDetector: 'standard' });
    const actual = fetch;
    globalThis.fetch = (url, options) => {
      if (String(url).includes('openrouter.ai/api') || String(url).includes(':generateContent')) throw new Error('Live provider calls disabled by user');
      return actual(url, options);
    };
  });
  const page = await browser.newPage();
  await page.route('**/*', route => route.request().resourceType() === 'image' && route.request().url() !== source ? route.abort() : route.continue());
  await page.goto(`${url}#mangalens-test-${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(source => [...document.images].some(img => img.src === source && img.naturalHeight === 16000), source, { timeout: 45000 });
  // Scope this live-DOM test to the already cached image. No hidden provider/image sampling.
  await page.evaluate(source => {
    const limitScope = () => { for (const img of document.images) if (img.src !== source) img.remove(); };
    limitScope(); new MutationObserver(limitScope).observe(document.documentElement, { subtree: true, childList: true });
  }, source);
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
  await worker.evaluate(id => chrome.tabs.sendMessage(id, { type: 'START_PAGE_TRANSLATION' }), tabId);
  let job;
  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(1000);
    job = await worker.evaluate(async ({ id, url }) => (await chrome.storage.local.get(`ml-page-job:${id}:${url}`))[`ml-page-job:${id}:${url}`], { id: tabId, url });
    if (i % 10 === 0) console.log('[live-reader-progress] ' + JSON.stringify(job?.pages.map(p => ({ state: p.state, error: p.error }))));
    if (job?.state === 'finished') break;
  }
  assert.equal(job?.pages.length, 1, 'Test scope must stay at one cached image');
  assert.equal(job.pages[0].error, undefined, job.pages[0].error);
  const alignment = [];
  for (const width of [1280, 700]) {
    await page.setViewportSize({ width, height: 900 }); await page.evaluate(() => scrollTo(0, 1500)); await page.waitForTimeout(250);
    const geometry = await page.evaluate(source => {
      const img = [...document.images].find(img => img.src === source), layer = document.querySelector('[data-mangalens-ui="layer"]');
      const a = img.getBoundingClientRect(), b = layer.getBoundingClientRect();
      return { delta: Math.max(...['x', 'y', 'width', 'height'].map(k => Math.abs(a[k] - b[k]))), layerHidden: layer.hidden, width: innerWidth };
    }, source);
    assert.ok(geometry.delta <= 1); assert.equal(geometry.layerHidden, false); alignment.push(geometry);
  }
  await page.screenshot({ path: 'reports/live-reader-smoke.png' });
  const report = { url, source, browser: await browser.browser().version(), limitedToOneImage: true, otherImagesRemovedForTest: true,
    alignment, state: job.pages[0].state, translated: job.pages[0].translated, issues: job.pages[0].issues.length,
    syntheticCachedTranslation: true, liveProviderCalls: false, fullChapterQualityMeasured: false };
  await writeFile('reports/live-reader-smoke.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} catch (error) {
  await writeFile('reports/live-reader-smoke-failure.json', JSON.stringify({ url, error: error.message, liveProviderCalls: false }, null, 2)); throw error;
} finally { await browser?.close(); }
