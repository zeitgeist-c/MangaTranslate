import * as ort from './vendor/ort.all.bundle.min.mjs';
import { detectImage } from './lib/rtdetr.mjs';
import { detectPPOCR } from './lib/ppocr.mjs';
import { fuseGroups, groupTextLines, cardLayout, interior, fitText, regionCrop } from './layout.mjs';
import { read, write, writeMany, hash } from './store.mjs';
ort.env.wasm.wasmPaths = chrome.runtime.getURL('src/page/vendor/');
ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
const models = [
  { id: 'rtdetr-int8', file: 'detector_int8.onnx', sha256: 'b5022ad46416b6fe4f88b0cc082cfd2ff5b1cfc624088c2f19879485493f5913' },
  { id: 'ppocrv5-mobile-det', file: 'ppocrv5_det.onnx', sha256: '1eb7b4f7ab657ebd1c66d5f79bca7497f29768a2e3c15e52daecbba1a8e4a039' },
  { id: 'rtdetr-v4-small', file: 'detector-v4-s_int8.onnx', sha256: '5fe9e4f576e49d4e7e8b0e029d6d3cdc252abd4694113e1cae120e62c931ea79' }
];
const sessions = new Map(), backends = new Map(), active = new Map();
let serial = Promise.resolve();
async function modelSession(model) {
  if (!sessions.has(model.id)) {
    const bytes = await (await fetch(chrome.runtime.getURL(`src/page/models/${model.file}`))).arrayBuffer();
    if (await hash(bytes) !== model.sha256) throw new Error('Yerel model hash doğrulaması başarısız.');
    let session;
    if (model.id === 'ppocrv5-mobile-det' && globalThis.navigator?.gpu) {
      try { session = await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' }); backends.set(model.id, 'webgpu'); } catch { /* Unsupported GPUs use the same model on CPU. */ }
    }
    if (!session) { session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }); backends.set(model.id, 'wasm'); }
    sessions.set(model.id, session);
  }
  return sessions.get(model.id);
}
async function imageFromSource(source, signal) {
  const url = new URL(source);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Desteklenmeyen görsel adresi.');
  const controller = new AbortController(), abort = () => controller.abort(), timer = setTimeout(abort, 30000);
  let blob;
  try {
    signal?.throwIfAborted(); signal?.addEventListener('abort', abort, { once: true });
    const response = await fetch(url.href, { credentials: 'omit', signal: controller.signal });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error(`Görsel yüklenemedi: HTTP ${response.status}`);
    blob = await response.blob();
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  signal?.throwIfAborted();
  if (blob.size > 50_000_000) throw new Error('Görsel dosyası 50 MB sınırını aşıyor.');
  const imageId = await hash(await blob.arrayBuffer()), image = await createImageBitmap(blob);
  if (image.width * image.height > 100_000_000) { image.close(); throw new Error('Görsel 100 milyon piksel sınırını aşıyor.'); }
  return { image, imageId };
}
async function dataUrl(canvas) {
  // convertToBlob's idle encoder is throttled in an invisible offscreen document
  // (~1 second per crop on Brave). The bounded synchronous encoder avoids that
  // scheduler entirely, while retaining PNG pixels and the same wire format.
  const output = document.createElement('canvas'); output.width = canvas.width; output.height = canvas.height;
  try { output.getContext('2d').drawImage(canvas, 0, 0); return output.toDataURL('image/png'); }
  finally { output.width = 1; output.height = 1; }
}
async function crop(image, box) {
  const canvas = new OffscreenCanvas(Math.ceil(box[2] - box[0]), Math.ceil(box[3] - box[1]));
  canvas.getContext('2d').drawImage(image, ...box.slice(0, 2), box[2] - box[0], box[3] - box[1], 0, 0, canvas.width, canvas.height);
  return canvas;
}
async function prepare(source, signal, progress, detector = 'fast') {
  const started = performance.now(), timing = {};
  const { image, imageId } = await imageFromSource(source, signal);
  timing.imageMs = performance.now() - started;
  try {
    const fast = !['small', 'detailed'].includes(detector), model = fast ? models[1] : detector === 'small' ? models[2] : models[0];
    const version = fast ? 'fast-v6' : detector === 'small' ? 'd6-small' : 'd6-detailed';
    const key = `detection-v6:${version}:${model.sha256}:${imageId}`;
    let report = await read(key);
    timing.cached = !!report;
    if (!report) {
      const detectStarted = performance.now(); let first;
      if (!fast) first = await detectImage({ image, imageId, ort, model, session: await modelSession(model), signal,
        onProgress: value => progress(`Ayrıntılı balon tespiti ${value.done}/${value.total}`) });
      const runText = async () => detectPPOCR({ image, imageId, ort, model: models[1], session: await modelSession(models[1]), signal,
        onProgress: value => progress(`Hızlı yazı taraması ${value.done}/${value.total}`) });
      let second;
      try { second = await runText(); }
      catch (error) {
        signal.throwIfAborted(); if (backends.get(models[1].id) !== 'webgpu') throw error;
        await sessions.get(models[1].id)?.release(); sessions.delete(models[1].id);
        const bytes = await (await fetch(chrome.runtime.getURL(`src/page/models/${models[1].file}`))).arrayBuffer();
        if (await hash(bytes) !== models[1].sha256) throw new Error('Yerel model hash doğrulaması başarısız.');
        sessions.set(models[1].id, await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })); backends.set(models[1].id, 'wasm');
        progress('GPU kullanılamadı; yazı taraması CPU ile sürüyor.'); second = await runText();
      }
      const combined = fast ? groupTextLines(second) : fuseGroups(first, second);
      timing.detectMs = performance.now() - detectStarted;
      report = { imageId, width: image.width, height: image.height, bubbles: first?.bubbles || [],
        regions: combined.map((r, i) => ({ ...r, regionId: `${imageId}:${version}:r${i}` })), detectorVersion: version, modelSHA256: model.sha256, backend: backends.get(models[1].id), timing };
      await write(key, report);
    }
    signal.throwIfAborted();
    const regions = [];
    for (const region of report.regions) {
      signal.throwIfAborted();
      if (region.needsReview) { regions.push({ ...region }); continue; }
      const bounds = regionCrop(region, image.width, image.height);
      // A giant merged detection is flagged, never downscaled into unreadable text.
      if (bounds[2] - bounds[0] > 1200 || bounds[3] - bounds[1] > 1200) { regions.push({ ...region, needsReview: true, reason: 'oversized_region' }); continue; }
      const canvas = await crop(image, bounds);
      regions.push({ ...region, crop: await dataUrl(canvas) });
      canvas.width = 1; canvas.height = 1;
    }
    return { ...report, regions, timing: { ...timing, totalMs: performance.now() - started } };
  } finally { image.close(); }
}
async function renderCards(report, translations, minFont, signal) {
  if (!Number.isSafeInteger(report.width) || !Number.isSafeInteger(report.height) || report.width < 1 || report.height < 1 || report.width * report.height > 100_000_000) throw new Error('Geçersiz görsel boyutu.');
  const started = performance.now(), measure = new OffscreenCanvas(1, 1).getContext('2d'), patches = [], issues = [];
  for (const region of report.regions) {
    signal.throwIfAborted(); const translation = translations.find(t => t.regionId === region.regionId);
    const fail = reason => issues.push({ regionId: region.regionId, textBox: region.textBox, reason, translatedText: translation?.translatedText || '' });
    if (region.needsReview) { fail(region.reason || 'needs_review'); continue; }
    if (!translation || translation.status !== 'translated') { fail('unreadable_or_pending'); continue; }
    const fit = cardLayout(measure, translation.translatedText, region.textBox, report.width, report.height, minFont || 12);
    if (!fit || fit.box[2] - fit.box[0] > 1200 || fit.box[3] - fit.box[1] > 1200) { fail('text_overflow'); continue; }
    if (patches.some(p => Math.min(p.box[2], fit.box[2]) > Math.max(p.box[0], fit.box[0]) && Math.min(p.box[3], fit.box[3]) > Math.max(p.box[1], fit.box[1]))) { fail('card_overlap'); continue; }
    const b = fit.box, canvas = new OffscreenCanvas(b[2] - b[0], b[3] - b[1]), ctx = canvas.getContext('2d');
    ctx.fillStyle = '#171d29'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.strokeStyle = '#7386aa'; ctx.strokeRect(.5, .5, canvas.width - 1, canvas.height - 1);
    ctx.font = `600 ${fit.size}px Arial, sans-serif`; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const top = (canvas.height - fit.lines.length * fit.step) / 2;
    fit.lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, top + (i + .5) * fit.step));
    patches.push({ regionId: region.regionId, box: b, dataUrl: await dataUrl(canvas), fontSize: fit.size, style: 'card' }); canvas.width = 1; canvas.height = 1;
  }
  return { imageId: report.imageId, width: report.width, height: report.height, patches, issues, timing: { renderMs: performance.now() - started } };
}
async function render(source, report, translations, minFont, signal, style) {
  if (style === 'card') return renderCards(report, translations, minFont, signal);
  const { image, imageId } = await imageFromSource(source, signal);
  try {
    if (imageId !== report.imageId || image.width !== report.width || image.height !== report.height) throw new Error('Kaynak görsel değişti; eski çeviri uygulanmadı.');
    const patches = [], issues = [];
    await document.fonts.ready;
    for (const region of report.regions) {
      signal.throwIfAborted();
      const translation = translations.find(t => t.regionId === region.regionId);
      const fail = reason => issues.push({ regionId: region.regionId, textBox: region.textBox, reason, translatedText: translation?.translatedText || '' });
      if (!translation || translation.status !== 'translated') { fail('unreadable_or_pending'); continue; }
      if (region.needsReview || (!region.bubbleBox && region.kind !== 'text_free')) { fail(region.reason || 'no_safe_bubble'); continue; }
      const b = (region.bubbleBox || regionCrop(region, image.width, image.height, 20)).map((v, i) => i < 2 ? Math.floor(v) : Math.ceil(v));
      if (b[2] - b[0] > 1200 || b[3] - b[1] > 1200) { fail('oversized_bubble'); continue; }
      const canvas = await crop(image, b), ctx = canvas.getContext('2d', { willReadFrequently: true });
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height), t = region.textBox.map((v, i) => v - b[i % 2]);
      const shape = interior(pixels.data, canvas.width, canvas.height, t);
      if (!shape) { fail('textured_or_unsafe_background'); continue; }
      const fit = fitText(ctx, translation.translatedText, shape, t, minFont || 12);
      if (!fit) { fail('text_overflow'); continue; }
      // Precompose onto the unchanged source crop. A rescaled transparent ink mask
      // blends twice with the old letters and leaves halos in the reader.
      // Outside the ink rectangle every original pixel remains byte-for-byte intact.
      const erased = pixels, background = shape.background;
      for (let y = Math.max(0, Math.floor(t[1]) - 1); y < Math.min(canvas.height, Math.ceil(t[3]) + 1); y++)
        for (let x = Math.max(0, Math.floor(t[0]) - 1); x < Math.min(canvas.width, Math.ceil(t[2]) + 1); x++) {
          const p = (y * canvas.width + x) * 4;
          if (Math.max(...[0, 1, 2].map(c => Math.abs(pixels.data[p + c] - background[c]))) > 2) {
            erased.data[p] = background[0]; erased.data[p + 1] = background[1]; erased.data[p + 2] = background[2]; erased.data[p + 3] = 255;
          }
        }
      ctx.putImageData(erased, 0, 0);
      ctx.font = `600 ${fit.size}px Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = shape.light ? '#000' : '#fff';
      fit.lines.forEach((line, i) => ctx.fillText(line, fit.x, fit.top + (i + .5) * fit.step));
      patches.push({ regionId: region.regionId, box: b, dataUrl: await dataUrl(canvas), fontSize: fit.size });
      canvas.width = 1; canvas.height = 1;
    }
    return { imageId, width: image.width, height: image.height, patches, issues };
  } finally { image.close(); }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message.target !== 'ml-offscreen') return;
  if (message.command === 'cancel') { active.get(message.requestId)?.abort(); respond({ ok: true }); return; }
  const controller = new AbortController(); active.set(message.requestId, controller);
  const heartbeat = setInterval(() => chrome.runtime.sendMessage({ type: 'ML_HEARTBEAT' }).catch(() => {}), 10000);
  const progress = text => chrome.runtime.sendMessage({ type: 'ML_PROGRESS', tabId: message.tabId, clientRequestId: message.clientRequestId, text }).catch(() => {});
  const execute = async () => {
    controller.signal.throwIfAborted();
    if (message.command === 'prepare') return prepare(message.source, controller.signal, progress, message.detector);
    if (message.command === 'render') return render(message.source, message.report, message.translations, message.minFont, controller.signal, message.style);
    if (message.command === 'read') return read(message.key);
    if (message.command === 'write') return write(message.key, message.value);
    if (message.command === 'writeMany') return writeMany(message.entries);
    throw new Error('Bilinmeyen görüntü komutu');
  };
  // Cache persistence must not wait behind a long inference or a cancelled kernel.
  const lightweight = ['read', 'write', 'writeMany'].includes(message.command);
  const task = lightweight ? execute() : serial.then(execute);
  if (!lightweight) serial = task.catch(() => {});
  task.then(value => respond({ ok: true, value })).catch(error => respond({ ok: false, error: error.message })).finally(() => { active.delete(message.requestId); clearInterval(heartbeat); });
  return true;
});
