import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchBoxes, scorePage, summarize } from '../lib/metrics.mjs';
test('bipartite matching avoids greedy IoU undercount', () => {
  const matched = matchBoxes([[0, 0, 10, 10], [2, 0, 12, 10]], [[0, 0, 10, 10], [-2, 0, 8, 10]]);
  assert.equal(matched.length, 2);
});
const label = { imageId: 'a', width: 100, height: 100, reviewStatus: 'human-reviewed',
  bubbles: [{ id: 'truth-bubble', box: [0, 0, 100, 100] }], regions: [{ id: 't', textBox: [20, 20, 60, 60], bubbleId: 'truth-bubble' }] };
const prediction = { imageId: 'a', width: 100, height: 100, bubbles: [{ id: 'b0', box: [0, 0, 100, 100] }],
  regions: [{ textBox: [20, 20, 60, 60], bubbleId: 'b0' }] };
test('excluded SFX ignore only contained predictions and cannot hide overlap with real dialogue', () => {
  const result = scorePage({ ...prediction, regions: [...prediction.regions, { textBox: [75, 75, 85, 85] }] },
    { ...label, regions: [...label.regions, { textBox: [70, 70, 90, 90], inScope: false }] });
  assert.equal(result.ignoredPredictions, 1); assert.equal(result.precision, 1);
  const overlapping = scorePage({ ...prediction, regions: [...prediction.regions, { textBox: [55, 55, 85, 85] }] },
    { ...label, regions: [...label.regions, { textBox: [50, 50, 90, 90], inScope: false }] });
  assert.equal(overlapping.ignoredPredictions, 0); assert.equal(overlapping.falsePositive, 1);
});
test('text coverage and balloon association are separate metrics', () => {
  assert.equal(scorePage(prediction, label).allAssigned, true);
  const result = scorePage({ ...prediction, regions: [{ ...prediction.regions[0], bubbleId: null }] }, label);
  assert.equal(result.recall, 1);
  assert.equal(result.missingAssociation, 1);
  assert.equal(result.allAssigned, false);
});
test('wrong balloon is counted even when text detection is perfect', () => {
  const result = scorePage({ ...prediction, regions: [{ ...prediction.regions[0], bubbleId: 'unknown' }] }, label);
  assert.equal(result.wrongAssociation, 1);
  assert.equal(summarize([result]).qualityTargetMet, false);
});
test('duplicate predictions count as false positives', () => {
  const result = scorePage({ ...prediction, regions: [...prediction.regions, ...prediction.regions] }, label);
  assert.equal(result.truePositive, 1); assert.equal(result.falsePositive, 1); assert.equal(result.precision, .5);
});
test('unknown quality never becomes successful zero/zero accuracy', () => {
  assert.throws(() => scorePage(prediction, { ...label, reviewStatus: 'unreviewed' }), /Unreviewed/);
  assert.throws(() => scorePage(prediction, { ...label, imageId: 'other' }), /identity/);
  assert.equal(summarize([]).acceptancePassed, false);
  assert.equal(summarize([scorePage({ ...prediction, regions: [] }, { ...label, regions: [] })]).qualityTargetMet, false);
});
