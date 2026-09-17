'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../src/pagemode-core.js');

function worker() {
  const listener = { addListener() {} };
  const context = vm.createContext({
    self: { MLPagemodeCore: core }, importScripts() {}, console,
    setTimeout, clearTimeout, AbortController,
    crypto: { randomUUID: () => 'test-job' },
    chrome: {
      runtime: { onInstalled: listener, onStartup: listener, onMessage: listener },
      alarms: { onAlarm: listener }, storage: { session: { get: async () => ({}) } },
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

test('Gemini keeps its JSON config and Gemma failures do not silently switch models', async () => {
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
  assert.equal(attempts, 1);
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
