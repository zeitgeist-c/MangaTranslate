import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
function fixture() {
  const calls = [], stored = { openrouterApiKey: 'router-private-key', googleApiKeys: [{ id: 'g', key: 'google-private-key' }], activeGoogleApiKeyId: 'g' };
  const context = vm.createContext({
    chrome: { runtime: { onMessage: { addListener() {} } }, storage: { local: { get: async () => stored } } },
    setTimeout, clearTimeout, AbortController, TextEncoder, crypto,
    getActiveApiKey: async () => 'google-private-key',
    fetch: async (url, options) => {
      calls.push({ url, ...options, body: JSON.parse(options.body) });
      return { ok: true, json: async () => url.includes('openrouter') ? { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] } :
        { candidates: [{ content: { parts: [{ thought: true, text: 'hidden' }, { text: 'OK' }] }, finishReason: 'STOP' }] } };
    }
  });
  return { context, calls };
}
const scripts = await Promise.all(['providers.js', 'page-background.js'].map(file => readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')));

test('age confirmation refusal has a Turkish actionable job-blocking error, without model fallback', async () => {
  const { context, calls } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  context.fetch = async (url, options) => { calls.push({ url, options }); return { ok: false, status: 403,
    json: async () => ({ error: { message: 'This model requires you to complete the following before use: 18+ age confirmation. Confirm at https://openrouter.ai/settings/preferences.' } }) }; };
  await assert.rejects(context.mlProviderCall({ provider: 'openrouter', model: 'meta/muse-spark-1.3-contributor' }, '', []), error =>
    error.code === 'AGE_CONFIRMATION_REQUIRED' && error.stopJob === true && error.message.includes('yaş onayı') && error.actionUrl === 'https://openrouter.ai/settings/preferences');
  assert.equal(calls.length, 1);
});

test('account authentication and credit errors block the job; content moderation does not', async () => {
  const { context } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  for (const [status, message, expected] of [[401, 'Invalid key', 'PROVIDER_AUTH_REQUIRED'], [402, 'Insufficient credits', 'PROVIDER_CREDIT_REQUIRED'], [403, 'Input flagged by moderation', undefined]]) {
    context.fetch = async () => ({ ok: false, status, json: async () => ({ error: { message } }) });
    await assert.rejects(context.mlProviderCall({ provider: 'openrouter', model: 'qwen/qwen3.8-flash' }, '', []), error => error.code === expected && Boolean(error.stopJob) === Boolean(expected));
  }
});

test('legacy cached age refusal is actionable without a call; explicit retry can recover', async () => {
  const { context } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  let value = { status: 'uncertain', error: 'openrouter/test: HTTP 403 — 18+ age confirmation. Confirm at https://openrouter.ai/settings/preferences.' }, attempts = 0;
  context.mlOffscreen = async (command, payload) => command === 'read' ? value : (value = payload.value);
  const imageId = 'b'.repeat(64), regionId = `${imageId}:r1`;
  context.enqueueWithRateLimit = async () => { attempts++; return JSON.stringify({ regions: [{ regionId, sourceText: 'Hi', translatedText: 'Merhaba', status: 'translated' }] }); };
  context.incrementTranslationStats = async () => {};
  const message = { config: context.MLProviders.settings({ translationProvider: 'openrouter' }), imageId, regions: [{ regionId, crop: 'data:image/png;base64,AAAA' }] };
  await assert.rejects(context.mlTranslate(message), error => error.code === 'AGE_CONFIRMATION_REQUIRED'); assert.equal(attempts, 0);
  assert.equal((await context.mlTranslate({ ...message, retry: true })).status, 'done'); assert.equal(attempts, 1);
});

test('a saved 3.5.1 job with age refusal restores as blocked while keeping page results', () => {
  const { context } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  const job = { config: { provider: 'openrouter', model: 'meta/muse-spark-1.3-contributor' }, state: 'finished', pages: [
    { state: 'review', translated: 2 }, { state: 'error', error: 'HTTP 403 — 18+ age confirmation.' }, { state: 'queued' }
  ] };
  const restored = context.mlRestoreJob(job);
  assert.equal(restored.state, 'blocked'); assert.equal(restored.blocked.code, 'AGE_CONFIRMATION_REQUIRED');
  assert.equal(restored.pages[0].translated, 2); assert.equal(restored.pages[2].state, 'queued');
});
test('all eight router adapters preserve exact chosen model and keep Google credentials separate', async () => {
  const { context, calls } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  for (const [model] of context.MLProviders.catalog.openrouter) {
    const result = await context.mlProviderCall({ provider: 'openrouter', model }, 'Translate', [{ regionId: 'r', dataUrl: 'data:image/png;base64,AAAA' }]);
    assert.equal(result, 'OK');
    const request = calls.at(-1); assert.equal(request.body.model, model);
    assert.equal(request.headers.Authorization, 'Bearer router-private-key');
    assert.equal(request.headers['x-goog-api-key'], undefined); assert.ok(!JSON.stringify(request.body).includes('private-key'));
  }
  assert.equal(calls.length, 8);
});
test('all direct Google models use Google credentials; reasoning text never reaches translation', async () => {
  const { context, calls } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  for (const [model] of context.MLProviders.catalog.gemini) {
    assert.equal(await context.mlProviderCall({ provider: 'gemini', model }, 'Translate', [{ regionId: 'r', dataUrl: 'data:image/png;base64,AAAA' }]), 'OK');
    assert.ok(calls.at(-1).url.includes(model)); assert.equal(calls.at(-1).headers['x-goog-api-key'], 'google-private-key');
    assert.equal(calls.at(-1).headers.Authorization, undefined); assert.ok(!calls.at(-1).url.includes('private-key'));
  }
});
test('provider error never invokes another model and redacts echoed credentials', async () => {
  const { context, calls } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  context.fetch = async (url, options) => { calls.push({ url, options }); return { ok: false, status: 401, json: async () => ({ error: { message: 'router-private-key invalid' } }) }; };
  await assert.rejects(context.mlProviderCall({ provider: 'openrouter', model: 'qwen/qwen3.8-flash' }, '', []), error => error.message.includes('401') && !error.message.includes('router-private-key'));
  assert.equal(calls.length, 1);
});
test('strict translation jobs never automatically retry potentially billed failures', async () => {
  const { context } = fixture();
  context.chrome.runtime.onInstalled = context.chrome.runtime.onStartup = { addListener() {} };
  context.chrome.alarms = { onAlarm: { addListener() {} } };
  context.chrome.storage.session = { get: async () => ({}), set: async () => {} };
  context.console = { warn() {} };
  vm.runInContext(await readFile(new URL('../src/background.js', import.meta.url), 'utf8'), context);
  let attempts = 0;
  await assert.rejects(context.enqueueWithRateLimit(async () => { attempts++; throw new Error('429 timeout'); }, { retry: false }), /429/);
  assert.equal(attempts, 1);
  assert.equal(vm.runInContext('requestQueue.length', context), 0);
});

test('resuming while a provider reply is pending reuses the same operation and caches its result', async () => {
  const { context } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  const cache = new Map(); let release, attempts = 0;
  context.mlOffscreen = async (command, payload) => command === 'read' ? cache.get(payload.key) : cache.set(payload.key, payload.value);
  context.enqueueWithRateLimit = async () => { attempts++; return new Promise(resolve => { release = resolve; }); };
  context.incrementTranslationStats = async () => {};
  const imageId = 'a'.repeat(64), regionId = `${imageId}:r1`;
  const config = context.MLProviders.settings({ translationProvider: 'openrouter', openrouterModel: 'qwen/qwen3.8-flash' });
  const message = { config, imageId, regions: [{ regionId, crop: 'data:image/png;base64,AAAA' }] };
  const first = context.mlTranslate(message);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const resumed = context.mlTranslate(message);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(attempts, 1);
  release(JSON.stringify({ regions: [{ regionId, sourceText: 'Hello', translatedText: 'Merhaba', status: 'translated' }] }));
  assert.equal((await first).regions[0].translatedText, 'Merhaba');
  assert.equal((await resumed).regions[0].translatedText, 'Merhaba');
  assert.equal((await context.mlTranslate(message)).cached, true); assert.equal(attempts, 1);
});
