const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/background.js'), 'utf8');
const requests = [];
let fetchImpl = async (url, options) => {
  requests.push({ url, body: JSON.parse(options.body) });
  return { ok: true, json: async () => ({ candidates: [{ content: { parts: [
    { thought: true, text: 'internal reasoning' }, { text: 'OK' },
  ] } }] }) };
};
const chrome = {
  runtime: { onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener() {} } },
  alarms: { onAlarm: { addListener() {} } },
  storage: { session: { get: async () => ({}), set: async () => {} } },
};
const context = vm.createContext({
  chrome, console, AbortController, setTimeout, clearTimeout,
  fetch: (url, options) => fetchImpl(url, options),
});
vm.runInContext(source, context);

const models = vm.runInContext('GEMINI_MODELS', context);
const values = vm.runInContext('GEMINI_MODEL_VALUES', context);
const every = (fn, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`zaman asimi: ${ms}ms icinde bitmedi`)), ms);
  Promise.resolve(fn()).then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
});

(async () => {
  // ── Model listesi ve etiket butunlugu ──────────────────────────────────────
  assert.deepEqual([...values], [
    'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemma-4-26b-a4b-it', 'gemma-4-31b-it',
  ], 'model rotasyonu hizli -> yavas sirali olmali');
  const labels = vm.runInContext('GEMINI_MODEL_LABELS', context);
  for (const model of values) assert.ok(labels[model], `etiket eksik: ${model}`);
  const popupSource = fs.readFileSync(path.join(root, 'popup/popup.js'), 'utf8');
  for (const model of values) {
    assert.ok(popupSource.includes(`'${model}'`), `popup model listesinde yok: ${model}`);
  }

  // ── Yedek zincir: secili modelden baslar, 4 modeli de dolasir ───────────────
  for (const selected of values) {
    const tried = [];
    const result = await context.executeWithModelFallback(selected, async model => {
      tried.push(model);
      if (tried.length < 4) throw new Error('temporarily unavailable');
      return 'translated';
    });
    assert.equal(tried[0], selected, 'once secili model denenmeli');
    assert.equal(new Set(tried).size, 4, 'zincir 4 modeli de kapsamali');
    assert.equal(result.model, tried[3]);
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

  // ── Yavas model korumasi: yumusak tavan verilir, hizli modelde verilmez ────
  const attemptTimeouts = [];
  await context.executeWithModelFallback(models.GEMMA, async (model, options) => {
    attemptTimeouts.push({ model, timeoutMs: options && options.timeoutMs, soft: options && options.soft });
    if (attemptTimeouts.length < 2) { const e = new Error('slow'); e.status = 'timeout'; throw e; }
    return 'translated';
  });
  assert.deepEqual(attemptTimeouts[0], { model: 'gemma-4-31b-it', timeoutMs: 12000, soft: true },
    'yavas model ilk denemede 12sn yumusak tavan almali');
  assert.equal(attemptTimeouts[1].model, 'gemini-3.5-flash-lite', 'yumusak tavandan sonra hizli yedek gelmeli');
  assert.equal(attemptTimeouts[1].timeoutMs, undefined, 'hizli modelde yumusak tavan yok (sert tavan 45sn)');

  // ── Yumusak zaman asimi modeli gecici olarak zincirin sonuna atar ──────────
  assert.equal(vm.runInContext("isModelDemoted('gemma-4-31b-it')", context), true,
    'ardisik yumusak zaman asimi modeli devre disi birakmali');
  const afterDemote = [];
  const fast = await context.executeWithModelFallback(models.GEMMA, async model => {
    afterDemote.push(model);
    return 'translated';
  });
  assert.equal(afterDemote[0], 'gemini-3.5-flash-lite', 'yavas model devre disiyken zincir hizli modelle baslamali');
  assert.equal(fast.model, 'gemini-3.5-flash-lite');
  assert.equal(fast.fallbackUsed, true);

  // ── Basarili istek devre disi durumunu temizler ────────────────────────────
  await context.executeWithModelFallback('gemini-3.1-flash-lite', async () => 'translated');
  assert.equal(vm.runInContext("isModelDemoted('gemini-3.1-flash-lite')", context), false);

  // ── Adaptif aralik matematigi (olcum: 2.5sn taban, 429'da artar, temizde azalir) ──
  assert.equal(vm.runInContext('MIN_INTERVAL_MS', context), 2500, 'taban aralik 2.5sn olmali');
  assert.equal(context.nextIntervalAfterSuccess(10000), 8500);
  assert.equal(context.nextIntervalAfterSuccess(2600), 2500, 'taban altina inmemeli');
  assert.equal(context.nextIntervalAfterRateLimit(2500), 6000, '429 sonrasi en az 6sn');
  assert.equal(context.nextIntervalAfterRateLimit(20000), 30000, 'ust sinir 30sn');

  // ── Gemma modelleri: responseMimeType yok, thinkingConfig minimal ──────────
  for (const gemma of [models.GEMMA, models.GEMMA_FAST]) {
    const gemmaAnswer = await context.callGemini({
      apiKey: 'test-key', model: gemma, prompt: 'Read image',
      imageBase64: { mime: 'image/png', base64: 'AA==' }, responseMimeType: 'application/json',
    });
    assert.equal(gemmaAnswer, 'OK');
    const gemmaRequest = requests[requests.length - 1];
    assert.match(gemmaRequest.url, new RegExp(`${gemma}:generateContent`));
    assert.equal(gemmaRequest.body.generationConfig.responseMimeType, undefined);
    assert.equal(gemmaRequest.body.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
  }

  // ── callGemini timeoutMs: yavas yanit yumusak tavanla kesilir ──────────────
  // Gercek fetch gibi davran: abort sinyali gelince AbortError ile reddet
  fetchImpl = (url, options) => new Promise((resolve, reject) => {
    const signal = options && options.signal;
    if (!signal) return;
    if (signal.aborted) {
      const aborted = new Error('The operation was aborted.'); aborted.name = 'AbortError'; reject(aborted); return;
    }
    signal.addEventListener('abort', () => {
      const aborted = new Error('The operation was aborted.'); aborted.name = 'AbortError'; reject(aborted);
    });
  });
  const softStart = Date.now();
  await assert.rejects(
    every(() => context.callGemini({ apiKey: 'test-key', model: models.GEMMA, prompt: 'slow', timeoutMs: 300 }), 5000),
    /zaman asimina ugradi/,
  );
  const softElapsed = Date.now() - softStart;
  assert.ok(softElapsed >= 250 && softElapsed < 3000, `yumusak tavan ~300ms'de kesmeliydi (olculen ${softElapsed}ms)`);

  // ── content.js: bekleme suresi kuyruk derinligiyle buyur, tavani asmaz ─────
  const contentSource = fs.readFileSync(path.join(root, 'src/content.js'), 'utf8');
  const timeoutFnStart = contentSource.indexOf('function translationTimeoutMsForQueueDepth');
  assert.ok(timeoutFnStart > 0, 'content.js icinde translationTimeoutMsForQueueDepth bulunamadi');
  let braceDepth = 0;
  let timeoutFnEnd = -1;
  for (let i = contentSource.indexOf('{', timeoutFnStart); i < contentSource.length; i++) {
    if (contentSource[i] === '{') braceDepth++;
    else if (contentSource[i] === '}') { braceDepth--; if (braceDepth === 0) { timeoutFnEnd = i + 1; break; } }
  }
  assert.ok(timeoutFnEnd > 0, 'translationTimeoutMsForQueueDepth govdesi kapanmadi');
  const timeoutContext = vm.createContext({});
  vm.runInContext(
    'const QUICK_TRANSLATE_TIMEOUT_MS = 75000; const TRANSLATE_TIMEOUT_PER_JOB_MS = 16000;' +
    'const TRANSLATE_TIMEOUT_MAX_MS = 240000;',
    timeoutContext,
  );
  vm.runInContext(contentSource.slice(timeoutFnStart, timeoutFnEnd), timeoutContext);
  const timeoutFor = timeoutContext.translationTimeoutMsForQueueDepth;
  assert.equal(timeoutFor(0), 75000, 'bos kuyrukta taban bekleme');
  assert.equal(timeoutFor(3), 123000, 'kuyruktaki her is icin 16sn pay');
  assert.equal(timeoutFor(50), 240000, 'ust sinir 240sn');
  assert.equal(timeoutFor(undefined), 75000);

  // ── Sonuc kutusu meta satiri: model + sure ────────────────────────────────
  const metaStart = contentSource.indexOf('function resultMetaText');
  assert.ok(metaStart > 0, 'content.js icinde resultMetaText bulunamadi');
  const metaEnd = contentSource.indexOf('function setResultMeta', metaStart);
  assert.ok(metaEnd > metaStart, 'resultMetaText govdesi bulunamadi');
  const metaContext = vm.createContext({});
  vm.runInContext(contentSource.slice(metaStart, metaEnd), metaContext);
  assert.equal(metaContext.resultMetaText({ modelLabel: 'Gemini 3.5 Flash Lite', elapsedMs: 1140 }),
    'Gemini 3.5 Flash Lite · 1.1 sn');
  assert.equal(metaContext.resultMetaText({ modelLabel: 'Gemini 3.5 Flash Lite', elapsedMs: 1140, fallbackUsed: true }),
    'Gemini 3.5 Flash Lite · yedek model · 1.1 sn');
  assert.equal(metaContext.resultMetaText(null), '');

  console.log('Model fallback, yavas model korumasi, adaptif kuyruk ve meta satiri testleri gecti.');
})().catch(error => { console.error(error); process.exitCode = 1; });
