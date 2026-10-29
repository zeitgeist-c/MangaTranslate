'use strict';
const T = (key, vars) => (globalThis.MLI18N ? globalThis.MLI18N.t(key, vars) : key);
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
// Per-key rotation with in-flight window: requests go round-robin across saved keys
// (active key first), each key serves up to ML_KEY_WINDOW concurrent sends; a full key is
// skipped, and when every key is full the rotation overflows past the window (never blocks).
// The order wraps and a 429/quota failure skips that key for a while.
// Gemini additionally keeps a sliding budget (12 sends per 60 s window + 5 s margin) per key.
const mlGeminiBudget = new Map(), ML_GEMINI_RPM = 12, ML_GEMINI_WINDOW_MS = 60000, ML_GEMINI_MARGIN_MS = 5000;
const ML_KEY_WINDOW = 5;
const mlBatchState = new Map(), mlBatchCooldown = new Map();
function mlPruneGeminiBudget(id, now = Date.now()) {
  const uses = (mlGeminiBudget.get(id) || []).filter(t => t > now - ML_GEMINI_WINDOW_MS);
  mlGeminiBudget.set(id, uses); return uses;
}
function mlBatchScope(provider, owner) { return provider + ':' + (owner || 'manual'); }
function mlBatchReset(provider, owner) {
  const scope = mlBatchScope(provider, owner);
  mlBatchState.delete(scope);
  for (const key of [...mlBatchCooldown.keys()]) if (key.startsWith(scope + ':')) mlBatchCooldown.delete(key);
}
async function mlListProviderKeys(provider) {
  if (typeof MLKeys !== 'undefined' && typeof MLKeys.all === 'function') {
    try { const list = await MLKeys.all(provider); if (Array.isArray(list) && list.length) return list; } catch { /* Active/legacy key below. */ }
  }
  const single = await mlKey(provider);
  return single ? [{ id: single, key: single }] : [];
}
async function mlBatchActiveId(provider, keys) {
  if (keys.length < 2 || typeof MLKeys === 'undefined' || typeof MLKeys.active !== 'function') return null;
  try {
    const activeKey = await MLKeys.active(provider), found = keys.find(k => k.key === activeKey);
    return found ? found.id : null;
  } catch { return null; }
}
function mlBatchOrder(keys, scope, firstId) {
  if (!mlBatchState.has(scope) && mlBatchState.size > 50) mlBatchState.delete(mlBatchState.keys().next().value);
  if (mlBatchCooldown.size > 500) { const now = Date.now(); for (const [key, until] of mlBatchCooldown) if (until <= now) mlBatchCooldown.delete(key); }
  let state = mlBatchState.get(scope);
  const ids = keys.map(k => k.id);
  if (!state) {
    const order = [...ids];
    if (firstId && order.includes(firstId)) while (order[0] !== firstId) order.push(order.shift());
    state = { order, pos: 0, flight: {} }; mlBatchState.set(scope, state); return state;
  }
  state.order = state.order.filter(id => ids.includes(id));
  for (const id of ids) if (!state.order.includes(id)) state.order.push(id);
  if (!state.order.length) { state.order = [...ids]; state.pos = 0; }
  else state.pos = Math.min(state.pos, state.order.length - 1);
  state.flight ||= {};
  return state;
}
// Skipped key's turn goes to the next key.
function mlBatchSkip(provider, owner, keyId, cooldownMs = 30000) {
  const scope = mlBatchScope(provider, owner);
  if (keyId) mlBatchCooldown.set(scope + ':' + keyId, Date.now() + Math.max(1000, cooldownMs || 0));
  const state = mlBatchState.get(scope);
  if (!state || !state.order.length) return;
  const at = keyId ? state.order.indexOf(keyId) : -1;
  state.pos = (at >= 0 ? at + 1 : state.pos + 1) % state.order.length;
}
function mlBatchRelease(scope, id) {
  return () => { const state = mlBatchState.get(scope); if (!state) return;
    state.flight[id] = Math.max(0, (state.flight[id] || 0) - 1); };
}
function mlBatchTake(keys, scope, state, index) {
  const id = state.order[index];
  state.pos = (index + 1) % state.order.length;
  state.flight[id] = (state.flight[id] || 0) + 1;
  const entry = keys.find(k => k.id === id);
  return { id: entry.id, key: entry.key, release: mlBatchRelease(scope, id) };
}
async function mlPickGeminiKey(owner) {
  const keys = await mlListProviderKeys('gemini');
  if (!keys.length) throw new Error(T('pg_gemini_key_missing'));
  const now = Date.now(), base = Math.max(1, Math.min(4, keys.length));
  if (!(globalThis.mlLaneCutUntil > now)) globalThis.mlGeminiLanes = base;
  const scope = mlBatchScope('gemini', owner);
  const state = mlBatchState.has(scope) ? mlBatchOrder(keys, scope) : mlBatchOrder(keys, scope, await mlBatchActiveId('gemini', keys));
  let earliest = Infinity;
  const available = (id, ignoreCooling) => {
    if (!ignoreCooling) {
      const cooling = mlBatchCooldown.get(scope + ':' + id) || 0;
      if (cooling > now) { earliest = Math.min(earliest, cooling); return false; }
    }
    const uses = mlPruneGeminiBudget(id, now);
    if (uses.length >= ML_GEMINI_RPM) { earliest = Math.min(earliest, uses[0] + ML_GEMINI_WINDOW_MS + ML_GEMINI_MARGIN_MS); return false; }
    return true;
  };
  // Pass 0: free window; pass 1: overflow ignoring the window; pass 2: last resort ignoring cooldown (mid-retry).
  for (let pass = 0; pass < 3; pass++) {
    for (let step = 0; step < state.order.length; step++) {
      const index = (state.pos + step) % state.order.length, id = state.order[index];
      if (!keys.some(k => k.id === id)) continue;
      if (pass < 2 && !available(id, false)) continue;
      if (pass === 2 && !available(id, true)) continue;
      if (pass === 0 && (state.flight[id] || 0) >= ML_KEY_WINDOW) continue;
      return mlBatchTake(keys, scope, state, index);
    }
  }
  throw Object.assign(new Error(`Gemini istek limiti doldu (12/dk, ${keys.length} anahtar). Pencere bitiminde otomatik devam edilecek.`),
    { notSent: true, stopJob: true, code: 'GEMINI_BUDGET_EXHAUSTED', retryAt: earliest === Infinity ? now + ML_GEMINI_MARGIN_MS : earliest });
}
async function mlPickRoundRobin(provider, owner, opts = {}) {
  const keys = await mlListProviderKeys(provider);
  if (!keys.length) throw new Error(T('pg_provider_key_missing', { provider: provider === 'gemini' ? 'Gemini' : provider === 'openrouter' ? 'OpenRouter' : 'Ollama' }));
  const now = Date.now(), scope = mlBatchScope(provider, owner);
  // Ollama bulutu anahtar başına tek isteğe izin verir: pencere dolar dolmaz beklenir, taşma yapılmaz.
  const limit = provider === 'ollama' ? 1 : ML_KEY_WINDOW;
  const state = mlBatchState.has(scope) ? mlBatchOrder(keys, scope) : mlBatchOrder(keys, scope, await mlBatchActiveId(provider, keys));
  let earliest = Infinity;
  const scan = (ignoreCooling, ignoreWindow) => {
    for (let step = 0; step < state.order.length; step++) {
      const index = (state.pos + step) % state.order.length, id = state.order[index];
      if (!keys.some(k => k.id === id)) continue;
      if (!ignoreCooling) {
        const cooling = mlBatchCooldown.get(scope + ':' + id) || 0;
        if (cooling > now) { earliest = Math.min(earliest, cooling); continue; }
      }
      if (!ignoreWindow && (state.flight[id] || 0) >= limit) continue;
      return mlBatchTake(keys, scope, state, index);
    }
    return null;
  };
  // Pass 0: free window; pass 1: overflow ignoring the window; pass 2: last resort ignoring cooldown (mid-retry).
  let picked = scan(false, false);
  if (!picked && provider === 'ollama') {
    const cap = Number.isFinite(opts.maxWaitMs) ? opts.maxWaitMs
      : Number.isFinite(globalThis.mlOllamaSlotWaitMs) ? globalThis.mlOllamaSlotWaitMs : 300000;
    const start = Date.now();
    while (!picked && Date.now() - start < cap) {
      await new Promise(resolve => setTimeout(resolve, 200));
      picked = scan(false, false);
    }
  }
  picked = picked || scan(false, true) || scan(true, true);
  if (picked) return picked;
  throw Object.assign(new Error(T('pg_keys_cooldown', { provider: provider === 'ollama' ? 'Ollama' : 'OpenRouter' })),
    { notSent: true, stopJob: true, code: 'PROVIDER_COOLDOWN', retryAt: earliest === Infinity ? now + 30000 : earliest, cooldownScope: 'account' });
}
async function mlPickOpenrouterKey(owner) { return mlPickRoundRobin('openrouter', owner); }
async function mlPickOllamaKey(owner, opts) { return mlPickRoundRobin('ollama', owner, opts); }
function mlReserveGeminiKey(id) { mlPruneGeminiBudget(id).push(Date.now()); }
const mlGeminiKeyLocks = new Map(), mlGeminiLastSend = new Map();
async function mlWithGeminiKeySlot(id, gapMs, task) {
  const prev = mlGeminiKeyLocks.get(id) || Promise.resolve();
  let release; const current = new Promise(resolve => { release = resolve; });
  mlGeminiKeyLocks.set(id, current);
  await prev;
  try {
    const wait = Math.max(0, gapMs - (Date.now() - (mlGeminiLastSend.get(id) || 0)));
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    mlGeminiLastSend.set(id, Date.now());
    return await task();
  } finally { release(); }
}
const mlQueueReady = chrome.storage?.local?.get(['mlParallelLimit', 'mlRouterCooldowns']).then(stored => {
  if (Number.isInteger(stored.mlParallelLimit)) mlRouterQueue.limit = Math.max(1, Math.min(8, stored.mlParallelLimit));
  for (const [scope, value] of Object.entries(stored.mlRouterCooldowns || {})) {
    if ((scope === 'account' || MLProviders.catalog.openrouter.some(([id]) => id === scope) || MLProviders.catalog.ollama.some(([id]) => id === scope)) && Number.isFinite(value?.until) && value.until > Date.now() && value.until > (mlCooldowns.get(scope)?.until || 0)) mlCooldowns.set(scope, value);
  }
}).catch(() => {});
function mlCooldownError(model) {
  const blocked = [mlCooldowns.get('account'), mlCooldowns.get(model)].filter(value => value?.until > Date.now()).sort((a,b) => b.until-a.until)[0];
  if (!blocked) return null;
  const seconds = Math.ceil((blocked.until-Date.now())/1000);
  return Object.assign(new Error(T('pg_provider_wait', { scope: blocked.scope === 'account' ? T('pg_scope_account') : T('pg_scope_model'), seconds, model: blocked.model, forModel: model })),
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
  if (config.provider === 'gemini') return enqueueWithRateLimit(task, { retry: false });
  if (owner === undefined) { owner = `manual:${++mlManualOwner}`; mlRouterQueue.begin(owner); }
  const policy = config.provider === 'ollama' ? MLProviders.ollamaPolicy(config.model) : MLProviders.routerPolicy(config.model);
  return Promise.resolve(mlQueueReady).then(() => mlRouterQueue.enqueue(owner, timing => {
    const cooldown = mlCooldownError(config.model); if (cooldown) throw cooldown;
    return task(timing);
  }, {lane:config.model, maxConcurrency:policy.maxConcurrency}));
}
async function mlCapabilities(config) {
  const fallback = { maxRegions: config.provider === 'gemini' ? 6 : 12, maxOutputTokens: 8192, contextLength: null, verified: false };
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
      if (!endpoints.length) throw Object.assign(new Error(T('pg_model_params_unavailable')), { notSent: true, stopJob: true, code: 'MODEL_PARAMETERS_UNAVAILABLE' });
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
    if (!mlOffscreenCreating) mlOffscreenCreating = chrome.offscreen.createDocument({ url: 'src/page/offscreen.html', reasons: ['BLOBS'], justification: T('pg_offscreen_justification') }).finally(() => { mlOffscreenCreating = null; });
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
      new Promise((_, reject) => { timer = setTimeout(() => { cancel(); reject(new Error(T('pg_local_timeout'))); }, command === 'prepare' ? 175000 : 55000); })
    ]);
    if (!response?.ok) throw new Error(response?.error || T('pg_local_no_response'));
    return response.value;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
async function mlLocal(message, sender, command) {
  if (typeof message.requestId !== 'string' || message.requestId.length > 80) throw new Error(T('pg_invalid_op_id'));
  const key = `${sender.tab.id}:${message.requestId}`, controller = new AbortController();
  if (mlLocalRequests.has(key)) throw new Error(T('pg_already_running'));
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
  if (provider === 'ollama') {
    const stored = await chrome.storage.local.get(['ollamaApiKey']);
    return stored.ollamaApiKey || '';
  }
  const stored = await chrome.storage.local.get(['openrouterApiKey']);
  return stored.openrouterApiKey || '';
}
function mlAccessError(config, status, message) {
  let code, advice, actionUrl;
  if (config.provider === 'openrouter' && status === 403 && /(?:18\+\s*age confirmation|age (?:confirmation|verification) (?:is )?required)/i.test(message)) {
    code = 'AGE_CONFIRMATION_REQUIRED';
    advice = T('pg_advice_age');
    actionUrl = 'https://openrouter.ai/settings/preferences';
  } else if (status === 401) {
    code = 'PROVIDER_AUTH_REQUIRED'; advice = T('pg_advice_auth');
  } else if (status === 402) {
    code = 'PROVIDER_CREDIT_REQUIRED'; advice = T('pg_advice_credit');
  } else if (config.provider === 'openrouter' && status === 404 && /(?:paid model training violation|matching your (?:guardrail restrictions and )?data policy|no endpoints.*data policy)/i.test(message)) {
    code = 'PROVIDER_DATA_POLICY_BLOCK'; advice = T('pg_advice_data_policy');
    actionUrl = 'https://openrouter.ai/settings/privacy';
  } else if (status === 429) {
    code = 'PROVIDER_RATE_LIMITED'; advice = T('pg_advice_rate');
  } else if (config.provider === 'ollama' && status === 400 && /image input/i.test(message)) {
    code = 'MODEL_VISION_UNSUPPORTED'; advice = T('pg_advice_vision');
  } else if (config.provider === 'openrouter' && status === 404 && /(?:no (?:available )?endpoints|no providers|parameters|routing)/i.test(message)) {
    code = 'MODEL_ENDPOINT_UNAVAILABLE'; advice = T('pg_advice_endpoint');
  } else if (config.provider === 'openrouter' && status === 400 && /(?:thinking|reasoning|response_format|json mode|unsupported.*parameter)/i.test(message)) {
    code = 'MODEL_PARAMETER_REJECTED'; advice = T('pg_advice_params');
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
const mlRetryableStatus = new Set([408, 429, 500, 502, 503, 504]);
function mlCutGeminiLanes() {
  const lanes = globalThis.mlGeminiLanes || 1;
  if (lanes > 1) { globalThis.mlGeminiLanes = Math.max(1, Math.floor(lanes / 2)); globalThis.mlLaneCutUntil = Date.now() + 5 * 60 * 1000; }
}
function mlMarkRetryable(config, error, status) {
  error.retryableStatus = true; error.httpStatus = error.httpStatus || status;
  if (!error.code) error.code = status === 503 ? 'PROVIDER_OVERLOADED' : status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_UNAVAILABLE';
  if (status === 503 && config.provider === 'gemini') mlCutGeminiLanes();
}
async function mlProviderCall(config, prompt, images, keyOverride, owner) {
  const heartbeat = globalThis.setInterval?.(() => chrome.runtime.getContexts?.({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).catch(() => {}), 10000);
  try {
    const tuning = globalThis.mlRetryTuning || {};
    const delays = Array.isArray(tuning.delays) ? tuning.delays : [15000, 30000];
    const maxWait = Number.isFinite(tuning.maxWait) ? tuning.maxWait : 120000;
    let current = config, error;
    for (;;) {
      for (let attempt = 0; ; attempt++) {
        try { return await mlProviderAttempt(current, prompt, images, keyOverride, owner); }
        catch (e) {
          error = e; error.attempts = attempt + 1;
          if (!e.retryableStatus || attempt >= delays.length) break;
          let wait = delays[attempt];
          if (e.cooldownUntil > Date.now()) wait = Math.min(Math.max(wait, e.cooldownUntil - Date.now() + 1000), maxWait);
          await new Promise(resolve => setTimeout(resolve, wait));
        }
      }
      // 429/503 reddedildi demektir (ücret yok): zincirdeki sonraki Gemini modeliyle
      // aynı iş içinde otomatik devam edilir. Opt-in açıksa diğer retryable
      // hatalarda (500/502/504/408) da zincirlenir; kapalıysa iş durur.
      const chainable = current.provider === 'gemini' && (error.httpStatus === 429 || error.httpStatus === 503 ||
        (current.geminiFallback === true && error.retryableStatus === true));
      const next = chainable ? MLProviders.nextGeminiModel(current.model) : null;
      if (!next) break;
      current = { ...current, model: next };
    }
    if (error.retryableStatus && !error.retryAt) error.retryAt = Date.now() + 60000;
    if (error.attempts > 1) error.message = `${error.message} (${error.attempts} deneme)`;
    throw error;
  } finally { if (heartbeat) globalThis.clearInterval(heartbeat); }
}
async function mlProviderAttempt(config, prompt, images, keyOverride, owner) {
  let key = keyOverride, release = null, geminiKeyId, routerKeyId;
  if (!key && config.provider === 'gemini') {
    const picked = await mlPickGeminiKey(owner);
    key = picked.key; geminiKeyId = picked.id; release = picked.release;
  }
  if (!key && config.provider === 'openrouter') {
    const picked = await mlPickOpenrouterKey(owner);
    key = picked.key; routerKeyId = picked.id; release = picked.release;
  }
  if (!key && config.provider === 'ollama') {
    const picked = await mlPickOllamaKey(owner);
    key = picked.key; routerKeyId = picked.id; release = picked.release;
  }
  if (!key) key = await mlKey(config.provider);
  if (!key) throw new Error(T('pg_provider_key_missing', { provider: config.provider === 'gemini' ? 'Gemini' : config.provider === 'openrouter' ? 'OpenRouter' : 'Ollama' }));
  const timeoutMs = config.provider === 'openrouter' ? MLProviders.routerPolicy(config.model).timeoutMs
    : config.provider === 'ollama' ? MLProviders.ollamaPolicy(config.model).timeoutMs : 60000;
  const streaming = config.provider === 'openrouter' && Boolean(config.maxOutputTokens);
  const controller = new AbortController();
  let timer = 0, idleTimer = 0, absoluteTimer = 0, idleFired = false, activity;
  if (streaming) {
    const armIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => { idleFired = true; controller.abort(); }, timeoutMs); };
    armIdle(); activity = armIdle;
    absoluteTimer = setTimeout(() => controller.abort(), timeoutMs * 2);
  } else timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    const router = config.provider === 'openrouter', cloud = config.provider === 'ollama';
    const body = router ? MLProviders.routerBody(config.model, prompt, images, config.maxOutputTokens || 8192, config.regionsOutput === true)
      : cloud ? MLProviders.ollamaBody(config.model, prompt, images) : {
      contents: [{ role: 'user', parts: [{ text: prompt }, ...images.flatMap(image => {
        const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(image.dataUrl);
        if (!match) throw new Error(T('pg_invalid_crop'));
        return [{ text: `regionId=${image.regionId || 'manual'}` }, { inlineData: { mimeType: match[1], data: match[2] } }];
      })] }], generationConfig: { maxOutputTokens: 8192,
      ...(config.model.startsWith('gemma') ? { thinkingConfig: { thinkingLevel: 'minimal' } } : { responseMimeType: 'application/json' }) }
    };
    if (router && config.maxOutputTokens) body.stream = true;
    if (new TextEncoder().encode(JSON.stringify(body)).length > 8 * 1024 * 1024) throw Object.assign(new Error(T('pg_batch_too_large')), { notSent: true, stopJob: true, code: 'BATCH_TOO_LARGE' });
    if (geminiKeyId) mlReserveGeminiKey(geminiKeyId);
    const endpoint = router ? 'https://openrouter.ai/api/v1/chat/completions'
      : cloud ? 'https://ollama.com/api/chat'
      : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;
    const send = () => fetch(endpoint, { method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...((router || cloud) ? { Authorization: `Bearer ${key}` } : { 'x-goog-api-key': key }) }, body: JSON.stringify(body) });
    response = geminiKeyId ? await mlWithGeminiKeySlot(geminiKeyId, Number.isFinite(globalThis.mlGeminiGapMs) ? globalThis.mlGeminiGapMs : 2500, send) : await send();
    let data;
    try {
      data = router && response.headers?.get('content-type')?.includes('text/event-stream') ? await mlReadStream(response, activity) : await response.json();
    } catch (error) {
      if (error.httpStatus && mlRetryableStatus.has(error.httpStatus)) mlMarkRetryable(config, error, error.httpStatus);
      throw error;
    }
    if (!response.ok || data.error) {
      const cooldown = (router || cloud) && response.status === 429 ? await mlRememberCooldown(config,response,data) : null;
      const rawDetail = typeof data.error === 'string' ? data.error : (data.error?.message || '');
      const detail = String(rawDetail || JSON.stringify(data)?.slice(0, 240) || T('pg_generic')).replaceAll(key, '[anahtar]');
      if (data.error?.metadata?.limit_source === 'openrouter_in_flight_budget') throw Object.assign(new Error(T('pg_in_flight_budget')), { stopJob: true, code: 'PROVIDER_IN_FLIGHT_BUDGET', httpStatus: response.status });
      const access = mlAccessError(config, response.status, detail);
      if (access && cooldown) { access.retryAt=cooldown.until; access.cooldownScope=cooldown.scope; access.cooldownUntil=cooldown.until; }
      const failure = access || new Error(`${config.provider}/${config.model}: HTTP ${response.status} — ${detail.slice(0, 240)}`);
      if (mlRetryableStatus.has(response.status)) mlMarkRetryable(config, failure, response.status);
      throw failure;
    }
    const text = router ? data.choices?.[0]?.message?.content
      : cloud ? data.message?.content
      : data.candidates?.[0]?.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join('');
    const finish = router ? data.choices?.[0]?.finish_reason : cloud ? data.done_reason : data.candidates?.[0]?.finishReason;
    if (['length', 'MAX_TOKENS'].includes(finish)) throw Object.assign(new Error(T('pg_stream_cut', { finish })), { code: 'PROVIDER_OUTPUT_TRUNCATED', stopJob: true });
    if (['SAFETY', 'content_filter'].includes(finish)) throw new Error(T('pg_unfinished', { finish }));
    if (typeof text !== 'string' || !text.trim()) throw new Error(T('pg_empty_provider'));
    return text;
  } catch (error) {
    if (error.name === 'AbortError') { mlNoteTimeout(config.model, images.length);
      const reason = idleFired ? T('pg_timeout_idle', { seconds: timeoutMs/1000 }) : T('pg_timeout_plain', { seconds: timeoutMs/1000 });
      throw Object.assign(new Error(T('pg_provider_timeout', { provider: config.provider, model: config.model, reason })), { stopJob: true, code: 'PROVIDER_TIMEOUT' }); }
    const failedId = geminiKeyId || routerKeyId;
    if (failedId && (error.httpStatus === 429 || error.status === 'rate_limited')) {
      const wait = Math.max(0, (error.retryAt || error.cooldownUntil || Date.now() + 30000) - Date.now());
      mlBatchSkip(config.provider, owner, failedId, wait);
    }
    error.message = String(error.message).replaceAll(key, '[anahtar]').slice(0, 1000);
    if (error.httpStatus && !error.code) {
      const access=mlAccessError(config,error.httpStatus,error.message);
      if (access && config.provider==='openrouter' && error.httpStatus===429) {
        const cooldown=await mlRememberCooldown(config,response,{error:error.providerError||{}});
        access.retryAt=cooldown.until; access.cooldownScope=cooldown.scope;
      }
      throw access||error;
    }
    if (error.httpStatus === 429 && config.provider === 'openrouter' && !error.retryAt) {
      const cooldown=await mlRememberCooldown(config,response,{error:error.providerError||{}});
      error.retryAt=cooldown.until; error.cooldownScope=cooldown.scope;
    }
    throw error;
  } finally { clearTimeout(timer); clearTimeout(idleTimer); clearTimeout(absoluteTimer); if (release) release(); }
}
async function mlReadStream(response, onActivity) {
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', content = '', finish, size = 0, doneMarker = false;
  const event = value => {
    const data = value.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim();
    if (!data) return; if (data === '[DONE]') { doneMarker = true; return; }
    let parsed; try { parsed = JSON.parse(data); } catch { throw new Error(T('pg_stream_json')); }
    if (parsed.error) {
      const problem = typeof parsed.error === 'string' ? parsed.error : (parsed.error.message || parsed.error.code || 'unknown');
      const error = new Error(T('pg_stream_error', { problem: String(problem) }));
      error.httpStatus = Number.isInteger(parsed.error.code) ? parsed.error.code : undefined;
      error.providerError = parsed.error;
      throw error;
    }
    const choice = parsed.choices?.[0];
    if (choice?.finish_reason === 'error') throw new Error(T('pg_stream_unfinished'));
    if (typeof choice?.delta?.content === 'string') content += choice.delta.content;
    if (choice?.finish_reason) finish = choice.finish_reason;
  };
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break; onActivity?.();
      size += chunk.value.byteLength; if (size > 2 * 1024 * 1024) throw new Error(T('pg_stream_too_large'));
      buffer += decoder.decode(chunk.value, { stream: true }); buffer = buffer.replace(/\r\n/g, '\n');
      let boundary; while ((boundary = buffer.indexOf('\n\n')) >= 0) { event(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); }
    }
    buffer += decoder.decode(); if (buffer.trim()) event(buffer);
    if (!doneMarker || !finish) throw new Error(T('pg_stream_short'));
    return { choices: [{ finish_reason: finish, message: { content } }] };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function mlTranslate(message) {
  if (message.jobId) return mlTranslateGroup(message);
  const { config, regions, imageId, context = [] } = message;
  const checked = MLProviders.settings({ translationProvider: config.provider, geminiModel: config.model, openrouterModel: config.model, ollamaModel: config.model,
    geminiFallback: config.geminiFallback,
    contributorConsent: config.model.endsWith('-contributor') ? (await chrome.storage.sync.get('contributorConsent')).contributorConsent : false,
    contentType: config.contentType, localDetector: config.localDetector, seriesName: config.series, translationInstructions: config.instructions, translationGlossary: config.glossary });
  if (!/^[a-f0-9]{64}$/.test(imageId) || !Array.isArray(regions) || !regions.length || regions.length > 6 ||
      regions.some(r => !r.regionId?.startsWith(`${imageId}:`) || typeof r.crop !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(r.crop) || r.crop.length > 4_000_000)) throw new Error(T('pg_invalid_region'));
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
    if (existing && !message.retry) throw new Error(T('pg_prev_call_open'));
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
  if (typeof message.jobId !== 'string' || message.jobId.length > 80) throw new Error(T('pg_invalid_job_id'));
  const checked = MLProviders.settings({ translationProvider: message.config.provider, geminiModel: message.config.model, openrouterModel: message.config.model, ollamaModel: message.config.model,
    geminiFallback: message.config.geminiFallback,
    contributorConsent: message.config.model.endsWith('-contributor') ? (await chrome.storage.sync.get('contributorConsent')).contributorConsent : false,
    contentType: message.config.contentType, localDetector: message.config.localDetector, seriesName: message.config.series, translationInstructions: message.config.instructions, translationGlossary: message.config.glossary });
  const caps = await mlCapabilities(checked);
  if (!Array.isArray(regions) || !regions.length || regions.length > caps.maxRegions || new Set(regions.map(r => r.regionId)).size !== regions.length ||
    regions.some(r => !/^[a-f0-9]{64}$/.test(r.imageId) || typeof r.regionId !== 'string' || r.regionId.length > 180 || !r.regionId.startsWith(r.imageId + ':') ||
      typeof r.crop !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(r.crop) || r.crop.length > 4_000_000) ||
    !Array.isArray(context) || JSON.stringify(context).length > 50000) throw new Error(T('pg_invalid_batch'));
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
      throw Object.assign(new Error(refusal?.error || T('pg_uncertain_group')), { stopJob: true, code: refusal?.code || 'UNCERTAIN_GROUP', actionUrl: refusal?.actionUrl, httpStatus: refusal?.httpStatus });
    }
    let queueMs = 0, concurrency = 1, sentAt, dispatched = false;
    const missingKeys = missing.map(r => regionKeys[regions.indexOf(r)]);
    const prompt = MLProviders.prompt(checked, missing, context);
    if (caps.contextLength && new TextEncoder().encode(prompt).length + missing.length * 10000 + caps.maxOutputTokens > caps.contextLength)
      throw Object.assign(new Error(T('pg_context_limit')), { notSent: true, stopJob: true, code: 'CONTEXT_LIMIT' });
    try {
      const raw = await mlEnqueue(checked, async timing => {
        queueMs = timing?.queueMs || 0; concurrency = timing?.concurrency || 1;
        try { await mlOffscreen('writeMany', { entries: [{ key, value: { status: 'pending', owner, startedAt: Date.now() } }, ...missingKeys.map(regionKey => ({ key: regionKey, value: { status: 'pending', groupId: key, startedAt: Date.now() } }))] }); }
        catch { throw Object.assign(new Error(T('pg_storage_failed')), { notSent: true, stopJob: true, code: 'LOCAL_STORAGE_FAILED' }); }
        sentAt = Date.now(); dispatched = true;
        try {
          const raw = await mlProviderCall({ ...checked, maxOutputTokens: caps.maxOutputTokens, regionsOutput:true }, prompt, missing.map(r => ({ regionId: r.regionId, dataUrl: r.crop })), undefined, owner);
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
    if (!sender.tab?.id) throw new Error(T('pg_cmd_manga_only'));
    if (message.type === 'ML_JOB_CONTROL') {
      if (typeof message.jobId !== 'string' || message.jobId.length > 80) throw new Error(T('pg_invalid_job_id'));
      const owner = `${sender.tab.id}:${message.jobId}`;
      let batching;
      if (!message.paused && message.config) {
        const {provider,model}=message.config;
        if (!MLProviders.catalog[provider]?.some(([id])=>id===model)) throw new Error(T('pg_invalid_job_model'));
        batching=await mlCapabilities({provider,model});
      }
      if (message.paused) mlRouterQueue.pause(owner);
      else {
        if (message.retry !== true) { mlBatchReset('gemini', owner); mlBatchReset('openrouter', owner); mlBatchReset('ollama', owner); }
        mlRouterQueue.begin(owner, message.retry === true);
      }
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
      if (!message.job || JSON.stringify(message.job).length > 2_000_000) throw new Error(T('pg_job_too_large'));
      await chrome.storage.local.set({ [key]: message.job }); return true;
    }
    throw new Error(T('pg_unknown_cmd'));
  };
  action().then(value => respond({ ok: true, value })).catch(error => respond({ ok: false, error: error.message,
    timing: error.timing, notSent: error.notSent, retryAt:error.retryAt, cooldownScope:error.cooldownScope, ...(error.stopJob ? { stopJob: true, code: error.code, actionUrl: error.actionUrl } : {}) }));
  return true;
});
