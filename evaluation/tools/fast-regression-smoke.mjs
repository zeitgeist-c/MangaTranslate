import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('..'), profile = await mkdtemp(join(tmpdir(), 'mangalens-fast-'));
const samples = [
  ['purple', resolve('.local/regressions/purple.png'), ['NEDEN… VIKIR?', 'NASIL…?']],
  ['title', resolve('.local/regressions/title.png'), ['BEELZEBUB: SİNEKLERİN OBURLUĞU / KÖPEK DİŞİ', '1. YUVA: ÖLÜMCÜL ZEHİR — SEKİZ BACAKLI MADAM (S)']],
  ['black', resolve('.local/regressions/black.png'), ['YALNIZCA GEÇİCİ FELCE YOL AÇAN ETKİSİZLEŞTİRİLMİŞ BİR ZEHİR…', 'BUNUN İÇİN SENDEN NEFRET EDECEKLERİNİ BİLİYORSUN, DEĞİL Mİ?']],
  ['long', resolve('.local/chapter-174/002.webp'), null]
];
const buffers = new Map(await Promise.all(samples.map(async ([name, file]) => [name, await readFile(file)])));
const requests = new Map();
const server = createServer((req, res) => {
  const name = req.url.slice(1); requests.set(name, (requests.get(name) || 0) + 1);
  if (buffers.has(name)) { res.setHeader('Content-Type', name === 'long' ? 'image/webp' : 'image/png'); res.end(buffers.get(name)); }
  else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><style>body{background:#555;margin:20px}#view{position:relative;display:inline-block}img{display:block}</style><div id="view"></div>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, { executablePath: process.env.BRAVE_EXECUTABLE, headless: true, args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`], ignoreDefaultArgs: ['--disable-extensions'] });
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  await worker.evaluate(() => { const actual = fetch; globalThis.fetch = (url, ...args) => { if (/openrouter.ai|generativelanguage.googleapis.com/.test(String(url))) throw new Error('Real providers blocked by regression test'); return actual(url, ...args); }; });
  const page = await browser.newPage(); await page.goto(origin);
  const pngPixelsIdentical = await page.evaluate(async () => {
    const input = new OffscreenCanvas(160, 80), ctx = input.getContext('2d'), gradient = ctx.createLinearGradient(0, 0, 160, 80);
    gradient.addColorStop(0, '#f1ddff'); gradient.addColorStop(1, '#192230'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 160, 80);
    ctx.fillStyle = '#fff'; ctx.font = '20px Arial'; ctx.fillText('İŞĞÜÖÇ', 10, 40);
    const legacy = await createImageBitmap(await input.convertToBlob({ type: 'image/png' }));
    const output = document.createElement('canvas'); output.width = 160; output.height = 80; output.getContext('2d').drawImage(input, 0, 0);
    const modern = await createImageBitmap(await (await fetch(output.toDataURL('image/png'))).blob());
    const scratch = new OffscreenCanvas(160, 80), g = scratch.getContext('2d'); g.drawImage(legacy, 0, 0); const a = g.getImageData(0, 0, 160, 80).data;
    g.drawImage(modern, 0, 0); const b = g.getImageData(0, 0, 160, 80).data; legacy.close(); modern.close(); return a.every((v, i) => v === b[i]);
  });
  assert.equal(pngPixelsIdentical, true);
  const results = []; await mkdir('reports', { recursive: true });
  for (const [name, , labels] of samples) {
    const source = `${origin}/${name}`, wall = performance.now();
    const report = await worker.evaluate(source => mlOffscreen('prepare', { source, detector: 'fast' }), source);
    const prepareWallMs = performance.now() - wall;
    const eligible = report.regions.filter(r => !r.needsReview && r.crop);
    if (labels) assert.equal(eligible.length, 2, name + ' must contain two readable groups');
    const translations = eligible.map((r, index) => ({ regionId: r.regionId, status: 'translated', translatedText: labels?.[index] || 'BU BİR DENEME ÇEVİRİSİDİR.', sourceText: 'Synthetic reading' }));
    const beforeRender = requests.get(name), renderWall = performance.now();
    const rendered = await worker.evaluate(({ source, report, translations }) => mlOffscreen('render', { source, report, translations, style: 'card', minFont: 12 }), { source, report, translations });
    const renderWallMs = performance.now() - renderWall;
    assert.equal(requests.get(name), beforeRender, 'Card rendering must not download the original again');
    if (labels) { assert.equal(rendered.patches.length, 2, name + ' must show both Turkish cards'); assert.equal(rendered.issues.length, 0); }
    for (const patch of rendered.patches) { assert.ok(patch.fontSize >= 12); assert.ok(patch.box[0] >= 0 && patch.box[1] >= 0 && patch.box[2] <= report.width && patch.box[3] <= report.height); }
    if (labels) {
      await page.evaluate(({ source, patches }) => { const host = document.querySelector('#view'); host.replaceChildren(); const image = document.createElement('img'); image.src = source; host.append(image); for (const patch of patches) { const overlay = document.createElement('img'); overlay.src = patch.dataUrl; overlay.style.cssText = `position:absolute;left:${patch.box[0]}px;top:${patch.box[1]}px`; host.append(overlay); } }, { source, patches: rendered.patches });
      await page.waitForFunction(() => [...document.images].every(img => img.complete)); await page.locator('#view').screenshot({ path: `reports/fast-${name}.png` });
    }
    const warm = performance.now(); await worker.evaluate(source => mlOffscreen('prepare', { source, detector: 'fast' }), source);
    results.push({ name, width: report.width, height: report.height, backend: report.backend, prepareWallMs, timing: report.timing, renderWallMs, warmPrepareMs: performance.now() - warm,
      groups: report.regions.length, cards: rendered.patches.length, issues: rendered.issues.map(i => i.reason), geometry: report.regions.map(r => ({ textBox: r.textBox, review: r.needsReview })) });
    console.log(JSON.stringify(results.at(-1)));
  }
  const output = { version: '3.7.0', browser: browser.browser().version(), realProviderCalls: 0, pngPixelsIdentical, note: 'Real local detection, synthetic Turkish translations; not live model reading accuracy.', results };
  await writeFile('reports/fast-regression-smoke.json', JSON.stringify(output, null, 2));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
