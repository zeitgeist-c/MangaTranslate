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
function fillRect(d, w, h, x0, y0, x1, y1, v) {
  for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) setPx(d, w, x, y, v);
  }
}
// panel: beyaz ic + kalin koyu cerceve (manga paneli taklidi)
function panel(d, w, h, x0, y0, x1, y1, inner, frame) {
  fillRect(d, w, h, x0, y0, x1, y1, inner);
  fillRect(d, w, h, x0, y0, x1, y0 + 4, frame);
  fillRect(d, w, h, x0, y1 - 4, x1, y1, frame);
  fillRect(d, w, h, x0, y0, x0 + 4, y1, frame);
  fillRect(d, w, h, x1 - 4, y0, x1, y1, frame);
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

test('snapBubbles: beyaz sayfa zemininde de balona oturur (coklu tohum)', () => {
  const W = 320, H = 240;
  const d = grayPage(W, H, 238);                        // manga sayfasi zemini: beyaz
  ellipse(d, W, H, 160, 120, 60, 40, 255, 20);          // balon: beyaz govde + koyu cerceve
  inkText(d, W, 140, 118, 8);
  const model = { text: 'A', translation: 'B', x: 172, y: 129, width: 84, height: 56 };   // +12/+9 kaymis
  const out = core.snapBubbles({ data: d, width: W, height: H, bubbles: [model], opts: baseOpts() });
  const b = out.bubbles[0];
  assert.equal(b.snap, 'bubble', JSON.stringify(b));
  assert.ok(Math.abs((b.x + b.width / 2) - 160) <= 5, JSON.stringify(b));
  assert.ok(Math.abs((b.y + b.height / 2) - 120) <= 5, JSON.stringify(b));
});

test('snapBubbles: yazi yedegi model kutusunu buyutmez', () => {
  const W = 320, H = 240;
  const d = grayPage(W, H, 238);
  for (let y = 100; y < 200; y++) for (let x = 100; x < 260; x++) setPx(d, W, x, y, 60);   // koyu sanat alani
  const model = { text: 'A', translation: 'B', x: 130, y: 120, width: 60, height: 40 };
  const out = core.snapBubbles({ data: d, width: W, height: H, bubbles: [model], opts: baseOpts() });
  const b = out.bubbles[0];
  assert.ok(b.width <= 60 * 1.15 + 1 && b.height <= 40 * 1.15 + 1, 'model kutusu buyumemeli: ' + JSON.stringify(b));
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

// ── D) gercek sayfa kosullari: panel, metne siki kutu, cok balon, SFX ──────
test('contentRectOf: padding + border icerik alanini daraltir', () => {
  const r = core.contentRectOf({
    boxW: 800, boxH: 600, naturalW: 400, naturalH: 300, objectFit: 'contain',
    borderTop: 4, borderLeft: 4, borderRight: 4, borderBottom: 4,
    paddingTop: 6, paddingLeft: 6, paddingRight: 6, paddingBottom: 6,
  });
  assert.equal(r.h, 580);                                  // 600 - 2*4 - 2*6
  assert.ok(Math.abs(r.y - 10) < 0.1, JSON.stringify(r));
  assert.ok(Math.abs(r.x - 13.33) < 0.2, JSON.stringify(r));
  assert.ok(Math.abs(r.w - 773.33) < 0.5, JSON.stringify(r));
});

test('snapBubbles: panel icindeki balon panele degil BALONA oturur', () => {
  const W = 420, H = 320;
  const d = grayPage(W, H, 60);
  panel(d, W, H, 20, 20, 400, 300, 245, 15);                // panel (kapali beyaz alan)
  ellipse(d, W, H, 210, 160, 80, 55, 255, 20);              // balon
  inkText(d, W, 190, 156, 9);
  const model = { text: 'A', translation: 'B', x: 255, y: 120, width: 110, height: 80 };   // sag-ust kaymis
  const out = core.snapBubbles({ data: d, width: W, height: H, bubbles: [model], opts: baseOpts() });
  const b = out.bubbles[0];
  assert.equal(b.snap, 'bubble', JSON.stringify(b));
  assert.ok(b.width < 200, 'panel kutusu secilmemeli: ' + JSON.stringify(b));
  assert.ok(Math.abs((b.x + b.width / 2) - 210) <= 6 && Math.abs((b.y + b.height / 2) - 160) <= 6, JSON.stringify(b));
});

test('snapBubbles: model kutusu metne siki otursa da balon bulunur', () => {
  const W = 420, H = 320;
  const d = grayPage(W, H, 60);
  panel(d, W, H, 20, 20, 400, 300, 245, 15);
  ellipse(d, W, H, 210, 160, 80, 55, 255, 20);
  inkText(d, W, 178, 152, 16, 10);
  const model = { text: 'A', translation: 'B', x: 158, y: 138, width: 104, height: 44 };   // sadece yazi
  const out = core.snapBubbles({ data: d, width: W, height: H, bubbles: [model], opts: baseOpts() });
  const b = out.bubbles[0];
  assert.equal(b.snap, 'bubble', JSON.stringify(b));
  assert.ok(b.width > 120 && b.height > 80, 'kutu balonu kaplamali: ' + JSON.stringify(b));
});

test('snapBubbles: cok balonlu sayfada hicbir balon atlanmaz', () => {
  const W = 600, H = 900;
  const d = grayPage(W, H, 70);
  const truths = [];
  for (let i = 0; i < 12; i++) {
    const cx = 100 + (i % 3) * 200, cy = 90 + Math.floor(i / 3) * 220;
    ellipse(d, W, H, cx, cy, 60, 42, 255, 20);
    inkText(d, W, cx - 20, cy - 4, 8);
    truths.push({ cx: cx, cy: cy });
  }
  const models = truths.map(function (t, i) {
    return { text: 'T' + i, translation: 'C' + i, x: t.cx - 24, y: t.cy - 16, width: 60 * 1.1, height: 42 * 1.1 };
  });
  const out = core.snapBubbles({ data: d, width: W, height: H, bubbles: models, opts: baseOpts() });
  assert.equal(out.bubbles.length, 12);
  out.bubbles.forEach(function (b, i) {
    const dx = Math.abs((b.x + b.width / 2) - truths[i].cx);
    const dy = Math.abs((b.y + b.height / 2) - truths[i].cy);
    assert.ok(dx <= 6 && dy <= 6, 'balon ' + i + ' oturmadi: ' + JSON.stringify(b));
  });
});

test('snapBubbles: SFX (balonsuz yazi) yazi kutusuna oturur', () => {
  const W = 420, H = 320;
  const d = grayPage(W, H, 60);
  panel(d, W, H, 20, 20, 400, 300, 245, 15);
  fillRect(d, W, H, 200, 150, 260, 180, 15);                // kalin harf blogu (balon yok)
  const model = { text: 'BOOM', translation: 'GUM', x: 198, y: 148, width: 64, height: 34 };
  const out = core.snapBubbles({ data: d, width: W, height: H, bubbles: [model], opts: baseOpts() });
  const b = out.bubbles[0];
  assert.equal(b.snap, 'text', JSON.stringify(b));
  assert.ok(Math.abs(b.x - 200) <= 8 && Math.abs(b.y - 150) <= 8, JSON.stringify(b));
});

test('snapBubbles: acik renkli (krem) balon da bulunur', () => {
  const W = 320, H = 240;
  const d = grayPage(W, H, 90);
  ellipse(d, W, H, 160, 120, 60, 40, 255, 20);
  for (let y = 80; y <= 160; y++) {                           // balon govdesi: krem tonu
    for (let x = 100; x <= 220; x++) {
      const v = ((x - 160) ** 2) / (60 * 60) + ((y - 120) ** 2) / (40 * 40);
      if (v > 0.7 || v > 1) continue;
      const i = (y * W + x) * 4;
      d[i] = 255; d[i + 1] = 250; d[i + 2] = 195;             // spread 60 -> varsayilan 80 ile gecer
    }
  }
  inkText(d, W, 140, 118, 8);
  const model = { text: 'A', translation: 'B', x: 172, y: 129, width: 84, height: 56 };
  const out = core.snapBubbles({ data: d, width: W, height: H, bubbles: [model], opts: Object.assign({}, baseOpts(), { brightSpread: 80 }) });
  const b = out.bubbles[0];
  assert.ok(b.snap === 'bubble' || b.snap === 'text', JSON.stringify(b));
  assert.ok(Math.abs((b.x + b.width / 2) - 160) <= 6, JSON.stringify(b));
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
