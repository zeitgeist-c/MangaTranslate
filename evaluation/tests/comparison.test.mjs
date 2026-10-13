import test from 'node:test';
import assert from 'node:assert/strict';
import { compareDetectors } from '../lib/comparison.mjs';
const base = { imageId: 'same', width: 100, height: 200 };
test('comparison preserves independent lines and refuses ambiguous assignment', () => {
  const result = compareDetectors({ ...base, regions: [
    { regionId: 'g1', textBox: [0, 0, 40, 40] }, { regionId: 'g2', textBox: [20, 0, 60, 40] }
  ] }, { ...base, regions: [
    { regionId: 'l1', textBox: [2, 2, 10, 10] }, { regionId: 'l2', textBox: [25, 2, 30, 10] },
    { regionId: 'l3', textBox: [70, 70, 80, 80] }
  ] });
  assert.deepEqual(result.counts, { covered: 1, uncovered: 1, ambiguous: 1 });
  assert.equal(result.items[1].groupId, null);
  assert.deepEqual(result.items[1].candidateGroupIds, ['g1', 'g2']);
  assert.equal(result.items.length, 3);
  assert.equal(result.qualityMeasured, false);
});
test('comparison rejects a different image even with identical dimensions', () => {
  assert.throws(() => compareDetectors({ ...base }, { ...base, imageId: 'different' }), /identity/);
});
