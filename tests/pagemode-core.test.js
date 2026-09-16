// tests/pagemode-core.test.js — sayfa modu saf mantik testleri (bagimlilik yok)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/pagemode-core.js');

test('fnv1aHex: deterministik, 16 hex, farkli girdi farkli cikti', () => {
  const a = core.fnv1aHex('https://x.test/01.jpg|1200x1800');
  assert.equal(a, core.fnv1aHex('https://x.test/01.jpg|1200x1800'));
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.notEqual(a, core.fnv1aHex('https://x.test/02.jpg|1200x1800'));
});

test('pageCacheKey: surumlu ve kararli', () => {
  assert.equal(core.pageCacheKey({ src: 'a.jpg', w: 1000, h: 1500 }), core.pageCacheKey({ src: 'a.jpg', w: 1000, h: 1500 }));
  assert.match(core.pageCacheKey({ src: 'a.jpg', w: 1000, h: 1500 }), /^pc1:[0-9a-f]{16}$/);
});

test('scaleForMaxSide: kucuk gorsel buyutulmez', () => {
  assert.deepEqual(core.scaleForMaxSide(800, 600, 1600), { scale: 1, width: 800, height: 600 });
  const s = core.scaleForMaxSide(3200, 4000, 1600);
  assert.equal(s.width, 1280); assert.equal(s.height, 1600); assert.equal(s.scale, 0.4);
});

test('planBands: normal sayfa tek bant', () => {
  const bands = core.planBands(1200, 1800, { maxHeight: 1800, overlapPx: 200 });
  assert.equal(bands.length, 1);
  assert.deepEqual(bands[0], { index: 0, count: 1, x: 0, y: 0, width: 1200, height: 1800 });
});

test('planBands: uzun serit bantlari tam kapsar, ortusur, bosluksuz', () => {
  const H = 8000;
  const bands = core.planBands(800, H, { maxHeight: 1800, overlapPx: 200 });
  assert.equal(bands.length, 5, 'beklenen bant sayisi 5, gelen ' + bands.length);
  assert.equal(bands[0].y, 0);
  assert.equal(bands[bands.length - 1].y + bands[bands.length - 1].height, H);
  for (let i = 1; i < bands.length; i++) {
    assert.ok(bands[i].y > bands[i - 1].y, 'y artan olmali');
    assert.ok((bands[i - 1].y + bands[i - 1].height) - bands[i].y >= 200, 'ortusme en az 200px olmali');
    assert.equal(bands[i].index, i);
    assert.equal(bands[i].count, bands.length);
    assert.ok(bands[i].height <= 1800, 'bant yuksekligi sinirini asmamali');
  }
});

test('detectCoordSpace', () => {
  assert.equal(core.detectCoordSpace([{ x: 0.1, y: 0.2, width: 0.3, height: 0.05 }]), 'normalized');
  assert.equal(core.detectCoordSpace([{ x: 100, y: 220, width: 300, height: 50 }]), 'pixels');
  assert.equal(core.detectCoordSpace([]), 'pixels');
});

test('sanitizeBubbles: normalize -> piksel, sinir disi kirpilir, kucuk atilir', () => {
  const out = core.sanitizeBubbles([
    { text: 'Hi', translation: 'Selam', x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
    { text: 'Tiny', translation: 'Kucuk', x: 0.5, y: 0.5, width: 0.001, height: 0.001 },
    { text: 'Edge', translation: 'Kenar', x: 1.4, y: -0.2, width: 0.2, height: 0.2 },
    { text: '', translation: '', x: 0.2, y: 0.2, width: 0.2, height: 0.2 },
  ], { w: 1000, h: 2000, coordSpace: 'normalized', maxLen: 600, minSizePct: 0.01 });
  assert.equal(out.length, 2);
  assert.equal(out[0].x, 100); assert.equal(out[0].y, 400);
  assert.equal(out[0].width, 300); assert.equal(out[0].height, 200);
  // Sagdan tasan kutu ATILMAZ, resmin icine kaydirilir (ceviri kaybi olmasin)
  assert.equal(out[1].x, 800); assert.equal(out[1].y, 0);
  assert.equal(out[1].width, 200); assert.equal(out[1].height, 400);
});

test('sanitizeBubbles: uzun metin isaretle kesilir, sessiz kesme yok', () => {
  const long = 'a'.repeat(800);
  const out = core.sanitizeBubbles([{ text: long, translation: long, x: 0, y: 0, width: 0.5, height: 0.5 }],
    { w: 100, h: 100, coordSpace: 'normalized', maxLen: 600 });
  assert.equal(out[0].text.length, 601);            // 600 + '…'
  assert.ok(out[0].text.endsWith('…'));
});

test('dedupeBubbles: ayni balonun bant tekrari tek sonuca iner', () => {
  const a = { text: 'A', translation: 'A', x: 100, y: 100, width: 200, height: 100 };
  const b = { text: 'A', translation: 'A', x: 104, y: 102, width: 200, height: 100 }; // IoU yuksek
  const c = { text: 'B', translation: 'B', x: 500, y: 900, width: 200, height: 100 };
  const out = core.dedupeBubbles([a, b, c], { iouThreshold: 0.6 });
  assert.equal(out.length, 2);
});

test('bandToGlobal: bant koordinatini sayfa yuzdesine cevirir', () => {
  const band = { x: 0, y: 600, width: 1000, height: 1000 };
  const b = core.bandToGlobal({ text: 'A', translation: 'B', x: 100, y: 200, width: 300, height: 100 }, band, 1000, 4000);
  assert.equal(b.xPct, 0.1);      // 100 / 1000
  assert.equal(b.yPct, 0.2);      // (600 + 200) / 4000
  assert.equal(b.wPct, 0.3);
  assert.equal(b.hPct, 0.025);    // 100 / 4000
});

test('sortPagesForTranslation: gorunen -> alt -> ust', () => {
  const pages = [
    { id: 'yukarida', rect: { top: -1200, bottom: -200 } },
    { id: 'gorunen',  rect: { top: 100, bottom: 900 } },
    { id: 'alta',     rect: { top: 1000, bottom: 1800 } },
    { id: 'cok-alta', rect: { top: 5000, bottom: 5800 } },
  ];
  const order = core.sortPagesForTranslation(pages, { top: 0, bottom: 900 }).map(p => p.id);
  assert.deepEqual(order, ['gorunen', 'alta', 'cok-alta', 'yukarida']);
});

test('estimateFontSize: kutu buyudukce yazi buyur, min/max sinirinda kalir', () => {
  const small = core.estimateFontSize(60, 30, 12, { min: 9, max: 18 });
  const big   = core.estimateFontSize(300, 160, 12, { min: 9, max: 18 });
  assert.ok(big >= small);
  assert.ok(small >= 9 && big <= 18);
  assert.equal(core.estimateFontSize(5, 5, 400, { min: 9, max: 18 }), 9);
});

test('isMangaCandidate: reklam/avatar elenir, sayfa gorseli gecer', () => {
  assert.equal(core.isMangaCandidate({ w: 1200, h: 1800, src: 'https://x/reader/page-01.jpg', cls: 'page-img' }), true);
  assert.equal(core.isMangaCandidate({ w: 1200, h: 1800, src: 'https://x/logo.png', cls: 'site-logo' }), false);
  assert.equal(core.isMangaCandidate({ w: 900, h: 60, src: 'https://x/banner.jpg', cls: 'banner' }), false);
  assert.equal(core.isMangaCandidate({ w: 90, h: 90, src: 'https://x/avatar.jpg', cls: '' }), false);
  assert.equal(core.isMangaCandidate({ w: 1000, h: 1500, src: 'data:image/jpeg;base64,AAAA', cls: '' }), true);
  // uzun serit webtoon sayfasi (800x4800) elenmemeli
  assert.equal(core.isMangaCandidate({ w: 800, h: 4800, src: 'https://x/long.jpg', cls: 'reader-page' }), true);
  assert.equal(core.isMangaCandidate({ w: 800, h: 26000, src: 'https://x/very-long.jpg', cls: 'page' }), true);
});
