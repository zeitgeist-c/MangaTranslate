import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const context = vm.createContext({ URL, AbortSignal });
for (const f of ['i18n.js', 'i18n-strings-all.js', 'providers.js']) {
  vm.runInContext(await readFile(new URL(`src/${f}`, root), 'utf8'), context);
}
vm.runInContext("MLI18N.__testLang('tr')", context);
const P = context.MLProviders;

test('gemini discovery keeps vision models, drops non-generateContent and media models', () => {
  const good = P.normalizeDiscovered('gemini', { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }, 'k1');
  assert.equal(good.modelId, 'gemini-3.5-flash-lite');
  assert.equal(good.image, true);
  assert.equal(P.normalizeDiscovered('gemini', { name: 'models/gemini-tts-1', supportedGenerationMethods: ['generateContent'] }, 'k1'), null);
  assert.equal(P.normalizeDiscovered('gemini', { name: 'models/gemini-embed-1', supportedGenerationMethods: ['embedContent'] }, 'k1'), null);
  assert.equal(P.normalizeDiscovered('gemini', { name: '!!!' }, 'k1'), null);
});

test('openrouter discovery requires image input and marks free/paid from pricing', () => {
  const free = P.normalizeDiscovered('openrouter', { id: 'google/gemma-4-26b:free', name: 'Gemma', architecture: { input_modalities: ['image', 'text'] }, pricing: { prompt: '0', completion: '0' } }, 'k1');
  assert.ok(free && P.isFreeModel(free) && !P.isPaidModel(free));
  const paid = P.normalizeDiscovered('openrouter', { id: 'openai/gpt-6-luna', name: 'Luna', architecture: { input_modalities: ['image', 'text'] }, pricing: { prompt: '0.001', completion: '0.002' } }, 'k1');
  assert.ok(paid && P.isPaidModel(paid) && !P.isFreeModel(paid));
  assert.equal(P.normalizeDiscovered('openrouter', { id: 'text/only-model', architecture: { input_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' } }, 'k1'), null);
  assert.equal(P.normalizeDiscovered('openrouter', { id: 'openrouter/free' }, 'k1'), null);
  assert.equal(P.normalizeDiscovered('openrouter', { id: 'x/y:free' }, 'k1').free, true);
});

test('ollama discovery passes names through', () => {
  const m = P.normalizeDiscovered('ollama', { name: 'gemma4:31b' }, 'k1');
  assert.equal(m.modelId, 'gemma4:31b');
  assert.equal(P.normalizeDiscovered('ollama', {}, 'k1'), null);
});

test('discoverModels pages gemini, stops openrouter under a full page, rejects bad keys', async () => {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    if (url.includes('generativelanguage')) {
      return { ok: true, json: async () => ({ models: [{ name: 'models/a-model', supportedGenerationMethods: ['generateContent'] }] }) };
    }
    return { ok: true, json: async () => ({ data: [] }) };
  };
  const found = await P.discoverModels('gemini', 'KEY', { fetch: fetchFn });
  assert.deepEqual([...found.map(m => m.modelId)], ['a-model']);
  assert.ok(calls[0].includes('pageSize=100'));
  await assert.rejects(() => P.discoverModels('gemini', '', { fetch: fetchFn }), /anahtar/i);
  await assert.rejects(() => P.discoverModels('nope', 'KEY', { fetch: fetchFn }), /anahtar/i);
  const bad = async () => ({ ok: false, status: 429 });
  await assert.rejects(() => P.discoverModels('openrouter', 'KEY', { fetch: bad }), /429/);
  const malformed = async () => ({ ok: true, json: async () => ({}) });
  await assert.rejects(() => P.discoverModels('ollama', 'KEY', { fetch: malformed }));
});

test('effectiveModels merges static and enabled discovered, drops disabled and duplicates', () => {
  const prefs = { ...P.defaultPrefs(), models: [
    { provider: 'openrouter', modelId: 'x/new-free:free', label: 'New Free', free: true, image: true },
    { provider: 'openrouter', modelId: 'y/paid', label: 'Paid', free: false, image: true },
    { provider: 'openrouter', modelId: 'z/off', label: 'Off', free: true, image: true },
    { provider: 'openrouter', modelId: 'openai/gpt-6-luna', label: 'Shadow', free: true, image: true },
  ] };
  prefs.enabled = prefs.enabled.filter(k => k !== 'openrouter:z/off');
  prefs.enabled.push('openrouter:x/new-free:free', 'openrouter:y/paid');
  const list = P.effectiveModels('openrouter', prefs);
  const ids = list.map(e => e.modelId);
  assert.ok(ids.includes('openai/gpt-6-luna') && ids.includes('x/new-free:free') && ids.includes('y/paid'));
  assert.ok(!ids.includes('z/off'));
  assert.equal(ids.filter(id => id === 'openai/gpt-6-luna').length, 1);
  assert.equal(list.find(e => e.modelId === 'x/new-free:free').free, true);
  assert.equal(list.find(e => e.modelId === 'y/paid').free, false);
  assert.equal(list.find(e => e.modelId === 'openai/gpt-6-luna').source, 'static');
});

test('settings and migrate accept enabled discovered models, reject disabled and unknown', () => {
  const prefs = { ...P.defaultPrefs(), models: [{ provider: 'openrouter', modelId: 'x/new-free:free', label: 'N', free: true, image: true }] };
  prefs.enabled.push('openrouter:x/new-free:free');
  assert.equal(P.settings({ translationProvider: 'openrouter', openrouterModel: 'x/new-free:free' }, prefs).model, 'x/new-free:free');
  assert.throws(() => P.settings({ translationProvider: 'openrouter', openrouterModel: 'x/nope' }, prefs), /desteklenmiyor/);
  const off = { ...P.defaultPrefs(), enabled: P.defaultPrefs().enabled.filter(k => k !== 'openrouter:openai/gpt-6-luna') };
  assert.throws(() => P.settings({ translationProvider: 'openrouter', openrouterModel: 'openai/gpt-6-luna' }, off), /desteklenmiyor/);
  assert.equal(P.migrate({ translationProvider: 'openrouter', openrouterModel: 'x/new-free:free' }, prefs).migrated, false);
  // No prefs argument keeps the old static-only contract.
  assert.equal(P.settings({ translationProvider: 'openrouter' }).model, 'openai/gpt-6-luna');
  assert.throws(() => P.settings({ translationProvider: 'openrouter', openrouterModel: 'x/new-free:free' }), /desteklenmiyor/);
});

test('filterModels combines search and price buckets for bulk actions', () => {
  const list = [
    { provider: 'openrouter', modelId: 'a/free-x:free', label: 'Free X', free: true },
    { provider: 'openrouter', modelId: 'b/paid-y', label: 'Paid Y', free: false },
    { provider: 'openrouter', modelId: 'c/plain', label: 'Plain Z', free: null },
  ];
  assert.deepEqual(P.filterModels(list, '', 'free').map(m => m.modelId), ['a/free-x:free']);
  assert.deepEqual(P.filterModels(list, '', 'paid').map(m => m.modelId), ['b/paid-y']);
  assert.equal(P.filterModels(list, '', 'all').length, 3);
  assert.deepEqual(P.filterModels(list, 'paid y', 'all').map(m => m.modelId), ['b/paid-y']);
  assert.deepEqual(P.filterModels(list, 'c/plain', 'free'), []);
});
test('nextGeminiModel chains discovered ids after the static order', () => {
  assert.equal(P.nextGeminiModel('gemma-4-26b-a4b-it', ['gemini-9-new']), 'gemini-9-new');
  assert.equal(P.nextGeminiModel('gemini-9-new', ['gemini-9-new']), null);
  assert.equal(P.nextGeminiModel('gemini-3.5-flash-lite'), 'gemini-3.1-flash-lite');
});

test('routerBody and ollamaBody accept an explicit allow-list', () => {
  const imgs = [{ regionId: 'r1', dataUrl: 'data:image/png;base64,AAAA' }];
  const body = P.routerBody('x/new-free:free', 'p', imgs, 8192, false, ['x/new-free:free']);
  assert.equal(body.model, 'x/new-free:free');
  assert.throws(() => P.routerBody('x/new-free:free', 'p', imgs), /Bilinmeyen OpenRouter/);
  const ob = P.ollamaBody('my-model', 'p', imgs, ['my-model']);
  assert.equal(ob.model, 'my-model');
  assert.throws(() => P.ollamaBody('my-model', 'p', imgs), /Bilinmeyen Ollama/);
  assert.throws(() => P.ollamaPolicy('my-model', ['other']), /Bilinmeyen Ollama/);
  assert.equal(P.ollamaPolicy('gemma4:31b').maxRegions, 12);
});
