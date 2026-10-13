import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startServer } from '../server.mjs';
const executablePath = process.env.BRAVE_EXECUTABLE;
if (!executablePath) throw new Error('Set BRAVE_EXECUTABLE to the installed Brave executable. An isolated temporary browser profile is used.');
const server = await startServer(0), port = server.address().port;
let browser;
const reportName = process.env.REPORT_NAME ?? 'browser-smoke';
if (!/^[a-z0-9-]+$/.test(reportName)) throw new Error('Invalid report name');
try {
  browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-extensions', '--no-first-run'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1.25 });
  const errors = [], consoleErrors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') consoleErrors.push(e.text()); });
  await page.goto(`http://127.0.0.1:${port}`);
  await page.evaluate(() => new MutationObserver(() => console.log('[lab-progress] ' + document.querySelector('#status').textContent))
    .observe(document.querySelector('#status'), { childList: true }));
  page.on('console', e => { if (e.type() === 'log' && e.text().startsWith('[lab-progress]')) console.log(e.text()); });
  await page.waitForFunction(() => window.lab?.ready || window.lab?.error, null, { timeout: 60000 });
  const initializationError = await page.evaluate(() => window.lab.error);
  if (initializationError) throw new Error(initializationError);
  const chapterName = process.env.CHAPTER ?? 'chapter-174';
  const options = await page.locator('#page option').evaluateAll(items => items.map(el => ({ value: el.value, text: el.textContent })));
  const chapterOptions = options.filter(el => el.text.startsWith(chapterName + ' / '));
  const sourcePage = Number(chapterOptions[Number(process.env.SOURCE_PAGE ?? 1)]?.value);
  if (!Number.isSafeInteger(sourcePage)) throw new Error('Requested chapter/source image not found');
  await page.evaluate(index => window.lab.loadPage(index), sourcePage);
  await page.locator('#page').evaluate((element, value) => { element.value = String(value); }, sourcePage);
  const gpu = await page.evaluate(async () => {
    if (!navigator.gpu) return { available: false };
    const adapter = await navigator.gpu.requestAdapter();
    return adapter ? { available: true, info: { vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device, description: adapter.info.description } } : { available: false };
  });
  const models = process.env.MODELS?.split(',') ?? ['rtdetr-int8', 'rtdetr-fp32'];
  const results = [];
  const wallTimes = [];
  for (const model of models) {
    await page.selectOption('#model', model);
    await page.selectOption('#backend', process.env.BACKEND ?? 'wasm');
    const start = performance.now();
    const reports = await page.evaluate(batch => window.lab.run(batch), process.env.BATCH === '1');
    wallTimes.push({ model, elapsedMs: performance.now() - start, images: reports.length });
    results.push(...reports.map(r => ({ imageId: r.imageId, width: r.width, height: r.height, modelId: r.modelId,
      modelSHA256: r.modelSHA256, regions: r.regions.length, bubbles: r.bubbles.length, needsReview: r.regions.filter(v => v.needsReview).length,
      tileCount: r.tileCount, timing: r.timing, modelLoadMs: r.modelLoadMs, backend: r.backend, runtimeVersion: r.runtimeVersion })));
  }
  // SVG/source alignment is measured separately from detection correctness.
  const geometry = await page.evaluate(() => {
    const image = document.querySelector('#image'), svg = document.querySelector('#overlay');
    const a = image.getBoundingClientRect(), b = svg.getBoundingClientRect();
    return { image: { width: a.width, height: a.height, x: a.x, y: a.y }, overlay: { width: b.width, height: b.height, x: b.x, y: b.y },
      viewBox: svg.getAttribute('viewBox'), dpr: devicePixelRatio };
  });
  if (['width', 'height', 'x', 'y'].some(k => Math.abs(geometry.image[k] - geometry.overlay[k]) > 1)) throw new Error('Overlay/source geometry drift');
  await page.evaluate(() => { const r = window.lab.report?.regions[0]; if (r) { const img = document.querySelector('#image'); window.scrollTo(0, img.getBoundingClientRect().top + window.scrollY + r.textBox[1] * img.clientWidth / img.naturalWidth - 150); } });
  await page.screenshot({ path: resolve('reports', `${reportName}.png`) });
  const output = { date: new Date().toISOString(), browserVersion: browser.version(), executablePath, isolatedProfile: true, gpu,
    results, wallTimes, geometry, errors, consoleErrors, qualityMeasured: false, note: 'Inference and SVG alignment only; not full-page quality acceptance or extension integration.' };
  await mkdir(resolve('reports'), { recursive: true });
  await writeFile(resolve('reports', `${reportName}.json`), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
  if (errors.length) throw new Error('Browser page errors');
} catch (error) {
  await mkdir(resolve('reports'), { recursive: true });
  await writeFile(resolve('reports', `${reportName}-failure.json`), JSON.stringify({ date: new Date().toISOString(), error: error.message, qualityMeasured: false }, null, 2));
  throw error;
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
