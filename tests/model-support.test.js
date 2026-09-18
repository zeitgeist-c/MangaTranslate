'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../src/pagemode-core.js');
const localMatch = require('../src/local-match.js');

function worker() {
  const listener = { addListener() {} };
  let nextId = 0;
  const context = vm.createContext({
    self: { MLPagemodeCore: core, MLLocalMatch: localMatch }, importScripts() {}, console,
    setTimeout, clearTimeout, AbortController,
    crypto: { randomUUID: () => 'test-job-' + (++nextId) },
    chrome: {
      runtime: { onInstalled: listener, onStartup: listener, onMessage: listener },
      alarms: { onAlarm: listener }, storage: { session: { get: async () => ({}) },
        sync: { get: async defaults => defaults } },
    },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../src/background.js'), 'utf8'), context);
  return context;
}

test('Gemma image request uses chosen endpoint and ignores thought text', async () => {
  const ctx = worker();
  let request;
  ctx.fetch = async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [
      { thought: true, text: 'Internal reasoning' }, { text: '[{"translation":"Merhaba"}]' },
    ] } }] }) };
  };
  const result = await ctx.callGemini({ apiKey: 'test-only', model: 'gemma-4-31b-it',
    prompt: 'Return JSON', imageBase64: { mime: 'image/png', base64: 'dummy' }, responseMimeType: 'application/json' });
  assert.ok(request.url.includes('/gemma-4-31b-it:generateContent'));
  assert.equal(request.body.contents[0].parts[1].inline_data.mime_type, 'image/png');
  assert.equal(request.body.generationConfig.responseMimeType, undefined);
  assert.equal(request.body.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
  assert.equal(result, '[{"translation":"Merhaba"}]');
});

test('Gemini keeps its JSON config and exhausted Gemma request tries all three models', async () => {
  const ctx = worker();
  let body;
  ctx.fetch = async (_url, opts) => {
    body = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '[]' }] } }] }) };
  };
  await ctx.callGemini({ apiKey: 'test-only', model: 'gemini-3.1-flash-lite', prompt: 'JSON', responseMimeType: 'application/json' });
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  let attempts = 0;
  await assert.rejects(ctx.executeWithModelFallback('gemma-4-31b-it', async () => {
    attempts++; throw new Error('unavailable');
  }), /unavailable/);
  assert.equal(attempts, 3);
});

test('every selected model falls back in order on quota/timeout and stops on success', async () => {
  const models = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemma-4-31b-it'];
  for (const selected of models) {
    const ctx = worker(), attempts = [];
    const result = await ctx.executeWithModelFallback(selected, async model => {
      attempts.push(model);
      if (attempts.length < 3) throw Object.assign(new Error('quota'), { status: attempts.length === 1 ? 'rate_limited' : 'timeout' });
      return 'translated';
    });
    assert.deepEqual(attempts, [selected, ...models.filter(m => m !== selected)]);
    assert.equal(result.value, 'translated');
    assert.equal(result.model, attempts[2]);
    assert.equal(result.fallbackUsed, true);
  }
});

test('invalid credentials and network failures stop without wasting other model requests', async () => {
  for (const status of ['invalid', 'network']) {
    const ctx = worker(); let count = 0;
    await assert.rejects(ctx.executeWithModelFallback('gemma-4-31b-it', async () => {
      count++; throw Object.assign(new Error(status), { status });
    }), new RegExp(status));
    assert.equal(count, 1);
  }
});

test('page translation recovers from malformed model output and caches only the valid result', async () => {
  const ctx = worker(), attempted = [], cached = [];
  ctx.getActiveApiKey = async () => 'test-only';
  ctx.incrementTranslationStats = async () => {};
  ctx.pageCacheSet = async (...args) => cached.push(args);
  ctx.callGemini = async ({ model }) => {
    attempted.push(model);
    if (attempted.length === 1) return 'invalid JSON';
    if (attempted.length === 2) throw ctx.normalizeGeminiError(403, { error: { message: 'Model unavailable' } });
    return JSON.stringify([{ text: 'Hello', translation: 'Merhaba', x: 20, y: 20, width: 100, height: 60 }]);
  };
  const result = await ctx.runPageJob({ dataUrl: 'data:image/jpeg;base64,test', w: 800, h: 1000 }, 'page-key', 0, 'gemini-3.5-flash-lite');
  assert.deepEqual(attempted, ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemma-4-31b-it']);
  assert.equal(result.bubbles[0].translation, 'Merhaba');
  assert.equal(cached.length, 1);
  assert.equal(cached[0][2], 'gemma-4-31b-it');
  assert.equal(ctx.normalizeGeminiError(400, { error: { details: [{ reason: 'API_KEY_INVALID' }] } }).status, 'invalid');
});

test('opt-in local placement uses a matching detected balloon and preserves translation', async () => {
  const ctx = worker();
  ctx.getActiveApiKey = async () => 'test-only';
  ctx.incrementTranslationStats = async () => {};
  ctx.pageCacheSet = async () => {};
  ctx.callGemini = async request => {
    assert.equal(request.imageBase64, undefined);
    return JSON.stringify({ items: [{ id: 0, translation: 'Ailem Chicago’da yaşıyor' }] });
  };
  ctx.nativeRequest = async () => ({ ok: true, size: [400, 400], matches: [{
    ocr: 'MY FAMILY LIVES IN CHICAGO', bubble_box: [25, 20, 160, 115], text_box: [45, 35, 140, 100],
    bubble_confidence: 0.95, needs_review: false,
  }] });
  const result = await ctx.runPageJob({ dataUrl: 'data:image/jpeg;base64,test', w: 400, h: 400 },
    'page-key', 0, 'gemini-3.5-flash-lite', true);
  assert.equal(result.bubbles[0].translation, 'Ailem Chicago’da yaşıyor');
  assert.equal(result.bubbles[0].x, 25);
  assert.equal(result.bubbles[0].localPlacement, true);
});

test('clipped local detector falls back to image translation without moving that balloon', async () => {
  const ctx = worker();
  ctx.getActiveApiKey = async () => 'test-only';
  ctx.incrementTranslationStats = async () => {};
  ctx.pageCacheSet = async () => {};
  ctx.nativeRequest = async () => ({ ok: true, size: [900, 1152], unassigned_ocr: 0, matches: [{
    ocr: 'FIGHTING MORE BRAVELY', bubble_box: [49, 214, 857, 644], text_box: [84, 331, 823, 524],
    bubble_confidence: 0.98, needs_review: true, reason: 'text_outside_detected_bubble',
  }] });
  ctx.callGemini = async request => {
    assert.ok(request.imageBase64);
    return JSON.stringify([{ text: 'FIGHTING MORE BRAVELY', translation: 'Daha cesurca savaşıyor',
      x: 50, y: 278, width: 610, height: 545 }]);
  };
  const result = await ctx.runPageJob({ dataUrl: 'data:image/jpeg;base64,test', w: 900, h: 1152 },
    'page-key', 0, 'gemini-3.5-flash-lite', true);
  assert.equal(result.bubbles[0].x, 50);
  assert.equal(result.bubbles[0].localPlacement, undefined);
});

test('queued page jobs emit progress and another tab gets its own result subscription', async () => {
  const ctx = worker(), messages = [], pending = [];
  ctx.chrome.tabs = { sendMessage: async (tabId, payload) => { messages.push({ tabId, payload }); } };
  ctx.getSelectedGeminiModel = async () => 'gemini-3.5-flash-lite';
  ctx.pageCacheGet = async () => null;
  ctx.enqueueWithRateLimit = (_job, meta) => { pending.push(meta); return Promise.resolve(); };
  const msg = { dataUrl: 'data:image/png;base64,dummy', cacheKey: 'same', pageKey: 'p', bandIndex: 0 };
  assert.equal((await ctx.handleTranslatePage(msg, { tab: { id: 1 } })).duplicate, undefined);
  assert.equal((await ctx.handleTranslatePage(msg, { tab: { id: 2 } })).duplicate, undefined);
  assert.equal((await ctx.handleTranslatePage(msg, { tab: { id: 1 } })).duplicate, true);
  ctx.notifyPageProgress();
  assert.deepEqual(messages.map(m => m.tabId), [1, 2]);
  assert.ok(messages.every(m => m.payload.type === 'PAGE_PROGRESS' && m.payload.status === 'queued'));
  pending[0].onProgress('retrying', 'quota reached');
  assert.ok(messages.some(m => m.payload.error === 'quota reached'));
});

test('page cache is separated by model and queued work retains the selected model', async () => {
  const ctx = worker(), keys = [], jobs = [], usedModels = [];
  let selected = 'gemini-3.5-flash-lite';
  ctx.getSelectedGeminiModel = async () => selected;
  ctx.pageCacheGet = async key => { keys.push(key); return null; };
  ctx.enqueueWithRateLimit = job => { jobs.push(job); return Promise.resolve(); };
  ctx.runPageJob = async (_message, _key, _band, model) => { usedModels.push(model); };
  const msg = { dataUrl: 'data:image/png;base64,dummy', cacheKey: 'same-page', pageKey: 'page' };
  await ctx.handleTranslatePage(msg, { tab: { id: 1 } });
  selected = 'gemma-4-31b-it';
  await ctx.handleTranslatePage(msg, { tab: { id: 1 } });
  assert.notEqual(keys[0], keys[1]);
  for (const job of jobs) await job();
  assert.deepEqual(usedModels, ['gemini-3.5-flash-lite', 'gemma-4-31b-it']);
});
