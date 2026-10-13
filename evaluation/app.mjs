import * as ort from './node_modules/onnxruntime-web/dist/ort.all.bundle.min.mjs';
import { detectImage } from './lib/rtdetr.mjs';
import { detectPPOCR } from './lib/ppocr.mjs';
const $ = id => document.getElementById(id);
ort.env.wasm.wasmPaths = '/node_modules/onnxruntime-web/dist/';
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
let registry, pages = [], selected, currentImage, report, session, sessionKey, controller, generation = 0, busy = false;
let truth = { regions: [], bubbles: [] }, dirty = false;
const status = message => { $('status').textContent = message; };
function option(select, value, text) { const el = document.createElement('option'); el.value = value; el.textContent = text; select.append(el); }
function setBusy(value) { busy = value; for (const id of ['page', 'model', 'backend', 'run', 'batch']) $(id).disabled = value; $('cancel').disabled = !value; }
function rect(b, stroke, text = '') {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  for (const [name, value] of Object.entries({ x: b[0], y: b[1], width: b[2] - b[0], height: b[3] - b[1], fill: 'none', stroke, 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' })) el.setAttribute(name, value);
  if (text) { const title = document.createElementNS(el.namespaceURI, 'title'); title.textContent = text; el.append(title); }
  $('overlay').append(el); return el;
}
function draw() {
  $('overlay').replaceChildren();
  if (report && $('showPredictions').checked) {
    for (const b of report.bubbles) rect(b.box, '#4aa3ff', b.id);
    for (const r of report.regions) rect(r.textBox, r.needsReview ? '#ff914d' : '#d57aff', `${r.regionId}: ${r.reason ?? 'candidate'}`);
  }
  for (const b of truth.bubbles) rect(b.box, '#54e1e8', b.id);
  for (const r of truth.regions) rect(r.textBox, r.inScope === false ? '#aaa' : '#62ef86', r.id);
}
function renderLabels() {
  $('labels').replaceChildren();
  for (const item of [...truth.bubbles, ...truth.regions]) {
    const row = document.createElement('div'); row.className = 'label-row';
    const name = document.createElement('span'); name.textContent = item.id; row.append(name);
    if (item.textBox) {
      const scopeLabel = document.createElement('label'), scope = document.createElement('input'); scope.type = 'checkbox'; scope.checked = item.inScope !== false;
      scopeLabel.append(scope, ' Kapsam içi'); row.append(scopeLabel);
      scope.onchange = () => { item.inScope = scope.checked; $('reviewed').checked = false; dirty = true; draw(); };
      const select = document.createElement('select'); select.setAttribute('aria-label', `${item.id} balonu`);
      option(select, '', 'Balon dışında'); for (const b of truth.bubbles) option(select, b.id, b.id);
      select.value = item.bubbleId ?? '';
      select.onchange = () => { item.bubbleId = select.value || null; $('reviewed').checked = false; dirty = true; }; row.append(select);
    }
    const remove = document.createElement('button'); remove.textContent = 'Sil'; remove.onclick = () => {
      truth.regions = truth.regions.filter(r => r.id !== item.id); truth.bubbles = truth.bubbles.filter(b => b.id !== item.id);
      for (const r of truth.regions) if (r.bubbleId === item.id) r.bubbleId = null;
      $('reviewed').checked = false; dirty = true; renderLabels(); draw();
    }; row.append(remove); $('labels').append(row);
  }
}
async function loadPage(index) {
  if (dirty) await saveLabels();
  const token = ++generation; report = null; selected = pages[index];
  $('image').src = selected.path; await $('image').decode();
  const image = await createImageBitmap($('image')); // Oriented decode used by both inference and display.
  if (token !== generation) { image.close(); return; }
  currentImage?.close(); currentImage = image;
  $('overlay').setAttribute('viewBox', `0 0 ${image.width} ${image.height}`);
  truth = { schemaVersion: 1, imageId: selected.imageId, source: selected.url, width: image.width, height: image.height,
    reviewStatus: 'unreviewed', regions: [], bubbles: [] };
  const labels = await fetch(`/api/labels/${selected.imageId}`);
  if (token !== generation) return;
  if (labels.ok) {
    const stored = await labels.json();
    if (stored) {
    if (stored.imageId !== selected.imageId || stored.width !== image.width || stored.height !== image.height) throw new Error('Etiket görseli/boyutu uyuşmuyor');
      truth = stored;
    }
  }
  dirty = false; $('reviewed').checked = truth.reviewStatus === 'human-reviewed'; renderLabels(); draw();
  status(`${selected.chapter} · ${selected.file} · ${image.width} × ${image.height}. Doğruluk henüz ölçülmedi.`);
}
async function getSession() {
  const model = registry.models.find(m => m.id === $('model').value), backend = $('backend').value;
  const key = `${model.sha256}:${backend}`;
  if (key !== sessionKey) {
    if (session) { await session.release(); session = null; sessionKey = null; }
    status(`${model.id} yükleniyor · ${backend}…`);
    const start = performance.now();
    session = await ort.InferenceSession.create(`/.local/models/${model.file}`, { executionProviders: [backend], graphOptimizationLevel: 'all' });
    sessionKey = key;
    window.lab.lastModelLoadMs = performance.now() - start;
    window.lab.sessionInfo = { inputNames: session.inputNames, outputNames: session.outputNames, inputMetadata: session.inputMetadata };
  }
  return { session, model, backend };
}
async function runOne() {
  const token = generation, source = selected;
  const { session: runner, model, backend } = await getSession();
  const detector = model.id === 'ppocrv5-mobile-det' ? detectPPOCR : detectImage;
  const result = await detector({ image: currentImage, imageId: source.imageId, session: runner, ort, model, signal: controller.signal,
    onProgress: p => status(`${source.file} · ${model.id} · dilim ${p.done}/${p.total}`) });
  controller.signal.throwIfAborted();
  result.backend = backend; result.modelLoadMs = window.lab.lastModelLoadMs; result.source = source.url;
  result.runtimeVersion = ort.env.versions; result.browser = navigator.userAgent;
  if (token !== generation) throw new Error('Görsel değişti; sonuç uygulanmadı.');
  report = result; draw();
  const saved = await fetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
  if (!saved.ok) throw new Error(`Rapor kaydedilemedi: ${saved.status}`);
  const unit = model.id === 'ppocrv5-mobile-det' ? 'satır bileşeni adayı (diyalog grubu değil)' : 'yazı grubu adayı';
  status(`${source.file}: ${result.regions.length} ${unit}, ${result.bubbles.length} balon; ${result.regions.filter(r => r.needsReview).length} kontrol gerekli. ${(result.timing.totalMs / 1000).toFixed(1)} sn. Recall/precision henüz ölçülmedi.`);
  return result;
}
async function run(batch = false) {
  if (busy) throw new Error('Başka bir tarama çalışıyor');
  setBusy(true); controller = new AbortController(); const initial = $('page').value;
  const results = [];
  try {
    const currentChapter = selected.chapter;
    const indices = batch ? pages.map((p, i) => p.chapter === currentChapter ? i : null).filter(i => i !== null) : [Number(initial)];
    for (const index of indices) {
      controller.signal.throwIfAborted();
      if (String(index) !== $('page').value) { $('page').value = String(index); await loadPage(index); }
      results.push(await runOne());
    }
    return results;
  } catch (error) { status(`${error.name === 'AbortError' ? 'Durduruldu' : 'Hata'}: ${error.message}`); throw error; }
  finally { controller = null; setBusy(false); }
}
$('page').onchange = () => loadPage(Number($('page').value)).catch(e => status(e.message));
$('run').onclick = () => run().catch(() => {}); $('batch').onclick = () => run(true).catch(() => {});
$('cancel').onclick = () => controller?.abort(); $('showPredictions').onchange = draw;
async function saveLabels() {
  truth.reviewStatus = $('reviewed').checked ? 'human-reviewed' : 'unreviewed';
  const response = await fetch('/api/labels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(truth) });
  if (!response.ok) throw new Error(`Etiket kaydı başarısız: ${await response.text()}`);
  dirty = false; status(`Etiketler kaydedildi: ${truth.reviewStatus}.`);
}
$('saveLabels').onclick = () => saveLabels().catch(e => status(e.message));
$('reviewed').onchange = () => { dirty = true; };
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
let drag;
function pointer(event) { const r = $('overlay').getBoundingClientRect(); return [
  Math.max(0, Math.min(currentImage.width, (event.clientX - r.left) / r.width * currentImage.width)),
  Math.max(0, Math.min(currentImage.height, (event.clientY - r.top) / r.height * currentImage.height))]; }
$('overlay').onpointerdown = event => {
  if (!currentImage || $('labelMode').value === 'none' || busy) return;
  drag = pointer(event); $('overlay').setPointerCapture(event.pointerId);
};
$('overlay').onpointerup = event => {
  if (!drag) return; const end = pointer(event), b = [Math.min(drag[0], end[0]), Math.min(drag[1], end[1]), Math.max(drag[0], end[0]), Math.max(drag[1], end[1])];
  drag = null; if (b[2] - b[0] < 3 || b[3] - b[1] < 3) return;
  const id = crypto.randomUUID().slice(0, 8);
  if ($('labelMode').value === 'bubble') truth.bubbles.push({ id: `b-${id}`, box: b });
  else truth.regions.push({ id: `t-${id}`, textBox: b, bubbleId: null, inScope: true });
  $('reviewed').checked = false; dirty = true; renderLabels(); draw();
};
$('overlay').onpointercancel = () => { drag = null; };
window.lab = { ready: false, run, loadPage, get report() { return report; }, get truth() { return truth; } };
try {
  const [modelsResponse, datasetResponse] = await Promise.all([fetch('/.local/models/registry.json'), fetch('/api/datasets')]);
  if (!modelsResponse.ok) throw new Error('Model yok: önce node tools/fetch-models.mjs çalıştır.');
  registry = await modelsResponse.json();
  for (const m of registry.models) option($('model'), m.id, `${m.id} · ${(m.bytes / 1e6).toFixed(1)} MB`);
  for (const d of await datasetResponse.json()) for (const p of d.pages) {
    pages.push({ ...p, chapter: d.name, path: `/.local/${d.name}/${p.file}` });
    option($('page'), String(pages.length - 1), `${d.name} / ${p.file}`);
  }
  if (!pages.length) throw new Error('Görsel yok: önce npm run collect -- BÖLÜM_URL çalıştır.');
  await loadPage(0); window.lab.ready = true;
} catch (error) { status(error.message); setBusy(true); $('cancel').disabled = true; window.lab.error = error.message; }
