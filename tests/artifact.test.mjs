import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
test('MV3 ships only local executable assets and declares the offscreen boundary', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  assert.equal(manifest.version, '3.8.4'); assert.ok(manifest.permissions.includes('offscreen'));
  assert.ok(manifest.content_security_policy.extension_pages.includes("'wasm-unsafe-eval'"));
  assert.ok(!manifest.content_security_policy.extension_pages.includes('https:'));
  assert.ok(!manifest.content_security_policy.extension_pages.includes("'unsafe-eval'"));
  for (const script of manifest.content_scripts.flatMap(entry => entry.js)) await access(new URL(script, root));
  assert.equal(manifest.options_ui.open_in_tab, true); await access(new URL(manifest.options_ui.page, root));
  for (const file of ['popup/ui.js', 'src/keys.js', 'options/settings.js']) await access(new URL(file, root));
  const offscreen = await readFile(new URL('src/page/offscreen.mjs', root), 'utf8');
  assert.ok(offscreen.includes("'./vendor/ort.all.bundle.min.mjs'"));
  assert.ok(!offscreen.includes('cdn.jsdelivr.net')); assert.ok(!offscreen.includes('apiKey'));
});
test('packaged model bytes match pinned receipts and production geometry matches evaluated adapter', async () => {
  for (const [file, expected] of [
    ['detector_int8.onnx', 'b5022ad46416b6fe4f88b0cc082cfd2ff5b1cfc624088c2f19879485493f5913'],
    ['ppocrv5_det.onnx', '1eb7b4f7ab657ebd1c66d5f79bca7497f29768a2e3c15e52daecbba1a8e4a039'],
    ['detector-v4-s_int8.onnx', '5fe9e4f576e49d4e7e8b0e029d6d3cdc252abd4694113e1cae120e62c931ea79']
  ]) assert.equal(createHash('sha256').update(await readFile(new URL(`src/page/models/${file}`, root))).digest('hex'), expected);
  for (const file of ['geometry.mjs', 'rtdetr.mjs', 'ppocr.mjs', 'db.mjs']) assert.deepEqual(
    await readFile(new URL(`src/page/lib/${file}`, root)), await readFile(new URL(`evaluation/lib/${file}`, root)));
});
