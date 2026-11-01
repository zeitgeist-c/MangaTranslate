import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const root = new URL('../', import.meta.url);
const sources = await Promise.all(
  ['i18n.js', 'i18n-strings-all.js', 'providers.js', 'keys.js', 'page/queue.js', 'page-background.js']
    .map(x => readFile(new URL(`src/${x}`, root), 'utf8'))
);

function fixture(fetchImpl, seed = {}) {
  const stored = { ...seed };
  const context = vm.createContext({
    crypto: webcrypto, TextEncoder, AbortSignal, setTimeout, clearTimeout, console,
    URL,
    fetch: fetchImpl,
    chrome: {
      runtime: { id: 'test-id', onMessage: { addListener() {} } },
      storage: {
        sync: { get: async () => ({}), set: async () => {} },
        local: {
          get: async key => Array.isArray(key) ? Object.fromEntries(key.map(k => [k, stored[k]])) : ({ [key]: stored[key] }),
          set: async patch => Object.assign(stored, patch),
        },
      },
    },
    enqueueWithRateLimit: async fn => fn(),
    incrementTranslationStats: async () => {},
  });
  sources.forEach(s => vm.runInContext(s, context));
  vm.runInContext("MLI18N.__testLang('tr')", context);
  return { context, stored };
}

const geminiList = async () => ({
  ok: true,
  json: async () => ({ models: [
    { name: 'models/gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash Lite', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-9-new', displayName: 'Gemini 9 New', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-embed-1', supportedGenerationMethods: ['embedContent'] },
  ] }),
});

const seedKeys = {
  googleApiKeys: [{ id: 'k1', key: 'GKEY', label: 'G1', isActive: true }],
  activeGoogleApiKeyId: 'k1',
};

test('refresh discovers, enables and persists gemini models; static list survives', async () => {
  const { context, stored } = fixture(geminiList, seedKeys);
  const result = await context.mlRefreshModels('gemini');
  assert.equal(result.ok, true);
  assert.equal(result.failed.length, 0);
  const prefs = stored.modelPreferences;
  assert.ok(prefs);
  const ids = prefs.models.filter(m => m.provider === 'gemini').map(m => m.modelId);
  assert.ok(ids.includes('gemini-9-new'));
  assert.ok(!ids.includes('gemini-embed-1'));
  assert.ok(prefs.enabled.includes('gemini:gemini-9-new'));
  assert.ok(prefs.enabled.includes('gemini:gemini-3.5-flash-lite'));
  assert.ok(Number.isFinite(prefs.refreshedAt.gemini));
  assert.equal(await context.MLProviders.isModelAllowed('gemini', 'gemini-9-new'), true);
  assert.equal(await context.MLProviders.isModelAllowed('gemini', 'gemini-embed-1'), false);
  assert.ok(!String(JSON.stringify(prefs)).includes('GKEY'), 'raw key must not be persisted');
});

test('mlConfig validates against stored prefs and attaches allow-lists', async () => {
  const { context } = fixture(geminiList, seedKeys);
  const config = await context.mlConfig();
  assert.equal(config.provider, 'gemini');
  assert.equal(config.model, 'gemini-3.5-flash-lite');
  assert.ok(config.allowed.openrouter.includes('openai/gpt-6-luna'));
  assert.ok(config.allowed.gemini.includes('gemini-3.5-flash-lite'));
  assert.ok(config.batching && config.batching.maxRegions > 0);
});
test('refresh without keys throws openly; total failure keeps the previous list', async () => {
  const { context } = fixture(geminiList, {});
  await assert.rejects(() => context.mlRefreshModels('gemini'), /anahtar/i);
  const down = async () => ({ ok: false, status: 503 });
  const f2 = fixture(down, seedKeys);
  const before = await f2.context.MLProviders.modelPreferences();
  const result = await f2.context.mlRefreshModels('gemini');
  assert.equal(result.ok, false);
  assert.equal(result.kept, 0);
  assert.deepEqual(await f2.context.MLProviders.modelPreferences(), before);
});

test('openrouter refresh keeps other providers and merges pages transparently', async () => {
  const pages = [
    { data: [{ id: 'a/m1', name: 'M1', architecture: { input_modalities: ['image', 'text'] }, pricing: { prompt: '0', completion: '0' } }] },
    { data: [] },
  ];
  let n = 0;
  const fetchFn = async (url) => {
    assert.ok(String(url).includes('offset='), 'openrouter paging uses offset');
    return { ok: true, json: async () => pages[Math.min(n++, pages.length - 1)] };
  };
  const seed = {
    openrouterApiKeys: [{ id: 'k9', key: 'RKEY', label: 'R', isActive: true }],
    activeOpenrouterApiKeyId: 'k9',
  };
  const { context, stored } = fixture(fetchFn, seed);
  const result = await context.mlRefreshModels('openrouter');
  assert.equal(result.ok, true);
  const prefs = stored.modelPreferences;
  assert.ok(prefs.models.some(m => m.provider === 'openrouter' && m.modelId === 'a/m1' && m.free === true));
  assert.ok(prefs.enabled.includes('openrouter:a/m1'));
});
