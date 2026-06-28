// dosya: src/background.js (v3 - Gemini native)
// Dogrudan Google Gemini native API. 9Router/OpenRouter kaldirildi.

'use strict';

const GEMINI_API_KEY = 'REDACTED_GEMINI_KEY';
const GEMINI_MODEL  = 'gemini-3.1-flash-lite';
const GEMINI_BASE   = 'https://generativelanguage.googleapis.com/v1beta/models';

const REQUEST_TIMEOUT = 45000;

// v2: Rate limit yonetimi (Gemini 15 RPM = ~4sn minimum aralik)
const MIN_INTERVAL_MS = 4000;        // istekler arasi minimum bekleme
const BACKOFF_INITIAL_MS = 30000;     // 429 alinca ilk bekleme
const BACKOFF_MAX_MS = 120000;        // maksimum backoff
const requestQueue = [];
let lastRequestTime = 0;
let activeRequest = false;

try {
  chrome.alarms?.create('keepalive', { periodInMinutes: 0.4 });
} catch {}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === 'EXTRACT_BUBBLES') {
    handleExtract(message)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(err => sendResponse({ success: false, error: err.message, errors: err.errors }));
    return true;
  }

  if (message.type === 'CAPTURE_TAB') {
    try {
      chrome.tabs.captureVisibleTab()
        .then(dataUrl => sendResponse({ dataUrl }))
        .catch(e => sendResponse({ dataUrl: null, error: e.message }));
    } catch (e) {
      sendResponse({ dataUrl: null, error: e.message });
    }
    return true;
  }

  if (message.type === 'GET_SETTINGS') {
    sendResponse({
      enabled: true,
      model: GEMINI_MODEL,
    });
    return false;
  }

  // v2: Per-cell cache
  if (message.type === 'GET_CACHED_CELL') {
    getCachedCell(message.cacheKey).then(cached => {
      sendResponse({ success: true, bubbles: cached });
    });
    return true;
  }

  if (message.type === 'STORE_CACHED_CELL') {
    storeCachedCell(message.cacheKey, message.bubbles).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
});

const PROMPT = 'You are a manga panel analyzer.\n\nFind all speech bubbles, narration boxes, and sound effects. For each, return:\n- "text": the text TRANSLATED to natural Turkish (translate dialogue; keep character names in original language; translate SFX like BOOM as GUM, CRACK as CAT)\n- "x", "y", "width", "height": bounding box in PIXELS of the input image (integers, top-left origin)\n\nReturn ONLY a JSON array. No prose. Example: [{"text":"Selam!","x":100,"y":50,"width":200,"height":80}]\n\nOrder bubbles top-to-bottom. Return [] if nothing readable.';

async function handleExtract({ dataUrl, w, h }) {
  if (!dataUrl) throw new Error('dataUrl eksik');
  console.log('[MangaLens-bg] handleExtract basladi, w=', w, 'h=', h, 'dataUrl uzunluk=', dataUrl.length);

  // v2: rate-limited queue uzerinden calistir
  const bubbles = await enqueueWithRateLimit(() => callMultimodal(dataUrl, w, h));

  console.log('[MangaLens-bg] Gemini dondu:', bubbles ? bubbles.length : 0, 'balon');
  if (bubbles && bubbles.length > 0) {
    return { bubbles, model: GEMINI_MODEL };
  }
  return { bubbles: [], model: GEMINI_MODEL };
}

async function callMultimodal(dataUrl, w, h) {
  // Google Gemini native API — dataUrl'in base64 kismini ayir
  // data:image/png;base64,XXXX → mime + base64
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) throw new Error('Gecersiz dataUrl formati');
  const mime = m[1];
  const base64 = m[2];

  const body = {
    contents: [{
      parts: [
        { text: PROMPT + '\n[Image: ' + w + 'x' + h + ']' },
        { inline_data: { mime_type: mime, data: base64 } },
      ],
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    },
  };

  const url = GEMINI_BASE + '/' + GEMINI_MODEL + ':generateContent?key=' + GEMINI_API_KEY;

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
  } finally {
    clearTimeout(tid);
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    console.warn('[MangaLens-bg] Gemini HTTP', res.status, JSON.stringify(errBody).slice(0, 500));
    throw new Error('Gemini ' + res.status + ': ' + (errBody?.error?.message || res.statusText));
  }

  const data = await res.json();
  // Gemini native format: candidates[0].content.parts[0].text
  let raw = '';
  const parts = data?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    raw = parts.map(p => p.text || '').join('\n');
  }
  console.log('[MangaLens-bg] Gemini dondu, raw:', raw.slice(0, 200));
  return parseBubbleArray(raw || '[]', w, h);
}

function parseBubbleArray(raw, w, h) {
  const s = String(raw).replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
  const first = s.indexOf('[');
  const last = s.lastIndexOf(']');
  if (first < 0 || last <= first) return [];
  let arr;
  try { arr = JSON.parse(s.slice(first, last + 1)); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  return arr.filter(it => it && typeof it === 'object').map(it => ({
    text: String(it.text || '').slice(0, 200).trim(),
    x: clampInt(it.x, 0, w),
    y: clampInt(it.y, 0, h),
    width: clampInt(it.width, 1, w),
    height: clampInt(it.height, 1, h),
  })).filter(b => b.text && b.width > 0 && b.height > 0);
}

function clampInt(v, min, max) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

// ══════════════════════════════════════════════════════════════════════════════
//  v2: Rate-Limited Sequential Queue
// ══════════════════════════════════════════════════════════════════════════════

function enqueueWithRateLimit(fn) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ fn, resolve, reject, retries: 0 });
    processRateLimitedQueue();
  });
}

async function processRateLimitedQueue() {
  if (activeRequest || requestQueue.length === 0) return;

  const { fn, resolve, reject, retries } = requestQueue.shift();
  activeRequest = true;

  try {
    // Minimum aralik bekle
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (lastRequestTime > 0 && elapsed < MIN_INTERVAL_MS) {
      const wait = Math.max(0, MIN_INTERVAL_MS - elapsed);
      if (wait > 0) {
        console.log('[MangaLens-bg] rate-limit bekleme:', wait, 'ms');
        await new Promise(r => setTimeout(r, wait));
      }
    }

    lastRequestTime = Date.now();
    console.log('[MangaLens-bg] istek gonderiliyor, queue:', requestQueue.length);

    let result;
    try {
      result = await fn();
      resolve(result);
    } catch (e) {
      // 429 veya timeout → backoff ile retry
      const isRetryable = /429|rate|timeout/i.test(String(e.message));
      if (isRetryable && retries < 3) {
        const backoff = Math.min(BACKOFF_INITIAL_MS * Math.pow(2, retries), BACKOFF_MAX_MS);
        console.warn('[MangaLens-bg] retryable hata:', e.message, '-> backoff:', backoff, 'ms');
        requestQueue.unshift({ fn, resolve, reject, retries: retries + 1 });
        // lastRequestTime'i geriye cek ki bir sonraki deneme de backoff yapisin
        lastRequestTime = Date.now() + backoff;
      } else {
        reject(e);
      }
    }
  } finally {
    activeRequest = false;
    // Siradaki istek
    if (requestQueue.length > 0) {
      // Kuyruktaki bir sonraki istek icin minimum araligi koru
      setTimeout(processRateLimitedQueue, MIN_INTERVAL_MS);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  v2: Per-Cell Cache (chrome.storage.local)
// ══════════════════════════════════════════════════════════════════════════════

const CACHE_PREFIX = 'ml_cell_';

async function getCachedCell(cacheKey) {
  if (!cacheKey) return null;
  try {
    const fullKey = CACHE_PREFIX + cacheKey;
    const res = await chrome.storage.local.get([fullKey]);
    return res[fullKey]?.bubbles || null;
  } catch (e) {
    console.warn('[MangaLens-bg] cache read hatasi:', e.message);
    return null;
  }
}

async function storeCachedCell(cacheKey, bubbles) {
  if (!cacheKey) return;
  try {
    const fullKey = CACHE_PREFIX + cacheKey;
    const payload = { bubbles, cachedAt: Date.now() };
    await chrome.storage.local.set({ [fullKey]: payload });
    console.log('[MangaLens-bg] cache stored:', fullKey, '(', bubbles.length, 'balon)');
  } catch (e) {
    console.warn('[MangaLens-bg] cache write hatasi:', e.message);
  }
}
