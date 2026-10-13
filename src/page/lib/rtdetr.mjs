import { tiles, transform, modelBoxToSource, deduplicate, associate, retryTiles, resolveClipped } from './geometry.mjs';

const CLASS_NAMES = ['bubble', 'text_bubble', 'text_free'];
export const DETECTOR_VERSION = 'rtdetr-square-output-v2-seams';

export function imageTensor(image, tile, ort, size = 640) {
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, tile.x, tile.y, tile.width, tile.height, 0, 0, size, size);
  const rgba = context.getImageData(0, 0, size, size).data;
  const plane = size * size, floats = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++) {
    floats[i] = rgba[i * 4] / 255; floats[i + plane] = rgba[i * 4 + 1] / 255; floats[i + plane * 2] = rgba[i * 4 + 2] / 255;
  }
  canvas.width = 1; canvas.height = 1;
  return new ort.Tensor('float32', floats, [1, 3, size, size]);
}

export function decodeDetections(outputs, tile, width, height, threshold = 0.35) {
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) throw new Error('Invalid confidence threshold');
  const { labels, boxes, scores } = outputs;
  if (!labels || !boxes || !scores || boxes.dims.at(-1) !== 4 ||
      labels.data.length !== scores.data.length || boxes.data.length !== scores.data.length * 4) throw new Error('Unsupported RT-DETR output contract');
  const t = transform(tile, 640, 640, 'stretch'), detections = [];
  for (let i = 0; i < scores.data.length; i++) {
    const score = Number(scores.data[i]), kind = CLASS_NAMES[Number(labels.data[i])];
    if (!kind || !Number.isFinite(score) || score < threshold || score > 1) continue;
    const raw = Array.from(boxes.data.slice(i * 4, i * 4 + 4));
    if (!raw.every(Number.isFinite) || raw[2] <= raw[0] || raw[3] <= raw[1]) continue;
    const value = modelBoxToSource(raw, t, width, height);
    if (!value || (value[2] - value[0]) < 2 || (value[3] - value[1]) < 2) continue;
    const border = 3; // model pixels, not source pixels
    const edgeClipped = (tile.x > 0 && raw[0] <= border) || (tile.y > 0 && raw[1] <= border) ||
      (tile.x + tile.width < width && raw[2] >= 640 - border) ||
      (tile.y + tile.height < height && raw[3] >= 640 - border);
    detections.push({ kind, score, box: value, tileId: tile.id, edgeClipped });
  }
  return detections;
}

export async function detectImage({ image, imageId, session, ort, model, threshold = 0.35,
  tileSize = 1200, overlap = 200, signal, onProgress = () => {} }) {
  const started = performance.now();
  const width = image.width || image.naturalWidth, height = image.height || image.naturalHeight;
  if (!session.inputNames.includes('images') || !session.inputNames.includes('orig_target_sizes') ||
      !['labels', 'boxes', 'scores'].every(n => session.outputNames.includes(n))) throw new Error('Unsupported model input/output names');
  const bands = tiles(width, height, tileSize, overlap), detections = [], timings = [], initialCount = bands.length;
  for (let index = 0; index < bands.length; index++) {
    const tile = bands[index];
    signal?.throwIfAborted();
    const tileStarted = performance.now();
    const input = imageTensor(image, tile, ort);
    // Square postprocessor output intentionally avoids ambiguous [H,W] vs [W,H].
    // Both axes are then mapped explicitly back to the non-square source tile.
    const sizes = new ort.Tensor('int64', BigInt64Array.from([640n, 640n]), [1, 2]);
    let result;
    try {
      result = await session.run({ images: input, orig_target_sizes: sizes });
      signal?.throwIfAborted();
      detections.push(...decodeDetections(result, tile, width, height, threshold).map(d => ({ ...d, retry: tile.retry === true })));
    } finally {
      input.dispose(); sizes.dispose();
      if (result) for (const tensor of Object.values(result)) tensor.dispose();
    }
    timings.push(performance.now() - tileStarted);
    onProgress({ done: timings.length, total: bands.length });
    if (index === initialCount - 1) bands.push(...retryTiles(detections, width, height, bands, tileSize));
  }
  const kept = deduplicate(resolveClipped(detections));
  const association = associate(kept, imageId, `${DETECTOR_VERSION}:${model.id}:${model.sha256.slice(0, 12)}`);
  return { schemaVersion: 1, imageId, width, height, modelId: model.id, modelSHA256: model.sha256,
    detectorVersion: DETECTOR_VERSION, parameters: { threshold, tileSize, overlap, nmsIoU: 0.65 },
    coordinateSpace: 'oriented-source-image-pixels-xyxy', detections: kept, ...association,
    timing: { totalMs: performance.now() - started, tileMs: timings },
    rawDetections: detections.length, tileCount: bands.length, retryTileCount: bands.length - initialCount,
    quality: { measured: false, reason: 'Human-reviewed ground truth required; confidence is not accuracy.' } };
}
