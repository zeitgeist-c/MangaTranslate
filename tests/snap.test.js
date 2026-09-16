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

// ── B) snapBubbles ─────────────────────────────────────────────────────────
function baseOpts() { return { brightLuma: 205, brightSpread: 45, inkLuma: 120, margin: 3 }; }

test('snapBubbles: kaymis kutu beyaz balona oturur', () => {
  const W = 300, H = 200;
  const d = grayPage(W, H, 90);
  ellipse(d, W, H, 120, 90, 45, 30, 250, 30);      // gercek balon: beyaz govde
  inkText(d, W, 100, 85, 8);
  const model = { text: 'A', translation: 'B', x: 132, y: 99, width: 84, height: 56 };  // +12/+9 kaymis
  const out = core.snapBubbles({ data: d, width: W, height: H, bubbles: [model], opts: baseOpts() });
  const b = out.bubbles[0];
  assert.equal(out.bubbles.length, 1);
  assert.ok(b.snap === 'bubble' || b.snap === 'text', 'snap uygulanmali: ' + b.snap);
  assert.ok(Math.abs((b.x + b.width / 2) - 120) <= 4, 'merkez x kaymasi: ' + JSON.stringify(b));
  assert.ok(Math.abs((b.y + b.height / 2) - 90) <= 4, 'merkez y kaymasi: ' + JSON.stringify(b));
});

test('snapBubbles: ayni balona iki kutu → tek kutuda birlesir', () => {
  const W = 300, H = 200;
  const d = grayPage(W, H, 90);
  ellipse(d, W, H, 120, 90, 45, 30, 250, 30);
  inkText(d, W, 100, 85, 8);
  const a = { text: 'A', translation: 'BIR', x: 80, y: 62, width: 80, height: 56 };
  const b = { text: 'C', translation: 'IKI', x: 84, y: 64, width: 78, height: 54 };
  const out = core.snapBubbles({ data: d, width: W, height: H, bubbles: [a, b], opts: baseOpts() });
  assert.equal(out.bubbles.length, 1);
  assert.equal(out.stats.merged, 1);
  assert.ok(out.bubbles[0].translation.includes('BIR') && out.bubbles[0].translation.includes('IKI'));
});

test('snapBubbles: balon yoksa (duz zemin) model kutusu korunur', () => {
  const W = 300, H = 200;
  const d = grayPage(W, H, 200);                       // ne beyaz ne yazi: bos zemin
  const model = { text: 'A', translation: 'B', x: 100, y: 80, width: 60, height: 40 };
  const out = core.snapBubbles({ data: d, width: W, height: H, bubbles: [model], opts: baseOpts() });
  const b = out.bubbles[0];
  assert.equal(b.snap, 'model');
  assert.equal(b.x, 100); assert.equal(b.y, 80);
});

test('snapBubbles: SFX (balonsuz yazi) yazi kutusuna oturur', () => {
  const W = 300, H = 120;
  const d = grayPage(W, H, 140);
  inkText(d, W, 100, 60, 10, 6);                        // iki satir yazi: x 100..118, y 60..66
  const model = { text: 'BOOM', translation: 'GUM', x: 88, y: 40, width: 60, height: 40 };
  const out = core.snapBubbles({ data: d, width: W, height: H, bubbles: [model], opts: baseOpts() });
  const b = out.bubbles[0];
  assert.equal(b.snap, 'text');
  assert.ok(b.x <= 100 && b.x + b.width >= 119, 'yazi kutusunu kapsamali: ' + JSON.stringify(b));
  assert.ok(b.width < 60, 'model kutusundan daha dar olmali: ' + JSON.stringify(b));
});

test('snapBubbles: dev beyaz zeminde runaway dolgu balona donusmez', () => {
  const W = 400, H = 300;
  const d = grayPage(W, H, 245);                       // her yer beyaz (zemin), balon yok
  const model = { text: 'A', translation: 'B', x: 150, y: 120, width: 60, height: 40 };
  const out = core.snapBubbles({ data: d, width: W, height: H, bubbles: [model], opts: baseOpts() });
  const b = out.bubbles[0];
  assert.ok(b.width <= 120 && b.height <= 80, 'kutu buyumemeli: ' + JSON.stringify(b));
  assert.ok(out.stats.rejected + out.stats.kept >= 1);
});

test('snapBubbles: koyu zeminde model kutusu korunur (her yer murekkep sayilmaz)', () => {
  const W = 300, H = 200;
  const d = grayPage(W, H, 90);                        // tum zemin koyu
  const model = { text: 'A', translation: 'B', x: 100, y: 80, width: 60, height: 40 };
  const out = core.snapBubbles({ data: d, width: W, height: H, bubbles: [model], opts: baseOpts() });
  assert.equal(out.bubbles[0].snap, 'model');
});

test('snapBubbles: deterministik', () => {
  const W = 200, H = 150;
  const d = grayPage(W, H, 90);
  ellipse(d, W, H, 100, 70, 40, 26, 250, 30);
  const m = { text: 'A', translation: 'B', x: 70, y: 50, width: 70, height: 44 };
  const a = core.snapBubbles({ data: d, width: W, height: H, bubbles: [m], opts: baseOpts() });
  const b = core.snapBubbles({ data: d, width: W, height: H, bubbles: [m], opts: baseOpts() });
  assert.deepEqual(a.bubbles, b.bubbles);
});

// ── C) resolveOverlaps ─────────────────────────────────────────────────────
test('resolveOverlaps: kucuk (%2) ortusme dokunulmaz', () => {
  const a = { x: 0, y: 0, width: 100, height: 100 };
  const b = { x: 94, y: 94, width: 40, height: 40 };
  const out = core.resolveOverlaps([a, b], { maxRatio: 0.25 });
  assert.deepEqual(out[1], b);
});

test('resolveOverlaps: buyuk ortusmede kucuk kutu kesilir, ortusme kalmaz', () => {
  const big = { x: 100, y: 100, width: 120, height: 100 };
  const small = { x: 160, y: 120, width: 120, height: 100 };
  const out = core.resolveOverlaps([big, small], { maxRatio: 0.25, minWidth: 24, minHeight: 14 });
  const s = out[1];
  const x0 = Math.max(big.x, s.x), y0 = Math.max(big.y, s.y);
  const x1 = Math.min(big.x + big.width, s.x + s.width), y1 = Math.min(big.y + big.height, s.y + s.height);
  assert.equal(Math.max(0, x1 - x0) * Math.max(0, y1 - y0), 0, 'ortusme sifirlanmali: ' + JSON.stringify(s));
  assert.ok(s.width >= 24 && s.height >= 14);
});

test('resolveOverlaps: ic ice kutuda ortusme kalkar veya taban boyutta kalir', () => {
  const big = { x: 0, y: 0, width: 200, height: 160 };
  const small = { x: 20, y: 20, width: 180, height: 140 };
  const out = core.resolveOverlaps([big, small], { maxRatio: 0.25, minWidth: 24, minHeight: 14 });
  const s = out[1];
  const ix = Math.max(0, Math.min(big.x + big.width, s.x + s.width) - Math.max(big.x, s.x));
  const iy = Math.max(0, Math.min(big.y + big.height, s.y + s.height) - Math.max(big.y, s.y));
  assert.ok(ix * iy === 0 || s.width === 24 || s.height === 14, 'kesisim yok veya taban boyutta: ' + JSON.stringify(s));
});
