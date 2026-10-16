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
test('all five router adapters preserve exact chosen model and keep Google credentials separate', async () => {
  const { context, calls } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  for (const [model] of context.MLProviders.catalog.openrouter) {
    const result = await context.mlProviderCall({ provider: 'openrouter', model }, 'Translate', [{ regionId: 'r', dataUrl: 'data:image/png;base64,AAAA' }]);
    assert.equal(result, 'OK');
    const request = calls.at(-1); assert.equal(request.body.model, model);
    assert.equal(request.headers.Authorization, 'Bearer router-private-key');
    assert.equal(request.headers['x-goog-api-key'], undefined); assert.ok(!JSON.stringify(request.body).includes('private-key'));
  }
  assert.equal(calls.length, context.MLProviders.catalog.openrouter.length);
});
test('gemini single key is paced to 12 sends per minute window', async () => {
  const { context } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  vm.runInContext('mlGeminiGapMs = 5', context);
  const gemini = { provider: 'gemini', model: 'gemini-3.5-flash-lite' };
  for (let i = 0; i < 12; i++) assert.equal(await context.mlProviderCall(gemini, 'Hi', []), 'OK');
  await assert.rejects(context.mlProviderCall(gemini, 'Hi', []),
    e => e.code === 'GEMINI_BUDGET_EXHAUSTED' && e.retryAt > Date.now() && e.notSent === true && e.stopJob === true);
});
test('gemini keys rotate every request with 5 in flight each', async () => {
  const { context, calls } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  vm.runInContext('mlGeminiGapMs = 5', context);
  context.MLKeys = { active: async () => 'AAA', all: async () => [{ id: 'k1', key: 'AAA' }, { id: 'k2', key: 'BBB' }] };
  const gemini = { provider: 'gemini', model: 'gemini-3.5-flash-lite' };
  for (let i = 0; i < 4; i++) await context.mlProviderCall(gemini, 'Hi', [], undefined, 'job1');
  assert.deepEqual(calls.map(c => c.headers['x-goog-api-key']), ['AAA', 'BBB', 'AAA', 'BBB']);
  for (let i = 0; i < 20; i++) await context.mlProviderCall(gemini, 'Hi', [], undefined, 'job1');
  assert.equal(calls.length, 24);
  await assert.rejects(context.mlProviderCall(gemini, 'Hi', [], undefined, 'job1'), e => e.code === 'GEMINI_BUDGET_EXHAUSTED');
});
test('openrouter rotates keys every request and wraps', async () => {
  const { context, calls } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  context.MLKeys = { active: async () => 'A', all: async () => [{ id: 'a', key: 'A' }, { id: 'b', key: 'B' }] };
  const config = { provider: 'openrouter', model: 'qwen/qwen3.8-flash' };
  for (let i = 0; i < 5; i++) await context.mlProviderCall(config, 'Hi', [], undefined, 'jobA');
  assert.deepEqual(calls.map(c => c.headers.Authorization), ['Bearer A', 'Bearer B', 'Bearer A', 'Bearer B', 'Bearer A']);
});
test('a 429 key is skipped within the same job', async () => {
  const { context, calls } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  vm.runInContext('mlRetryTuning = {delays:[1,1],maxWait:5}; mlGeminiGapMs = 5;', context);
  context.MLKeys = { active: async () => 'A', all: async () => [{ id: 'a', key: 'A' }, { id: 'b', key: 'B' }] };
  context.fetch = async (url, options) => {
    calls.push({ url, options });
    if (options.headers.Authorization.includes('A'))
      return { ok: false, status: 429, json: async () => ({ error: { message: 'rate limited', metadata: { provider_name: 'Upstream' } } }) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }) };
  };
  assert.equal(await context.mlProviderCall({ provider: 'openrouter', model: 'qwen/qwen3.7-flash' }, 'Hi', [], undefined, 'jobB'), 'OK');
  assert.deepEqual(calls.map(c => c.options.headers.Authorization), ['Bearer A', 'Bearer B']);
  assert.equal(await context.mlProviderCall({ provider: 'openrouter', model: 'qwen/qwen3.8-flash' }, 'Hi', [], undefined, 'jobB'), 'OK');
  assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer B');
  assert.equal(calls.length, 3);
});
test('each page job restarts key rotation from the active key', async () => {
  const { context } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  context.MLKeys = { active: async () => 'A', all: async () => [{ id: 'a', key: 'A' }, { id: 'b', key: 'B' }] };
  assert.equal((await context.mlPickOpenrouterKey('jobC')).key, 'A');
  assert.equal((await context.mlPickOpenrouterKey('jobC')).key, 'B');
  context.mlBatchReset('openrouter', 'jobC');
  assert.equal((await context.mlPickOpenrouterKey('jobC')).key, 'A');
});
test('gemini budget frees slots older than one minute', async () => {
  const { context } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  vm.runInContext('mlGeminiGapMs = 5', context);
  vm.runInContext(`mlGeminiBudget.set('google-private-key', Array(12).fill(${Date.now() - 61000}))`, context);
  assert.equal(await context.mlProviderCall({ provider: 'gemini', model: 'gemini-3.5-flash-lite' }, 'Hi', []), 'OK');
});
test('explicit key override skips gemini budget accounting', async () => {
  const { context } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  vm.runInContext('mlGeminiGapMs = 5', context);
  const gemini = { provider: 'gemini', model: 'gemini-3.5-flash-lite' };
  for (let i = 0; i < 13; i++) assert.equal(await context.mlProviderCall(gemini, 'Hi', [], 'override-key'), 'OK');
});
test('all direct Google models use Google credentials; reasoning text never reaches translation', async () => {
  const { context, calls } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  for (const [model] of context.MLProviders.catalog.gemini) {
    assert.equal(await context.mlProviderCall({ provider: 'gemini', model }, 'Translate', [{ regionId: 'r', dataUrl: 'data:image/png;base64,AAAA' }]), 'OK');
    assert.ok(calls.at(-1).url.includes(model)); assert.equal(calls.at(-1).headers['x-goog-api-key'], 'google-private-key');
    assert.equal(calls.at(-1).headers.Authorization, undefined); assert.ok(!calls.at(-1).url.includes('private-key'));
  }
});

test('Qwen disables default reasoning; mandatory Muse reasoning is untouched', async () => {
  const { context, calls } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  for (const [model] of context.MLProviders.catalog.openrouter) {
    await context.mlProviderCall({ provider: 'openrouter', model }, 'Return JSON', []);
    const body = calls.at(-1).body;
    assert.equal(body.provider.require_parameters, true);
    assert.equal(body.provider.allow_fallbacks, false);
    assert.equal(body.response_format.type, 'json_object');
    if (model.startsWith('qwen/')) assert.deepEqual(body.reasoning, { enabled: false });
    else assert.equal(body.reasoning, undefined);
  }
  assert.equal(calls.length, context.MLProviders.catalog.openrouter.length);
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
  const config = { provider: 'openrouter', model: 'qwen/qwen3.8-flash' };
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
  await assert.rejects(context.mlProviderCall({ provider: 'openrouter', model: 'qwen/qwen3.8-flash' }, '', []), e => e.code === 'PROVIDER_OUTPUT_TRUNCATED');
  assert.equal(calls.length, 1);
});

test('stream messages redact the complete credential before applying length limits', async () => {
  const { context } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  vm.runInContext('mlRetryTuning = {delays:[1,1],maxWait:5}', context);
  let calls = 0;
  context.fetch = async () => { calls++; return new Response('data: '+JSON.stringify({error:{code:502,message:'x'.repeat(470)+'router-private-key'+'y'.repeat(1200)}})+'\n\n',
    {headers:{'Content-Type':'text/event-stream'}}); };
  await assert.rejects(context.mlProviderCall({provider:'openrouter',model:'qwen/qwen3.8-flash',maxOutputTokens:16384},'',[]),
    e=>e.message.includes('[anahtar]')&&!e.message.includes('router-')&&e.message.length<=1012); // 1000 cap + ' (3 deneme)' suffix
  assert.equal(calls, 3);
});
test('overload halves model lane concurrency like quota failures',async()=>{
  const f=fixture(); scripts.forEach(source => vm.runInContext(source, f.context));
  f.context.chrome.storage.local.set = async () => {};
  await assert.rejects(f.context.mlEnqueue({provider:'openrouter',model:'qwen/qwen3.8-flash'},
    async()=>{ throw Object.assign(new Error('overload'),{stopJob:true,code:'PROVIDER_OVERLOADED'}); },'owner'),/overload/);
  assert.equal(vm.runInContext('mlRouterQueue.limit',f.context),2);
});
test('transient provider overload is retried then served',async()=>{
  const { context } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  vm.runInContext('mlRetryTuning = {delays:[1,1],maxWait:5}; mlGeminiGapMs = 5;', context);
  let calls = 0;
  context.fetch = async () => (++calls < 3)
    ? { ok: false, status: 503, json: async () => ({ error: { message: 'high demand' } }) }
    : { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] }) };
  assert.equal(await context.mlProviderCall({ provider: 'gemini', model: 'gemini-3.5-flash-lite' }, 'Hi', []), 'OK');
  assert.equal(calls, 3);
});
test('persistent overload chains through all gemini models then stops with a countdown',async()=>{
  const { context } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  vm.runInContext('mlRetryTuning = {delays:[1,1],maxWait:5}; mlGeminiGapMs = 5;', context);
  let calls = 0;
  context.fetch = async () => { calls++; return { ok: false, status: 503, json: async () => ({ error: { message: 'high demand' } }) }; };
  await assert.rejects(context.mlProviderCall({ provider: 'gemini', model: 'gemini-3.5-flash-lite' }, 'Hi', []),
    e => e.code === 'PROVIDER_OVERLOADED' && e.retryAt > Date.now() && e.message.includes('3 deneme'));
  assert.equal(calls, 9);
});
test('unavailable statuses map distinctly; refusals never retry',async()=>{
  const { context } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  vm.runInContext('mlRetryTuning = {delays:[1,1],maxWait:5}; mlGeminiGapMs = 5;', context);
  let calls = 0;
  context.fetch = async () => { calls++; return { ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) }; };
  await assert.rejects(context.mlProviderCall({ provider: 'gemini', model: 'gemini-3.5-flash-lite' }, 'Hi', []), e => e.code === 'PROVIDER_UNAVAILABLE');
  assert.equal(calls, 3);
  context.fetch = async () => { calls++; return { ok: false, status: 400, json: async () => ({ error: { message: 'bad request' } }) }; };
  await assert.rejects(context.mlProviderCall({ provider: 'gemini', model: 'gemini-3.5-flash-lite' }, 'Hi', []));
  assert.equal(calls, 4);
});
test('opt-in chains other retryable gemini failures; without it the job stops',async()=>{
  const mk = () => { const { context, calls } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
    vm.runInContext('mlRetryTuning = {delays:[1,1],maxWait:5}; mlGeminiGapMs = 5;', context); return { context, calls }; };
  const failing = (url, options, calls) => { calls.push({ url, options });
    if (url.includes('gemini-3.5-flash-lite')) return { ok: false, status: 500, json: async () => ({ error: { message: 'backend error' } }) };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] }) }; };
  { const { context, calls } = mk();
    context.fetch = async (url, options) => failing(url, options, calls);
    assert.equal(await context.mlProviderCall({ provider: 'gemini', model: 'gemini-3.5-flash-lite', geminiFallback: true }, 'Hi', []), 'OK');
    assert.equal(calls.length, 4); assert.ok(calls.at(-1).url.includes('gemini-3.1-flash-lite')); }
  { const { context, calls } = mk();
    context.fetch = async (url, options) => failing(url, options, calls);
    await assert.rejects(context.mlProviderCall({ provider: 'gemini', model: 'gemini-3.5-flash-lite' }, 'Hi', []),
      e => e.code === 'PROVIDER_UNAVAILABLE');
    assert.equal(calls.length, 3); }
});
test('full keys are skipped and freed slots are preferred',async()=>{
  const { context } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  context.MLKeys = { active: async () => 'A', all: async () => [{ id: 'a', key: 'A' }, { id: 'b', key: 'B' }] };
  const held = [];
  for (let i = 0; i < 10; i++) held.push(await context.mlPickOpenrouterKey('jobW'));
  assert.deepEqual(held.map(h => h.key), ['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B']);
  held.filter(h => h.key === 'B').forEach(h => h.release());
  assert.equal((await context.mlPickOpenrouterKey('jobW')).key, 'B');
});
test('503 chains to the next gemini model automatically within one call',async()=>{
  const { context, calls } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  vm.runInContext('mlRetryTuning = {delays:[1,1],maxWait:5}; mlGeminiGapMs = 5;', context);
  context.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('gemini-3.5-flash-lite')) return { ok: false, status: 503, json: async () => ({ error: { message: 'high demand' } }) };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] }) };
  };
  assert.equal(await context.mlProviderCall({ provider: 'gemini', model: 'gemini-3.5-flash-lite' }, 'Hi', []), 'OK');
  assert.equal(calls.length, 4);
  assert.ok(calls.at(-1).url.includes('gemini-3.1-flash-lite'));
});
test('gemma requests disable thinking and omit the JSON mime type',async()=>{
  const { context, calls } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  vm.runInContext('mlGeminiGapMs = 5', context);
  assert.equal(await context.mlProviderCall({ provider: 'gemini', model: 'gemma-4-26b-a4b-it' }, 'Hi', [], undefined, 'gemma'), 'OK');
  const body = calls.at(-1).body;
  assert.equal(body.generationConfig.responseMimeType, undefined);
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
  assert.ok(calls.at(-1).url.includes('gemma-4-26b-a4b-it'));
});
test('ollama sends native chat bodies and reads message content',async()=>{
  const { context, calls } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  context.MLKeys = { active: async () => 'O', all: async () => [{ id: 'o1', key: 'O' }] };
  context.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    assert.equal(url, 'https://ollama.com/api/chat');
    assert.equal(options.headers.Authorization, 'Bearer O');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'nemotron-3-nano:30b'); assert.equal(body.stream, false); assert.equal(body.format, 'json');
    assert.deepEqual(body.messages[0].images, ['AAAA']);
    assert.ok(body.messages[0].content.includes('regionId=r'));
    return { ok: true, json: async () => ({ message: { content: 'OK' }, done_reason: 'stop' }) };
  };
  assert.equal(await context.mlProviderCall({ provider: 'ollama', model: 'nemotron-3-nano:30b' }, 'Hi', [{ regionId: 'r', dataUrl: 'data:image/png;base64,AAAA' }]), 'OK');
  assert.equal((await context.mlCapabilities({ provider: 'ollama', model: 'nemotron-3-nano:30b' })).maxRegions, 12);
});
test('ollama keys rotate and a 429 key is skipped',async()=>{
  const { context, calls } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  vm.runInContext('mlRetryTuning = {delays:[1,1],maxWait:5}; mlGeminiGapMs = 5;', context);
  context.MLKeys = { active: async () => 'A', all: async () => [{ id: 'a', key: 'A' }, { id: 'b', key: 'B' }] };
  const config = { provider: 'ollama', model: 'nemotron-3-nano:30b' };
  context.fetch = async (url, options) => { calls.push({ url, options });
    return { ok: true, json: async () => ({ message: { content: 'OK' }, done_reason: 'stop' }) }; };
  for (let i = 0; i < 4; i++) await context.mlProviderCall(config, 'Hi', [], undefined, 'jobO');
  assert.deepEqual(calls.map(c => c.options.headers.Authorization), ['Bearer A', 'Bearer B', 'Bearer A', 'Bearer B']);
  context.fetch = async (url, options) => { calls.push({ url, options });
    if (options.headers.Authorization.includes('A'))
      return { ok: false, status: 429, json: async () => ({ error: { message: 'too many', metadata: { provider_name: 'Ollama' } } }) };
    return { ok: true, json: async () => ({ message: { content: 'OK' }, done_reason: 'stop' }) }; };
  assert.equal(await context.mlProviderCall({ provider: 'ollama', model: 'gemma4:31b' }, 'Hi', [], undefined, 'jobO'), 'OK');
  assert.deepEqual(calls.slice(-2).map(c => c.options.headers.Authorization), ['Bearer A', 'Bearer B']);
});
test('gemini overload halves parallel lanes until the cut expires',async()=>{
  const { context } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  vm.runInContext('mlRetryTuning = {delays:[1,1],maxWait:5}; mlGeminiGapMs = 5;', context);
  context.MLKeys = { active: async () => 'A', all: async () => ['A', 'B', 'C', 'D'].map((key, i) => ({ id: 'k' + i, key })) };
  let calls = 0;
  context.fetch = async () => (++calls === 1)
    ? { ok: false, status: 503, json: async () => ({ error: { message: 'high demand' } }) }
    : { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] }) };
  assert.equal(await context.mlProviderCall({ provider: 'gemini', model: 'gemini-3.5-flash-lite' }, 'Hi', []), 'OK');
  assert.equal(vm.runInContext('mlGeminiLanes', context), 2);
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
test('same-key gemini sends serialize while different keys overlap', async () => {
  const { context } = fixture(); scripts.forEach(source => vm.runInContext(source, context));
  const order = [];
  const same1 = context.mlWithGeminiKeySlot('k1', 40, async () => { order.push('a-start'); await new Promise(r => setTimeout(r, 10)); order.push('a-end'); return 'a'; });
  const same2 = context.mlWithGeminiKeySlot('k1', 40, async () => { order.push('b'); return 'b'; });
  const other = context.mlWithGeminiKeySlot('k2', 40, async () => { order.push('c'); return 'c'; });
  assert.deepEqual(await Promise.all([same1, same2, other]), ['a', 'b', 'c']);
  assert.ok(order.indexOf('a-end') < order.indexOf('b'), 'same key must serialize');
  assert.equal(order.length, 4);
});
test('gemini queue stays serial by default and overlaps across lanes', async () => {
  const background = await readFile(new URL('../src/background.js', import.meta.url), 'utf8');
  const mk = async () => {
    const { context } = fixture();
    context.chrome.runtime.onInstalled = context.chrome.runtime.onStartup = { addListener() {} };
    context.chrome.alarms = { onAlarm: { addListener() {} } };
    context.chrome.storage.session = { get: async () => ({}), set: async () => {} };
    context.console = { warn() {} };
    vm.runInContext(background, context); return context;
  };
  const flush = async () => { for (let i = 0; i < 50; i++) await new Promise(r => setImmediate(r)); };
  const hold = releases => label => () => new Promise(r => releases.push(() => r(label)));
  { const context = await mk(), releases = [];
    const p1 = context.enqueueWithRateLimit(hold(releases)('one'), { retry: false });
    const p2 = context.enqueueWithRateLimit(hold(releases)('two'), { retry: false });
    await flush(); assert.equal(releases.length, 1);
    releases[0](); assert.equal(await p1, 'one'); await flush(); assert.equal(releases.length, 2);
    releases[1](); assert.equal(await p2, 'two'); }
  { const context = await mk();
    vm.runInContext('mlGeminiLanes = 2', context);
    const releases = [];
    const p1 = context.enqueueWithRateLimit(hold(releases)('one'), { retry: false });
    const p2 = context.enqueueWithRateLimit(hold(releases)('two'), { retry: false });
    await flush(); assert.equal(releases.length, 2);
    releases[0](); releases[1](); assert.deepEqual(await Promise.all([p1, p2]), ['one', 'two']); }
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
