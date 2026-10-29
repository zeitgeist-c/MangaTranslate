import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
test('background cancellation belongs to its tab and forwards correlated progress', async () => {
  let listener, complete; const sent = [], progress = [];
  const context = vm.createContext({ AbortController, crypto: webcrypto, setTimeout, clearTimeout,
    chrome: { runtime: { id: 'extension', getURL: path => `chrome-extension://extension/${path}`,
      getContexts: async () => [{}], onMessage: { addListener(fn) { listener = fn; } },
      sendMessage: async message => { sent.push(message); if (message.command === 'prepare') return new Promise(resolve => { complete = resolve; }); return { ok: true }; }
    }, tabs: { sendMessage: async (id, message) => progress.push({ id, message }) } }
  });
  for (const f of ['i18n.js','i18n-strings.js','i18n-strings-content.js']) vm.runInContext(await readFile(new URL('../src/'+f, import.meta.url), 'utf8'), context);
  vm.runInContext("MLI18N.__testLang('tr')", context);
  vm.runInContext(await readFile(new URL('../src/page/queue.js', import.meta.url), 'utf8'), context);
  vm.runInContext(await readFile(new URL('../src/page-background.js', import.meta.url), 'utf8'), context);
  const invoke = (message, tab = 1) => new Promise(resolve => listener(message, { id: 'extension', tab: { id: tab } }, resolve));
  const operation = invoke({ type: 'ML_PREPARE', requestId: 'client', source: 'https://fixture/a' }); await tick();
  await invoke({ type: 'ML_CANCEL', requestId: 'client' }, 2);
  assert.equal(sent.filter(m => m.command === 'cancel').length, 0);
  await invoke({ type: 'ML_CANCEL', requestId: 'client' });
  assert.equal(sent.at(-1).requestId, sent[0].requestId); assert.equal(sent.at(-1).command, 'cancel');
  listener({ type: 'ML_PROGRESS', tabId: 1, clientRequestId: 'client', text: 'tile 2' },
    { id: 'extension', url: 'chrome-extension://extension/src/page/offscreen.html' }, () => {});
  assert.equal(progress[0].message.requestId, 'client');
  complete({ ok: false, error: 'cancelled' }); assert.equal((await operation).ok, false);
});
test('offscreen cache remains accessible while inference is blocked; queued cancellation never executes', async () => {
  let listener, release; const executed = [];
  const context = vm.createContext({ AbortController, setInterval, clearInterval,
    ort: { env: { wasm: {} } }, read: async key => `cached:${key}`, write: async () => true,
    chrome: { runtime: { id: 'extension', getURL: x => x, onMessage: { addListener(fn) { listener = fn; } }, sendMessage: async () => ({ ok: true }) } }
  });
  const source = (await readFile(new URL('../src/page/offscreen.mjs', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  vm.runInContext(source, context);
  context.prepare = async (source, signal) => { executed.push(source); await new Promise(resolve => { release = resolve; }); signal.throwIfAborted(); return true; };
  const invoke = message => new Promise(resolve => listener({ target: 'ml-offscreen', ...message }, { id: 'extension' }, resolve));
  const first = invoke({ command: 'prepare', requestId: 'a', source: 'a' }); await tick();
  const queued = invoke({ command: 'prepare', requestId: 'b', source: 'b' });
  assert.equal((await invoke({ command: 'read', requestId: 'read', key: 'translation' })).value, 'cached:translation');
  await invoke({ command: 'cancel', requestId: 'b' }); await invoke({ command: 'cancel', requestId: 'a' });
  release(); assert.equal((await first).ok, false); assert.equal((await queued).ok, false);
  assert.deepEqual(executed, ['a']);
});

test('a failed GPU text run releases its session and falls back once to the identical verified CPU model', async () => {
  const sha = '1eb7b4f7ab657ebd1c66d5f79bca7497f29768a2e3c15e52daecbba1a8e4a039';
  const backends = []; let runs = 0, released = 0;
  const context = vm.createContext({ AbortController, performance, navigator: { gpu: {} },
    ort: { env: { wasm: {} }, InferenceSession: { create: async (bytes, options) => { backends.push(options.executionProviders[0]); return { release: async () => released++ }; } } },
    read: async () => null, write: async () => {}, hash: async () => sha, groupTextLines: () => [],
    detectPPOCR: async () => { runs++; if (runs === 1) throw new Error('GPU lost'); return { regions: [] }; },
    fetch: async () => ({ arrayBuffer: async () => new ArrayBuffer(1) }),
    chrome: { runtime: { getURL: x => x, onMessage: { addListener() {} } } }
  });
  vm.runInContext((await readFile(new URL('../src/page/offscreen.mjs', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, ''), context);
  context.imageFromSource = async () => ({ image: { width: 900, height: 1000, close() {} }, imageId: 'image' });
  const result = await context.prepare('https://fixture/image', new AbortController().signal, () => {}, 'fast');
  assert.equal(result.backend, 'wasm'); assert.deepEqual(backends, ['webgpu', 'wasm']); assert.equal(released, 1); assert.equal(runs, 2);
});
