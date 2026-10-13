// All boxes are [x1, y1, x2, y2] in the oriented source image, unless stated.
export function positive(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name}: positive finite number required`);
  return value;
}

export function box(value) {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite) ||
      value[2] <= value[0] || value[3] <= value[1]) throw new Error('Invalid xyxy box');
  return value;
}

export function area(value) { const b = box(value); return (b[2] - b[0]) * (b[3] - b[1]); }
export function intersection(a, b) {
  box(a); box(b);
  return Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
    Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
}
export function iou(a, b) { const n = intersection(a, b); return n / (area(a) + area(b) - n); }
export function clipBox(value, width, height) {
  box(value); positive(width, 'width'); positive(height, 'height');
  const b = [Math.max(0, value[0]), Math.max(0, value[1]), Math.min(width, value[2]), Math.min(height, value[3])];
  return b[2] > b[0] && b[3] > b[1] ? b : null;
}

export function axisStarts(length, size, overlap) {
  for (const [name, v] of Object.entries({ length, size })) {
    if (!Number.isSafeInteger(v) || v <= 0) throw new Error(`Invalid ${name}`);
  }
  if (!Number.isSafeInteger(overlap) || overlap < 0 || overlap >= size) throw new Error('Invalid overlap');
  if (length <= size) return [0];
  const starts = [];
  for (let v = 0; v < length - size; v += size - overlap) starts.push(v);
  starts.push(length - size);
  return starts;
}

export function tiles(width, height, size = 1200, overlap = 200) {
  const result = [];
  for (const y of axisStarts(height, size, overlap)) {
    for (const x of axisStarts(width, size, overlap)) {
      result.push({ id: result.length, x, y, width: Math.min(size, width - x), height: Math.min(size, height - y) });
    }
  }
  return result;
}

export function transform(tile, modelWidth, modelHeight, resize = 'stretch') {
  for (const [key, value] of Object.entries({ width: tile.width, height: tile.height, modelWidth, modelHeight })) positive(value, key);
  if (![tile.x, tile.y].every(Number.isFinite)) throw new Error('Invalid tile origin');
  if (!['stretch', 'letterbox'].includes(resize)) throw new Error('Explicit resize mode required');
  const common = Math.min(modelWidth / tile.width, modelHeight / tile.height);
  const scaleX = resize === 'stretch' ? modelWidth / tile.width : common;
  const scaleY = resize === 'stretch' ? modelHeight / tile.height : common;
  return { tile, modelWidth, modelHeight, scaleX, scaleY,
    padX: (modelWidth - tile.width * scaleX) / 2, padY: (modelHeight - tile.height * scaleY) / 2, resize };
}

export function toSource(point, t) {
  return [(point[0] - t.padX) / t.scaleX + t.tile.x, (point[1] - t.padY) / t.scaleY + t.tile.y];
}
export function toModel(point, t) {
  return [(point[0] - t.tile.x) * t.scaleX + t.padX, (point[1] - t.tile.y) * t.scaleY + t.padY];
}
export function modelBoxToSource(value, t, width, height) {
  const b = box(value), a = toSource(b.slice(0, 2), t), c = toSource(b.slice(2), t);
  // First clip to the tile: padded detections must not leak into an adjacent tile.
  const clipped = clipBox([a[0] - t.tile.x, a[1] - t.tile.y, c[0] - t.tile.x, c[1] - t.tile.y], t.tile.width, t.tile.height);
  return clipped ? clipBox([clipped[0] + t.tile.x, clipped[1] + t.tile.y, clipped[2] + t.tile.x, clipped[3] + t.tile.y], width, height) : null;
}

const kinds = new Set(['bubble', 'text_bubble', 'text_free', 'text']);
const isText = item => item.kind !== 'bubble';

export function deduplicate(detections, threshold = 0.65) {
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) throw new Error('Invalid NMS threshold');
  const ordered = detections.map(d => {
    box(d.box);
    if (!kinds.has(d.kind) || !Number.isFinite(d.score) || d.score < 0 || d.score > 1) throw new Error('Invalid detection');
    return { ...d, box: [...d.box] };
  }).sort((a, b) => b.score - a.score || a.box[1] - b.box[1] || a.box[0] - b.box[0] || a.kind.localeCompare(b.kind));
  const kept = [];
  for (const d of ordered) {
    const duplicate = kept.find(k => (k.kind === d.kind || (isText(k) && isText(d))) && iou(k.box, d.box) >= threshold);
    if (!duplicate) kept.push({ ...d, observations: [d.tileId ?? null] });
    else duplicate.observations.push(d.tileId ?? null);
  }
  return kept.sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0] || a.kind.localeCompare(b.kind));
}

export function retryTiles(detections, width, height, existing, size = 1200, limit = 16) {
  const known = new Set(existing.map(t => `${t.x},${t.y}`)), result = [];
  for (const d of [...detections].filter(d => d.edgeClipped && d.kind !== 'bubble').sort((a, b) => b.score - a.score)) {
    const x = Math.max(0, Math.min(width - Math.min(size, width), Math.round((d.box[0] + d.box[2] - size) / 2)));
    const y = Math.max(0, Math.min(height - Math.min(size, height), Math.round((d.box[1] + d.box[3] - size) / 2)));
    const key = `${x},${y}`; if (known.has(key)) continue;
    known.add(key); result.push({ id: existing.length + result.length, x, y, width: Math.min(size, width), height: Math.min(size, height), retry: true });
    if (result.length >= limit) break;
  }
  return result;
}

export function resolveClipped(detections) {
  // Only a shifted, complete observation may replace a contained clipped fragment.
  // Adjacent/non-contained fragments remain explicit review candidates.
  return detections.filter(fragment => !fragment.edgeClipped || !detections.some(whole =>
    whole.retry === true && !whole.edgeClipped && whole.kind === fragment.kind &&
    area(whole.box) <= area(fragment.box) * 4 && intersection(fragment.box, whole.box) / area(fragment.box) >= .95));
}

export function associate(detections, imageId, detectorVersion) {
  if (!imageId || !detectorVersion) throw new Error('Image hash and detector version required');
  const ordered = [...detections].sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0] || a.kind.localeCompare(b.kind));
  const bubbles = ordered.filter(d => d.kind === 'bubble').map((d, index) => ({ ...d, id: `b${index}` }));
  const texts = ordered.filter(isText);
  const prefix = `${imageId}:${detectorVersion}`;
  return { bubbles, regions: texts.map((text, index) => {
    const candidates = bubbles.filter(b => intersection(text.box, b.box) / area(text.box) >= 0.9);
    const bubbleId = candidates.length === 1 ? candidates[0].id : null;
    const needsReview = candidates.length > 1 || (text.kind !== 'text_free' && !bubbleId) || text.edgeClipped === true;
    return { regionId: `${prefix}:r${index}`, textBox: text.box, score: text.score, kind: text.kind,
      bubbleId, bubbleBox: bubbleId ? candidates[0].box : null, needsReview,
      reason: text.edgeClipped ? 'tile_boundary' : candidates.length > 1 ? 'ambiguous_bubble' :
        !bubbleId && text.kind !== 'text_free' ? 'unmatched_text' : null,
      candidateBubbleIds: candidates.map(b => b.id), observations: text.observations ?? [] };
  }) };
}

// Polygon containment is used by future shape masks, never inferred from a bbox.
export function pointInPolygon([x, y], polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3 || polygon.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) throw new Error('Invalid polygon');
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if (((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
