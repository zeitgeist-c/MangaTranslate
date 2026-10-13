import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';
import { startServer } from '../server.mjs';
import assert from 'node:assert/strict';
const server = await startServer(0);
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.BRAVE_EXECUTABLE, headless: true });
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.lab?.ready);
  const measurements = await page.evaluate(async () => {
    const ort = await import('/node_modules/onnxruntime-web/dist/ort.all.bundle.min.mjs');
    const { imageTensor } = await import('/lib/rtdetr.mjs');
    const { tiles } = await import('/lib/geometry.mjs');
    const original = await ort.InferenceSession.create('/.local/models/detector-v4-s_int8.onnx', { executionProviders: ['wasm'] });
    const derived = await ort.InferenceSession.create('/.local/models/detector-v4-s_int8-gpu.onnx', { executionProviders: ['wasm'] });
    const image = await createImageBitmap(await (await fetch('/.local/chapter-174/002.webp')).blob());
    const bands = tiles(image.width, image.height), result = [];
    try {
      for (const index of [0, Math.floor(bands.length / 2), bands.length - 1]) {
        const input = imageTensor(image, bands[index], ort), sizes = new ort.Tensor('int64', BigInt64Array.from([640n, 640n]), [1, 2]);
        const a = await original.run({ images: input, orig_target_sizes: sizes }), b = await derived.run({ images: input, orig_target_sizes: sizes });
        const metrics = {};
        for (const key of ['boxes', 'scores', 'labels']) {
          let different = 0, maxAbs = 0;
          for (let i = 0; i < a[key].data.length; i++) { if (a[key].data[i] !== b[key].data[i]) different++; maxAbs = Math.max(maxAbs, Math.abs(Number(a[key].data[i]) - Number(b[key].data[i]))); }
          metrics[key] = { different, maxAbs };
        }
        result.push({ tile: index, metrics });
        input.dispose(); sizes.dispose(); Object.values(a).forEach(t => t.dispose()); Object.values(b).forEach(t => t.dispose());
      }
    } finally { image.close(); await original.release(); await derived.release(); }
    return result;
  });
  for (const m of measurements) for (const value of Object.values(m.metrics)) assert.equal(value.different, 0, 'Unit-stride rewrite must preserve WASM outputs exactly');
  await writeFile('reports/pool-rewrite-parity.json', JSON.stringify({ measurements, exactWasmParity: true, gpuParityProven: false }, null, 2));
  console.log(JSON.stringify(measurements));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
