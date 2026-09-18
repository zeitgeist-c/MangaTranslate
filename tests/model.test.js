const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require('node:path').join(__dirname, '../src/background.js'), 'utf8');
const requests = [];
const chrome = {
  runtime: { onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener() {} } },
  alarms: { onAlarm: { addListener() {} } },
  storage: { session: { get: async () => ({}) } },
};
const context = vm.createContext({
  chrome, console, AbortController, setTimeout, clearTimeout,
  fetch: async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [
      { thought: true, text: 'internal reasoning' }, { text: 'OK' },
    ] } }] }) };
  },
});
vm.runInContext(source, context);

(async () => {
  for (const selected of ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemma-4-31b-it']) {
    const tried = [];
    const result = await context.executeWithModelFallback(selected, async model => {
      tried.push(model);
      if (tried.length < 3) throw new Error('temporarily unavailable');
      return 'translated';
    });
    assert.equal(tried[0], selected);
    assert.equal(new Set(tried).size, 3);
    assert.equal(result.model, tried[2]);
    assert.equal(result.fallbackUsed, true);
  }

  await assert.rejects(
    context.executeWithModelFallback('gemma-4-31b-it', async () => {
      const error = new Error('invalid key'); error.status = 'invalid'; throw error;
    }),
    /invalid key/,
  );

  const answer = await context.callGemini({
    apiKey: 'test', model: 'gemma-4-31b-it', prompt: 'Read image',
    imageBase64: { mime: 'image/png', base64: 'AA==' }, responseMimeType: 'application/json',
  });
  assert.equal(answer, 'OK');
  assert.match(requests[0].url, /gemma-4-31b-it:generateContent/);
  assert.equal(requests[0].body.generationConfig.responseMimeType, undefined);
  assert.equal(requests[0].body.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
  assert.equal(requests[0].body.contents[0].parts[1].inline_data.mime_type, 'image/png');

  console.log('Model fallback and Gemma request tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
