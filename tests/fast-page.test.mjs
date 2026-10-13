import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { groupTextLines, cardLayout } from '../src/page/layout.mjs';
const report = boxes => ({ imageId: 'image', regions: boxes.map(textBox => ({ textBox, score: .9 })) });
test('fast grouping joins words and dialogue lines but keeps columns and separated captions apart', () => {
  const result = groupTextLines(report([[10, 10, 70, 30], [80, 10, 140, 30], [20, 45, 130, 65], [220, 10, 300, 30], [220, 45, 300, 65], [10, 140, 140, 160]]));
  assert.equal(result.length, 3); assert.deepEqual(result[0].textBox, [10, 10, 140, 65]); assert.deepEqual(result[1].textBox, [220, 10, 300, 65]);
  assert.ok(result.every(r => !r.needsReview && r.kind === 'text_free'));
});
test('tiny and clipped text remains reviewable, nested observations do not duplicate a card', () => {
  const result = groupTextLines({ imageId: 'x', regions: [{ textBox: [20, 20, 100, 45], score: .9 }, { textBox: [25, 25, 60, 40], score: .8 }, { textBox: [10, 150, 18, 156], score: .9 }, { textBox: [100, 240, 180, 265], score: .9, reason: 'tile_boundary' }] });
  assert.equal(result.length, 3); assert.equal(result.filter(r => r.needsReview).length, 2);
});
test('cards fit Turkish text inside source bounds without shrinking below the readable minimum', () => {
  const ctx = { measureText: text => ({ width: text.length * 7 }) };
  const fit = cardLayout(ctx, 'NEDEN VIKIR? NASIL?', [250, 140, 320, 190], 340, 220, 12);
  assert.ok(fit && fit.size >= 12); assert.ok(fit.box[0] >= 0 && fit.box[1] >= 0 && fit.box[2] <= 340 && fit.box[3] <= 220);
  assert.equal(cardLayout(ctx, 'x'.repeat(1000), [0, 0, 50, 20], 100, 50, 12), null);
});
test('old standard setting moves to the fast path; detailed mode is explicit and jobs use a new processing version', async () => {
  const context = vm.createContext({}); vm.runInContext(await readFile(new URL('../src/providers.js', import.meta.url), 'utf8'), context);
  assert.equal(context.MLProviders.settings({ localDetector: 'standard' }).localDetector, 'fast');
  assert.equal(context.MLProviders.settings({ localDetector: 'detailed' }).localDetector, 'detailed');
  assert.equal(context.MLProviders.settings({}).processingVersion, 'page-v6');
});
test('router queue starts concurrently without Google delay and keeps Google pacing intact', async () => {
  let googleCalls = 0;
  const context = vm.createContext({ chrome: { runtime: { onMessage: { addListener() {} } } }, enqueueWithRateLimit: async fn => { googleCalls++; return fn(); } });
  vm.runInContext(await readFile(new URL('../src/providers.js', import.meta.url), 'utf8'), context);
  vm.runInContext(await readFile(new URL('../src/page/queue.js', import.meta.url), 'utf8'), context);
  vm.runInContext(await readFile(new URL('../src/page-background.js', import.meta.url), 'utf8'), context);
  let active=0, peak=0; const releases=[];
  const operations = Array.from({length:4}, () => context.mlEnqueue({provider:'openrouter'},async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>releases.push(r));active--;}));
  for(let i=0;i<15;i++)await Promise.resolve();assert.equal(peak,4);releases.forEach(r=>r());await Promise.all(operations);
  await context.mlEnqueue({provider:'gemini'},async()=>{});assert.equal(googleCalls,1);
});

test('data-policy 404 and quota 429 stop the job; unrelated 404 is not misclassified', async () => {
  const context = vm.createContext({ chrome: { runtime: { onMessage: { addListener() {} } } } });
  vm.runInContext(await readFile(new URL('../src/page/queue.js', import.meta.url), 'utf8'), context);
  vm.runInContext(await readFile(new URL('../src/page-background.js', import.meta.url), 'utf8'), context);
  const config = { provider: 'openrouter', model: 'meta/muse-spark-1.3-contributor' };
  assert.equal(context.mlAccessError(config, 404, 'Paid model training violation (account settings)').code, 'PROVIDER_DATA_POLICY_BLOCK');
  assert.equal(context.mlAccessError(config, 429, 'Rate limit').stopJob, true);
  assert.equal(context.mlAccessError(config, 404, 'Model does not exist'), null);
});
