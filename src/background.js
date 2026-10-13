// dosya: src/background.js (v2.5 - API key yonetimi)
// Google Gemini native API. API key artik chrome.storage.local'dan okunuyor.

'use strict';

if (typeof importScripts === 'function') importScripts('providers.js', 'keys.js', 'page-background.js');

const GEMINI_MODELS = Object.freeze({
  DEFAULT: 'gemini-3.5-flash-lite',
  FALLBACK: 'gemini-3.1-flash-lite',
  GEMMA_FAST: 'gemma-4-26b-a4b-it',
});
// Sirasi = yedek model rotasyon sirasi (hizli -> yavas). Secili modelden baslanir.
const GEMINI_MODEL_VALUES = Object.freeze(Object.values(GEMINI_MODELS));
const GEMINI_MODEL_LABELS = Object.freeze({
  [GEMINI_MODELS.DEFAULT]: 'Gemini 3.5 Flash Lite',
  [GEMINI_MODELS.FALLBACK]: 'Gemini 3.1 Flash Lite',
  [GEMINI_MODELS.GEMMA_FAST]: 'Gemma 4 26B A4B',
});
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const REQUEST_TIMEOUT = 45000;        // model basina tavani (asilirsa yedek modele gecilir)

// v2: Rate limit yonetimi — v3.1.4 adaptif aralik
// Olcum (19 Eyl): 2.5sn x 24 istek temiz (24 RPM), 2.0sn'de 9. istekte 429 -> anahtar siniri 30 RPM.
const MIN_INTERVAL_MS = 2500;         // taban aralik (istekler arasi)
const MAX_INTERVAL_MS = 30000;        // 429 sonrasi ulasilabilecek en yuksek aralik
const INTERVAL_DECAY = 0.85;          // basarili istekte araligi yumusakca dusur
const BACKOFF_INITIAL_MS = 30000;     // 429 alinca ilk bekleme
const BACKOFF_MAX_MS = 120000;        // maksimum backoff
const requestQueue = [];
let lastFinishTime = 0;
let intervalMs = MIN_INTERVAL_MS;
let activeRequest = false;

// v3: SW state persistence — lastFinishTime storage.session'da saklanir
const RATE_STATE_KEY = 'ml_rate_state';
const TRANSLATION_STATS_KEY = 'translationStats';

async function loadRateState() {
  try {
    const data = await chrome.storage.session.get([RATE_STATE_KEY]);
    lastFinishTime = data[RATE_STATE_KEY]?.lastFinish || 0;
    const saved = Number(data[RATE_STATE_KEY]?.intervalMs);
    intervalMs = Number.isFinite(saved) && saved > 0
      ? Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, saved))
      : MIN_INTERVAL_MS;
  } catch(e) { lastFinishTime = 0; intervalMs = MIN_INTERVAL_MS; }
}

async function saveRateState(ts, nextInterval) {
  lastFinishTime = ts;
  if (Number.isFinite(nextInterval) && nextInterval > 0) {
    intervalMs = Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, nextInterval));
  }
  try {
    await chrome.storage.session.set({ [RATE_STATE_KEY]: { lastFinish: ts, intervalMs } });
  } catch(e) {}
}

// v3.1.4: adaptif aralik saf matematigi (test edilebilir)
function nextIntervalAfterSuccess(current) {
  const value = Number.isFinite(current) && current > 0 ? current : MIN_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, Math.round(value * INTERVAL_DECAY));
}

function nextIntervalAfterRateLimit(current) {
  const value = Number.isFinite(current) && current > 0 ? current : MIN_INTERVAL_MS;
  return Math.min(MAX_INTERVAL_MS, Math.max(6000, Math.round(value * 2)));
}

// v3: Alarm — SW'i uyanik tut + queue isle
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('keepalive', { periodInMinutes: 0.4 }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('keepalive', { periodInMinutes: 0.4 }).catch(() => {});
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') processRateLimitedQueue();
});

// Sw basladiginda son lastFinishTime'i yukle
loadRateState();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === 'EXTRACT_BUBBLES') {
    handleExtract(message)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(err => sendResponse({ success: false, error: err.message, errors: err.errors }));
    return true;
  }

  // v3.1.4: content tarafindaki bekleme suresini kuyruk derinligine gore ayarlamak icin
  if (message.type === 'GET_QUEUE_STATE') {
    sendResponse({
      queueDepth: requestQueue.length,
      activeRequest,
      intervalMs: Math.max(MIN_INTERVAL_MS, intervalMs),
    });
    return false;
  }

  if (message.type === 'CAPTURE_TAB') {
    try {
      // Gonderen sekmenin penceresini yakala (cok pencerede yanlis ekran riski).
      const captureTarget = sender && sender.tab && typeof sender.tab.windowId === 'number'
        ? chrome.tabs.captureVisibleTab(sender.tab.windowId)
        : chrome.tabs.captureVisibleTab();
      captureTarget
        .then(dataUrl => sendResponse({ dataUrl }))
        .catch(e => sendResponse({ dataUrl: null, error: e.message }));
    } catch (e) {
      sendResponse({ dataUrl: null, error: e.message });
    }
    return true;
  }

  // v2.5: API key test et
  if (message.type === 'TEST_API_KEY') {
    testApiKey(message.apiKey)
      .then(r => sendResponse({ success: r.status === 'success', ...r }))
      .catch(err => sendResponse({ success: false, status: err.status || 'error', message: err.message }));
    return true;
  }
});

// v2.7: Structured prompt — JSON schema, "balloons" wrapper, explicit requirements
const BASE_PROMPT = 'You are analyzing a manga/comic image.\n' +
  'Detect all visible speech bubbles, narration boxes, signs, and readable text.\n' +
  'Return ONLY valid JSON. Do NOT use markdown. Do NOT explain.\n\n' +
  'OUTPUT SCHEMA:\n' +
  '{\n' +
  '  "balloons": [\n' +
  '    {\n' +
  '      "text": "English text",\n' +
  '      "translation": "Turkish translation",\n' +
  '      "x": 0, "y": 0, "width": 100, "height": 50\n' +
  '    }\n' +
  '  ]\n' +
  '}\n\n' +
  'RULES:\n' +
  '- Coordinates are PIXELS of the input image (integers, top-left origin).\n' +
  '- Tight bbox: include bubble border NOT surrounding art.\n' +
  '- Order top-to-bottom, left-to-right.\n' +
  '- Translate text to natural Turkish in "translation" field.\n' +
  '- SFX: translate e.g. BOOM -> GUM, CRACK -> CAT. Keep short.\n' +
  '- If NO readable text, return {"balloons":[]}.\n' +
  '- NEVER return empty string. NEVER return markdown.';

function buildTranslationPrompt(translationMode, alternativeAttempt) {
  if (translationMode !== 'alternative') return BASE_PROMPT;
  const strategies = [
    'Translate independently with natural, everyday Turkish dialogue. Favor idiomatic phrasing over literal word order.',
    'Translate independently with strong awareness of character voice, emotion, scene context, and conversational flow.',
    'Translate independently into concise, fluent Turkish that reads naturally inside a manga speech bubble.',
  ];
  const attempt = Math.max(1, Number(alternativeAttempt) || 1);
  const strategy = strategies[(attempt - 1) % strategies.length];
  return BASE_PROMPT + '\n\nALTERNATIVE TRANSLATION MODE:\n' +
    '- Re-read the source text from the image independently.\n' +
    '- Do not assume or reconstruct any previous Turkish answer.\n' +
    '- Produce a genuinely fresh alternative while preserving meaning.\n' +
    '- ' + strategy;
}

async function handleExtract({ dataUrl, w, h, translationMode, alternativeAttempt }) {
  if (!dataUrl) throw new Error('dataUrl eksik');

  if (typeof MLProviders !== 'undefined') {
    const config = await mlConfig(), started = Date.now();
    const prompt = buildTranslationPrompt(translationMode, alternativeAttempt) + '\n' + MLProviders.style(config) +
      '\nRead the complete selected crop. Image dimensions: ' + w + 'x' + h;
    const raw = await mlEnqueue(config, () => mlProviderCall(config, prompt, [{ dataUrl }]));
    const bubbles = parseBubbleArray(raw, w, h);
    if (bubbles.length) await incrementTranslationStats();
    return { bubbles, model: config.model, modelLabel: config.model, provider: config.provider, fallbackUsed: false, elapsedMs: Date.now() - started };
  }

  // v2.5: aktif API key'i storage'dan al
  const apiKey = await getActiveApiKey();
  if (!apiKey) {
    throw new Error('Lutfen once Google Gemini API anahtari ekleyin ve aktif yapin.');
  }
  const selectedModel = await getSelectedGeminiModel();

  // v2: rate-limited queue uzerinden calistir
  const startedAt = Date.now();
  const result = await enqueueWithRateLimit(() =>
    executeWithModelFallback(selectedModel, model =>
      callMultimodal(apiKey, model, dataUrl, w, h, translationMode, alternativeAttempt)
    )
  );
  const elapsedMs = Date.now() - startedAt;
  const bubbles = result.value;

  if (bubbles && bubbles.length > 0) {
    await incrementTranslationStats();
  }
  return {
    bubbles: bubbles || [],
    model: result.model,
    modelLabel: GEMINI_MODEL_LABELS[result.model] || result.model,
    fallbackUsed: result.fallbackUsed,
    elapsedMs,
  };
}

function getMinuteBucket(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function getDayBucket(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function incrementTranslationStats() {
  const now = new Date();
  const minuteBucket = getMinuteBucket(now);
  const dayBucket = getDayBucket(now);
  const data = await chrome.storage.local.get([TRANSLATION_STATS_KEY]);
  const stats = data[TRANSLATION_STATS_KEY] || {
    minute: { bucket: minuteBucket, count: 0 },
    day: { bucket: dayBucket, count: 0 },
    lifetime: { count: 0 },
  };

  if (!stats.minute || stats.minute.bucket !== minuteBucket) {
    stats.minute = { bucket: minuteBucket, count: 0 };
  }
  if (!stats.day || stats.day.bucket !== dayBucket) {
    stats.day = { bucket: dayBucket, count: 0 };
  }
  if (!stats.lifetime) {
    stats.lifetime = { count: 0 };
  }

  stats.minute.count += 1;
  stats.day.count += 1;
  stats.lifetime.count += 1;

  await chrome.storage.local.set({ [TRANSLATION_STATS_KEY]: stats });
  return stats;
}

async function callMultimodal(apiKey, model, dataUrl, w, h, translationMode, alternativeAttempt) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) throw new Error('Gecersiz dataUrl formati');
  const mime = m[1];
  const base64 = m[2];
  const isAlternative = translationMode === 'alternative';

  const text = await callGemini({
    apiKey,
    model,
    prompt: buildTranslationPrompt(translationMode, alternativeAttempt) + '\n[Image: ' + w + 'x' + h + ']',
    imageBase64: { mime, base64 },
    responseMimeType: 'application/json',
    temperature: model === GEMINI_MODELS.FALLBACK ? (isAlternative ? 0.65 : 0.2) : undefined,
  });

  return parseBubbleArray(text || '[]', w, h);
}
/**
 * v2.7: Tek Gemini client helper.
 * Translation + test + response hardening (finishReason, candidates, empty).
 */
async function callGemini({ apiKey, model, prompt, imageBase64, responseMimeType, temperature }) {
  if (!apiKey) throw new Error('API key eksik');
  const normalizedModel = normalizeGeminiModel(model);

  const parts = [{ text: prompt }];
  if (imageBase64) {
    parts.push({ inline_data: { mime_type: imageBase64.mime, data: imageBase64.base64 } });
  }
  const isGemma = normalizedModel === GEMINI_MODELS.GEMMA_FAST;

  const body = {
    contents: [{ parts }],
    generationConfig: {
      maxOutputTokens: 8192,
      ...(normalizedModel === GEMINI_MODELS.FALLBACK && typeof temperature === 'number' ? { temperature } : {}),
      ...(isGemma ? { thinkingConfig: { thinkingLevel: 'minimal' } } : {}),
      ...(!isGemma && responseMimeType ? { responseMimeType } : {}),
    },
  };

  const url = GEMINI_BASE + '/' + normalizedModel + ':generateContent?key=' + apiKey;

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw normalizeFetchError(e);
  } finally {
    clearTimeout(tid);
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    console.warn('[MangaLens-bg] Gemini HTTP', res.status, JSON.stringify(errBody).slice(0, 300));
    throw normalizeGeminiError(res.status, errBody);
  }

  // v2.7: Parse response
  const json = await res.json();

  const candidates = json?.candidates || [];
  if (candidates.length === 0) {
    const blockReason = json?.promptFeedback?.blockReason;
    if (blockReason) {
      throw new Error('Gemini istegi bloklandi. (blockReason: ' + blockReason + ')');
    }
    throw new Error('Gemini candidates bos döndü. (safety block?)');
  }

  const finishReason = candidates[0]?.finishReason;
  if (finishReason === 'SAFETY' || finishReason === 'BLOCKLIST') {
    throw new Error('Gemini response safety tarafindan bloklandi.');
  }

  // v2.7: Tum parts arrayini birlestir (sadece ilk degil)
  const partsArr = candidates[0]?.content?.parts || [];
  let text = '';
  for (const part of partsArr) {
    if (!part.thought && typeof part.text === 'string') text += part.text + '\n';
  }
  text = text.trim();

  // Reasoning fallback
  if (!text && Array.isArray(candidates[0]?.message?.reasoning_details)) {
    text = candidates[0].message.reasoning_details
      .map(r => r?.text || '').join('\n').trim();
  }

  // v2.7: Bos text → hata (0 balon sayma)
  if (!text) {
    throw new Error('Gemini bos cevap dondurdu. (finishReason: ' + (finishReason || 'yok') + ')');
  }

  return text;
}

/**
 * v2.5: Gemini hata yanitini normalize et (kullanici dostu mesaj + status).
 * status: 'invalid' | 'rate_limited' | 'error'
 */
function normalizeGeminiError(status, body) {
  if (status === 401) {
    const e = new Error('API key gecersiz veya bu modele erisim yetkisi yok.');
    e.status = 'invalid';
    return e;
  }
  if (status === 403) {
    const e = new Error('Bu modele erisim yetkisi yok veya API istegi engellendi.');
    e.status = 'forbidden';
    return e;
  }
  if (status === 429) {
    const e = new Error('Rate limit veya kota dolmus.');
    e.status = 'rate_limited';
    return e;
  }
  const e = new Error('Gemini ' + status + ': ' + (body?.error?.message || 'Bilinmeyen hata'));
  e.status = 'error';
  return e;
}

function normalizeFetchError(err) {
  const msg = String(err && err.message || err || '');
  if (err && err.name === 'AbortError') {
    const e = new Error('Gemini istegi zaman asimina ugradi. Baglanti yavas veya API yanit vermiyor.');
    e.status = 'timeout';
    return e;
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    const e = new Error('Gemini baglantisi kurulamadı. Internet/VPN/proxy veya generativelanguage.googleapis.com erisimi engellenmis olabilir.');
    e.status = 'network';
    return e;
  }
  const e = new Error('Gemini ag hatasi: ' + (msg || 'Bilinmeyen fetch hatasi'));
  e.status = 'network';
  return e;
}

/**
 * v2.5: Aktif API key'i chrome.storage.local'dan oku.
 * chrome.storage.sync olarak da dene (geriye uyumluluk).
 */
async function getActiveApiKey() {
  if (typeof MLKeys !== 'undefined') return MLKeys.active('gemini');
  const data = await new Promise(resolve => {
    chrome.storage.local.get(['googleApiKeys', 'activeGoogleApiKeyId'], d => resolve(d));
  });
  const list = data.googleApiKeys || [];
  const activeId = data.activeGoogleApiKeyId;
  const active = list.find(k => k.id === activeId);
  return active ? active.key : null;
}

function normalizeGeminiModel(model) {
  return GEMINI_MODEL_VALUES.includes(model) ? model : GEMINI_MODELS.DEFAULT;
}

async function getSelectedGeminiModel() {
  const data = await chrome.storage.sync.get({ geminiModel: GEMINI_MODELS.DEFAULT });
  return normalizeGeminiModel(data.geminiModel);
}

/**
 * v3.1.5: Secili modelden baslar; hizli -> yavas rotasyonla diger modeller denenir.
 * Her denemede REQUEST_TIMEOUT tavani gecerlidir (401/403 'invalid' ise hic yedek denenmez).
 */
async function executeWithModelFallback(selectedModel, operation) {
  const primaryModel = normalizeGeminiModel(selectedModel);
  const start = GEMINI_MODEL_VALUES.indexOf(primaryModel);
  const chain = GEMINI_MODEL_VALUES.slice(start).concat(GEMINI_MODEL_VALUES.slice(0, start));
  const errors = {};

  for (const model of chain) {
    try {
      const value = await operation(model);
      return { value, model, fallbackUsed: model !== primaryModel };
    } catch (attemptError) {
      if (attemptError?.status === 'invalid') throw attemptError;
      errors[model] = attemptError?.message || String(attemptError);
      console.warn('[MangaLens-bg] Model failed:', model, errors[model]);
    }
  }
  const error = new Error('Tüm modeller başarısız oldu. ' + chain
    .map(model => GEMINI_MODEL_LABELS[model] + ': ' + errors[model]).join(' | '));
  error.status = 'error';
  error.fallbackAttempted = true;
  error.errors = errors;
  throw error;
}

/**
 * v2.5: API key test et. Kisa "Reply with OK only." promptu, JSON yok.
 */
async function testApiKey(apiKey) {
  if (typeof MLProviders !== 'undefined') {
    const model = await getSelectedGeminiModel();
    try {
      await mlProviderCall({ provider: 'gemini', model }, 'Return JSON {"ok":true}.', [], apiKey);
      return { status: 'success', model, fallbackUsed: false };
    } catch (error) { return { status: 'error', model, fallbackUsed: false, message: error.message }; }
  }
  if (!apiKey) throw new Error('API key bos');
  const selectedModel = await getSelectedGeminiModel();
  try {
    const result = await executeWithModelFallback(selectedModel, model =>
      callGemini({ apiKey, model, prompt: 'Reply with OK only.' })
    );
    return {
      status: 'success',
      message: result.fallbackUsed ? 'API, ' + GEMINI_MODEL_LABELS[result.model] + ' yedek modeli ile calisiyor.' : 'API calisiyor.',
      model: result.model,
      fallbackUsed: result.fallbackUsed,
    };
  } catch (e) {
    if (!e.status) e.status = 'error';
    return {
      status: e.status,
      message: e.message,
      model: null,
      fallbackUsed: false,
      fallbackAttempted: e.fallbackAttempted === true,
    };
  }
}

// v2.7: parseBubbleArray boş/geçersiz girişte hata fırlatır → cache yazılmaz
function parseBubbleArray(raw, w, h) {
  if (!raw || !String(raw).trim()) {
    throw new Error('parseBubbleArray: bos giris');
  }

  var s = String(raw)
    .replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1')  // markdown fences
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '') // thinking
    .trim();

  // Try direct array format: [...]
  var first = s.indexOf('[');
  var last  = s.lastIndexOf(']');
  if (first >= 0 && last > first) {
    try {
      var arr = JSON.parse(s.slice(first, last + 1));
      if (Array.isArray(arr)) return validateBubbles(arr, w, h);
    } catch (e) { /* fall through to object format */ }
  }

  // Try object format: {"balloons": [...]} veya {"texts": [...]}
  try {
    var obj = JSON.parse(s);
    if (Array.isArray(obj.balloons)) return validateBubbles(obj.balloons, w, h);
    if (Array.isArray(obj.texts)) return validateBubbles(obj.texts, w, h);
  } catch (e) { /* fall through */ }

  throw new Error('parseBubbleArray: JSON array veya {balloons:[]} bulunamadi. raw=' + s.slice(0, 120));
}

// v2.7: Ortak bubble validation — her kaynaktan gelen bubble'i ayni mantikla dogrula
function validateBubbles(arr, w, h) {
  if (!Array.isArray(arr)) throw new Error('validateBubbles: array degil');
  return arr
    .filter(it => it && typeof it === 'object')
    .map(it => {
      var rawX = it.x || it.left || 0;
      var rawY = it.y || it.top || 0;
      var rawW = it.width || it.w || it.right - it.x || 0;
      var rawH = it.height || it.h || it.bottom - it.y || 0;
      var fitted = fitBubbleBoxToImage(rawX, rawY, rawW, rawH, w, h);
      if (!fitted) {
        console.warn('[MangaLens-bg] balon atildi (goruntu disi koordinat):', rawX, rawY, rawW, rawH, 'limit:', w, h);
        return null;
      }
      if (fitted.adjusted) {
        console.warn('[MangaLens-bg] balon koordinati sinira sigdirildi:', rawX, rawY, rawW, rawH, '->',
          fitted.x, fitted.y, fitted.width, fitted.height, 'limit:', w, h);
      }
      return {
        text: String(it.text || '').slice(0, 200).trim(),
        translation: String(it.translation || '').slice(0, 200).trim(),
        x: fitted.x, y: fitted.y, width: fitted.width, height: fitted.height,
      };
    })
    .filter(b => b && (b.text || b.translation) && b.width > 0 && b.height > 0);
}

function fitBubbleBoxToImage(rawX, rawY, rawW, rawH, imageW, imageH) {
  var x0 = Number(rawX);
  var y0 = Number(rawY);
  var bw0 = Number(rawW);
  var bh0 = Number(rawH);
  if (!Number.isFinite(x0) || !Number.isFinite(y0)) return null;
  if (!Number.isFinite(bw0) || bw0 <= 0) bw0 = Math.max(1, imageW - x0);
  if (!Number.isFinite(bh0) || bh0 <= 0) bh0 = Math.max(1, imageH - y0);

  var right = x0 + bw0;
  var bottom = y0 + bh0;
  var overlapW = Math.min(right, imageW) - Math.max(x0, 0);
  var overlapH = Math.min(bottom, imageH) - Math.max(y0, 0);
  if (overlapW <= 0 || overlapH <= 0) return null;

  var width = clampInt(bw0, 1, imageW);
  var height = clampInt(bh0, 1, imageH);
  var x = Math.round(x0);
  var y = Math.round(y0);

  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x + width > imageW) x = Math.max(0, imageW - width);
  if (y + height > imageH) y = Math.max(0, imageH - height);

  return {
    x: x,
    y: y,
    width: width,
    height: height,
    adjusted:
      Math.abs(x - Math.round(x0)) > 1 ||
      Math.abs(y - Math.round(y0)) > 1 ||
      Math.abs(width - Math.round(bw0)) > 1 ||
      Math.abs(height - Math.round(bh0)) > 1,
  };
}

function clampInt(v, min, max) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

// ══════════════════════════════════════════════════════════════════════════════
//  v2: Rate-Limited Sequential Queue
// ══════════════════════════════════════════════════════════════════════════════

function enqueueWithRateLimit(fn, options = {}) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ fn, resolve, reject, retries: 0, allowRetry: options.retry !== false });
    processRateLimitedQueue();
  });
}

async function processRateLimitedQueue() {
  if (activeRequest || requestQueue.length === 0) return;

  const item = requestQueue.shift();
  activeRequest = true;

  try {
    // onceki istek BITTIKTEN sonra gecerli aralik kadar gecmis mi? (v3.1.4: aralik adaptif)
    const now = Date.now();
    const elapsed = now - lastFinishTime;
    const spacing = Math.max(MIN_INTERVAL_MS, intervalMs);
    if (lastFinishTime > 0 && elapsed < spacing) {
      const wait = spacing - elapsed;
      await new Promise(r => setTimeout(r, wait));
    }

    try {
      const result = await item.fn();
      saveRateState(Date.now(), nextIntervalAfterSuccess(intervalMs));
      item.resolve(result);
    } catch (e) {
      // 429 veya timeout → backoff ile retry
      // Retry edilebilir mi? status'e bak (mesaj dili degisebilir, regex tek basina yetmez).
      const errText = String((e && e.message) || '');
      const errStatus = e && e.status;
      if (errStatus === 'rate_limited' || /429|rate[\s_-]?limit|kota/i.test(errText)) {
        const raised = nextIntervalAfterRateLimit(intervalMs);
        console.warn('[MangaLens-bg] rate limit -> aralik', intervalMs, '->', raised, 'ms');
        intervalMs = raised;
      }
      const isRetryable = errStatus === 'rate_limited' || errStatus === 'timeout' ||
        /429|timeout|rate[\s_-]?limit|kota|zaman as/i.test(errText);
      if (isRetryable && item.allowRetry !== false && item.retries < 3) {
        const backoff = Math.min(BACKOFF_INITIAL_MS * Math.pow(2, item.retries), BACKOFF_MAX_MS);
        console.warn('[MangaLens-bg] retryable hata:', e.message, '-> backoff:', backoff, 'ms');
        saveRateState(Date.now() + backoff, intervalMs);  // backoff kadar bekleme zorla
        requestQueue.unshift({ ...item, retries: item.retries + 1 });
      } else {
        saveRateState(Date.now(), intervalMs);
        item.reject(e);
      }
    }
  } finally {
    activeRequest = false;
    if (requestQueue.length > 0) {
      processRateLimitedQueue();
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
