// dosya: src/background.js (v5 - direct Gemini API)
// 9Router multimodal'da 401 aliyoruz. Dogrudan Google Gemini native API kullan.

'use strict';

const GEMINI_API_KEY = 'REDACTED_GEMINI_KEY';
const GEMINI_MODEL  = 'gemini-3.1-flash-lite';
const GEMINI_BASE   = 'https://generativelanguage.googleapis.com/v1beta/models';

const REQUEST_TIMEOUT = 45000;

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
    sendResponse({ enabled: true, ninerouterModel: MODEL_CHAIN[0] });
    return false;
  }
});

const PROMPT = 'You are a manga panel analyzer.\n\nFind all speech bubbles, narration boxes, and sound effects. For each, return:\n- "text": the text TRANSLATED to natural Turkish (translate dialogue; keep character names in original language; translate SFX like BOOM as GUM, CRACK as CAT)\n- "x", "y", "width", "height": bounding box in PIXELS of the input image (integers, top-left origin)\n\nReturn ONLY a JSON array. No prose. Example: [{"text":"Selam!","x":100,"y":50,"width":200,"height":80}]\n\nOrder bubbles top-to-bottom. Return [] if nothing readable.';

async function handleExtract({ dataUrl, w, h }) {
  if (!dataUrl) throw new Error('dataUrl eksik');
  console.log('[MangaLens-bg] handleExtract basladi, w=', w, 'h=', h, 'dataUrl uzunluk=', dataUrl.length);
  try {
    const bubbles = await callMultimodal(dataUrl, w, h);
    console.log('[MangaLens-bg] Gemini dondu:', bubbles ? bubbles.length : 0, 'balon');
    if (bubbles && bubbles.length > 0) {
      return { bubbles, model: GEMINI_MODEL };
    }
    return { bubbles: [], model: GEMINI_MODEL };
  } catch (e) {
    console.warn('[MangaLens-bg] Gemini HATA:', e.message);
    throw e;
  }
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
