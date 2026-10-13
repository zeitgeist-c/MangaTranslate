import { dbBoxes } from './db.mjs';
import { tiles, transform, modelBoxToSource, deduplicate, associate, retryTiles, resolveClipped, intersection, area } from './geometry.mjs';

// Diagnostic connected components, NOT a replacement for Paddle DB polygon/unclip.
// Kept separate so line counts cannot be advertised as speech-group recall.
export function probabilityComponents(values, width, height, pixelThreshold = .3, scoreThreshold = .6) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || values.length !== width * height) throw new Error('Invalid probability map');
  const visited = new Uint8Array(values.length), queue = new Int32Array(values.length), result = [];
  for (let start = 0; start < values.length; start++) {
    if (visited[start] || !(values[start] > pixelThreshold)) continue;
    let head = 0, tail = 1, count = 0, sum = 0, x0 = width, y0 = height, x1 = -1, y1 = -1;
    queue[0] = start; visited[start] = 1;
    while (head < tail) {
      const index = queue[head++], y = Math.floor(index / width), x = index - y * width;
      count++; sum += values[index]; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (!visited[next] && values[next] > pixelThreshold) { visited[next] = 1; queue[tail++] = next; }
      }
    }
    if (count >= 6 && x1 - x0 >= 2 && y1 - y0 >= 2 && sum / count >= scoreThreshold) {
      // Conservative rectangular diagnostic margin, explicitly not polygon expansion.
      const margin = Math.max(1, Math.min(x1 - x0, y1 - y0) * .2);
      result.push({ box: [Math.max(0, x0 - margin), Math.max(0, y0 - margin), Math.min(width, x1 + 1 + margin), Math.min(height, y1 + 1 + margin)], score: sum / count });
    }
  }
  return result;
}

export function ppShape(width, height) {
  const ratio = 960 / Math.max(width, height);
  return { width: Math.max(32, Math.round(width * ratio / 32) * 32), height: Math.max(32, Math.round(height * ratio / 32) * 32) };
}

export async function detectPPOCR({ image, imageId, session, ort, model, signal, onProgress = () => {} }) {
  if (session.inputNames.length !== 1 || session.outputNames.length !== 1) throw new Error('Unsupported PP-OCR model contract');
  const width = image.width, height = image.height, bands = tiles(width, height, 1200, 200), detections = [], tileMs = [];
  let inversePasses = 0; const regularCount = bands.length;
  const start = performance.now();
  const runTile = async (tile, inverse = false) => {
    signal?.throwIfAborted(); const tileStart = performance.now(), shape = ppShape(tile.width, tile.height);
    const canvas = new OffscreenCanvas(shape.width, shape.height), ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, tile.x, tile.y, tile.width, tile.height, 0, 0, shape.width, shape.height);
    const rgba = ctx.getImageData(0, 0, shape.width, shape.height).data, plane = shape.width * shape.height;
    let dark=0,bright=0; for(let i=0;i<plane;i++){const light=(rgba[i*4]+rgba[i*4+1]+rgba[i*4+2])/3;if(light<70)dark++;if(light>190)bright++;}
    const tryInverse = !inverse && dark/plane >= .45 && bright/plane >= .005 && bright/plane <= .35;
    const data = new Float32Array(plane * 3), mean = [.485, .456, .406], std = [.229, .224, .225];
    // Official inference.yml specifies BGR decode followed by these mean/std values.
    for (let c = 0; c < 3; c++) for (let i = 0; i < plane; i++) data[c * plane + i] = ((inverse ? 255 - rgba[i * 4 + (2 - c)] : rgba[i * 4 + (2 - c)]) / 255 - mean[c]) / std[c];
    canvas.width = 1; canvas.height = 1;
    const tensor = new ort.Tensor('float32', data, [1, 3, shape.height, shape.width]);
    let outputs;
    try {
      outputs = await session.run({ [session.inputNames[0]]: tensor }); signal?.throwIfAborted();
      const output = outputs[session.outputNames[0]], dims = output.dims;
      if (dims.length !== 4 || dims[0] !== 1 || dims[1] !== 1) throw new Error('Unsupported PP-OCR output shape');
      const mapHeight = dims[2], mapWidth = dims[3], t = transform(tile, mapWidth, mapHeight, 'stretch');
      for (const finding of dbBoxes(output.data, mapWidth, mapHeight)) {
        const value = modelBoxToSource(finding.box, t, width, height);
        if (value) detections.push({ kind: 'text', score: finding.score, box: value, inkBox: modelBoxToSource(finding.inkBox, t, width, height), tileId: tile.id, retry: !!tile.retry, inverse, edgeClipped:
          (tile.y > 0 && finding.box[1] <= 2) || (tile.y + tile.height < height && finding.box[3] >= mapHeight - 2) });
      }
    } finally { tensor.dispose(); if (outputs) for (const value of Object.values(outputs)) value.dispose(); }
    tileMs.push(performance.now() - tileStart); onProgress({ done: tileMs.length, total: bands.length });
    if(tryInverse) { inversePasses++; await runTile(tile, true); }
  };
  for(const tile of bands) await runTile(tile);
  const shifted = retryTiles(detections, width, height, bands, 1200, 16);
  for(const tile of shifted) await runTile(tile);
  // Prefer complete observations and remove contained duplicates across polarity.
  const resolved = resolveClipped(detections).sort((a,b)=>Number(a.edgeClipped)-Number(b.edgeClipped)||b.score-a.score);
  const unique = resolved.filter((r,i)=>!resolved.slice(0,i).some(k=> intersection(r.box,k.box)/Math.min(area(r.box),area(k.box))>.9 && Math.max(area(r.box),area(k.box))/Math.min(area(r.box),area(k.box))<2.5));
  const kept = deduplicate(unique), association = associate(kept, imageId, `ppocr-db-quad-v2:${model.sha256.slice(0, 12)}`);
  return { schemaVersion: 1, imageId, width, height, modelId: model.id, modelSHA256: model.sha256,
    detectorVersion: 'ppocr-db-quad-v2', coordinateSpace: 'oriented-source-image-pixels-xyxy',
    parameters: { pixelThreshold: .3, scoreThreshold: .6, tileSize: 1200, overlap: 200 }, detections: kept, ...association,
    tileCount: regularCount, inversePasses, shiftedPasses: shifted.length, rawDetections: detections.length, timing: { totalMs: performance.now() - start, tileMs },
    quality: { measured: false, unit: 'text-line-quad', reason: 'DB quad geometry; speech-group recall requires human annotation.' } };
}
