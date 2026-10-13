'use strict';
let mlOffscreenCreating;
const mlCalls = new Map();
const mlLocalRequests = new Map();
async function mlOffscreen(command, payload = {}) {
  const { signal, ...data } = payload;
  const url = chrome.runtime.getURL('src/page/offscreen.html');
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
  if (!contexts.length) {
    if (!mlOffscreenCreating) mlOffscreenCreating = chrome.offscreen.createDocument({ url: 'src/page/offscreen.html', reasons: ['BLOBS'], justification: 'Yerel manga görsellerini okuyup dilimler halinde tespit etmek ve şekle uygun çeviri katmanı hazırlamak.' }).finally(() => { mlOffscreenCreating = null; });
    await mlOffscreenCreating;
  }
  signal?.throwIfAborted();
  const requestId = crypto.randomUUID();
  const cancel = () => chrome.runtime.sendMessage({ target: 'ml-offscreen', command: 'cancel', requestId }).catch(() => {});
  signal?.addEventListener('abort', cancel, { once: true });
  let timer;
  try {
    const response = await Promise.race([
      chrome.runtime.sendMessage({ target: 'ml-offscreen', command, ...data, requestId }),
      new Promise((_, reject) => { timer = setTimeout(() => { cancel(); reject(new Error('Yerel görüntü işleyici zamanında yanıt vermedi.')); }, command === 'prepare' ? 175000 : 55000); })
    ]);
    if (!response?.ok) throw new Error(response?.error || 'Yerel görüntü işleyici yanıt vermedi.');
    return response.value;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
async function mlLocal(message, sender, command) {
  if (typeof message.requestId !== 'string' || message.requestId.length > 80) throw new Error('Geçersiz işlem kimliği.');
  const key = `${sender.tab.id}:${message.requestId}`, controller = new AbortController();
  if (mlLocalRequests.has(key)) throw new Error('İşlem zaten çalışıyor.');
  mlLocalRequests.set(key, controller);
  try {
    return await mlOffscreen(command, { source: message.source, detector: message.detector, report: message.report,
      translations: message.translations, minFont: message.minFont, tabId: sender.tab.id,
      clientRequestId: message.requestId, signal: controller.signal });
  } finally { mlLocalRequests.delete(key); }
}
async function mlConfig() {
  const [settings, local] = await Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get('translationGlossary')]);
  return MLProviders.settings({ ...settings, translationGlossary: local.translationGlossary ?? settings.translationGlossary });
}
async function mlKey(provider) {
  if (typeof MLKeys !== 'undefined') return MLKeys.active(provider);
  if (provider === 'gemini') return getActiveApiKey();
  const stored = await chrome.storage.local.get(['openrouterApiKey']);
  return stored.openrouterApiKey || '';
}
function mlAccessError(config, status, message) {
  let code, advice, actionUrl;
  if (config.provider === 'openrouter' && status === 403 && /(?:18\+\s*age confirmation|age (?:confirmation|verification) (?:is )?required)/i.test(message)) {
    code = 'AGE_CONFIRMATION_REQUIRED';
    advice = 'Bu model için OpenRouter hesabında 18+ yaş onayı gerekiyor. OpenRouter ayarlarından uygun onayı kendiniz tamamlayın; ardından “Hatalıları yeniden dene”yi kullanın. Alternatif olarak popup’tan başka model seçip yeni tarama başlatın.';
    actionUrl = 'https://openrouter.ai/settings/preferences';
  } else if (status === 401) {
    code = 'PROVIDER_AUTH_REQUIRED'; advice = 'Sağlayıcı API anahtarını kabul etmedi. Popup’taki API sekmesinden ilgili anahtarı kontrol edip “Hatalıları yeniden dene”yi kullanın.';
  } else if (status === 402) {
    code = 'PROVIDER_CREDIT_REQUIRED'; advice = 'Sağlayıcı kredi veya ödeme koşulu nedeniyle isteği reddetti. Hesabınızın kredi durumunu kontrol edip “Hatalıları yeniden dene”yi kullanın.';
  } else return null;
  return Object.assign(new Error(`${config.provider}/${config.model}: HTTP ${status} — ${advice}`), { code, stopJob: true, httpStatus: status, actionUrl });
}
function mlRestoreJob(job) {
  if (!job?.config || job.blocked) return job;
  for (const page of job.pages || []) {
    if (!/HTTP 403/.test(page.error || '')) continue;
    const error = mlAccessError(job.config, 403, page.error);
    if (!error) continue;
    job.state = 'blocked'; job.blocked = { error: error.message, code: error.code, actionUrl: error.actionUrl };
    break;
  }
  return job;
}
async function mlProviderCall(config, prompt, images, keyOverride) {
  const key = keyOverride || await mlKey(config.provider);
  if (!key) throw new Error(`${config.provider === 'gemini' ? 'Gemini' : 'OpenRouter'} API anahtarı eksik.`);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000);
  try {
    const router = config.provider === 'openrouter';
    const body = router ? MLProviders.routerBody(config.model, prompt, images) : {
      contents: [{ role: 'user', parts: [{ text: prompt }, ...images.flatMap(image => {
        const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(image.dataUrl);
        if (!match) throw new Error('Geçersiz görsel kırpması');
        return [{ text: `regionId=${image.regionId || 'manual'}` }, { inlineData: { mimeType: match[1], data: match[2] } }];
      })] }], generationConfig: { maxOutputTokens: 8192, ...(!config.model.startsWith('gemma') ? { responseMimeType: 'application/json' } : {}) }
    };
    const endpoint = router ? 'https://openrouter.ai/api/v1/chat/completions' : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;
    const response = await fetch(endpoint, { method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(router ? { Authorization: `Bearer ${key}` } : { 'x-goog-api-key': key }) }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok || data.error) {
      const detail = String(data.error?.message || 'Sağlayıcı hatası').replaceAll(key, '[anahtar]');
      throw mlAccessError(config, response.status, detail) || new Error(`${config.provider}/${config.model}: HTTP ${response.status} — ${detail.slice(0, 240)}`);
    }
    const text = router ? data.choices?.[0]?.message?.content : data.candidates?.[0]?.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join('');
    const finish = router ? data.choices?.[0]?.finish_reason : data.candidates?.[0]?.finishReason;
    if (['length', 'MAX_TOKENS', 'SAFETY', 'content_filter'].includes(finish)) throw new Error(`Çeviri tamamlanmadı: ${finish}`);
    if (typeof text !== 'string' || !text.trim()) throw new Error('Sağlayıcı boş yanıt verdi.');
    return text;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Sağlayıcı 25 saniyede yanıt vermedi; ücretlendirme durumu belirsiz. Otomatik tekrar yapılmadı.');
    throw error;
  } finally { clearTimeout(timer); }
}
async function mlTranslate(message) {
  const { config, regions, imageId, context = [] } = message;
  const checked = MLProviders.settings({ translationProvider: config.provider, geminiModel: config.model, openrouterModel: config.model,
    contributorConsent: config.model.endsWith('-contributor') ? (await chrome.storage.sync.get('contributorConsent')).contributorConsent : false,
    contentType: config.contentType, localDetector: config.localDetector, seriesName: config.series, translationInstructions: config.instructions, translationGlossary: config.glossary });
  if (!/^[a-f0-9]{64}$/.test(imageId) || !Array.isArray(regions) || !regions.length || regions.length > 6 ||
      regions.some(r => !r.regionId?.startsWith(`${imageId}:`) || typeof r.crop !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(r.crop) || r.crop.length > 4_000_000)) throw new Error('Geçersiz bölge isteği');
  const encoded = new TextEncoder().encode(JSON.stringify({ config: checked, imageId, regions: regions.map(r => r.regionId), context }));
  const key = 'translation-v1:' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoded))].map(v => v.toString(16).padStart(2, '0')).join('');
  if (mlCalls.has(key)) return mlCalls.get(key);
  const operation = (async () => {
    const existing = await mlOffscreen('read', { key });
    if (existing?.status === 'done') return { ...existing, cached: true };
    if (existing && !message.retry) {
      // Recognize the known 3.5.1 cached refusal as well as new structured blocks.
      const refusal = mlAccessError(checked, existing.httpStatus || (/HTTP 403/.test(existing.error || '') ? 403 : 0), existing.error || '');
      if (existing.status === 'blocked') throw Object.assign(new Error(existing.error), { code: existing.code, stopJob: true, httpStatus: existing.httpStatus, actionUrl: existing.actionUrl });
      if (refusal) throw refusal;
    }
    if (existing && !message.retry) throw new Error('Önceki çağrı tamamlanamadı; tekrar ücret olasılığı nedeniyle durduruldu. “Hatalıları yeniden dene” ile açıkça tekrar deneyebilirsiniz.');
    await mlOffscreen('write', { key, value: { status: 'pending', startedAt: Date.now(), config: checked } });
    try {
      const raw = await enqueueWithRateLimit(() => mlProviderCall(checked, MLProviders.prompt(checked, regions, context), regions.map(r => ({ regionId: r.regionId, dataUrl: r.crop }))), { retry: false });
      const translated = MLProviders.parse(raw, regions.map(r => r.regionId));
      const result = { status: 'done', config: checked, regions: translated, completedAt: Date.now() };
      await mlOffscreen('write', { key, value: result }); await incrementTranslationStats();
      return result;
    } catch (error) {
      await mlOffscreen('write', { key, value: { status: error.stopJob ? 'blocked' : 'uncertain', error: error.message,
        ...(error.stopJob ? { code: error.code, httpStatus: error.httpStatus, actionUrl: error.actionUrl } : {}), config: checked, updatedAt: Date.now() } });
      throw error;
    }
  })();
  mlCalls.set(key, operation);
  try { return await operation; } finally { mlCalls.delete(key); }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message?.type?.startsWith('ML_') || sender.id !== chrome.runtime.id) return;
  if (message.type.startsWith('ML_KEYS_')) return;
  if (message.type === 'ML_HEARTBEAT') { respond({ ok: true }); return; }
  if (message.type === 'ML_PROGRESS') {
    if (sender.url !== chrome.runtime.getURL('src/page/offscreen.html')) return;
    if (Number.isInteger(message.tabId)) chrome.tabs.sendMessage(message.tabId, { type: 'ML_PAGE_PROGRESS', requestId: message.clientRequestId, text: message.text }).catch(() => {});
    respond({ ok: true }); return;
  }
  const action = async () => {
    if (message.type === 'ML_CONFIG') return mlConfig();
    if (!sender.tab?.id) throw new Error('Bu komut yalnız manga sayfasından çalıştırılabilir.');
    if (message.type === 'ML_CANCEL') { mlLocalRequests.get(`${sender.tab.id}:${message.requestId}`)?.abort(); return true; }
    if (message.type === 'ML_PREPARE') return mlLocal(message, sender, 'prepare');
    if (message.type === 'ML_RENDER') return mlLocal(message, sender, 'render');
    if (message.type === 'ML_TRANSLATE') return mlTranslate(message);
    if (message.type === 'ML_JOB_GET' || message.type === 'ML_JOB_SAVE') {
      const url = new URL(sender.tab.url); url.hash = '';
      const key = `ml-page-job:${sender.tab.id}:${url.href}`;
      if (message.type === 'ML_JOB_GET') return mlRestoreJob((await chrome.storage.local.get(key))[key] || null);
      if (!message.job || JSON.stringify(message.job).length > 2_000_000) throw new Error('İş kaydı çok büyük.');
      await chrome.storage.local.set({ [key]: message.job }); return true;
    }
    throw new Error('Bilinmeyen sayfa komutu.');
  };
  action().then(value => respond({ ok: true, value })).catch(error => respond({ ok: false, error: error.message,
    ...(error.stopJob ? { stopJob: true, code: error.code, actionUrl: error.actionUrl } : {}) }));
  return true;
});
