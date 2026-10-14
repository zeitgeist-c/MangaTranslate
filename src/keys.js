'use strict';
globalThis.MLKeys = (() => {
  let serial = Promise.resolve();
  const fields = provider => {
    if (provider === 'gemini') return ['googleApiKeys', 'activeGoogleApiKeyId'];
    if (provider === 'openrouter') return ['openrouterApiKeys', 'activeOpenrouterApiKeyId'];
    throw new Error('Bilinmeyen sağlayıcı.');
  };
  const queue = task => { const next = serial.then(task); serial = next.catch(() => {}); return next; };
  async function persist(provider, list, activeId) {
    const [listField, activeField] = fields(provider), normalized = list.map(k => ({ ...k, isActive: k.id === activeId }));
    const patch = { [listField]: normalized, [activeField]: activeId };
    if (provider === 'openrouter') patch.openrouterApiKey = normalized.find(k => k.id === activeId)?.key || '';
    await chrome.storage.local.set(patch);
  }
  async function load(provider) {
    const [listField, activeField] = fields(provider), data = await chrome.storage.local.get([listField, activeField, 'openrouterApiKey', 'googleApiKey', 'apiKey', 'geminiApiKey']);
    if (!Array.isArray(data[listField])) {
      const legacy = provider === 'openrouter' ? data.openrouterApiKey : data.googleApiKey || data.apiKey || data.geminiApiKey;
      const list = legacy ? [{ id: crypto.randomUUID(), key: legacy, label: provider === 'openrouter' ? 'OpenRouter API 1' : 'Google API 1', createdAt: Date.now() }] : [];
      await persist(provider, list, list[0]?.id || null); return { list, activeId: list[0]?.id || null };
    }
    return { list: data[listField], activeId: data[activeField] || null };
  }
  const mask = key => key?.length >= 12 ? key.slice(0, 6) + '…' + key.slice(-4) : '••••';
  const safe = (list, activeId) => list.map(k => ({ id: k.id, label: k.label || 'Adsız anahtar', masked: mask(k.key), active: k.id === activeId,
    status: k.connectionStatus || 'untested', message: k.connectionMessage || 'Bağlantı kontrol edilmedi.', testedAt: k.connectionTestedAt || null }));
  async function check(provider, entry) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const router = provider === 'openrouter', response = await fetch(router ? 'https://openrouter.ai/api/v1/key' : 'https://generativelanguage.googleapis.com/v1beta/models', {
        method: 'GET', signal: controller.signal, headers: router ? { Authorization: `Bearer ${entry.key}` } : { 'x-goog-api-key': entry.key }
      }), data = await response.json();
      if (response.ok && !data.error && (router ? data.data && typeof data.data === 'object' : Array.isArray(data.models)))
        return { status: 'success', message: 'Bağlantı doğrulandı. Seçili model erişimi ve yaş onayı ayrıca değerlendirilir.' };
      return { status: response.status === 401 ? 'invalid' : response.status === 429 ? 'rate_limited' : 'error', message: `Bağlantı doğrulanamadı (HTTP ${response.status}). Anahtarınızı ve sağlayıcı hesabınızı kontrol edin.` };
    } catch { return { status: 'error', message: 'Bağlantı kontrolü tamamlanamadı. Ağ bağlantısını kontrol edip tekrar deneyin.' }; }
    finally { clearTimeout(timer); }
  }
  async function action(m) {
    const provider = m.provider; fields(provider);
    if (m.type === 'ML_KEYS_CHECK') {
      const entry = await queue(async () => (await load(provider)).list.find(k => k.id === m.id));
      if (!entry) throw new Error('Anahtar bulunamadı.'); const result = await check(provider, entry);
      return queue(async () => { const { list, activeId } = await load(provider), current = list.find(k => k.id === m.id);
        if (current) { Object.assign(current, { connectionStatus: result.status, connectionMessage: result.message, connectionTestedAt: Date.now() }); await persist(provider, list, activeId); }
        return safe(list, activeId); });
    }
    return queue(async () => {
      let { list, activeId } = await load(provider); const entry = list.find(k => k.id === m.id);
      const label = () => { const value = String(m.label || '').trim(); if (value.length > 80) throw new Error('Etiket en fazla 80 karakter olabilir.'); return value; };
      switch (m.type) {
        case 'ML_KEYS_LIST': return safe(list, activeId);
        case 'ML_KEYS_ADD': {
          const key = String(m.key || '').trim();
          if (key.length < 20 || key.length > 512 || /\s/.test(key)) throw new Error('Geçerli bir API anahtarı girin; anahtar boşluk içermemeli.');
          if (list.some(k => k.key === key)) throw new Error('Bu API anahtarı zaten kayıtlı.');
          const item = { id: crypto.randomUUID(), key, label: label() || `${provider === 'gemini' ? 'Google' : 'OpenRouter'} API ${list.length + 1}`, createdAt: Date.now() };
          list = [...list, item]; if (!list.some(k => k.id === activeId)) activeId = item.id; break;
        }
        case 'ML_KEYS_RENAME': if (!entry) throw new Error('Anahtar bulunamadı.'); entry.label = label() || 'Adsız anahtar'; break;
        case 'ML_KEYS_ACTIVATE': if (!entry) throw new Error('Anahtar bulunamadı.'); activeId = entry.id; break;
        case 'ML_KEYS_DELETE': if (!entry) return safe(list, activeId); list = list.filter(k => k.id !== m.id); if (activeId === m.id) activeId = list[0]?.id || null; break;
        default: throw new Error('Bilinmeyen anahtar işlemi.');
      }
      await persist(provider, list, activeId); return safe(list, activeId);
    });
  }
  const active = provider => queue(async () => { const { list, activeId } = await load(provider); return list.find(k => k.id === activeId)?.key || ''; });
  // Service-worker-only rotation source. Never sent to popup/options; UI keeps using safe().
  const all = provider => queue(async () => (await load(provider)).list.map(k => ({ id: k.id, key: k.key })));
  chrome.runtime.onMessage.addListener((m, sender, respond) => {
    if (!m?.type?.startsWith('ML_KEYS_')) return;
    const allowed = ['popup/popup.html', 'options/settings.html'].map(path => chrome.runtime.getURL(path));
    if (sender.id !== chrome.runtime.id || !allowed.includes(sender.url?.split(/[?#]/)[0])) { respond({ ok: false, error: 'Anahtar yönetimi yalnız uzantı ayarlarından kullanılabilir.' }); return; }
    action(m).then(value => respond({ ok: true, value })).catch(error => respond({ ok: false, error: error.message })); return true;
  });
  return { active, all, action };
})();
