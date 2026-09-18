const test = require('node:test');
const assert = require('node:assert/strict');
const { refine, similarity } = require('../src/local-match.js');

test('OCR noise still matches the intended English dialogue', () => {
  assert.ok(similarity('MY FAMILY LIVES IN CHICAGO', 'MY FAMlLY LIVES IN CHICAGO /') > 0.7);
});

test('local box replaces drifted remote coordinates once', () => {
  const bubbles = [
    { text: 'My family lives in Chicago', translation: 'Ailem Chicago’da yaşıyor', x: 10, y: 10, width: 100, height: 80 },
    { text: 'Other text', translation: 'Diğer', x: 200, y: 200, width: 80, height: 60 },
  ];
  const matches = [{ ocr: 'MY FAMILY LIVES IN CHICAGO', bubble_box: [30, 15, 150, 110],
    text_box: [50, 30, 130, 90], bubble_confidence: 0.95, needs_review: false }];
  const result = refine(bubbles, matches, 400, 400);
  assert.equal(result.placed, 1);
  assert.deepEqual([result.bubbles[0].x, result.bubbles[0].y, result.bubbles[0].width, result.bubbles[0].height], [30, 15, 120, 95]);
  assert.equal(result.bubbles[1].localPlacement, undefined);
});

test('uncertain and far mismatched regions do not move the translation', () => {
  const bubble = { text: 'hello', x: 10, y: 10, width: 40, height: 30 };
  const uncertain = { ocr: 'hello', bubble_box: [200, 200, 260, 240], text_box: [210, 210, 250, 230],
    bubble_confidence: 0.9, needs_review: true };
  assert.equal(refine([bubble], [uncertain], 400, 400).placed, 0);
  assert.equal(refine([bubble], [{ ...uncertain, needs_review: false, ocr: 'unrelated' }], 400, 400).placed, 0);
});

test('nearby different dialogue cannot claim a balloon by location alone', () => {
  const bubble = { text: 'WE MUST GO NOW', x: 50, y: 50, width: 120, height: 70 };
  const match = { ocr: 'THERE IS NO TIME', bubble_box: [55, 55, 175, 125],
    text_box: [65, 65, 165, 115], bubble_confidence: .99, needs_review: false };
  assert.equal(refine([bubble], [match], 400, 400).placed, 0);
});

test('clipped detector uses OCR-safe white rectangle for the matching dialogue', () => {
  const bubble = { text: 'FIGHTING MORE BRAVELY THAN ANYONE ON THE MOST DANGEROUS FRONT LINES, AND BECOMING AN EXAMPLE TO ALL EXPLORERS.',
    translation: 'En tehlikeli cephede savaşarak örnek oluyor.', x: 84, y: 331, width: 739, height: 193 };
  const match = { ocr: bubble.text, bubble_box: [49, 214, 857, 644], ocr_safe_rect: [65, 426, 644, 671],
    reason: 'text_outside_detected_bubble', needs_review: true };
  const result = refine([bubble], [match], 900, 1152);
  assert.equal(result.placed, 1);
  assert.deepEqual([result.bubbles[0].x, result.bubbles[0].y, result.bubbles[0].width, result.bubbles[0].height],
    [65, 426, 579, 245]);
});

test('OCR-only candidate rescues a balloon that the detector missed', () => {
  const bubble = { text: 'FIGHTING MORE BRAVELY THAN ANYONE', translation: 'Herkesten cesurca savaşıyor',
    x: 84, y: 331, width: 739, height: 193 };
  const candidates = [
    { ocr: 'UNRELATED WORDS', ocr_safe_rect: [10, 20, 120, 60], reason: 'ocr_only', needs_review: true },
    { ocr: bubble.text, ocr_safe_rect: [66, 427, 643, 670], reason: 'ocr_only', needs_review: true },
  ];
  const result = refine([bubble], candidates, 900, 1152);
  assert.equal(result.placed, 1);
  assert.equal(result.bubbles[0].x, 66);
});
