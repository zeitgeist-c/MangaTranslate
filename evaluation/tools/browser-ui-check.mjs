import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startServer } from '../server.mjs';
if (!process.env.BRAVE_EXECUTABLE) throw new Error('BRAVE_EXECUTABLE required');
const server = await startServer(0);
let browser;
const measurements = [];
try {
  browser = await chromium.launch({ executablePath: process.env.BRAVE_EXECUTABLE, headless: true });
  for (const dpr of [1, 1.25, 2]) {
    const context = await browser.newContext({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    const labels = new Map(); // Synthetic UI labels never touch the real ground-truth directory.
    await page.route('**/api/labels**', async route => {
      const request = route.request();
      if (request.method() === 'POST') {
        const data = request.postDataJSON(); labels.set(data.imageId, data);
        await route.fulfill({ json: { saved: 'isolated-ui-fixture' } });
      } else await route.fulfill({ json: labels.get(request.url().split('/').at(-1)) ?? null });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.lab?.ready || window.lab?.error);
    assert.equal(await page.evaluate(() => window.lab.error), undefined);
    await page.locator('summary').click();
    await page.selectOption('#labelMode', 'text');
    await page.locator('#stage').scrollIntoViewIfNeeded();
    const bounds = await page.locator('#overlay').boundingBox();
    await page.mouse.move(bounds.x + 20, bounds.y + 20);
    await page.mouse.down(); await page.mouse.move(bounds.x + 90, bounds.y + 70); await page.mouse.up();
    const draft = await page.evaluate(() => structuredClone(window.lab.truth));
    assert.equal(draft.regions.length, 1);
    assert.equal(draft.reviewStatus, 'unreviewed');
    await page.click('#saveLabels');
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Etiketler kaydedildi'));
    await page.reload(); await page.waitForFunction(() => window.lab?.ready);
    assert.deepEqual(await page.evaluate(() => window.lab.truth), draft);
    if (dpr === 1) {
      let reportWrites = 0;
      await page.route('**/api/report', async route => { reportWrites++; await route.fulfill({ json: { saved: 'isolated-ui-fixture' } }); });
      await page.selectOption('#model', 'ppocrv5-mobile-det');
      const cancelled = await page.evaluate(async () => {
        const pending = window.lab.run(true);
        document.querySelector('#cancel').click();
        try { await pending; return false; } catch (error) { return error.name === 'AbortError'; }
      });
      assert.equal(cancelled, true); assert.equal(reportWrites, 0);
      assert.equal(await page.locator('#run').isEnabled(), true);
    }
    for (const width of [1000, 600]) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await page.evaluate(() => {
        const image = document.querySelector('#image').getBoundingClientRect();
        const svg = document.querySelector('#overlay').getBoundingClientRect();
        return { width: innerWidth, dpr: devicePixelRatio, delta: Math.max(...['x', 'y', 'width', 'height'].map(k => Math.abs(image[k] - svg[k]))) };
      });
      assert.ok(geometry.delta <= 1, 'Image/SVG drift after resize'); measurements.push(geometry);
    }
    await context.close();
  }
  await mkdir('reports', { recursive: true });
  const report = { browserVersion: browser.version(), measurements, labelDrawSaveReload: true, isolatedLabels: true, cancelDuringModelLoadRejectsResult: true,
    liveReaderSiteTested: false, qualityMeasured: false };
  await writeFile('reports/browser-ui-check.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
