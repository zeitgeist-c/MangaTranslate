'use strict';
let mlOffscreenCreating;
const mlCalls = new Map();
const mlLocalRequests = new Map();
const mlRouterQueue = new MLQueue(limit => chrome.storage?.local?.set({ mlParallelLimit: limit }).catch(() => {}));
let mlManualOwner = 0;
const mlCooldowns = new Map(); let mlCooldownWrites = Promise.resolve();
const mlRegionCalls = new Map(), mlCapabilityCalls = new Map(), mlCapabilityMemory = new Map();
// A timed-out model keeps smaller groups for a while; a finished group clears it.
const mlTimeoutShrink = new Map(), ML_TIMEOUT_SHRINK_MS = 30 * 60 * 1000, ML_TIMEOUT_SHRINK_MIN = 2;
function mlNoteTimeout(model, attempted) {
  const prev = mlTimeoutShrink.get(model), cap = Math.max(ML_TIMEOUT_SHRINK_MIN, Math.floor((attempted || 0) / 2));
  mlTimeoutShrink.set(model, { regions: Math.min(prev && prev.until > Date.now() ? prev.regions : Infinity, cap), until: Date.now() + ML_TIMEOUT_SHRINK_MS });
}
function mlApplyShrink(model, regions) {
  const shrink = mlTimeoutShrink.get(model);
  if (!shrink) return regions;
  if (shrink.until <= Date.now()) { mlTimeoutShrink.delete(model); return regions; }
  return Math.min(regions, shrink.regions);
}
const mlQueueReady = chrome.storage?.local?.get(['mlParallelLimit', 'mlRouterCooldowns']).then(stored => {
  if (Number.isInteger(stored.mlParallelLimit)) mlRouterQueue.limit = Math.max(1, Math.min(8, stored.mlParallelLimit));
  for (const [scope, value] of Object.entries(stored.mlRouterCooldowns || {})) {
    if ((scope === 'account' || MLProviders.catalog.openrouter.some(([id]) => id === scope)) && Number.isFinite(value?.until) && value.until > Date.now() && value.until > (mlCooldowns.get(scope)?.until || 0)) mlCooldowns.set(scope, value);
  }
}).catch(() => {});
function mlCooldownError(model) {
  const blocked = [mlCooldowns.get('account'), mlCooldowns.get(model)].filter(value => value?.until > Date.now()).sort((a,b) => b.until-a.until)[0];
  if (!blocked) return null;
  const seconds = Math.ceil((blocked.until-Date.now())/1000);
  return Object.assign(new Error(`OpenRouter ${blocked.scope === 'account' ? 'hesap/genel' : 'model'} beklemesi: ${seconds} sn. Sınırı tetikleyen model: ${blocked.model}. ${model} için bu istek henüz gönderilmedi. Süre dolunca “Hatalıları yeniden dene”yi kullanın.`),
    { notSent: true, stopJob: true, code: 'PROVIDER_COOLDOWN', retryAt: blocked.until, cooldownScope: blocked.scope });
}
async function mlRememberCooldown(config, response, data) {
  const hint = response.headers?.get('retry-after'), seconds = Number(hint), delay = Number.isFinite(seconds) && seconds > 0 ? seconds*1000 : Date.parse(hint || '')-Date.now();
  const metadata = data.error?.metadata || {};
  // Unknown 429 origin stays account-wide; never bypass a real account limit.
  const upstream = typeof metadata.provider_name === 'string' && !metadata.limit_source && !response.headers?.get('x-ratelimit-limit');
  const scope = upstream ? config.model : 'account', until = Date.now()+Math.max(1000, Number.isFinite(delay) && delay>0 ? delay : 30000);
  const previous = mlCooldowns.get(scope);
  const value = { until: Math.max(until, previous?.until || 0), model: config.model, scope: upstream ? 'model' : 'account' };
  mlCooldowns.set(scope,value);
  mlCooldownWrites = mlCooldownWrites.catch(()=>{}).then(async()=>{
    const active = Object.fromEntries([...mlCooldowns].filter(([,v])=>v.until>Date.now()));
    try { await chrome.storage?.local?.set?.({mlRouterCooldowns:active}); } catch { /* In-memory cooldown remains enforced. */ }
  });
  await mlCooldownWrites; return value;
}
function mlEnqueue(config, task, owner) {
  if (config.provider !== 'openrouter') return enqueueWithRateLimit(task, { retry: false });
  if (owner === undefined) { owner = `manual:${++mlManualOwner}`; mlRouterQueue.begin(owner); }
  return Promise.resolve(mlQueueReady).then(() => mlRouterQueue.enqueue(owner, timing => {
    const cooldown = mlCooldownError(config.model); if (cooldown) throw cooldown;
    return task(timing);
  }, {lane:config.model, maxConcurrency:MLProviders.routerPolicy(config.model).maxConcurrency}));
}
async function mlCapabilities(config) {
  const fallback = { maxRegions: config.provider === 'openrouter' ? 12 : 6, maxOutputTokens: 8192, contextLength: null, verified: false };
  if (config.provider !== 'openrouter') return fallback;
  const memory = mlCapabilityMemory.get(config.model); if (memory?.expires > Date.now()) return { ...memory.value, maxRegions: mlApplyShrink(config.model, memory.value.maxRegions) };
  if (!mlCapabilityCalls.has(config.model)) mlCapabilityCalls.set(config.model, (async () => {
    const cacheKey = `ml-model-capabilities:v3:${config.model}`, cached = (await chrome.storage.local.get(cacheKey))[cacheKey];
    if (cached?.expires > Date.now()) return cached.value;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`https://openrouter.ai/api/v1/models/${config.model}/endpoints`, { signal: controller.signal });
      if (!response.ok) return fallback;
      const data = await response.json(), listed = data.data?.endpoints;
      if (!Array.isArray(listed) || !listed.length) return fallback;
      const required = MLProviders.routerPolicy(config.model).requiredParameters;
      const endpoints = listed.filter(e => (e.status === undefined || e.status === 0) &&
        (!Array.isArray(e.supported_parameters) || required.every(p => e.supported_parameters.includes(p))));
      if (!endpoints.length) throw Object.assign(new Error('Seçili modelin gerekli JSON/istek parametrelerini destekleyen kullanılabilir ucu bulunamadı; çeviri gönderilmedi.'), { notSent: true, stopJob: true, code: 'MODEL_PARAMETERS_UNAVAILABLE' });
      const positiveMin = key => endpoints.every(e => Number.isSafeInteger(e[key]) && e[key] > 0) ? Math.min(...endpoints.map(e => e[key])) : null;
      const contextLength = positiveMin('context_length'), completion = positiveMin('max_completion_tokens');
      const maxOutputTokens = completion ? Math.min(16384, completion) : 8192;
      const imageLimit = positiveMin('max_images');
      const maxRegions = Math.max(1, Math.min(MLProviders.routerPolicy(config.model).maxRegions, maxOutputTokens >= 16384 ? 20 : 12, Math.floor(maxOutputTokens / 680), imageLimit || 20,
        contextLength ? Math.floor((contextLength - maxOutputTokens - 65536) / 10000) : 12));
      const value = { maxRegions, maxOutputTokens, contextLength, verified: !!contextLength && !!completion };
      await chrome.storage.local.set({ [cacheKey]: { expires: Date.now() + 86400000, value } }); return value;
    } catch (error) { if (error.code === 'MODEL_PARAMETERS_UNAVAILABLE') throw error; return fallback; } finally { clearTimeout(timer); }
  })());
  const operation = mlCapabilityCalls.get(config.model);
  try {
    const raw = await operation, policy = MLProviders.routerPolicy(config.model);
    const value = {...raw, maxRegions:Math.min(raw.maxRegions,policy.maxRegions), maxPending:Math.min(8,policy.maxConcurrency*2)};
    mlCapabilityMemory.set(config.model, { expires: Date.now() + (value.verified ? 86400000 : 600000), value });
    return { ...value, maxRegions: mlApplyShrink(config.model, value.maxRegions) };
  } finally { if (mlCapabilityCalls.get(config.model) === operation) mlCapabilityCalls.delete(config.model); }
}
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
      translations: message.translations, minFont: message.minFont, style: message.style, tabId: sender.tab.id,
      clientRequestId: message.requestId, signal: controller.signal });
  } finally { mlLocalRequests.delete(key); }
}
async function mlConfig() {
  const [settings, local] = await Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get('translationGlossary')]);
  const config = MLProviders.settings({ ...settings, translationGlossary: local.translationGlossary ?? settings.translationGlossary });
  return { ...config, batching: await mlCapabilities(config) };
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
  } else if (config.provider === 'openrouter' && status === 404 && /(?:paid model training violation|matching your (?:guardrail restrictions and )?data policy|no endpoints.*data policy)/i.test(message)) {
    code = 'PROVIDER_DATA_POLICY_BLOCK'; advice = 'Seçili model OpenRouter hesabınızın veri politikasıyla uyuşmuyor. Veri paylaşımı koşullarını hesap ayarlarından değerlendirin veya başka model seçip yeni tarama başlatın. Ayarları değiştirdiyseniz “Hatalıları yeniden dene”yi kullanın.';
    actionUrl = 'https://openrouter.ai/settings/privacy';
  } else if (status === 429) {
    code = 'PROVIDER_RATE_LIMITED'; advice = 'Sağlayıcı istek sınırına ulaşıldı. Biraz bekleyip “Hatalıları yeniden dene”yi kullanın; otomatik tekrar yapılmadı.';
  } else if (config.provider === 'openrouter' && status === 404 && /(?:no (?:available )?endpoints|no providers|parameters|routing)/i.test(message)) {
    code = 'MODEL_ENDPOINT_UNAVAILABLE'; advice = 'Seçili model için hesap politikanıza ve gerekli JSON/istek parametrelerine uygun sağlayıcı bulunamadı. OpenRouter model erişimi ve hesap filtrelerini kontrol edin veya kendiniz başka model seçin; otomatik tekrar yapılmadı.';
  } else if (config.provider === 'openrouter' && status === 400 && /(?:thinking|reasoning|response_format|json mode|unsupported.*parameter)/i.test(message)) {
    code = 'MODEL_PARAMETER_REJECTED'; advice = 'Model sağlayıcısı düşünme/JSON parametrelerini reddetti. Uzantıyı güncelleyin; sürerse bu hata ile modeli bildirin. Otomatik tekrar yapılmadı.';
  } else return null;
  return Object.assign(new Error(`${config.provider}/${config.model}: HTTP ${status} — ${advice}`), { code, stopJob: true, httpStatus: status, actionUrl });
}
function mlRestoreJob(job) {
  if (!job?.config || job.blocked) return job;
  for (const page of job.pages || []) {
    const match = /HTTP (403|404)/.exec(page.error || ''); if (!match) continue;
    const error = mlAccessError(job.config, Number(match[1]), page.error);
    if (!error) continue;
    job.state = 'blocked'; job.blocked = { error: error.message, code: error.code, actionUrl: error.actionUrl };
    break;
  }
  return job;
}
async function mlProviderCall(config, prompt, images, keyOverride) {
  const key = keyOverride || await mlKey(config.provider);
  if (!key) throw new Error(`${config.provider === 'gemini' ? 'Gemini' : 'OpenRouter'} API anahtarı eksik.`);
  const timeoutMs = config.provider === 'openrouter' ? MLProviders.routerPolicy(config.model).timeoutMs : 60000;
  const streaming = config.provider === 'openrouter' && Boolean(config.maxOutputTokens);
  const controller = new AbortController();
  let timer = 0, idleTimer = 0, absoluteTimer = 0, idleFired = false, activity;
  if (streaming) {
    const armIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => { idleFired = true; controller.abort(); }, timeoutMs); };
    armIdle(); activity = armIdle;
    absoluteTimer = setTimeout(() => controller.abort(), timeoutMs * 2);
  } else timer = setTimeout(() => controller.abort(), timeoutMs);
  const heartbeat = globalThis.setInterval?.(() => chrome.runtime.getContexts?.({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).catch(() => {}), 10000);
  let response;
  try {
    const router = config.provider === 'openrouter';
    const body = router ? MLProviders.routerBody(config.model, prompt, images, config.maxOutputTokens || 8192, config.regionsOutput === true) : {
      contents: [{ role: 'user', parts: [{ text: prompt }, ...images.flatMap(image => {
        const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(image.dataUrl);
        if (!match) throw new Error('Geçersiz görsel kırpması');
        return [{ text: `regionId=${image.regionId || 'manual'}` }, { inlineData: { mimeType: match[1], data: match[2] } }];
      })] }], generationConfig: { maxOutputTokens: 8192, ...(!config.model.startsWith('gemma') ? { responseMimeType: 'application/json' } : {}) }
    };
    if (router && config.maxOutputTokens) body.stream = true;
    if (new TextEncoder().encode(JSON.stringify(body)).length > 8 * 1024 * 1024) throw Object.assign(new Error('Grup gövdesi 8 MiB sınırını aşıyor; gönderilmedi.'), { notSent: true, stopJob: true, code: 'BATCH_TOO_LARGE' });
    const endpoint = router ? 'https://openrouter.ai/api/v1/chat/completions' : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;
    response = await fetch(endpoint, { method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(router ? { Authorization: `Bearer ${key}` } : { 'x-goog-api-key': key }) }, body: JSON.stringify(body) });
    const data = router && response.headers?.get('content-type')?.includes('text/event-stream') ? await mlReadStream(response, activity) : await response.json();
    if (!response.ok || data.error) {
      const cooldown = router && response.status === 429 ? await mlRememberCooldown(config,response,data) : null;
      const detail = String(data.error?.message || 'Sağlayıcı hatası').replaceAll(key, '[anahtar]');
      if (data.error?.metadata?.limit_source === 'openrouter_in_flight_budget') throw Object.assign(new Error('Eşzamanlı OpenRouter kredi bütçesi doldu. Devam eden isteklerin bitmesini bekleyip açıkça yeniden deneyin.'), { stopJob: true, code: 'PROVIDER_IN_FLIGHT_BUDGET', httpStatus: response.status });
      const access = mlAccessError(config, response.status, detail);
      if (access && cooldown) { access.retryAt=cooldown.until; access.cooldownScope=cooldown.scope; }
      throw access || new Error(`${config.provider}/${config.model}: HTTP ${response.status} — ${detail.slice(0, 240)}`);
    }
    const text = router ? data.choices?.[0]?.message?.content : data.candidates?.[0]?.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join('');
    const finish = router ? data.choices?.[0]?.finish_reason : data.candidates?.[0]?.finishReason;
    if (['length', 'MAX_TOKENS'].includes(finish)) throw Object.assign(new Error(`Çeviri çıktı sınırında kesildi (${finish}); düşünme ve görünür yanıt aynı bütçeyi kullanabilir. Otomatik tekrar yapılmadı.`), { code: 'PROVIDER_OUTPUT_TRUNCATED', stopJob: true });
    if (['SAFETY', 'content_filter'].includes(finish)) throw new Error(`Çeviri tamamlanmadı: ${finish}`);
    if (typeof text !== 'string' || !text.trim()) throw new Error('Sağlayıcı boş yanıt verdi.');
    return text;
  } catch (error) {
    if (error.name === 'AbortError') { mlNoteTimeout(config.model, images.length);
      const reason = idleFired ? `yanıt akışı ${timeoutMs/1000} saniye ilerlemedi` : `${timeoutMs/1000} saniyede yanıt vermedi`;
      throw Object.assign(new Error(`${config.provider}/${config.model}: Sağlayıcı ${reason}; ücretlendirme durumu belirsiz. Otomatik tekrar yapılmadı. Sonraki gruplar bu modelde geçici küçültüldü.`), { stopJob: true, code: 'PROVIDER_TIMEOUT' }); }
    error.message = String(error.message).replaceAll(key, '[anahtar]').slice(0, 1000);
    if (error.httpStatus && !error.code) {
      const access=mlAccessError(config,error.httpStatus,error.message);
      if (access && config.provider==='openrouter' && error.httpStatus===429) {
        const cooldown=await mlRememberCooldown(config,response,{error:error.providerError||{}});
        access.retryAt=cooldown.until; access.cooldownScope=cooldown.scope;
      }
      throw access||error;
    }
    throw error;
  } finally { clearTimeout(timer); clearTimeout(idleTimer); clearTimeout(absoluteTimer); if (heartbeat) globalThis.clearInterval(heartbeat); }
}
async function mlReadStream(response, onActivity) {
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', content = '', finish, size = 0, doneMarker = false;
  const event = value => {
    const data = value.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim();
    if (!data) return; if (data === '[DONE]') { doneMarker = true; return; }
    let parsed; try { parsed = JSON.parse(data); } catch { throw new Error('Sağlayıcı akış JSON verisi geçersiz.'); }
    if (parsed.error) {
      const error = new Error('Sağlayıcı akış hatası: ' + String(parsed.error.message || parsed.error.code || 'unknown'));
      error.httpStatus = Number.isInteger(parsed.error.code) ? parsed.error.code : undefined;
      error.providerError = parsed.error;
      throw error;
    }
    const choice = parsed.choices?.[0];
    if (choice?.finish_reason === 'error') throw new Error('Sağlayıcı akışı tamamlanamadı.');
    if (typeof choice?.delta?.content === 'string') content += choice.delta.content;
    if (choice?.finish_reason) finish = choice.finish_reason;
  };
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break; onActivity?.();
      size += chunk.value.byteLength; if (size > 2 * 1024 * 1024) throw new Error('Sağlayıcı akış boyutu sınırı aşıldı.');
      buffer += decoder.decode(chunk.value, { stream: true }); buffer = buffer.replace(/\r\n/g, '\n');
      let boundary; while ((boundary = buffer.indexOf('\n\n')) >= 0) { event(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); }
    }
    buffer += decoder.decode(); if (buffer.trim()) event(buffer);
    if (!doneMarker || !finish) throw new Error('Sağlayıcı akışı eksik bitti; otomatik tekrar yapılmadı.');
    return { choices: [{ finish_reason: finish, message: { content } }] };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function mlTranslate(message) {
  if (message.jobId) return mlTranslateGroup(message);
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
      const refusal = mlAccessError(checked, existing.httpStatus || Number(/HTTP (403|404)/.exec(existing.error || '')?.[1] || 0), existing.error || '');
      if (existing.status === 'blocked') throw Object.assign(new Error(existing.error), { code: existing.code, stopJob: true, httpStatus: existing.httpStatus, actionUrl: existing.actionUrl });
      if (refusal) throw refusal;
    }
    if (existing && !message.retry) throw new Error('Önceki çağrı tamamlanamadı; tekrar ücret olasılığı nedeniyle durduruldu. “Hatalıları yeniden dene” ile açıkça tekrar deneyebilirsiniz.');
    await mlOffscreen('write', { key, value: { status: 'pending', startedAt: Date.now(), config: checked } });
    try {
      const raw = await mlEnqueue(checked, () => mlProviderCall(checked, MLProviders.prompt(checked, regions, context), regions.map(r => ({ regionId: r.regionId, dataUrl: r.crop }))));
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
async function mlDigest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(v => v.toString(16).padStart(2, '0')).join('');
}
async function mlTranslateGroup(message) {
  const { regions, context = [], owner, retry } = message;
  if (typeof message.jobId !== 'string' || message.jobId.length > 80) throw new Error('Geçersiz iş kimliği');
  const checked = MLProviders.settings({ translationProvider: message.config.provider, geminiModel: message.config.model, openrouterModel: message.config.model,
    contributorConsent: message.config.model.endsWith('-contributor') ? (await chrome.storage.sync.get('contributorConsent')).contributorConsent : false,
    contentType: message.config.contentType, localDetector: message.config.localDetector, seriesName: message.config.series, translationInstructions: message.config.instructions, translationGlossary: message.config.glossary });
  const caps = await mlCapabilities(checked);
  if (!Array.isArray(regions) || !regions.length || regions.length > caps.maxRegions || new Set(regions.map(r => r.regionId)).size !== regions.length ||
    regions.some(r => !/^[a-f0-9]{64}$/.test(r.imageId) || typeof r.regionId !== 'string' || r.regionId.length > 180 || !r.regionId.startsWith(r.imageId + ':') ||
      typeof r.crop !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(r.crop) || r.crop.length > 4_000_000) ||
    !Array.isArray(context) || JSON.stringify(context).length > 50000) throw new Error('Geçersiz toplu bölge isteği');
  const scope = await mlDigest({ checked, context });
  const regionKeys = regions.map(r => `translation-region-v2:${scope}:${r.regionId}`);
  const key = `translation-group-v2:${await mlDigest({ scope, regions: regions.map(r => r.regionId) })}`;
  if (mlCalls.has(key)) {
    try { return await mlCalls.get(key); }
    catch (error) {
      if (error.notSent && !mlRouterQueue.paused.has(owner) && !mlRouterQueue.isBlocked(owner)) return mlTranslateGroup(message);
      throw error;
    }
  }
  const operation = (async () => {
    // Attach to overlapping live work before reading persistent state. Regrouping
    // after pause cannot submit an already running region a second time.
    await Promise.all([...new Set(regionKeys.map(k => mlRegionCalls.get(k)).filter(Boolean))].map(p => p.catch(() => {})));
    const saved = await Promise.all(regionKeys.map(k => mlOffscreen('read', { key: k })));
    const missing = regions.filter((_, i) => saved[i]?.status !== 'done');
    if (!missing.length) return { regions: saved.map(s => s.region), cached: true, groupId: key, timing: { queueMs: 0, providerMs: 0, regions: 0, cachedRegions: regions.length } };
    if (!retry && saved.some(s => ['pending', 'uncertain', 'blocked'].includes(s?.status))) {
      const refusal = saved.find(s => s?.code && s.code !== 'PROVIDER_TIMEOUT' && s.code !== 'UNCERTAIN_GROUP');
      throw Object.assign(new Error(refusal?.error || 'Önceki grup sonucu belirsiz; otomatik tekrar yapılmadı. Hatalıları yeniden dene ile açıkça tekrar deneyebilirsiniz.'), { stopJob: true, code: refusal?.code || 'UNCERTAIN_GROUP', actionUrl: refusal?.actionUrl, httpStatus: refusal?.httpStatus });
    }
    let queueMs = 0, concurrency = 1, sentAt, dispatched = false;
    const missingKeys = missing.map(r => regionKeys[regions.indexOf(r)]);
    const prompt = MLProviders.prompt(checked, missing, context);
    if (caps.contextLength && new TextEncoder().encode(prompt).length + missing.length * 10000 + caps.maxOutputTokens > caps.contextLength)
      throw Object.assign(new Error('Grup, modelin doğrulanmış bağlam kapasitesi için ayrılan güvenli bütçeyi aşıyor; gönderilmedi.'), { notSent: true, stopJob: true, code: 'CONTEXT_LIMIT' });
    try {
      const raw = await mlEnqueue(checked, async timing => {
        queueMs = timing?.queueMs || 0; concurrency = timing?.concurrency || 1;
        try { await mlOffscreen('writeMany', { entries: [{ key, value: { status: 'pending', owner, startedAt: Date.now() } }, ...missingKeys.map(regionKey => ({ key: regionKey, value: { status: 'pending', groupId: key, startedAt: Date.now() } }))] }); }
        catch { throw Object.assign(new Error('Grup kaydı yazılamadı; sağlayıcıya gönderilmedi.'), { notSent: true, stopJob: true, code: 'LOCAL_STORAGE_FAILED' }); }
        sentAt = Date.now(); dispatched = true;
        try {
          const raw = await mlProviderCall({ ...checked, maxOutputTokens: caps.maxOutputTokens, regionsOutput:true }, prompt, missing.map(r => ({ regionId: r.regionId, dataUrl: r.crop })));
          return MLProviders.parse(raw, missing.map(r => r.regionId), true);
        } catch (error) { error.stopJob = true; error.code ||= 'UNCERTAIN_GROUP'; throw error; }
      }, owner);
      const translated = raw;
      mlTimeoutShrink.delete(checked.model);
      const result = { status: 'done', groupId: key, regions: regions.map((r, i) => saved[i]?.status === 'done' ? saved[i].region : translated.find(t => t.regionId === r.regionId)),
        timing: { queueMs, concurrency, providerMs: Date.now() - sentAt, regions: missing.length, cachedRegions: regions.length - missing.length }, completedAt: Date.now() };
      await mlOffscreen('writeMany', { entries: [{ key, value: result }, ...translated.map(region => ({ key: regionKeys[regions.findIndex(r => r.regionId === region.regionId)], value: { status: 'done', region } }))] });
      await incrementTranslationStats().catch(() => {}); return result;
    } catch (error) {
      if (dispatched) {
        error.stopJob = true; error.code ||= 'UNCERTAIN_GROUP';
        const value = { status: 'uncertain', groupId: key, error: error.message, code: error.code, actionUrl: error.actionUrl, httpStatus: error.httpStatus, updatedAt: Date.now() };
        try { await mlOffscreen('writeMany', { entries: [{ key, value }, ...missingKeys.map(key => ({ key, value }))] }); } catch { /* Initial pending reservation still prevents automatic resubmission. */ }
        mlRouterQueue.block(owner);
      }
      error.timing = { queueMs, concurrency, providerMs: sentAt ? Date.now() - sentAt : 0, regions: missing.length, failed: true, notSent: !dispatched }; throw error;
    }
  })();
  mlCalls.set(key, operation);
  // Reservation happens synchronously before another group can overlap it.
  const ownedKeys = regionKeys.filter(k => !mlRegionCalls.has(k)); ownedKeys.forEach(k => mlRegionCalls.set(k, operation));
  try { return await operation; } finally { mlCalls.delete(key); ownedKeys.forEach(k => { if (mlRegionCalls.get(k) === operation) mlRegionCalls.delete(k); }); }
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
    if (message.type === 'ML_JOB_CONTROL') {
      if (typeof message.jobId !== 'string' || message.jobId.length > 80) throw new Error('Geçersiz iş kimliği');
      const owner = `${sender.tab.id}:${message.jobId}`;
      let batching;
      if (!message.paused && message.config) {
        const {provider,model}=message.config;
        if (!MLProviders.catalog[provider]?.some(([id])=>id===model)) throw new Error('Geçersiz iş modeli.');
        batching=await mlCapabilities({provider,model});
      }
      if (message.paused) mlRouterQueue.pause(owner); else mlRouterQueue.begin(owner, message.retry === true);
      return batching ? {batching} : true;
    }
    if (message.type === 'ML_CANCEL') { mlLocalRequests.get(`${sender.tab.id}:${message.requestId}`)?.abort(); return true; }
    if (message.type === 'ML_PREPARE') return mlLocal(message, sender, 'prepare');
    if (message.type === 'ML_RENDER') return mlLocal(message, sender, 'render');
    if (message.type === 'ML_TRANSLATE') return mlTranslate({ ...message, owner: `${sender.tab.id}:${message.jobId || 'manual'}` });
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
    timing: error.timing, notSent: error.notSent, retryAt:error.retryAt, cooldownScope:error.cooldownScope, ...(error.stopJob ? { stopJob: true, code: error.code, actionUrl: error.actionUrl } : {}) }));
  return true;
});
