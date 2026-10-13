import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ppShape, probabilityComponents } from '../lib/ppocr.mjs';
test('PP-OCR preserves non-square proportions with stride-32 model dimensions', () => {
  assert.deepEqual(ppShape(900, 1200), { width: 736, height: 960 });
  assert.deepEqual(ppShape(1200, 900), { width: 960, height: 736 });
});
test('probability components stay separated and do not wrap across rows', () => {
  const values = new Float32Array(200);
  for (let y = 1; y <= 4; y++) for (let x = 1; x <= 5; x++) values[y * 20 + x] = .9;
  for (let y = 6; y <= 9; y++) for (let x = 14; x <= 19; x++) values[y * 20 + x] = .8;
  const result = probabilityComponents(values, 20, 10);
  assert.equal(result.length, 2);
  assert.ok(result[0].box[2] < result[1].box[0]);
  assert.throws(() => probabilityComponents(values, 10, 10));
});
