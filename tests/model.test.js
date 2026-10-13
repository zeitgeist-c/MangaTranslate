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

(async () => {
  // ── Model listesi ve etiket butunlugu ──────────────────────────────────────
  assert.deepEqual([...values], [
    'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemma-4-26b-a4b-it',
  ], 'model rotasyonu hizli -> yavas sirali olmali (gemma-4-31b-it listede yok)');
  assert.ok(!values.includes('gemma-4-31b-it'), 'kaldirilan model zincire geri sizmamali');
  const labels = vm.runInContext('GEMINI_MODEL_LABELS', context);
  for (const model of values) assert.ok(labels[model], `etiket eksik: ${model}`);
  const popupSource = fs.readFileSync(path.join(root, 'popup/popup.js'), 'utf8');
  const popupHtml = fs.readFileSync(path.join(root, 'popup/popup.html'), 'utf8');
  vm.runInContext(fs.readFileSync(path.join(root, 'src/providers.js'), 'utf8'), context);
  assert.deepEqual(context.MLProviders.catalog.gemini.map(([id]) => id).join(','), [...values].join(','));
  assert.ok(popupSource.includes('MLUI.models('), 'popup ortak model katalogunu kullanmali');
  assert.ok(popupHtml.includes('id="model"'), 'popup model secimi bulunmali');
  assert.ok(!popupHtml.includes('gemma-4-31b-it'), 'kaldirilan model popup listesinde kalmamali');

  // ── Yedek zincir: secili modelden baslar, 3 modeli de dolasir ───────────────
  for (const selected of values) {
    const tried = [];
    const result = await context.executeWithModelFallback(selected, async model => {
      tried.push(model);
      if (tried.length < 3) throw new Error('temporarily unavailable');
      return 'translated';
    });
    assert.equal(tried[0], selected, 'once secili model denenmeli');
    assert.equal(new Set(tried).size, 3, 'zincir 3 modeli de kapsamali');
    assert.equal(result.model, tried[2]);
    assert.equal(result.fallbackUsed, true);
  }

  await assert.rejects(
    context.executeWithModelFallback(models.GEMMA_FAST, async () => {
      const error = new Error('invalid key'); error.status = 'invalid'; throw error;
    }),
    /invalid key/,
  );

  const answer = await context.callGemini({
    apiKey: 'test-key', model: models.GEMMA_FAST, prompt: 'Read image',
    imageBase64: { mime: 'image/png', base64: 'AA==' }, responseMimeType: 'application/json',
  });
  assert.equal(answer, 'OK');
  assert.equal(requests[0].body.contents[0].parts[1].inline_data.mime_type, 'image/png');

  // ── Kaldirilan model: bilinmeyen ad varsayilana duser, zincire sizmaz ──────
  assert.equal(context.normalizeGeminiModel('gemma-4-31b-it'), 'gemini-3.5-flash-lite',
    'kaldirilan model adi varsayilan modele normalize edilmeli');

  // ── Adaptif aralik matematigi (olcum: 2.5sn taban, 429'da artar, temizde azalir) ──
  assert.equal(vm.runInContext('MIN_INTERVAL_MS', context), 2500, 'taban aralik 2.5sn olmali');
  assert.equal(context.nextIntervalAfterSuccess(10000), 8500);
  assert.equal(context.nextIntervalAfterSuccess(2600), 2500, 'taban altina inmemeli');
  assert.equal(context.nextIntervalAfterRateLimit(2500), 6000, '429 sonrasi en az 6sn');
  assert.equal(context.nextIntervalAfterRateLimit(20000), 30000, 'ust sinir 30sn');

  // ── Gemma modelleri: responseMimeType yok, thinkingConfig minimal ──────────
  for (const gemma of [models.GEMMA_FAST]) {
    const gemmaAnswer = await context.callGemini({
      apiKey: 'test-key', model: gemma, prompt: 'Read image',
      imageBase64: { mime: 'image/png', base64: 'AA==' }, responseMimeType: 'application/json',
    });
    assert.equal(gemmaAnswer, 'OK');
    const gemmaRequest = requests[requests.length - 1];
    assert.match(gemmaRequest.url, new RegExp(`${gemma}:generateContent`));
    assert.equal(gemmaRequest.body.generationConfig.responseMimeType, undefined);
    assert.equal(gemmaRequest.body.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
    assert.equal(gemmaRequest.body.contents[0].parts[1].inline_data.mime_type, 'image/png');
  }

  // ── Sert tavan tek sabit: yumusak tavan makinesi v3.1.5'te kaldirildi ──────
  assert.equal(vm.runInContext('REQUEST_TIMEOUT', context), 45000, 'model basina tavan 45sn olmali');

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

  console.log('Model zinciri, adaptif kuyruk, dinamik bekleme ve meta satiri testleri gecti.');
})().catch(error => { console.error(error); process.exitCode = 1; });
