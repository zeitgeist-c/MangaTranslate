(() => {
  'use strict';
  if (globalThis.__mlPageController) return;
  globalThis.__mlPageController = true;
  let job, running = false, paused = false, epoch = 0, panel, statusNode, original = false, boxes = false;
  const layers = new Map();
  let controller, resumePending, actionLink, pauseButton, resumeButton, retryButton, counterNode, panelCollapsed = false;
  const pendingRequests = new Set();
  const request = (type, data = {}, signal = controller?.signal) => new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const cancelLocal = () => {
      if (type === 'ML_PREPARE' || type === 'ML_RENDER') chrome.runtime.sendMessage({ type: 'ML_CANCEL', requestId }).catch(() => {});
    };
    let settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort); pendingRequests.delete(requestId);
      if (error) reject(error); else resolve(value);
    };
    const abort = () => { cancelLocal(); finish(new DOMException('İş duraklatıldı', 'AbortError')); };
    const limit = type === 'ML_PREPARE' ? 180000 : type === 'ML_TRANSLATE' ? 120000 : type === 'ML_RENDER' ? 60000 : 15000;
    const timer = setTimeout(() => {
      cancelLocal(); finish(new Error(type === 'ML_TRANSLATE'
        ? 'Çeviri yanıtı zamanında gelmedi. Otomatik ücretli tekrar yapılmadı; geç yanıt önbellekte korunabilir.'
        : 'İşlem zamanında yanıt vermedi. Hatalıları yeniden dene düğmesiyle tekrar deneyebilirsiniz.'));
    }, limit);
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true }); pendingRequests.add(requestId);
    Promise.resolve().then(() => {
      if (settled) return;
      return chrome.runtime.sendMessage({ type, ...data, requestId });
    }).then(response => {
      if (settled) return;
      if (!response?.ok) finish(Object.assign(new Error(response?.error || 'Uzantı bağlantısı kesildi; devam düğmesiyle yeniden deneyin.'),
        { code: response?.code, stopJob: response?.stopJob === true, actionUrl: response?.actionUrl }));
      else finish(null, response.value);
    }, error => finish(error));
  });
  function controls() {
    if (!pauseButton) return;
    const blocked = !!job?.blocked, finished = job?.state === 'finished' && !running;
    statusNode.hidden = panelCollapsed && !blocked;
    pauseButton.hidden = !running || paused || blocked || finished;
    resumeButton.hidden = running && !paused && !blocked || finished;
    retryButton.hidden = !blocked && !(job?.pages || []).some(p => p.state === 'error');
    const phase = job?.state === 'paused' ? 'Duraklatıldı' : blocked ? 'İşlem gerekli' : finished ? 'Bitti' :
      ({ detecting: 'Tespit', translating: 'Çeviri', rendering: 'Yerleşim' })[(job?.pages || []).find(p => ['detecting', 'translating', 'rendering'].includes(p.state))?.state] || 'Çalışıyor';
    counterNode.textContent = job ? `${phase} · ${job.pages.filter(p => ['done', 'review', 'error'].includes(p.state)).length}/${job.pages.length}` : 'Hazırlanıyor';
  }
  const status = text => { ensurePanel(); statusNode.textContent = text; actionLink.hidden = true; controls(); };
  const blockedStatus = error => {
    status('Tarama durduruldu; kalan görseller işlenmedi.\n' + error.message);
    const allowed = ['https://openrouter.ai/settings/preferences', 'https://openrouter.ai/settings/privacy'];
    actionLink.hidden = !allowed.includes(error.actionUrl); if (!actionLink.hidden) actionLink.href = error.actionUrl;
  };
  function ensurePanel() {
    if (panel?.isConnected) return;
    panelCollapsed = false;
    panel = document.createElement('div'); panel.dataset.mangalensUi = 'page';
    panel.style.cssText = 'position:fixed!important;left:12px!important;top:12px!important;z-index:2147483646!important;width:340px!important;max-width:calc(100vw - 24px)!important';
    const shadow = panel.attachShadow({ mode: 'closed' }), style = document.createElement('style');
    style.textContent = ':host{all:initial}[hidden]{display:none!important}section{font:13px/1.5 system-ui,Arial;color:#eef2fa;background:#191d26;border:1px solid #38455e;border-radius:12px;padding:12px;box-shadow:0 6px 24px #0007}header{display:flex;align-items:center;gap:8px}header strong{font-size:13px;flex:1}header span{color:#9ba8be;font-size:11px}button{font:12px system-ui,Arial;margin:3px;padding:7px 10px;color:#eef2fa;background:#222836;border:1px solid #3c4b65;border-radius:8px;cursor:pointer}button:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid #6b9cff;outline-offset:2px}button:hover{background:#304366}p{max-height:120px;overflow:auto;overflow-wrap:anywhere;white-space:pre-wrap;margin:10px 0;color:#c4cfe1}details{border-top:1px solid #303849;margin-top:8px;padding-top:8px}summary{cursor:pointer;color:#9fb9e4}';
    const section = document.createElement('section'), title = document.createElement('strong'); title.textContent = 'MangaLens';
    const header = document.createElement('header'), fold = document.createElement('button'); fold.textContent = '−'; fold.setAttribute('aria-label', 'Paneli katla'); fold.setAttribute('aria-expanded', 'true');
    counterNode = document.createElement('span'); counterNode.textContent = 'Hazırlanıyor'; header.append(title, counterNode, fold);
    statusNode = document.createElement('p'); statusNode.setAttribute('role', 'status');
    section.append(header, statusNode);
    actionLink = document.createElement('a'); actionLink.textContent = 'OpenRouter ayarlarını aç';
    actionLink.href = 'https://openrouter.ai/settings/preferences'; actionLink.target = '_blank'; actionLink.rel = 'noopener noreferrer';
    actionLink.style.cssText = 'color:#b7ccff;margin:8px 0'; actionLink.hidden = true; section.append(actionLink);
    const body = document.createElement('div'); section.append(body);
    const button = (text, action, parent = body) => { const b = document.createElement('button'); b.textContent = text; b.onclick = () => Promise.resolve().then(action).catch(e => status(e.message)); parent.append(b); return b; };
    pauseButton = button('Duraklat', pause); resumeButton = button('Devam et', () => start({ resume: true })); retryButton = button('Hatalıları yeniden dene', () => start({ resume: true, retry: true }));
    const tools = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Görünüm ve kontrol araçları'; tools.append(summary); body.append(tools);
    fold.onclick = () => { body.hidden = !body.hidden; panelCollapsed = body.hidden; controls(); fold.textContent = body.hidden ? '+' : '−'; fold.setAttribute('aria-expanded', String(!body.hidden)); fold.setAttribute('aria-label', body.hidden ? 'Paneli genişlet' : 'Paneli katla'); };
    button('Orijinal / çeviri', () => { original = !original; synchronize(); }, tools);
    button('Kutuları göster / gizle', () => { boxes = !boxes; synchronize(); }, tools);
    button('Kontrol listesi', () => { status((job?.pages || []).flatMap((p, index) => [
      p.timing ? `Görsel ${index + 1} süre: tarama ${((p.timing.totalMs || 0) / 1000).toFixed(2)} sn · çeviri ${((p.timing.translationMs || 0) / 1000).toFixed(2)} sn · kart ${((p.timing.renderMs || 0) / 1000).toFixed(2)} sn` : '',
      p.error ? `Görsel ${index + 1}: ${p.error}` : '',
      ...(p.issues || []).map(issue => `Görsel ${index + 1} · y=${Math.round(issue.textBox[1])}: ${issue.reason}${issue.translatedText ? '\n' + issue.translatedText : ''}`)
    ]).filter(Boolean).join('\n') || 'Kontrol gerektiren alan yok.'); }, tools);
    button('Kapat', () => { pause(); panel.remove(); for (const entry of layers.values()) entry.root.remove(); layers.clear(); }, tools);
    shadow.append(style, section); document.documentElement.append(panel);
  }
  async function save(signal = controller?.signal) { if (job) { job.updatedAt = Date.now(); await request('ML_JOB_SAVE', { job: structuredClone(job) }, signal); } }
  function pause() {
    paused = true; epoch++; resumePending = null; controller?.abort();
    if (job) { job.state = 'paused'; save(null).catch(() => {}); }
    status('Duraklatıldı. Devam eden adımın geç sonucu sayfaya uygulanmayacak; tamamlanan çeviri önbellekte korunur.');
  }
  const alive = token => { if (paused || token !== epoch) throw new DOMException('İş duraklatıldı', 'AbortError'); };
  function candidates() {
    return [...document.images].filter(img => !img.closest('[data-mangalens-ui]') && !img.dataset.mlPagePatch &&
      (img.naturalWidth >= 400 || img.getBoundingClientRect().width >= 350) &&
      (img.naturalHeight >= 300 || img.getBoundingClientRect().height >= 300));
  }
  async function discover(token) {
    const initial = { x: scrollX, y: scrollY }; let lastHeight = 0, stable = 0;
    try {
      // Bounded lazy-load scan. Never navigate to another chapter or click site controls.
      for (let step = 0; step < 120; step++) {
        alive(token);
        const height = document.documentElement.scrollHeight;
        const atBottom = scrollY + innerHeight >= height - 4;
        if (atBottom) { stable = height === lastHeight ? stable + 1 : 0; if (stable >= 3) break; }
        lastHeight = height; window.scrollBy(0, Math.max(300, innerHeight * .8));
        // Allow lazy loaders to observe every viewport; retain bottom settling.
        await new Promise(resolve => setTimeout(resolve, atBottom ? 160 : 40));
      }
      const images = candidates(), seen = new Set(), list = [];
      for (const img of images) {
        alive(token);
        if (!img.complete) await Promise.race([img.decode().catch(() => {}), new Promise(resolve => setTimeout(resolve, 3000))]);
        const source = img.currentSrc || img.src;
        if (!/^https?:/.test(source) || seen.has(source)) continue;
        seen.add(source); list.push({ source, state: 'queued' });
      }
      if (!list.length) throw new Error('İşlenebilir manga görseli bulunamadı. Görselleri yükleyip tekrar deneyin.');
      return list;
    } finally { window.scrollTo(initial.x, initial.y); }
  }
  function elementFor(source) { return [...document.images].find(img => (img.currentSrc || img.src) === source); }
  function synchronize() {
    for (const [source, entry] of layers) {
      const warn = message => { entry.geometryError = message; if (entry.lastWarning !== message) { entry.lastWarning = message; status(message + ' Orijinal görsel korundu.'); } };
      const img = elementFor(source);
      if (!img?.isConnected) { entry.root.hidden = true; continue; }
      const r = img.getBoundingClientRect(), css = getComputedStyle(img), matrix = css.transform;
      // Rotation/skew/perspective needs a matrix-aware fixture; refuse guessed alignment.
      const transform = matrix === 'none' ? null : new DOMMatrixReadOnly(matrix);
      if (transform && (!transform.is2D || Math.abs(transform.b) > .0001 || Math.abs(transform.c) > .0001 || transform.a <= 0 || transform.d <= 0)) {
        entry.root.hidden = true; warn('Bu görselde dönme/eğilme dönüşümü desteklenmiyor.'); continue;
      }
      if (img.naturalWidth !== entry.width || img.naturalHeight !== entry.height) { entry.root.hidden = true; warn('Görsel boyutu değişti; eski çeviri gizlendi.'); continue; }
      const sx = r.width / (img.offsetWidth || r.width), sy = r.height / (img.offsetHeight || r.height);
      const insetLeft = (parseFloat(css.borderLeftWidth) + parseFloat(css.paddingLeft)) * sx;
      const insetTop = (parseFloat(css.borderTopWidth) + parseFloat(css.paddingTop)) * sy;
      const cw = r.width - insetLeft - (parseFloat(css.borderRightWidth) + parseFloat(css.paddingRight)) * sx;
      const ch = r.height - insetTop - (parseFloat(css.borderBottomWidth) + parseFloat(css.paddingBottom)) * sy;
      let width = cw, height = ch;
      if (css.objectFit === 'contain' || css.objectFit === 'cover' || css.objectFit === 'scale-down' || css.objectFit === 'none') {
        let scale = css.objectFit === 'cover' ? Math.max(cw / entry.width, ch / entry.height) : Math.min(cw / entry.width, ch / entry.height);
        if (css.objectFit === 'none') scale = 1;
        if (css.objectFit === 'scale-down') scale = Math.min(1, scale);
        width = entry.width * scale; height = entry.height * scale;
      }
      const positions = css.objectPosition.split(/\s+/);
      const offset = (value, remaining) => value.endsWith('%') ? remaining * parseFloat(value) / 100 : value.endsWith('px') ? parseFloat(value) : null;
      const px = offset(positions[0], cw - width), py = offset(positions[1] || '50%', ch - height);
      if (px === null || py === null) { entry.root.hidden = true; warn('Görselin özel konumlandırması desteklenmiyor.'); continue; }
      entry.geometryError = null;
      entry.root.hidden = original;
      entry.root.style.cssText = `position:absolute!important;pointer-events:none!important;z-index:2147483000!important;overflow:hidden!important;left:${r.left + scrollX + insetLeft}px!important;top:${r.top + scrollY + insetTop}px!important;width:${cw}px!important;height:${ch}px!important;`;
      entry.inner.style.cssText = `position:absolute;left:${px}px;top:${py}px;width:${width}px;height:${height}px`;
      for (const marker of entry.markers) marker.hidden = !boxes;
    }
  }
  function draw(source, report, result) {
    const previous = layers.get(source); previous?.root.remove();
    const root = document.createElement('div'); root.dataset.mangalensUi = 'layer';
    const shadow = root.attachShadow({ mode: 'closed' }), inner = document.createElement('div'); shadow.append(inner);
    const position = (el, b) => { el.style.cssText = `position:absolute;left:${b[0] / report.width * 100}%;top:${b[1] / report.height * 100}%;width:${(b[2] - b[0]) / report.width * 100}%;height:${(b[3] - b[1]) / report.height * 100}%;box-sizing:border-box;`; };
    for (const patch of result.patches) {
      const image = document.createElement('img'); image.src = patch.dataUrl; image.alt = ''; image.dataset.mlPagePatch = '1'; position(image, patch.box); inner.append(image);
    }
    const markers = [];
    for (const region of report.regions) {
      const el = document.createElement('div'); position(el, region.textBox);
      el.style.border = `1px solid ${result.issues.some(i => i.regionId === region.regionId) ? '#ff9b40' : '#57d998'}`;
      inner.append(el); markers.push(el);
    }
    document.documentElement.append(root);
    layers.set(source, { root, inner, markers, width: report.width, height: report.height }); synchronize();
  }
  async function processPage(item, token, retry) {
    const pageStarted = performance.now(); let translationMs = 0;
    status(`${job.pages.indexOf(item) + 1}/${job.pages.length} · Yerel tespit hazırlanıyor…`);
    item.state = 'detecting'; delete item.error; delete item.errorCode; await save(); alive(token);
    const pendingImage = elementFor(item.source);
    if (pendingImage && !pendingImage.naturalWidth) {
      const loading = pendingImage.getAttribute('loading'); pendingImage.loading = 'eager';
      let timeout;
      try { await Promise.race([pendingImage.decode(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Sayfadaki görsel yüklenemedi.')), 15000); })]); }
      finally { clearTimeout(timeout); if (loading === null) pendingImage.removeAttribute('loading'); else pendingImage.setAttribute('loading', loading); }
      alive(token);
    }
    const report = await request('ML_PREPARE', { source: item.source, detector: job.config.localDetector }); alive(token);
    const image = elementFor(item.source);
    if (!image || image.naturalWidth !== report.width || image.naturalHeight !== report.height) throw new Error('Görsel kaynağı/boyutu değişti; sonuç uygulanmadı.');
    item.imageId = report.imageId; item.regions = report.regions.length;
    const translations = [], context = item.contextBefore || job.context || [];
    item.contextBefore = context;
    const eligible = report.regions.filter(r => r.crop && !r.needsReview && (r.bubbleId || r.kind === 'text_free'));
    // Uncertain candidates stay visible for manual correction; never silently discarded.
    for (let i = 0; i < eligible.length; i += 6) {
      alive(token); item.state = 'translating'; await save(); alive(token);
      status(`${job.pages.indexOf(item) + 1}/${job.pages.length} · ${job.config.provider}/${job.config.model} · yazı ${i + 1}–${Math.min(i + 6, eligible.length)}/${eligible.length}`);
      const translationStarted = performance.now();
      const response = await request('ML_TRANSLATE', { config: job.config, imageId: report.imageId, regions: eligible.slice(i, i + 6), context, retry });
      translationMs += performance.now() - translationStarted;
      alive(token); translations.push(...response.regions);
    }
    item.state = 'rendering'; await save(); alive(token);
    const result = await request('ML_RENDER', { source: item.source, report, translations, minFont: 12, style: 'card' }); alive(token);
    if (!elementFor(item.source)) throw new Error('Kaynak görsel sayfadan kaldırıldı.');
    draw(item.source, report, result);
    if (layers.get(item.source)?.geometryError) throw new Error(layers.get(item.source).geometryError);
    if (!report.regions.length) result.issues.push({ regionId: null, textBox: [0, 0, report.width, report.height], reason: 'no_text_detected', translatedText: '' });
    item.state = result.issues.length ? 'review' : 'done'; item.issues = result.issues; item.translated = result.patches.length;
    item.timing = { ...report.timing, ...result.timing, translationMs, pageTotalMs: performance.now() - pageStarted }; item.backend = report.backend;
    job.context = [...context, ...translations.filter(t => t.status === 'translated').map(t => ({ sourceText: t.sourceText, translatedText: t.translatedText }))].slice(-12);
    await save();
  }
  async function start({ resume = false, retry = false } = {}) {
    ensurePanel();
    if (running) {
      if (paused) { resumePending = { resume, retry }; status('Duraklatma tamamlanınca tarama otomatik devam edecek…'); }
      return;
    }
    running = true; paused = false; controller = new AbortController(); const token = ++epoch;
    try {
      const settings = await chrome.storage.sync.get({ enabled: true });
      alive(token);
      if (!settings.enabled) throw new Error('Uzantı kapalı.');
      if (resume) job = job || await request('ML_JOB_GET');
      if (resume && job) {
        const current = await request('ML_CONFIG');
        if (job.config.processingVersion !== current.processingVersion) throw new Error('İşleme sürümü değişti. Popup üzerinden yeni bölüm taraması başlatın; eski iş otomatik tekrar ücretlendirilmedi.');
        if (job.blocked && !retry) { blockedStatus({ ...job.blocked, message: job.blocked.error }); return; }
      }
      if (!resume || !job) {
        const config = await request('ML_CONFIG');
        status('Bölüm görselleri yükleniyor; kaydırma konumun korunacak…');
        const pages = await discover(token); alive(token);
        job = { id: crypto.randomUUID(), url: location.href, config, pages, context: [], createdAt: Date.now(), state: 'running' };
      }
      alive(token); delete job.blocked; job.state = 'running'; await save(); alive(token);
      for (const item of job.pages) {
        alive(token);
        if (item.state === 'error' && !retry) continue;
        if (['done', 'review'].includes(item.state) && layers.has(item.source)) continue;
        // Redraw completed pages after reload from deterministic detection/translation caches.
        try { await processPage(item, token, retry); }
        catch (error) {
          alive(token);
          if (error.name === 'AbortError') throw error;
          item.state = 'error'; item.error = error.message; await save();
          if (error.stopJob) {
            alive(token); item.errorCode = error.code;
            job.state = 'blocked'; job.blocked = { error: error.message, code: error.code, actionUrl: error.actionUrl };
            await save(); alive(token); blockedStatus(error); return;
          }
        }
      }
      alive(token); job.state = 'finished'; await save(); alive(token);
      const done = job.pages.filter(p => p.state === 'done').length, review = job.pages.filter(p => p.state === 'review').length, errors = job.pages.filter(p => p.state === 'error').length;
      const cards = job.pages.reduce((n, p) => n + (p.translated || 0), 0), issues = job.pages.reduce((n, p) => n + (p.issues?.length || 0), 0);
      const seconds = name => (job.pages.reduce((n, p) => n + (p.timing?.[name] || 0), 0) / 1000).toFixed(1);
      status(`Tarama bitti: ${cards} çeviri gösterildi, ${done + review}/${job.pages.length} görsel işlendi, ${issues} alan kontrol gerekli, ${errors} hata.\n${job.config.provider} / ${job.config.model}\nSüre: tarama ${seconds('totalMs')} sn · çeviri ${seconds('translationMs')} sn · kart ${seconds('renderMs')} sn.\nÇeviriler sade kart olarak gösterilir; özgün görsel dosyası korunur. Bütün yazıların bulunduğu henüz doğrulanmadı.${errors ? '\nİlk hata: ' + job.pages.find(p => p.error)?.error : ''}`);
    } catch (error) {
      if (error.name !== 'AbortError' && token === epoch) status(error.message);
    } finally {
      running = false;
      controls();
      const next = resumePending; resumePending = null;
      if (next) start(next);
    }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type === 'START_PAGE_TRANSLATION') { start(message); respond({ ok: true }); }
    if (message.type === 'ML_PAGE_PROGRESS' && running && !paused && pendingRequests.has(message.requestId)) status(message.text);
  });
  let scheduled = false;
  function schedule() { if (scheduled) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; synchronize(); }); }
  window.addEventListener('scroll', schedule, { passive: true }); window.addEventListener('resize', schedule);
  new MutationObserver(records => { if (records.some(record => !record.target.closest?.('[data-mangalens-ui]'))) schedule(); })
    .observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'class', 'style'] });
  new ResizeObserver(schedule).observe(document.documentElement);
})();
