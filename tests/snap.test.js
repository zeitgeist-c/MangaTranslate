// tests/snap.test.js — sayfa modu kalite fonksiyonlari (saf; DOM yok)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/pagemode-core.js');

// ── yardimcilar ────────────────────────────────────────────────────────────
function grayPage(w, h, v) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i += 4) { d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255; }
  return d;
}
function setPx(d, w, x, y, v) {
  const i = (y * w + x) * 4;
  d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
}
function ellipse(d, w, h, cx, cy, rx, ry, fill, outline) {
  for (let y = Math.max(0, cy - ry); y <= Math.min(h - 1, cy + ry); y++) {
    for (let x = Math.max(0, cx - rx); x <= Math.min(w - 1, cx + rx); x++) {
      const v = ((x - cx) ** 2) / (rx * rx) + ((y - cy) ** 2) / (ry * ry);
      if (v <= 1) setPx(d, w, x, y, fill);
    }
  }
  if (outline != null) {
    for (let y = Math.max(0, cy - ry); y <= Math.min(h - 1, cy + ry); y++) {
      for (let x = Math.max(0, cx - rx); x <= Math.min(w - 1, cx + rx); x++) {
        const v = ((x - cx) ** 2) / (rx * rx) + ((y - cy) ** 2) / (ry * ry);
        if (v <= 1 && v > 0.72) setPx(d, w, x, y, outline);
      }
    }
  }
}
function inkText(d, w, x, y, len, lineH) {
  for (let i = 0; i < len; i++) setPx(d, w, x + i * 2, y, 20);
  if (lineH) for (let i = 0; i < len; i++) setPx(d, w, x + i * 2, y + lineH, 20);
}

// ── A) contentRectOf ───────────────────────────────────────────────────────
test('contentRectOf: fill → icerik kutusu elemanla ayni', () => {
  const r = core.contentRectOf({ boxW: 800, boxH: 600, naturalW: 800, naturalH: 600, objectFit: 'fill' });
  assert.deepEqual([r.x, r.y, r.w, r.h], [0, 0, 800, 600]);
});

test('contentRectOf: contain + letterbox (ust/alt bosluk)', () => {
  const r = core.contentRectOf({ boxW: 800, boxH: 800, naturalW: 800, naturalH: 600, objectFit: 'contain' });
  assert.equal(r.w, 800);
  assert.equal(r.h, 600);
  assert.equal(r.y, 100);          // (800-600)/2
  assert.equal(r.x, 0);
});

test('contentRectOf: contain + pillarbox (yan bosluk) + object-position left top', () => {
  const r = core.contentRectOf({ boxW: 1000, boxH: 500, naturalW: 500, naturalH: 500, objectFit: 'contain', objectPosition: 'left top' });
  assert.equal(r.h, 500);
  assert.equal(r.w, 500);
  assert.equal(r.x, 0);
  assert.equal(r.y, 0);
});

test('contentRectOf: cover tasar ve gorunur alani bildirir', () => {
  const r = core.contentRectOf({ boxW: 400, boxH: 400, naturalW: 800, naturalH: 400, objectFit: 'cover' });
  assert.equal(r.h, 400);
  assert.equal(r.w, 800);
  assert.equal(r.clipped, true);
  assert.equal(r.visible.w, 400);   // yalnizca 400px gorunur
});

test('contentRectOf: kenarlik (border) iceri kaydirir', () => {
  const r = core.contentRectOf({ boxW: 810, boxH: 610, naturalW: 800, naturalH: 600, objectFit: 'fill', borderLeft: 5, borderTop: 5, borderRight: 5, borderBottom: 5 });
  assert.deepEqual([r.x, r.y, r.w, r.h], [5, 5, 800, 600]);
});

test('contentRectOf: % ve px object-position', () => {
  const a = core.contentRectOf({ boxW: 800, boxH: 700, naturalW: 800, naturalH: 600, objectFit: 'contain', objectPosition: '0% 0%' });
  assert.equal(a.y, 0);
  const b = core.contentRectOf({ boxW: 800, boxH: 700, naturalW: 800, naturalH: 600, objectFit: 'contain', objectPosition: 'center 10px' });
  assert.equal(b.y, 10);
});
