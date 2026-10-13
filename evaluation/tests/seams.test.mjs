import test from 'node:test';
import assert from 'node:assert/strict';
import { retryTiles, resolveClipped, tiles } from '../lib/geometry.mjs';
test('seam retry shifts the crop around clipped text and stays in source bounds', () => {
  const result = retryTiles([{ edgeClipped: true, kind: 'text_bubble', score: .9, box: [100, 1150, 200, 1200] }], 900, 16000, tiles(900, 16000));
  assert.equal(result.length, 1); assert.equal(result[0].y, 575); assert.equal(result[0].x, 0);
  assert.equal(result[0].retry, true); assert.equal(result[0].height, 1200);
});
test('complete shifted observation replaces only its contained clipped fragment, never adjacent text', () => {
  const a = { kind: 'text_bubble', box: [0, 90, 50, 100], edgeClipped: true };
  const b = { kind: 'text_bubble', box: [0, 88, 50, 110], edgeClipped: false, retry: true };
  const c = { kind: 'text_bubble', box: [60, 90, 100, 100], edgeClipped: true };
  assert.deepEqual(resolveClipped([a, b, c]), [b, c]);
});
