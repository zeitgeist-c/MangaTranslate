// tests/background-validate.test.js
// background.js chrome.* kullandigi icin dogrudan require edilemez; burada
// validateBubbles(opts.coordSpace='auto') ile AYNI zincir (detect -> sanitize -> dedupe) test edilir.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/pagemode-core.js');

function autoValidate(arr, w, h, maxLen) {
  const space = core.detectCoordSpace(arr);
  const clean = core.sanitizeBubbles(arr, { w, h, coordSpace: space, maxLen: maxLen || 600, minSizePct: 0.004 });
  return core.dedupeBubbles(clean, { iouThreshold: 0.6 });
}

test('auto: normalize giris piksele cevrilir', () => {
  const out = autoValidate([{ text: 'A', translation: 'B', x: 0.5, y: 0.5, width: 0.1, height: 0.05 }], 1000, 2000);
  assert.equal(out.length, 1);
  assert.equal(out[0].x, 500); assert.equal(out[0].y, 1000);
  assert.equal(out[0].width, 100); assert.equal(out[0].height, 100);
});

test('auto: piksel giris oldugu gibi gecer', () => {
  const out = autoValidate([{ text: 'A', translation: 'B', x: 100, y: 200, width: 300, height: 120 }], 1000, 2000);
  assert.deepEqual(out[0], { text: 'A', translation: 'B', x: 100, y: 200, width: 300, height: 120 });
});

test('auto: bant tekrari tek sonuca iner', () => {
  const a = { text: 'A', translation: 'A', x: 200, y: 200, width: 400, height: 200 };
  const b = { text: 'A', translation: 'A', x: 208, y: 206, width: 400, height: 200 };
  assert.equal(autoValidate([a, b], 2000, 4000).length, 1);
});

test('auto: 600 karakterden uzun metin … ile kesilir', () => {
  const long = 'x'.repeat(900);
  const out = autoValidate([{ text: long, translation: long, x: 10, y: 10, width: 300, height: 100 }], 1000, 2000, 600);
  assert.equal(out[0].text.length, 601);
  assert.equal(out[0].translation.length, 601);
});
