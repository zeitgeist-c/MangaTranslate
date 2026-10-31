import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
const i18nSources = await Promise.all(['i18n.js','i18n-strings-all.js'].map(x=>readFile(new URL('../src/'+x,import.meta.url),'utf8')));
const source = await readFile(new URL('../src/keys.js', import.meta.url), 'utf8');
const routerKey = 'sk-or-synthetic-12345678901234567890', googleKey = 'AIza-synthetic-12345678901234567890';
function fixture(initial = {}) {
  const data = structuredClone(initial), listeners = [], requests = []; let failWrite = false, fetchImpl = async () => ({ ok: true, json: async () => ({ data: {}, models: [] }) });
  const context = vm.createContext({ crypto: webcrypto, AbortController, setTimeout, clearTimeout,
    fetch: (url, options) => { requests.push({ url, options }); return fetchImpl(url, options); },
    chrome: { runtime: { id: 'ext', getURL: path => 'chrome-extension://ext/' + path, onMessage: { addListener: listener => listeners.push(listener) } },
      storage: { local: { get: async keys => Object.fromEntries((keys || Object.keys(data)).filter(k => Object.hasOwn(data, k)).map(k => [k, structuredClone(data[k])])),
        set: async patch => { if (failWrite) throw new Error('Storage unavailable'); Object.assign(data, structuredClone(patch)); } } } }
  });
  i18nSources.forEach(s=>vm.runInContext(s,context));
  vm.runInContext(source, context);
  vm.runInContext("MLI18N.__testLang('tr')", context);
  return { data, requests, keys: context.MLKeys, restart() { vm.runInContext(source, context); this.keys = context.MLKeys; },
    fail(value) { failWrite = value; }, fetch(fn) { fetchImpl = fn; },
    invoke(message, sender) { return new Promise(resolve => listeners.at(-1)(message, sender, resolve)); } };
}
const action = (f, provider, type = 'LIST', extra = {}) => f.keys.action({ type: 'ML_KEYS_' + type, provider, ...extra });
test('legacy router migrates once without touching Google or exposing key bytes', async () => {
  const google = [{ id: 'g', key: googleKey, label: 'İzleme', lastTestStatus: 'success' }], f = fixture({ openrouterApiKey: routerKey, googleApiKeys: google, activeGoogleApiKeyId: 'g' });
  const first = await action(f, 'openrouter'); assert.equal(first[0].label, 'OpenRouter API 1'); assert.equal(first[0].active, true);
  assert.ok(!JSON.stringify(first).includes(routerKey)); assert.equal(first[0].status, 'untested');
  const next = await action(f, 'openrouter'); assert.equal(next[0].id, first[0].id); assert.deepEqual(f.data.googleApiKeys, google);
  f.restart(); assert.equal(await f.keys.active('openrouter'), routerKey); assert.equal(await f.keys.active('gemini'), googleKey);
});
test('two simultaneous additions serialize and duplicate/invalid entries are rejected', async () => {
  const f = fixture(); await Promise.all([action(f, 'openrouter', 'ADD', { key: routerKey }), action(f, 'openrouter', 'ADD', { key: routerKey + '2' })]);
  let list = await action(f, 'openrouter'); assert.equal(list.length, 2); assert.equal(list.filter(k => k.active).length, 1); assert.equal(list[0].active, true);
  await assert.rejects(action(f, 'openrouter', 'ADD', { key: routerKey }), /zaten/);
  await assert.rejects(action(f, 'openrouter', 'ADD', { key: 'key with spaces 123456789' }), /boşluk/);
  await action(f, 'openrouter', 'ACTIVATE', { id: list[1].id }); assert.equal(f.data.openrouterApiKey, routerKey + '2');
  await action(f, 'openrouter', 'RENAME', { id: list[1].id, label: 'İkinci' }); list = await action(f, 'openrouter'); assert.equal(list[1].label, 'İkinci');
});
test('deleting active selects first remaining; empty list never resurrects legacy key', async () => {
  const f = fixture({ openrouterApiKey: routerKey }); let list = await action(f, 'openrouter');
  await action(f, 'openrouter', 'ADD', { key: routerKey + '2' }); await action(f, 'openrouter', 'DELETE', { id: list[0].id });
  list = await action(f, 'openrouter'); assert.equal(list[0].active, true);
  await action(f, 'openrouter', 'DELETE', { id: list[0].id }); assert.equal(await f.keys.active('openrouter'), '');
  f.restart(); assert.equal((await action(f, 'openrouter')).length, 0); assert.equal(f.data.openrouterApiKey, '');
});
test('failed writes preserve old keys and a later operation still succeeds', async () => {
  const f = fixture({ openrouterApiKey: routerKey }); const [old] = await action(f, 'openrouter'); f.fail(true);
  await assert.rejects(action(f, 'openrouter', 'DELETE', { id: old.id }), /Storage/); f.fail(false);
  assert.equal(await f.keys.active('openrouter'), routerKey); await action(f, 'openrouter', 'RENAME', { id: old.id, label: 'Korundu' });
  assert.equal((await action(f, 'openrouter'))[0].label, 'Korundu');
});
test('ollama keys add once, mirror the active key and check via tags endpoint', async () => {
  const f = fixture();
  await assert.rejects(action(f, 'ollama', 'ADD', { key: 'short' }), /boşluk|Geçerli/);
  const key = 'o'.repeat(40) + '1234567890';
  await action(f, 'ollama', 'ADD', { key, label: 'Bulut 1' });
  await assert.rejects(action(f, 'ollama', 'ADD', { key }), /zaten/);
  let list = await action(f, 'ollama');
  assert.equal(list.length, 1); assert.equal(list[0].label, 'Bulut 1'); assert.equal(list[0].active, true);
  assert.equal(f.data.ollamaApiKey, key); assert.equal(await f.keys.active('ollama'), key);
  assert.equal(f.data.openrouterApiKey, undefined);
  f.fetch(async (url, options) => {
    assert.equal(url, 'https://ollama.com/api/tags');
    assert.equal(options.headers.Authorization, 'Bearer ' + key);
    return { ok: true, json: async () => ({ models: [{ name: 'gemma4:31b' }] }) };
  });
  const [result] = await action(f, 'ollama', 'CHECK', { id: list[0].id });
  assert.equal(result.status, 'success');
});
test('metadata checks use correct headers and never generate a translation', async () => {
  const f = fixture({ openrouterApiKey: routerKey, googleApiKey: googleKey });
  for (const provider of ['openrouter', 'gemini']) { const [key] = await action(f, provider); const [result] = await action(f, provider, 'CHECK', { id: key.id }); assert.equal(result.status, 'success'); }
  assert.equal(f.requests.length, 2); assert.equal(f.requests[0].url, 'https://openrouter.ai/api/v1/key');
  assert.equal(f.requests[0].options.headers.Authorization, 'Bearer ' + routerKey); assert.equal(f.requests[1].options.headers['x-goog-api-key'], googleKey);
  assert.ok(f.requests.every(r => r.options.method === 'GET' && !r.options.body && !r.url.includes('synthetic')));
  f.fetch(async () => ({ ok: false, status: 401, json: async () => ({ error: { message: routerKey } }) }));
  const [key] = await action(f, 'openrouter'), [result] = await action(f, 'openrouter', 'CHECK', { id: key.id });
  assert.equal(result.status, 'invalid'); assert.ok(!JSON.stringify(result).includes(routerKey));
});
test('a late check never recreates a deleted key or overwrites concurrent edits', async () => {
  const f = fixture({ openrouterApiKey: routerKey }); let release; f.fetch(() => new Promise(resolve => { release = resolve; }));
  const [key] = await action(f, 'openrouter'), checking = action(f, 'openrouter', 'CHECK', { id: key.id });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await action(f, 'openrouter', 'DELETE', { id: key.id }); await action(f, 'openrouter', 'ADD', { key: routerKey + '2', label: 'Yeni' });
  release({ ok: true, json: async () => ({ data: {} }) }); const result = await checking;
  assert.equal(result.length, 1); assert.equal(result[0].label, 'Yeni'); assert.equal(result[0].status, 'untested');
});
test('key messages accept only exact extension settings/popup senders', async () => {
  const f = fixture({ openrouterApiKey: routerKey }), message = { type: 'ML_KEYS_LIST', provider: 'openrouter' };
  for (const sender of [{ id: 'ext', url: 'https://manga.test', tab: { id: 1 } }, { id: 'other', url: 'chrome-extension://ext/popup/popup.html' }, { id: 'ext', url: 'chrome-extension://ext/options/settings.html.evil' }]) assert.equal((await f.invoke(message, sender)).ok, false);
  assert.equal(f.data.openrouterApiKeys, undefined);
  const result = await f.invoke(message, { id: 'ext', url: 'chrome-extension://ext/options/settings.html#keys/openrouter' }); assert.equal(result.ok, true); assert.ok(!JSON.stringify(result).includes(routerKey));
});
test('rotation source lists raw keys worker-side while messages stay masked', async () => {
  const f = fixture({ googleApiKeys: [{ id: 'g1', key: 'K1' }, { id: 'g2', key: 'K2' }], activeGoogleApiKeyId: 'g1' });
  assert.deepEqual((await f.keys.all('gemini')).map(k => k.id), ['g1', 'g2']);
  assert.deepEqual((await f.keys.all('gemini')).map(k => k.key), ['K1', 'K2']);
  const listed = await action(f, 'gemini');
  assert.deepEqual(listed.map(k => k.id), ['g1', 'g2']); assert.ok(listed.every(k => !('key' in k)));
});
