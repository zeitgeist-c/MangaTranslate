import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve('..');
const samples = [
  ['purple', resolve('.local/regressions/purple.png')],
  ['title', resolve('.local/regressions/title.png')],
  ['black', resolve('.local/regressions/black.png')],
  ['long', resolve('.local/chapter-174/002.webp')]
];
const files = new Map(samples.map(([name, path]) => [`/sample/${name}`, path]));
for (const file of ['geometry.mjs', 'rtdetr.mjs', 'ppocr.mjs']) { files.set('/' + file, resolve(root, 'src/page/lib', file)); files.set('/lib/' + file, resolve(root, 'src/page/lib', file)); }
files.set('/layout.mjs', resolve(root, 'src/page/layout.mjs'));
for (const file of ['ort.all.bundle.min.mjs', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) files.set('/vendor/' + file, resolve(root, 'src/page/vendor', file));
for (const file of ['detector_int8.onnx', 'detector-v4-s_int8.onnx', 'ppocrv5_det.onnx']) files.set('/models/' + file, resolve(root, 'src/page/models', file));
const server = createServer(async (req, res) => {
  const path = files.get(req.url);
  if (!path) { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Isolated detector profiler</title>'); return; }
  const mime = path.endsWith('.mjs') ? 'text/javascript' : path.endsWith('.wasm') ? 'application/wasm' : path.endsWith('.png') ? 'image/png' : path.endsWith('.webp') ? 'image/webp' : 'application/octet-stream';
  try { res.setHeader('Content-Type', mime); res.end(await readFile(path)); } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.BRAVE_EXECUTABLE, headless: true, args: ['--disable-extensions'] });
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    globalThis.ort = await import('/vendor/ort.all.bundle.min.mjs'); ort.env.wasm.wasmPaths = location.origin + '/vendor/'; ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
    globalThis.detectImage = (await import('/rtdetr.mjs')).detectImage;
    globalThis.detectPPOCR = (await import('/ppocr.mjs')).detectPPOCR;
    globalThis.layout = await import('/layout.mjs'); globalThis.sessions = {};
  });
  if (process.env.PROFILE_GPU === '1') await page.evaluate(() => globalThis.profileGpuOnly = true);
  const results = [];
  for (const [name] of samples) {
    const result = await page.evaluate(async name => {
      const image = await createImageBitmap(await (await fetch('/sample/' + name)).blob()), reports = {};
      for (const [id, file] of [['standard', 'detector_int8.onnx'], ['small', 'detector-v4-s_int8.onnx'], ['pp', 'ppocrv5_det.onnx'], ['ppgpu', 'ppocrv5_det.onnx']]) {
        if (globalThis.profileGpuOnly && (id === 'standard' || id === 'small')) continue;
        const model = { id, sha256: 'profile-only' }; let loadMs = 0;
        if (!sessions[id]) { const start = performance.now(); sessions[id] = await ort.InferenceSession.create('/models/' + file, { executionProviders: [id === 'ppgpu' ? 'webgpu' : 'wasm'], graphOptimizationLevel: 'all' }); loadMs = performance.now() - start; }
        const args = { image, imageId: name, session: sessions[id], ort, model };
        reports[id] = await (id.startsWith('pp') ? detectPPOCR(args) : detectImage(args)); reports[id].modelLoadMs = loadMs;
      }
      const fused = reports.standard ? layout.fuseGroups(reports.standard, reports.pp) : reports.pp.regions;
      const prepareSafety = [];
      for (const region of fused) {
        const box = (region.bubbleBox || layout.regionCrop(region, image.width, image.height, 20)).map((v, i) => i < 2 ? Math.floor(v) : Math.ceil(v));
        if (box[2] - box[0] > 1200 || box[3] - box[1] > 1200) { prepareSafety.push('oversized'); continue; }
        const canvas = new OffscreenCanvas(box[2] - box[0], box[3] - box[1]), ctx = canvas.getContext('2d');
        ctx.drawImage(image, box[0], box[1], canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height), text = region.textBox.map((v, i) => v - box[i % 2]);
        prepareSafety.push(layout.interior(pixels.data, canvas.width, canvas.height, text) ? 'flat_safe' : 'background_rejected');
      }
      image.close(); return { name, reports, fused, prepareSafety };
    }, name);
    results.push(result);
    console.log(JSON.stringify({ sample: name, stages: Object.fromEntries(Object.entries(result.reports).map(([id, r]) => [id, { ms: Math.round(r.timing.totalMs), loadMs: Math.round(r.modelLoadMs), tiles: r.tileCount, regions: r.regions.length }])),
      fused: result.fused.length, eligible: result.fused.filter(r => !r.needsReview && (r.bubbleId || r.kind === 'text_free')).length, safety: result.prepareSafety }));
  }
  await mkdir('reports', { recursive: true });
  await writeFile(process.env.PROFILE_GPU === '1' ? 'reports/detection-gpu.json' : 'reports/detection-baseline.json', JSON.stringify({ browser: browser.version(), realProviderCalls: 0, results }, null, 2));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
