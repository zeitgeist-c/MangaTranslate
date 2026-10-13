import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
const source = await readFile(new URL('../src/page-content.js', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function fixture() {
  const buttons = new Map(), messages = [], pending = [], timers = new Map(); let listener, status, timerId = 0;
  const node = tag => ({ dataset: {}, style: {}, isConnected: true, textContent: '',
    append(...children) { for (const child of children) { if (child.tag === 'button') buttons.set(child.textContent, child); if (child.tag === 'p') status = child; } },
    tag, setAttribute() {}, attachShadow() { return node('shadow'); }, remove() { this.isConnected = false; } });
  const config = { processingVersion: 'page-v4', localDetector: 'standard', provider: 'openrouter', model: 'synthetic' };
  let saved = { config, pages: [{ source: 'https://fixture/image.png', state: 'queued' }], context: [] };
  const image = { currentSrc: 'https://fixture/image.png', naturalWidth: 900, naturalHeight: 1000, isConnected: true };
  const context = vm.createContext({ AbortController, DOMException, structuredClone, crypto: webcrypto, URL, console,
    setTimeout(fn, ms) { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout(id) { timers.delete(id); },
    document: { createElement: node, images: [image], documentElement: node('html') },
    window: { addEventListener() {} }, MutationObserver: class { observe() {} }, ResizeObserver: class { observe() {} },
    chrome: { storage: { sync: { get: async () => ({ enabled: true }) } }, runtime: {
      onMessage: { addListener(fn) { listener = fn; } }, sendMessage(message) {
        messages.push(message);
        if (message.type === 'ML_CONFIG') return Promise.resolve({ ok: true, value: config });
        if (message.type === 'ML_JOB_GET') return Promise.resolve({ ok: true, value: saved });
        if (message.type === 'ML_JOB_SAVE') { saved = structuredClone(message.job); return Promise.resolve({ ok: true }); }
        if (message.type === 'ML_CANCEL') return Promise.resolve({ ok: true });
        if (message.type === 'ML_PREPARE') return new Promise(resolve => pending.push({ message, resolve }));
        if (message.type === 'ML_RENDER') return Promise.reject(new Error('fixture render must not run'));
        throw new Error(message.type);
      }
    } }
  });
  vm.runInContext(source, context);
  return { buttons, messages, pending, timers, get saved() { return saved; }, get text() { return status.textContent; },
    async start() { listener({ type: 'START_PAGE_TRANSLATION', resume: true }, {}, () => {}); await flush(); },
    async click(label) { buttons.get(label).onclick(); await flush(); },
    progress(data) { listener({ type: 'ML_PAGE_PROGRESS', ...data }, {}, () => {}); } };
}
test('pause releases a pending request and a single resume click starts again', async () => {
  const f = fixture(); await f.start(); assert.equal(f.pending.length, 1);
  await f.click('Duraklat'); await f.click('Devam et');
  assert.equal(f.pending.length, 2, 'resume must not remain blocked by a never-resolving request');
  assert.ok(f.messages.some(m => m.type === 'ML_CANCEL'));
  f.pending[0].resolve({ ok: true, value: { width: 900, height: 1000, regions: [] } }); await flush();
  assert.equal(f.saved.pages[0].state, 'detecting', 'late completion must not change the resumed job');
  await f.click('Duraklat'); assert.equal(f.timers.size, 0);
});
test('a missing local reply times out, records the error and releases the controls', async () => {
  const f = fixture(); await f.start();
  const watchdog = [...f.timers.values()].find(t => t.ms === 180000);
  assert.ok(watchdog, 'local processing requires a finite watchdog'); watchdog.fn(); await flush();
  assert.equal(f.saved.state, 'finished'); assert.equal(f.saved.pages[0].state, 'error');
  assert.match(f.text, /hata/);
  await f.click('Hatalıları yeniden dene'); assert.equal(f.pending.length, 2); await f.click('Duraklat');
});
test('stale progress cannot overwrite the paused or resumed operation', async () => {
  const f = fixture(); await f.start(); const oldId = f.pending[0].message.requestId;
  await f.click('Duraklat'); const paused = f.text;
  f.progress({ requestId: oldId, text: 'STALE' }); assert.equal(f.text, paused);
  await f.click('Devam et'); const resumed = f.text;
  f.progress({ requestId: oldId, text: 'STALE' }); assert.equal(f.text, resumed);
  f.progress({ requestId: f.pending[1].message.requestId, text: 'CURRENT' }); assert.equal(f.text, 'CURRENT');
  await f.click('Duraklat');
});
