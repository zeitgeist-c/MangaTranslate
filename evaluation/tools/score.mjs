import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { scorePage, summarize } from '../lib/metrics.mjs';
const modelId = process.argv[2] ?? 'rtdetr-int8';
const backend = process.argv[3] ?? 'wasm';
if (!['wasm', 'webgpu'].includes(backend)) throw new Error('Unknown backend');
if (!['rtdetr-int8', 'rtdetr-fp32', 'rtdetr-v4-small'].includes(modelId)) throw new Error('Unknown model');
const queue = JSON.parse(await readFile(resolve('dataset-review-queue.json'), 'utf8')).queue;
const queued = new Map(queue.map(page => [page.imageId, page]));
const pages = [], skipped = [];
for (const file of await readdir(resolve('.local/labels')).catch(() => [])) {
  if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
  const label = JSON.parse(await readFile(resolve('.local/labels', file), 'utf8'));
  const entry = queued.get(label.imageId);
  if (!entry) { skipped.push({ imageId: label.imageId, reason: 'not_in_frozen_review_queue' }); continue; }
  if (label.reviewStatus !== 'human-reviewed') { skipped.push({ imageId: label.imageId, reason: 'unreviewed' }); continue; }
  let prediction;
  try { prediction = JSON.parse(await readFile(resolve('reports', `${label.imageId}-${modelId}-${backend}.json`), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; skipped.push({ imageId: label.imageId, reason: 'missing_prediction' }); continue; }
  if (label.width !== entry.width || label.height !== entry.height) throw new Error('Label dimensions do not match frozen queue');
  pages.push({ imageId: label.imageId, split: entry.split, sourceGroup: entry.sourceGroup,
    humanReviewedRegions: label.regions.filter(r => r.inScope !== false).length, ...scorePage(prediction, label) });
}
const perSplit = Object.fromEntries(['development', 'acceptance', 'stress'].map(split => [split, summarize(pages.filter(p => p.split === split))]));
const groups = new Map(); let leakage = false;
for (const page of queue) { if (groups.has(page.sourceGroup) && groups.get(page.sourceGroup) !== page.split) leakage = true; groups.set(page.sourceGroup, page.split); }
const reviewedRegions = pages.reduce((sum, page) => sum + page.humanReviewedRegions, 0);
const datasetGatePassed = !leakage && pages.length === queue.length && queue.length >= 35 && reviewedRegions >= 200 &&
  perSplit.development.pages >= 10 && perSplit.acceptance.pages >= 20 && perSplit.stress.pages >= 5;
const detectionAcceptancePassed = datasetGatePassed && perSplit.acceptance.qualityTargetMet === true && perSplit.stress.qualityTargetMet === true;
const report = { modelId, backend, summary: summarize(pages), perSplit, pages, skipped, reviewedRegions, leakage,
  datasetGatePassed, detectionAcceptancePassed, acceptancePassed: false,
  remainingProductGates: 'Human representativeness review, shape/rendering and live-reader lifecycle acceptance remain separate. Detection acceptance alone is not product acceptance.' };
await mkdir(resolve('reports'), { recursive: true });
await writeFile(resolve('reports', `score-${modelId}-${backend}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
