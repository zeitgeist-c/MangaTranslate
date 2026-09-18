// dosya: src/background.js (v2.5 - API key yonetimi)
// Google Gemini native API. API key artik chrome.storage.local'dan okunuyor.

'use strict';

// v3.2: sayfa modu saf yardimcilari (bant/dedupe/dogrulama) — content ile ayni kaynak
importScripts('/src/pagemode-core.js');
importScripts('/src/local-match.js');
const MLCore = self.MLPagemodeCore;
const MLLocalMatch = self.MLLocalMatch;

const GEMINI_MODELS = Object.freeze({
  DEFAULT: 'gemini-3.5-flash-lite',
  FALLBACK: 'gemini-3.1-flash-lite',
  GEMMA: 'gemma-4-31b-it',
});
const GEMINI_MODEL_VALUES = Object.freeze(Object.values(GEMINI_MODELS));
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const REQUEST_TIMEOUT = 45000;

// v3.2: sayfa modu sabitleri (bantlama/sayfa bolme content tarafinda yapilir)
const PAGE_MAX_TEXT = 600;               // sayfa modunda metin kesme siniri (200 degil)
const PAGE_MAX_IMAGE_BYTES = 12 * 1024 * 1024;

// v2: Rate limit yonetimi (Gemini 10 RPM = ~6sn minimum aralik)
const MIN_INTERVAL_MS = 6000;        // istekler arasi minimum bekleme
const BACKOFF_INITIAL_MS = 30000;     // 429 alinca ilk bekleme
const BACKOFF_MAX_MS = 120000;        // maksimum backoff
const requestQueue = [];
let lastFinishTime = 0;
let activeRequest = false;

// v3: SW state persistence — lastFinishTime storage.session'da saklanir
const RATE_STATE_KEY = 'ml_rate_state';
const TRANSLATION_STATS_KEY = 'translationStats';

async function loadRateState() {
  try {
    const data = await chrome.storage.session.get([RATE_STATE_KEY]);
    lastFinishTime = data[RATE_STATE_KEY]?.lastFinish || 0;
  } catch(e) { lastFinishTime = 0; }
}

async function saveRateState(ts) {
  lastFinishTime = ts;
  try {
    await chrome.storage.session.set({ [RATE_STATE_KEY]: { lastFinish: ts } });
  } catch(e) {}
}

// v3: Alarm — SW'i uyanik tut + queue isle
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('keepalive', { periodInMinutes: 0.4 }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('keepalive', { periodInMinutes: 0.4 }).catch(() => {});
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    processRateLimitedQueue();
    notifyPageProgress();
  }
});

// Sw basladiginda son lastFinishTime'i yukle
loadRateState();

const NATIVE_HOST_NAME = 'com.mangalens.tr';
let nativePort = null;
const nativePending = new Map();
let nextNativeId = 1;

function nativeRequest(payload, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    try {
      if (!nativePort) {
        nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
        nativePort.onMessage.addListener(message => {
          const pending = nativePending.get(message && message.id);
          if (!pending) return;
          nativePending.delete(message.id);
          clearTimeout(pending.timer);
          if (!message.ok) pending.reject(new Error(message.error || 'Yerel yardımcı hatası'));
          else pending.resolve(message);
        });
        nativePort.onDisconnect.addListener(() => {
          const error = new Error((chrome.runtime.lastError && chrome.runtime.lastError.message) || 'Yerel yardımcı bağlantısı kesildi');
          nativePort = null;
          nativePending.forEach(pending => { clearTimeout(pending.timer); pending.reject(error); });
          nativePending.clear();
        });
      }
      const id = nextNativeId++;
      const timer = setTimeout(() => {
        nativePending.delete(id);
        reject(new Error('Yerel yardımcı zaman aşımı'));
      }, timeoutMs);
      nativePending.set(id, { resolve, reject, timer });
      nativePort.postMessage(Object.assign({}, payload, { id }));
    } catch (error) {
      reject(error);
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === 'PING_LOCAL_HELPER') {
    nativeRequest({ type: 'ping' }, 10000)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'EXTRACT_BUBBLES') {
    handleExtract(message)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(err => sendResponse({ success: false, error: err.message, errors: err.errors }));
    return true;
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

  // v3.2: orijinal gorseli SW'de indir (host_permissions <all_urls> sayesinde CORS engeli yok)
  if (message.type === 'FETCH_IMAGE') {
    fetchImageAsDataUrl(message.url)
      .then(r => sendResponse(r))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // v3.2: sayfa modu — bant istegi (asenkron sonuc itme + iptal)
  if (message.type === 'TRANSLATE_PAGE') {
    handleTranslatePage(message, sender)
      .then(r => sendResponse(r))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'CANCEL_PAGE_JOBS') {
    let cancelled = 0;
    for (const item of requestQueue) {
      if (!item) continue;
      const match = item.meta && item.meta.tabId === sender?.tab?.id && (message.all || item.meta.pageKey === message.pageKey);
      if (match && item.meta) { item.cancelled = true; cancelled++; }
    }
    pageJobs.forEach(job => {
      if (job.tabId === sender?.tab?.id && (message.all || job.pageKey === message.pageKey)) job.state = 'cancelled';
    });
    sendResponse({ ok: true, cancelled });
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

// v3.2: Sayfa modu prompt'u — PIKSEl koordinati + balon bolgesi + komsu birlestirme yasagi
const PAGE_PROMPT = 'You are analyzing ONE image: a page (or a slice of a longer page) of a manga/comic.\n' +
  'Find EVERY speech bubble, thought bubble, narration box, sign and readable text.\n' +
  'Return ONLY valid JSON. Do NOT use markdown. Do NOT explain.\n\n' +
  'OUTPUT SCHEMA:\n' +
  '{\n' +
  '  "balloons": [\n' +
  '    { "text": "English text", "translation": "Turkish translation",\n' +
  '      "x": 120, "y": 340, "width": 210, "height": 96 }\n' +
  '  ]\n' +
  '}\n\n' +
  'COORDINATE RULES:\n' +
  '- x,y,width,height are NORMALIZED fractions of THIS image: 0.0 = left/top edge, 1.0 = right/bottom edge.\n' +
  '  Use decimals with up to 3 digits (example: 0.235). Do NOT use pixel values and do NOT use 0-1000 values.\n' +
  '- Example: a bubble whose left edge is 23% from the left and top edge 41% down, 30% wide, 8% tall:\n' +
  '  { "text": "...", "translation": "...", "x": 0.23, "y": 0.41, "width": 0.30, "height": 0.08 }\n' +
  '- Each box must be the BUBBLE REGION itself: the balloon shape INCLUDING its outline.\n' +
  '  Never box only the text glyphs, and never box the surrounding artwork.\n' +
  '- Boxes must be tight: their edges sit on the bubble border.\n' +
  '- Order top-to-bottom, then left-to-right.\n\n' +
  'CONTENT RULES:\n' +
  '- ONE bubble = ONE entry. Never merge two adjacent bubbles into one entry, even when they touch.\n' +
  '- Never split one bubble into two entries.\n' +
  '- For lettering without a bubble (SFX, background text), box exactly the lettering.\n' +
  '- "translation" must be natural Turkish dialogue, short enough to fit the bubble.\n' +
  '- SFX: translate (BOOM -> GUM, CRACK -> CAT). Keep short.\n' +
  '- If the lettering is unreadable, skip that bubble instead of inventing text.\n' +
  '- If there is NO readable text, return {"balloons":[]}.\n' +
  'NEVER return markdown.';

function buildPagePrompt() { return PAGE_PROMPT; }

function buildLocalTextPrompt(items) {
  return 'Translate the following OCR text from English comic speech balloons into concise, natural Turkish. ' +
    'These lines are in page order; use neighboring lines only as context. Return ONLY JSON: ' +
    '{"items":[{"id":0,"translation":"..."}]}. Include each id exactly once, preserve meaning, never invent missing text.\n' +
    JSON.stringify(items.map((item, id) => ({ id, text: item.ocr })));
}

function parseLocalTranslations(raw, items) {
  const source = String(raw || '').trim();
  const start = source.indexOf('{'), end = source.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Yerel metin çevirisi JSON değil');
  const parsed = JSON.parse(source.slice(start, end + 1));
  if (!Array.isArray(parsed.items)) throw new Error('Yerel metin çevirisi listesi yok');
  const byId = new Map();
  for (const entry of parsed.items) {
    const id = Number(entry && entry.id);
    const translation = String((entry && entry.translation) || '').trim();
    if (!Number.isInteger(id) || id < 0 || id >= items.length || !translation || byId.has(id)) continue;
    byId.set(id, translation.slice(0, PAGE_MAX_TEXT));
  }
  if (byId.size !== items.length) throw new Error('Yerel çeviride balon eksik');
  return items.map((item, id) => {
    const box = item.bubble_box;
    return { text: item.ocr, translation: byId.get(id), x: box[0], y: box[1],
      width: box[2] - box[0], height: box[3] - box[1], localPlacement: true };
  });
}

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

  // v2.5: aktif API key'i storage'dan al
  const apiKey = await getActiveApiKey();
  if (!apiKey) {
    throw new Error('Lutfen once Google Gemini API anahtari ekleyin ve aktif yapin.');
  }
  const selectedModel = await getSelectedGeminiModel();

  // v2: rate-limited queue uzerinden calistir
  const result = await enqueueWithRateLimit(() =>
    executeWithModelFallback(selectedModel, model =>
      callMultimodal(apiKey, model, dataUrl, w, h, translationMode, alternativeAttempt)
    )
  );
  const bubbles = result.value;

  if (bubbles && bubbles.length > 0) {
    await incrementTranslationStats();
    return { bubbles, model: result.model, fallbackUsed: result.fallbackUsed };
  }
  return { bubbles: [], model: result.model, fallbackUsed: result.fallbackUsed };
}

/**
 * v3.2: Gorsel URL'ini SW'de indir (CORS engeli yok) ve dataUrl'e cevir.
 * Cerezler gonderilmez (credentials: omit) — oturum isteyen CDN'lerde content tarafi
 * gorunur-alan kirpmasina duser.
 * Doner: { ok, dataUrl, width, height, bytes } veya { ok: false, error }.
 */
async function fetchImageAsDataUrl(url) {
  if (!url || !/^https?:/i.test(url)) return { ok: false, error: 'desteklenmeyen url' };
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT);
  try {
    const res = await fetch(url, { credentials: 'omit', cache: 'force-cache', signal: ctrl.signal });
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
    const blob = await res.blob();
    if (blob.size > PAGE_MAX_IMAGE_BYTES) return { ok: false, error: 'gorsel cok buyuk (' + blob.size + ' bayt)' };
    const bitmap = await createImageBitmap(blob).catch(() => null);
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return {
      ok: true,
      dataUrl: 'data:' + (blob.type || 'image/jpeg') + ';base64,' + btoa(bin),
      width: bitmap ? bitmap.width : 0,
      height: bitmap ? bitmap.height : 0,
      bytes: blob.size,
    };
  } catch (e) {
    const msg = (e && e.name === 'AbortError') ? 'gorsel indirme zaman asimi' : String((e && e.message) || e);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(tid);
  }
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

  const body = {
    contents: [{ parts }],
    generationConfig: {
      maxOutputTokens: 8192,
      ...(normalizedModel === GEMINI_MODELS.FALLBACK && typeof temperature === 'number' ? { temperature } : {}),
      // Gemma uses the JSON instructions in the prompt, without forcing a
      // structured-output capability that is not documented for this endpoint.
      ...(responseMimeType && normalizedModel !== GEMINI_MODELS.GEMMA ? { responseMimeType } : {}),
      ...(normalizedModel === GEMINI_MODELS.GEMMA ? { thinkingConfig: { thinkingLevel: 'minimal' } } : {}),
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
  const reasons = (body?.error?.details || []).map(d => d.reason || '').join(' ');
  if (status === 401 || /API_KEY_INVALID|API_KEY_EXPIRED/i.test(reasons)) {
    const e = new Error('API anahtarı geçersiz veya süresi dolmuş.');
    e.status = 'invalid';
    return e;
  }
  if (status === 403) {
    const e = new Error('Bu modele erişim reddedildi: ' + (body?.error?.message || 'yetki bulunamadı'));
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

async function executeWithModelFallback(selectedModel, operation) {
  const primaryModel = normalizeGeminiModel(selectedModel);
  const models = [primaryModel].concat(GEMINI_MODEL_VALUES.filter(model => model !== primaryModel));
  const errors = [];
  for (const model of models) {
    try {
      const value = await operation(model);
      return { value, model, fallbackUsed: model !== primaryModel };
    } catch (error) {
      // A bad credential or disconnected network affects every model.
      if (error.status === 'invalid' || error.status === 'network' || error.status === 'cancelled') throw error;
      errors.push({ model, message: error.message, status: error.status || 'error' });
    }
  }
  const error = new Error('Tüm modeller başarısız: ' + errors.map(e => e.model + ': ' + e.message).join(' | '));
  error.status = errors.some(e => e.status === 'rate_limited') ? 'rate_limited'
    : errors.some(e => e.status === 'timeout') ? 'timeout' : 'error';
  error.fallbackAttempted = true;
  error.errors = errors;
  throw error;
}

/**
 * v2.5: API key test et. Kisa "Reply with OK only." promptu, JSON yok.
 */
async function testApiKey(apiKey) {
  if (!apiKey) throw new Error('API key bos');
  const selectedModel = await getSelectedGeminiModel();
  try {
    const result = await executeWithModelFallback(selectedModel, model =>
      callGemini({ apiKey, model, prompt: 'Reply with OK only.' })
    );
    return {
      status: 'success',
      message: result.fallbackUsed ? 'API, ' + result.model + ' yedek modeli ile çalışıyor.' : 'API calisiyor.',
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
function parseBubbleArray(raw, w, h, opts) {
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
      if (Array.isArray(arr)) return validateBubbles(arr, w, h, opts);
    } catch (e) { /* fall through to object format */ }
  }

  // Try object format: {"balloons": [...]} veya {"texts": [...]}
  try {
    var obj = JSON.parse(s);
    if (Array.isArray(obj.balloons)) return validateBubbles(obj.balloons, w, h, opts);
    if (Array.isArray(obj.texts)) return validateBubbles(obj.texts, w, h, opts);
  } catch (e) { /* fall through */ }

  throw new Error('parseBubbleArray: JSON array veya {balloons:[]} bulunamadi. raw=' + s.slice(0, 120));
}

// v2.7: Ortak bubble validation — her kaynaktan gelen bubble'i ayni mantikla dogrula
function validateBubbles(arr, w, h, opts) {
  if (!Array.isArray(arr)) throw new Error('validateBubbles: array degil');
  const o = opts || {};
  if (o.coordSpace === 'auto' || o.coordSpace === 'normalized') {
    // v3.2: sayfa modu yolu — normalize/piksel tespiti + kirpma + tekrar birlestirme.
    // Resim disina tasan kutu ATILMAZ, iceri kaydirilir (ceviri kaybi olmasin).
    const space = o.coordSpace === 'auto' ? MLCore.detectCoordSpace(arr) : 'normalized';
    const clean = MLCore.sanitizeBubbles(arr, {
      w: w,
      h: h,
      coordSpace: space,
      maxLen: o.maxLen || PAGE_MAX_TEXT,
      minSizePct: 0.004,
    });
    return MLCore.dedupeBubbles(clean, { iouThreshold: 0.6 });
  }
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

function enqueueWithRateLimit(fn, meta) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ fn, resolve, reject, retries: 0, meta: meta || null, cancelled: false });
    processRateLimitedQueue();
  });
}

async function processRateLimitedQueue() {
  if (activeRequest || requestQueue.length === 0) return;

  const item = requestQueue.shift();
  activeRequest = true;

  try {
    // v3.2: iptal edilen is hic calismaz (sayfa modu "Durdur")
    if (item.cancelled) {
      item.resolve({ cancelled: true });
      return;
    }

    // onceki istek BITTIKTEN sonra MIN_INTERVAL_MS gecmis mi?
    const now = Date.now();
    const elapsed = now - lastFinishTime;
    if (lastFinishTime > 0 && elapsed < MIN_INTERVAL_MS) {
      const wait = MIN_INTERVAL_MS - elapsed;
      if (item.meta?.onProgress) item.meta.onProgress('waiting');
      await new Promise(r => setTimeout(r, wait));
    }
    if (item.cancelled) {
      item.resolve({ cancelled: true });
      return;
    }

    try {
      if (item.meta?.onProgress) item.meta.onProgress('working');
      const result = await item.fn();
      saveRateState(Date.now());
      item.resolve(result);
      if (item.meta && typeof item.meta.onSettled === 'function') item.meta.onSettled(null, result);
    } catch (e) {
      // 429 veya timeout → backoff ile retry
      // Retry edilebilir mi? status'e bak (mesaj dili degisebilir, regex tek basina yetmez).
      const errText = String((e && e.message) || '');
      const errStatus = e && e.status;
      const isRetryable = errStatus === 'rate_limited' || errStatus === 'timeout' ||
        /429|timeout|rate[\s_-]?limit|kota|zaman as/i.test(errText);
      if (isRetryable && item.retries < 3) {
        const backoff = Math.min(BACKOFF_INITIAL_MS * Math.pow(2, item.retries), BACKOFF_MAX_MS);
        console.warn('[MangaLens-bg] retryable hata:', e.message, '-> backoff:', backoff, 'ms');
        saveRateState(Date.now() + backoff);  // backoff kadar bekleme zorla
        if (item.meta?.onProgress) item.meta.onProgress('retrying', e.message);
        requestQueue.unshift({ ...item, retries: item.retries + 1 });
      } else {
        saveRateState(Date.now());
        item.reject(e);
        // v3.2: sayfa isi ise sonucu sayfaya bildir (retry yolunda bildirim YOK)
        if (item.meta && typeof item.meta.onSettled === 'function') item.meta.onSettled(e, null);
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
//  v3.2: Sayfa Modu Isleri (asenkron teslim: sonuc sayfaya itilir)
// ══════════════════════════════════════════════════════════════════════════════

const pageJobs = new Map();   // jobId -> { tabId, cacheKey, pageKey, bandIndex, state }

function notifyPageProgress() {
  pageJobs.forEach(job => {
    if (job.state !== 'running') return;
    notifyTab(job.tabId, { type: 'PAGE_PROGRESS', pageKey: job.pageKey,
      bandIndex: job.bandIndex, status: job.progress || 'queued', error: job.error || '' });
  });
}

function notifyTab(tabId, payload) {
  if (typeof tabId !== 'number') return;
  chrome.tabs.sendMessage(tabId, payload).catch(() => {});   // sayfa kapandi/degisti
}

function findQueuedDuplicate(cacheKey, tabId, pageKey, bandIndex) {
  for (const job of pageJobs.values()) {
    if (job.cacheKey === cacheKey && job.state === 'running' && job.tabId === tabId &&
        job.pageKey === pageKey && job.bandIndex === bandIndex) return true;
  }
  return false;
}

/**
 * v3.2: Bir bant istegi. Cache HIT ise hemen cevap doner (istek yok);
 * degilse kuyruga girer, sonuc PAGE_RESULT / PAGE_JOB_FAILED ile sayfaya itilir.
 */
async function handleTranslatePage(message, sender) {
  const tabId = sender && sender.tab ? sender.tab.id : null;
  const sourceCacheKey = String(message.cacheKey || '');
  const pageKey = String(message.pageKey || '');
  const bandIndex = Number(message.bandIndex || 0);

  if (!message.dataUrl) return Promise.resolve({ ok: false, error: 'dataUrl eksik' });
  if (!sourceCacheKey) return Promise.resolve({ ok: false, error: 'cacheKey eksik' });
  const selectedModel = await getSelectedGeminiModel();
  const localSetting = await chrome.storage.sync.get({ localPlacementEnabled: false });
  const localEnabled = localSetting.localPlacementEnabled === true;
  const cacheKey = sourceCacheKey + '|model:' + selectedModel + (localEnabled ? '|local:v1' : '');
  if (findQueuedDuplicate(cacheKey, tabId, pageKey, bandIndex)) return Promise.resolve({ ok: true, duplicate: true });

  return pageCacheGet(cacheKey).then(cached => {
    if (cached) return { ok: true, cached: true, bubbles: cached.bubbles, model: cached.model };

    const jobId = crypto.randomUUID();
    const meta = {
      cacheKey: cacheKey,
      tabId, pageKey,
      onProgress: (status, error) => {
        const job = pageJobs.get(jobId);
        if (!job || job.state !== 'running') return;
        job.progress = status;
        job.error = error || '';
        notifyPageProgress();
      },
      onSettled: (err, result) => {
        const job = pageJobs.get(jobId);
        pageJobs.delete(jobId);
        if (!job || job.state === 'cancelled') return;
        if (err) {
          notifyTab(tabId, {
            type: 'PAGE_JOB_FAILED', jobId, pageKey, bandIndex,
            error: err.message, status: err.status || 'error',
          });
        } else {
          notifyTab(tabId, {
            type: 'PAGE_RESULT', jobId, pageKey, bandIndex,
            bubbles: result.bubbles, model: result.model, fallbackUsed: result.fallbackUsed,
          });
        }
      },
    };
    pageJobs.set(jobId, { tabId, cacheKey, pageKey, bandIndex, state: 'running' });
    enqueueWithRateLimit(() => runPageJob(message, cacheKey, bandIndex, selectedModel, localEnabled), meta).catch(() => {});
    return { ok: true, jobId, position: requestQueue.length + 1, bandIndex };
  });
}

async function runPageJob(message, cacheKey, bandIndex, requestedModel, localEnabled = false) {
  const apiKey = await getActiveApiKey();
  if (!apiKey) {
    const e = new Error('Lutfen once Google Gemini API anahtari ekleyin ve aktif yapin.');
    e.status = 'invalid';
    throw e;
  }
  const selectedModel = requestedModel ? normalizeGeminiModel(requestedModel) : await getSelectedGeminiModel();
  const bandNote = message.bandCount > 1 ? '\n[Slice ' + (bandIndex + 1) + '/' + message.bandCount + ']' : '';

  let localMatches = null;
  let unassignedOcr = 0;
  let ocrCandidates = [];
  if (localEnabled) {
    try {
      const response = await nativeRequest({ type: 'analyze', dataUrl: message.dataUrl });
      if (response.size && response.size[0] === message.w && response.size[1] === message.h && Array.isArray(response.matches)) {
        localMatches = response.matches;
        unassignedOcr = Number(response.unassigned_ocr) || 0;
        ocrCandidates = Array.isArray(response.ocr_candidates) ? response.ocr_candidates : [];
      } else {
        console.warn('[MangaLens] yerel yardımcının resim boyutu uyuşmadı');
      }
    } catch (error) {
      console.warn('[MangaLens] yerel yerleşim kullanılamadı:', error.message);
    }
  }
  const reliable = localMatches && localMatches.length > 0 && unassignedOcr === 0 && localMatches.every(match =>
    match && !match.needs_review && Number(match.bubble_confidence) >= 0.7 &&
    typeof match.ocr === 'string' && match.ocr.trim() &&
    MLLocalMatch.validBox(match.bubble_box, message.w, message.h));
  let result;
  let localUsed = false;
  if (reliable) {
    result = await executeWithModelFallback(selectedModel, async model => {
      const raw = await callGemini({ apiKey, model, prompt: buildLocalTextPrompt(localMatches),
        responseMimeType: 'application/json' });
      return parseLocalTranslations(raw, localMatches);
    });
    localUsed = true;
  }
  if (!result) result = await executeWithModelFallback(selectedModel, async model => {
    const raw = await callGemini({
      apiKey, model,
      prompt: buildPagePrompt() + '\n[Image: ' + message.w + 'x' + message.h + ']' + bandNote,
      imageBase64: { mime: 'image/jpeg', base64: String(message.dataUrl).split(',')[1] || '' },
      responseMimeType: 'application/json',
    });
    return parseBubbleArray(raw, message.w, message.h, { coordSpace: 'auto', maxLen: PAGE_MAX_TEXT });
  });
  let bubbles = result.value;
  if (!localUsed && localMatches && bubbles.length) {
    const refined = MLLocalMatch.refine(bubbles, localMatches.concat(ocrCandidates), message.w, message.h);
    bubbles = refined.bubbles;
    localUsed = refined.placed > 0;
  }
  if (bubbles.length > 0) {
    await incrementTranslationStats();
    if (!localEnabled || localUsed) await pageCacheSet(cacheKey, bubbles, result.model);
  }
  return { bubbles, model: result.model, fallbackUsed: result.fallbackUsed };
}

// ══════════════════════════════════════════════════════════════════════════════
//  v3.2: Sayfa Cache (balon JSON'u; gorsel DEGIL — kota dostu)
// ══════════════════════════════════════════════════════════════════════════════

const PAGE_CACHE_KEY = 'ml_page_cache_v1';
const PAGE_CACHE_META = 'ml_page_cache_meta_v1';
const PAGE_CACHE_MAX_ENTRIES = 400;      // ~3 KB/girdi → 1.2 MB; storage.local 10 MB sinirinin cok altinda
const PAGE_CACHE_EVICT_RATIO = 0.20;

function pageCacheEvictOldest(map) {
  const victims = Object.keys(map)
    .sort((a, b) => ((map[a] && map[a].ts) || 0) - ((map[b] && map[b].ts) || 0))
    .slice(0, Math.max(1, Math.ceil(Object.keys(map).length * PAGE_CACHE_EVICT_RATIO)));
  victims.forEach(k => delete map[k]);
  return victims.length;
}

async function pageCacheRead() {
  const data = await chrome.storage.local.get([PAGE_CACHE_KEY, PAGE_CACHE_META]);
  return { map: data[PAGE_CACHE_KEY] || {}, meta: data[PAGE_CACHE_META] || { count: 0 } };
}

async function pageCacheGet(cacheKey) {
  if (!cacheKey) return null;
  const { map } = await pageCacheRead();
  const hit = map[cacheKey];
  return hit && Array.isArray(hit.bubbles) ? { bubbles: hit.bubbles, model: hit.model || null } : null;
}

async function pageCacheSet(cacheKey, bubbles, model) {
  if (!cacheKey) return { ok: false, error: 'cacheKey eksik' };
  const { map } = await pageCacheRead();
  map[cacheKey] = { bubbles: bubbles, model: model || null, ts: Date.now() };
  if (Object.keys(map).length > PAGE_CACHE_MAX_ENTRIES) pageCacheEvictOldest(map);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await chrome.storage.local.set({
        [PAGE_CACHE_KEY]: map,
        [PAGE_CACHE_META]: { count: Object.keys(map).length, updatedAt: Date.now() },
      });
      return { ok: true, count: Object.keys(map).length };
    } catch (e) {
      // kota dolu → en eski %20'yi at, tekrar dene
      if (pageCacheEvictOldest(map) === 0) return { ok: false, error: e.message };
    }
  }
  return { ok: false, error: 'cache yazilamadi' };
}

// ══════════════════════════════════════════════════════════════════════════════
