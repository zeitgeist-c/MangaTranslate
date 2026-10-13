import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const root = resolve(process.env.ML_EXTENSION_ROOT || '..'), profile = process.env.ML_TEST_PROFILE || await mkdtemp(join(tmpdir(), 'mangalens-extension-'));
const image = await readFile(resolve('.local/chapter-174/002.webp'));
const fixtureManifest = JSON.parse(await readFile('.local/chapter-174/manifest.json', 'utf8'));
const fixtureFiles = process.env.FULL_CHAPTER === '1' ? fixtureManifest.pages.map(p => p.file) : process.env.DUPLICATE_IMAGES === '1' ? ['002.webp', '002.webp'] : ['002.webp'];
const fixtureImages = new Map(await Promise.all(fixtureFiles.map(async file => [file, await readFile(`.local/chapter-174/${file}`)])));
let shapeBytes;
const server = createServer((req, res) => {
  if (req.url === '/shape.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(shapeBytes); return; }
  if (req.url.startsWith('/image/')) { res.writeHead(200, { 'Content-Type': 'image/webp' }); res.end(fixtureImages.get(new URL(req.url, 'http://fixture').pathname.split('/').at(-1))); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html><head><title>MangaLens extension fixture</title><style>body{margin:20px;background:#333}img.reader{display:block;width:600px;height:auto;max-width:95vw;margin:auto}</style></head><body>' + fixtureFiles.map((file, index) => `<img class="reader" src="/image/${file}${process.env.DUPLICATE_IMAGES === '1' ? '?copy=' + index : ''}">`).join('') + '</body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
const logs = [];
try {
  browser = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.BRAVE_EXECUTABLE, headless: true,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--no-first-run'],
    ignoreDefaultArgs: ['--disable-extensions'], viewport: { width: 1280, height: 900 }
  });
  let worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker', { timeout: 30000 });
  // A reused unpacked profile can retain compiled importScripts from an older release.
  if (!await worker.evaluate(() => typeof MLKeys !== 'undefined' && mlKey.toString().includes('MLKeys'))) {
    const nextWorker = browser.waitForEvent('serviceworker', { timeout: 30000 });
    const wake = await browser.newPage(), popupUrl = `chrome-extension://${new URL(worker.url()).host}/popup/popup.html`;
    await worker.evaluate(() => setTimeout(() => chrome.runtime.reload(), 50));
    await wake.waitForTimeout(300); await wake.goto(popupUrl);
    worker = await nextWorker;
    await wake.close();
  }
  worker.on('console', message => { logs.push(message.text()); console.log('[worker] ' + message.text().slice(0, 250)); });
  const extensionId = new URL(worker.url()).host;
  await worker.evaluate(async ({detector, delay, invalidRegion}) => {
    await chrome.storage.sync.set({ translationProvider: 'openrouter', openrouterModel: 'qwen/qwen3.8-flash', enabled: true, localDetector: detector });
    await chrome.storage.local.set({ openrouterApiKey: 'synthetic-key-no-real-provider-access' });
    globalThis.__providerCalls = []; globalThis.__activeProviderCalls = 0; globalThis.__peakProviderCalls = 0; globalThis.__syntheticDelay = delay;
    globalThis.__invalidRegion=invalidRegion;
    const actualFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      if (String(url).includes('/endpoints')) return new Response(JSON.stringify({data:{endpoints:[{context_length:1048576,max_completion_tokens:32768}]}}),{headers:{'Content-Type':'application/json'}});
      if (String(url).includes('/chat/completions')) {
        const body = JSON.parse(options.body), ids = body.messages[0].content.filter(part => part.type === 'text' && part.text.startsWith('regionId=')).map(part => part.text.slice(9));
        globalThis.__activeProviderCalls++; globalThis.__peakProviderCalls = Math.max(globalThis.__peakProviderCalls, globalThis.__activeProviderCalls);
        globalThis.__providerCalls.push({ model: body.model, ids, startedAt: Date.now(), maxTokens: body.max_tokens });
        await new Promise(resolve=>setTimeout(resolve,globalThis.__syntheticDelay));
        globalThis.__activeProviderCalls--;
        const regions = ids.reverse().map(regionId => ({ regionId, sourceText: 'Synthetic source', translatedText: 'BU BİR DENEME.', status: 'translated' }));
        if (globalThis.__invalidRegion && regions.length) regions[0].translatedText=null;
        return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ regions }) } }] }), { headers: { 'Content-Type': 'application/json' } });
      }
      return actualFetch(url, options);
    };
  }, {detector:process.env.ML_DETECTOR || 'fast',delay:Number(process.env.PROVIDER_DELAY_MS || 0),invalidRegion:process.env.INVALID_REGION==='1'});
  const page = await browser.newPage(); page.on('pageerror', error => logs.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/chapter`);
  await page.waitForFunction(() => [...document.images].some(img => img.naturalHeight === 16000));
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
  await worker.evaluate(async id => {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['src/content.js', 'src/page-content.js'] });
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['src/content.js', 'src/page-content.js'] });
  }, tabId);
  const getJob = () => worker.evaluate(async ({ id, url }) => (await chrome.storage.local.get(`ml-page-job:${id}:${url}`))[`ml-page-job:${id}:${url}`], { id: tabId, url: page.url() });
  async function waitResumed(before) {
    for (let i = 0; i < 120; i++) {
      await page.waitForTimeout(1000); const current = await getJob();
      if (current?.state === 'finished' && current.updatedAt > before) { assert.ok(current.pages.every(p => p.state !== 'error'), 'Resume completed with errors'); return; }
    }
    throw new Error('Resume did not finish');
  }
  const start = performance.now();
  await worker.evaluate(id => chrome.tabs.sendMessage(id, { type: 'START_PAGE_TRANSLATION' }), tabId);
  let job;
  for (let i = 0; i < (process.env.FULL_CHAPTER === '1' ? 1200 : 180); i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    job = await getJob();
    if (i % 10 === 0) console.log('[extension-progress] ' + JSON.stringify(job?.pages.map(p => ({ state: p.state, error: p.error }))));
    if (job?.state === 'finished') break;
  }
  assert.equal(job?.state, 'finished');
  console.log('[render-summary] ' + JSON.stringify(job.pages.map(p => ({ state: p.state, translated: p.translated, issues: p.issues?.length, error: p.error }))));
  assert.ok(['done', 'review'].includes(job.pages[0].state), job.pages[0].error);
  assert.ok(job.pages.some(p => p.translated > 0), 'At least one safe region must be rendered');
  if (process.env.INVALID_REGION==='1') assert.ok(job.pages.some(p=>p.issues?.some(i=>i.reason==='invalid_translation_result')),'Malformed region must remain explicitly reviewable');
  const calls = await worker.evaluate(() => globalThis.__providerCalls);
  if (process.env.DUPLICATE_IMAGES === '1') { assert.equal(job.pages.length, 2); assert.equal(calls.length, 1); assert.equal(job.pages[0].translated, job.pages[1].translated); assert.ok(job.pages[1].translated > 0); }
  if (!process.env.ML_TEST_PROFILE) assert.ok(calls.length > 0, 'Must exercise synthetic provider adapter');
  const popup = await browser.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  try { await popup.waitForFunction(() => document.querySelector('#provider-openrouter').getAttribute('aria-pressed') === 'true'); }
  catch (error) { console.log('[popup-diagnostic]', await popup.evaluate(() => ({ provider: document.querySelector('#provider-openrouter')?.outerHTML, notice: document.querySelector('#notice')?.textContent, summary: document.querySelector('#key-summary')?.textContent }))); throw error; }
  assert.equal(await popup.locator('input[type=password]').count(), 0);
  assert.equal(await popup.locator('#model option').count(), 6);
  assert.match(await popup.locator('#key-summary').textContent(), /Kayıtlı/);
  const firstWallMs = performance.now() - start;
  assert.ok(job.pages.every(p => ['done', 'review'].includes(p.state)), 'Every fixture image must complete without processing errors');
  if (process.env.FULL_CHAPTER === '1' && Number(process.env.PROVIDER_DELAY_MS) === 15000) assert.ok(firstWallMs <= 120000, 'Delayed full chapter must meet the synthetic 120 second target');
  const alignment = [];
  for (const width of process.env.FULL_CHAPTER === '1' ? [] : [1280, 700]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => scrollTo(0, 1200)); await page.waitForTimeout(100);
    const delta = await page.evaluate(() => {
      const img = document.querySelector('img.reader').getBoundingClientRect(), layer = document.querySelector('[data-mangalens-ui="layer"]').getBoundingClientRect();
      return Math.max(...['x', 'y', 'width', 'height'].map(key => Math.abs(img[key] - layer[key])));
    });
    assert.ok(delta < 1, 'Extension layer must remain aligned after scroll/resize'); alignment.push({ width, delta });
  }
  await page.screenshot({ path: 'reports/extension-smoke.png' });
  await page.evaluate(() => { scrollTo(0, 0); document.querySelector('[data-mangalens-ui="page"]').style.visibility = 'hidden'; });
  await page.screenshot({ path: 'reports/extension-render.png' });
  await page.evaluate(() => { document.querySelector('[data-mangalens-ui="page"]').style.visibility = 'visible'; });
  const shapeData = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 1000;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#555'; ctx.fillRect(0, 0, 900, 1000);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(450, 400, 220, 160, 0, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = '#000'; ctx.font = '600 28px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('OLD TEXT', 450, 395);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  shapeBytes = Buffer.from(shapeData, 'base64');
  const shapeId = createHash('sha256').update(shapeBytes).digest('hex'), regionId = `${shapeId}:shape:r0`;
  const shapeReport = { imageId: shapeId, width: 900, height: 1000, regions: [{ regionId, textBox: [340, 375, 560, 420], bubbleBox: [225, 235, 675, 565], kind: 'text_bubble', bubbleId: 'b0', needsReview: false }] };
  const renderShape = text => worker.evaluate(({ source, report, regionId, text }) => mlOffscreen('render', {
    source, report, translations: [{ regionId, status: 'translated', translatedText: text }], minFont: 12
  }), { source: `http://127.0.0.1:${server.address().port}/shape.png`, report: shapeReport, regionId, text });
  const shortShape = await renderShape('İĞÜŞÖÇ ıişğüöç');
  assert.equal(shortShape.patches.length, 1, 'Turkish text must fit in the verified flat ellipse');
  const overflowShape = await renderShape('Bu uzun metnin anlamı kesinlikle kesilmemeli. '.repeat(100));
  assert.equal(overflowShape.patches.length, 0); assert.equal(overflowShape.issues[0].reason, 'text_overflow');
  const shapeCheck = await page.evaluate(async dataUrl => {
    const image = new Image(); image.src = dataUrl; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return { cornerRGBA: [...pixels.slice(0, 4)], paintedPixels: pixels.filter((_, i) => i % 4 === 3 && pixels[i] > 0).length };
  }, shortShape.patches[0].dataUrl);
  assert.deepEqual(shapeCheck.cornerRGBA, [85, 85, 85, 255], 'Precomposed patch must preserve the original art outside the old text'); assert.ok(shapeCheck.paintedPixels > 0);
  // Resume/redraw completed work must hit the cache and preserve the frozen original context.
  let beforeResume = (await getJob()).updatedAt;
  await worker.evaluate(id => chrome.tabs.sendMessage(id, { type: 'START_PAGE_TRANSLATION', resume: true }), tabId);
  await waitResumed(beforeResume);
  const secondCalls = await worker.evaluate(() => globalThis.__providerCalls);
  assert.equal(secondCalls.length, calls.length, 'Resume must not retranslate already cached regions');
  const measuredPeak = await worker.evaluate(() => globalThis.__peakProviderCalls);
  const cdp = await browser.newCDPSession(page);
  await cdp.send('ServiceWorker.enable'); await cdp.send('ServiceWorker.stopAllWorkers');
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'ML_CONFIG' }));
  worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  await worker.evaluate(() => {
    globalThis.__unexpectedCalls = 0;
    const actualFetch = globalThis.fetch;
    globalThis.fetch = (url, options) => {
      if (String(url).includes('/chat/completions') || String(url).includes(':generateContent')) { globalThis.__unexpectedCalls++; throw new Error('Provider call blocked in restart test'); }
      return actualFetch(url, options);
    };
  });
  beforeResume = (await getJob()).updatedAt;
  await worker.evaluate(id => chrome.tabs.sendMessage(id, { type: 'START_PAGE_TRANSLATION', resume: true }), tabId);
  await waitResumed(beforeResume);
  const restartCalls = await worker.evaluate(() => globalThis.__unexpectedCalls);
  assert.equal(restartCalls, 0, 'Service-worker restart must preserve completed translation cache');
  const peakConcurrency = await worker.evaluate(() => globalThis.__peakProviderCalls || 0).catch(()=>0);
  const report = { date: new Date().toISOString(), extensionId, version: await worker.evaluate(() => chrome.runtime.getManifest().version), browser: await browser.browser().version(), firstWallMs,
    pages: job.pages.map(p => ({ state: p.state, regions: p.regions, translated: p.translated, issues: p.issues?.length, error: p.error, timing: p.timing, backend: p.backend })),
    calls, peakConcurrency: measuredPeak, syntheticDelayMs: Number(process.env.PROVIDER_DELAY_MS || 0), metrics: job.metrics, alignment, shapeCheck, turkishGlyphRender: true, overflowRejected: true, resumeProviderCalls: secondCalls.length - calls.length, serviceWorkerRestartProviderCalls: restartCalls, profile, errors: logs, realLocalModels: true, syntheticTranslation: true, realProviderCalled: false,
    source: 'Local reader fixture using user-supplied chapter image; not live-site or human quality acceptance.' };
  await mkdir('reports', { recursive: true }); await writeFile(process.env.DUPLICATE_IMAGES === '1' ? 'reports/extension-duplicate-smoke.json' : process.env.FULL_CHAPTER === '1' ? 'reports/extension-full-chapter.json' : process.env.ML_TEST_PROFILE ? 'reports/extension-resume-smoke.json' : 'reports/extension-smoke.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert.equal(logs.length, 0, 'Extension errors must not be ignored');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
