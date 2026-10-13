import { test } from 'node:test';
import assert from 'node:assert/strict';
import { axisStarts, tiles, transform, toSource, toModel, modelBoxToSource, deduplicate, associate, pointInPolygon } from '../lib/geometry.mjs';
import { decodeDetections } from '../lib/rtdetr.mjs';

test('non-square stretch and tile origin map both axes without swapping H/W', () => {
  const t = transform({ x: 37, y: 1000, width: 900, height: 1200 }, 640, 640);
  const p = toSource([320, 320], t);
  assert.deepEqual(p, [487, 1600]);
  assert.deepEqual(toModel(p, t), [320, 320]);
  assert.deepEqual(modelBoxToSource([64, 64, 576, 576], t, 1200, 6000), [127, 1120, 847, 2080]);
});
test('letterbox padding cannot draw outside source tile', () => {
  const t = transform({ x: 0, y: 100, width: 800, height: 400 }, 640, 640, 'letterbox');
  assert.deepEqual(toSource([320, 320], t), [400, 300]);
  assert.equal(modelBoxToSource([20, 20, 200, 140], t, 800, 1200), null);
  assert.deepEqual(modelBoxToSource([0, 0, 640, 640], t, 800, 1200), [0, 100, 800, 500]);
});
test('long images tile to their last pixel with bounded overlap and no duplicates', () => {
  assert.deepEqual(axisStarts(1200, 1200, 200), [0]);
  assert.deepEqual(axisStarts(1201, 1200, 200), [0, 1]);
  assert.deepEqual(axisStarts(3200, 1200, 200), [0, 1000, 2000]);
  const bands = tiles(900, 16000);
  assert.equal(bands.at(-1).y + bands.at(-1).height, 16000);
  assert.ok(bands.every(t => t.width <= 1200 && t.height <= 1200));
  assert.throws(() => axisStarts(100, 50, 50));
  assert.throws(() => tiles(Infinity, 200));
});
test('model output uses explicit square pixels, handles BigInt labels, rejects invalid outputs', () => {
  const result = decodeDetections({ labels: { data: BigInt64Array.from([1n]) },
    boxes: { dims: [1, 1, 4], data: Float32Array.from([64, 64, 320, 320]) }, scores: { data: Float32Array.from([0.9]) } },
    { id: 4, x: 0, y: 1000, width: 900, height: 1200 }, 900, 16000);
  assert.deepEqual(result[0].box, [90, 1120, 450, 1600]);
  assert.equal(result[0].kind, 'text_bubble');
  assert.throws(() => decodeDetections({}, {}, 10, 10), /contract/);
});
test('duplicate tiles merge text classes but preserve adjacent groups and provenance', () => {
  const kept = deduplicate([
    { kind: 'text_free', score: .8, box: [10, 10, 90, 60], tileId: 1 },
    { kind: 'text_bubble', score: .9, box: [10, 10, 90, 60], tileId: 0 },
    { kind: 'text_bubble', score: .9, box: [95, 10, 180, 60], tileId: 0 },
    { kind: 'bubble', score: .99, box: [0, 0, 200, 100], tileId: 0 },
  ]);
  assert.equal(kept.length, 3);
  assert.deepEqual(kept.find(d => d.box[0] === 10).observations, [0, 1]);
});
test('ambiguous/unmatched text remains visible, and region IDs survive reordered detections', () => {
  const detections = [
    { kind: 'bubble', box: [0, 0, 100, 100], score: .9 },
    { kind: 'bubble', box: [5, 5, 90, 90], score: .9 },
    { kind: 'text_bubble', box: [20, 20, 70, 70], score: .8 },
    { kind: 'text_bubble', box: [200, 200, 250, 250], score: .8 },
    { kind: 'text_free', box: [300, 300, 350, 350], score: .8 },
  ];
  const first = associate(detections, 'image', 'v1'), second = associate([...detections].reverse(), 'image', 'v1');
  assert.deepEqual(first, second);
  assert.equal(first.regions.length, 3);
  assert.equal(first.regions[0].reason, 'ambiguous_bubble');
  assert.equal(first.regions[0].bubbleId, null);
  assert.equal(first.regions[1].reason, 'unmatched_text');
  assert.equal(first.regions[2].needsReview, false);
});
test('large enclosing candidates do not match text on center alone', () => {
  const report = associate([{ kind: 'bubble', box: [0, 0, 50, 50], score: .9 },
    { kind: 'text_bubble', box: [20, 20, 70, 70], score: .9 }], 'a', 'v');
  assert.equal(report.regions[0].bubbleId, null);
});
test('shape containment distinguishes a balloon tail from a rectangular interior', () => {
  const polygon = [[0, 0], [100, 0], [100, 50], [60, 50], [40, 80], [40, 50], [0, 50]];
  assert.equal(pointInPolygon([50, 20], polygon), true);
  assert.equal(pointInPolygon([90, 70], polygon), false);
});
