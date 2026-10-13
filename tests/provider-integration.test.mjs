import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
function fixture() {
  const calls = [], stored = { openrouterApiKey: 'router-private-key', googleApiKeys: [{ id: 'g', key: 'google-private-key' }], activeGoogleApiKeyId: 'g' };
  const context = vm.createContext({
    chrome: { runtime: { onMessage: { addListener() {} } }, storage: { local: { get: async () => stored } } },
    setTimeout, clearTimeout, AbortController, TextEncoder, TextDecoder, crypto,
    getActiveApiKey: async () => 'google-private-key',
    fetch: async (url, options) => {
      calls.push({ url, ...options, body: JSON.parse(options.body) });
      return { ok: true, json: async () => url.includes('openrouter') ? { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] } :
        { candidates: [{ content: { parts: [{ thought: true, text: 'hidden' }, { text: 'OK' }] }, finishReason: 'STOP' }] } };
    }
  });
  return { context, calls };
}
const scripts = await Promise.all(['providers.js', 'page/queue.js', 'page-background.js'].map(file => readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')));

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
  context.mlProviderCall = async () => { attempts++; return JSON.stringify({ regions: [{ regionId, sourceText: 'Hi', translatedText: 'Merhaba', status: 'translated' }] }); };
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
test('all six router adapters preserve exact chosen model and keep Google credentials separate', async () => {
  const { context, calls } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  for (const [model] of context.MLProviders.catalog.openrouter) {
    const result = await context.mlProviderCall({ provider: 'openrouter', model }, 'Translate', [{ regionId: 'r', dataUrl: 'data:image/png;base64,AAAA' }]);
    assert.equal(result, 'OK');
    const request = calls.at(-1); assert.equal(request.body.model, model);
    assert.equal(request.headers.Authorization, 'Bearer router-private-key');
    assert.equal(request.headers['x-goog-api-key'], undefined); assert.ok(!JSON.stringify(request.body).includes('private-key'));
  }
  assert.equal(calls.length, 6);
});
test('all direct Google models use Google credentials; reasoning text never reaches translation', async () => {
  const { context, calls } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  for (const [model] of context.MLProviders.catalog.gemini) {
    assert.equal(await context.mlProviderCall({ provider: 'gemini', model }, 'Translate', [{ regionId: 'r', dataUrl: 'data:image/png;base64,AAAA' }]), 'OK');
    assert.ok(calls.at(-1).url.includes(model)); assert.equal(calls.at(-1).headers['x-goog-api-key'], 'google-private-key');
    assert.equal(calls.at(-1).headers.Authorization, undefined); assert.ok(!calls.at(-1).url.includes('private-key'));
  }
});

test('Qwen and DeepSeek disable default reasoning; mandatory Muse reasoning is untouched', async () => {
  const { context, calls } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  for (const [model] of context.MLProviders.catalog.openrouter) {
    await context.mlProviderCall({ provider: 'openrouter', model }, 'Return JSON', []);
    const body = calls.at(-1).body;
    assert.equal(body.provider.require_parameters, true);
    assert.equal(body.provider.allow_fallbacks, false);
    assert.equal(body.response_format.type, 'json_object');
    if (model.startsWith('qwen/') || model.startsWith('deepseek/')) assert.deepEqual(body.reasoning, { enabled: false });
    else assert.equal(body.reasoning, undefined);
  }
  assert.equal(calls.length, 6);
});

test('upstream thinking/JSON rejection is actionable and never retried or routed to another model', async () => {
  const { context, calls } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  context.fetch = async (url, options) => { calls.push({ url, options }); return { ok: false, status: 400,
    json: async () => ({ error: { message: 'Json mode response is not supported when enable_thinking is true' } }) }; };
  await assert.rejects(context.mlProviderCall({ provider: 'openrouter', model: 'qwen/qwen3.7-flash' }, '', []), e => e.code === 'MODEL_PARAMETER_REJECTED' && e.stopJob);
  assert.equal(calls.length, 1);
});

test('no matching JSON endpoint is distinguished from data policy and age restrictions', () => {
  const { context } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  const config = { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash' };
  assert.equal(context.mlAccessError(config, 404, 'No endpoints found that support all requested parameters').code, 'MODEL_ENDPOINT_UNAVAILABLE');
  assert.equal(context.mlAccessError(config, 404, 'No endpoints matching your data policy').code, 'PROVIDER_DATA_POLICY_BLOCK');
});

test('streamed upstream error preserves its explanation, redacts key and stops without a retry', async () => {
  const { context, calls } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  context.fetch = async (url, options) => { calls.push({ url, options }); return new Response(
    'data: '+JSON.stringify({ error: { code: 400, message: 'response_format thinking rejected router-private-key' } })+'\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } }); };
  await assert.rejects(context.mlProviderCall({ provider: 'openrouter', model: 'qwen/qwen3.8-flash', maxOutputTokens: 16384 }, '', []),
    e => e.code === 'MODEL_PARAMETER_REJECTED' && !e.message.includes('router-private-key'));
  assert.equal(calls.length, 1);
});

test('reasoning-only output hitting the token limit is not accepted as translation', async () => {
  const { context, calls } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  context.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true,
    json: async () => ({ choices: [{ message: { content: '', reasoning: '{"regions":[]}' }, finish_reason: 'length' }] }) }; };
  await assert.rejects(context.mlProviderCall({ provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash' }, '', []), e => e.code === 'PROVIDER_OUTPUT_TRUNCATED');
  assert.equal(calls.length, 1);
});

test('stream messages redact the complete credential before applying length limits', async () => {
  const { context } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  context.fetch = async () => new Response('data: '+JSON.stringify({error:{code:502,message:'x'.repeat(470)+'router-private-key'+'y'.repeat(1200)}})+'\n\n',
    {headers:{'Content-Type':'text/event-stream'}});
  await assert.rejects(context.mlProviderCall({provider:'openrouter',model:'qwen/qwen3.8-flash',maxOutputTokens:16384},'',[]),
    e=>e.message.includes('[anahtar]')&&!e.message.includes('router-')&&e.message.length<=1000);
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
  context.mlProviderCall = async () => { attempts++; return new Promise(resolve => { release = resolve; }); };
  context.incrementTranslationStats = async () => {};
  const imageId = 'a'.repeat(64), regionId = `${imageId}:r1`;
  const config = context.MLProviders.settings({ translationProvider: 'openrouter', openrouterModel: 'qwen/qwen3.8-flash' });
  const message = { config, imageId, regions: [{ regionId, crop: 'data:image/png;base64,AAAA' }] };
  const first = context.mlTranslate(message);
  for (let i = 0; i < 100 && !release; i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(release, 'Provider operation must have started');
  const resumed = context.mlTranslate(message);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(attempts, 1);
  release(JSON.stringify({ regions: [{ regionId, sourceText: 'Hello', translatedText: 'Merhaba', status: 'translated' }] }));
  assert.equal((await first).regions[0].translatedText, 'Merhaba');
  assert.equal((await resumed).regions[0].translatedText, 'Merhaba');
  assert.equal((await context.mlTranslate(message)).cached, true); assert.equal(attempts, 1);
});
