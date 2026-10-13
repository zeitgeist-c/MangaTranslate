import { chromium } from 'playwright-core';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { startServer } from '../server.mjs';
const server = await startServer(0);
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.BRAVE_EXECUTABLE, headless: true });
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.lab?.ready);
  const entries = [];
  for (const dir of await readdir('.local')) {
    if (!/^chapter-\d+$/.test(dir)) continue;
    const manifest = JSON.parse(await readFile(`.local/${dir}/manifest.json`, 'utf8'));
    const sourceGroup = new URL(manifest.source).pathname.split('/chapter/')[0];
    for (const p of manifest.pages) {
      p.sourceGroup = sourceGroup;
      const shape = await page.evaluate(async path => { const img = new Image(); img.src = path; await img.decode(); return { width: img.naturalWidth, height: img.naturalHeight }; }, `/.local/${dir}/${p.file}`);
      entries.push({ chapter: dir, file: p.file, imageId: p.imageId, source: p.url, sourceGroup, ...shape, reviewStatus: 'unreviewed' });
    }
    await writeFile(`.local/${dir}/manifest.json`, JSON.stringify(manifest, null, 2));
  }
  const selection = [];
  for (const [chapter, split, limit] of [['chapter-174', 'development', 10], ['chapter-21', 'acceptance', 10], ['chapter-8', 'acceptance', 10], ['chapter-12', 'stress', 5]]) {
    const candidates = entries.filter(e => e.chapter === chapter && e.height > e.width && e.width >= 600);
    // Selection is a proposed queue. Humans must reject banners/credits and ensure coverage.
    for (const entry of candidates.slice(0, limit)) selection.push({ ...entry, split });
  }
  const report = { date: new Date().toISOString(), images: entries.length, sourceGroups: new Set(entries.map(e => e.sourceGroup)).size,
    queue: selection, inventory: entries, humanReviewedRegions: 0, acceptancePassed: false,
    note: 'Proposed source-group-separated review queue. Dimensions do not prove representative content; no labels or quality acceptance inferred.' };
  await writeFile('dataset-review-queue.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ images: report.images, sourceGroups: report.sourceGroups, reviewQueue: selection.length, humanReviewedRegions: 0 }));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
