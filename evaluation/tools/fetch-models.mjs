import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const revision = '16e8a622f91fabc6b5b65c96d32d1183f8843546';
const repository = 'ogkalu/comic-text-and-bubble-detector';
const out = resolve(root, '.local/models');
await mkdir(out, { recursive: true });
async function hash(file) { const h = createHash('sha256'); for await (const c of createReadStream(file)) h.update(c); return h.digest('hex'); }
const infoResponse = await fetch(`https://huggingface.co/api/models/${repository}/tree/${revision}`, { signal: AbortSignal.timeout(30000) });
if (!infoResponse.ok) throw new Error(`Model metadata HTTP ${infoResponse.status}`);
const tree = await infoResponse.json();
const models = [];
for (const [id, file] of [['rtdetr-int8', 'detector_int8.onnx'], ['rtdetr-fp32', 'detector.onnx'], ['rtdetr-v4-small', 'detector-v4-s_int8.onnx']]) {
  const entry = tree.find(e => e.path === file);
  const expected = entry?.lfs?.oid;
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error(`Missing LFS checksum: ${file}`);
  const path = resolve(out, file);
  let exists = true;
  try { await readFile(path); } catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
  if (!exists) {
    const response = await fetch(`https://huggingface.co/${repository}/resolve/${revision}/${file}`, { signal: AbortSignal.timeout(300000) });
    if (!response.ok) throw new Error(`Model HTTP ${response.status}`);
    const temporary = `${path}.partial`;
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
    if (await hash(temporary) !== expected) throw new Error(`Download checksum mismatch: ${file}`);
    await rename(temporary, path);
  }
  if (await hash(path) !== expected) throw new Error(`Model checksum mismatch: ${file}`);
  models.push({ id, file, sha256: expected, bytes: entry.size, repository, revision, license: 'Apache-2.0',
    adapter: 'rtdetr-square-output-v1', input: { width: 640, height: 640, resize: 'stretch', normalization: 'rgb_0_1', layout: 'NCHW' },
    coordinateContract: 'orig_target_sizes=[640,640]; output boxes in 640x640 model pixels, then explicit inverse transform' });
  console.log(`${id}: verified ${expected}`);
}
const ppRepository = 'ilaylow/PP_OCRv5_mobile_onnx';
const ppRevision = 'f97b337b3ac256f9dffcac5fc53955082d919d58';
const ppTreeResponse = await fetch(`https://huggingface.co/api/models/${ppRepository}/tree/${ppRevision}`, { signal: AbortSignal.timeout(30000) });
if (!ppTreeResponse.ok) throw new Error(`Paddle export metadata HTTP ${ppTreeResponse.status}`);
const ppEntry = (await ppTreeResponse.json()).find(e => e.path === 'ppocrv5_det.onnx');
if (!/^[a-f0-9]{64}$/.test(ppEntry?.lfs?.oid ?? '')) throw new Error('Missing Paddle export checksum');
const ppPath = resolve(out, 'ppocrv5_det.onnx');
let ppExists = true;
try { await readFile(ppPath); } catch (error) { if (error.code !== 'ENOENT') throw error; ppExists = false; }
if (!ppExists) {
  const response = await fetch(`https://huggingface.co/${ppRepository}/resolve/${ppRevision}/ppocrv5_det.onnx`, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Paddle export HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(`${ppPath}.partial`));
  if (await hash(`${ppPath}.partial`) !== ppEntry.lfs.oid) throw new Error('Paddle export checksum mismatch');
  await rename(`${ppPath}.partial`, ppPath);
}
if (await hash(ppPath) !== ppEntry.lfs.oid) throw new Error('Paddle export checksum mismatch');
models.push({ id: 'ppocrv5-mobile-det', file: 'ppocrv5_det.onnx', sha256: ppEntry.lfs.oid, bytes: ppEntry.size,
  repository: ppRepository, revision: ppRevision, license: 'Apache-2.0',
  sourceModel: 'PaddlePaddle/PP-OCRv5_mobile_det', exportProvenance: 'Third-party paddle2onnx conversion; upstream parity not yet verified',
  adapter: 'ppocr-component-diagnostic-v1', input: { resize: 'longest-960-rounded32', normalization: 'BGR_imagenet', layout: 'NCHW' },
  coordinateContract: 'Probability map component bounds inverse-scaled to source tile; not polygon DBPostProcess parity' });
console.log(`ppocrv5-mobile-det: verified ${ppEntry.lfs.oid}`);
await writeFile(resolve(out, 'registry.json'), JSON.stringify({ schemaVersion: 1, models }, null, 2));
