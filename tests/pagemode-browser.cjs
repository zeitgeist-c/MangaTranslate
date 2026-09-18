'use strict';
// Optional browser regression: NODE_PATH must provide playwright.
// Uses generated drawings only; no API keys, external pages or translation calls.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    page.on('console', msg => console.log(msg.text()));
    await page.setContent('<style>body{background:#bbb}#holder{position:relative;width:800px}canvas{display:block;width:800px;height:500px}</style><div id="holder"><canvas id="drawing" width="800" height="500"></canvas></div>');
    await page.addStyleTag({ path: path.resolve('styles/pagemode.css') });
    await page.evaluate(() => {
      window.chrome = { runtime: { onMessage: { addListener() {} } } };
      window.ensureRelativeParent = el => el.parentElement;
    });
    await page.addScriptTag({ path: path.resolve('src/pagemode-core.js') });
    await page.addScriptTag({ path: path.resolve('src/pagemode.js') });
    const result = await page.evaluate(() => {
      const el = document.querySelector('canvas'), ctx = el.getContext('2d');
      ctx.fillStyle = '#555'; ctx.fillRect(0, 0, 800, 500);
      const draw = (cx, cy, rx, ry, fill) => {
        ctx.fillStyle = fill; ctx.strokeStyle = '#111'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#111'; ctx.font = '16px sans-serif'; ctx.fillText('ORIGINAL TEXT', cx - 60, cy);
      };
      draw(200, 180, 110, 90, '#fff'); draw(560, 180, 105, 110, '#fff9e5');
      window.fixturePage = pmPageRecord(el, 'fixture');
      fixturePage.imageWidth = 800; fixturePage.imageHeight = 500;
      fixturePage.image = { canvas: el, width: 800, height: 500 };
      const bubble = (x, y, w, h, text) => ({ xPct: x / 800, yPct: y / 500,
        wPct: w / 800, hPct: h / 500, text, translation: text });
      fixturePage.bubbles = pmSnapPageBubbles(fixturePage, [
        bubble(105, 100, 190, 160, 'Birinci cümle.'),
        bubble(108, 103, 185, 155, 'İkinci cümle.'),
        bubble(470, 80, 180, 200, 'Bunu daha önce düşünmeliydim. Şimdi buradan birlikte çıkmanın bir yolunu bulmamız gerekiyor; arkadaşlarımız bizi bekliyor!'),
      ]);
      pmLayoutPage(fixturePage);
      return fixturePage.bubbles.map(b => ({ text: b.translation, snap: b.snap }));
    });
    assert.equal(result.length, 2, 'merged source entries must not survive as stale overlays');
    assert.ok(result.some(b => b.text.includes('Birinci cümle.') && b.text.includes('İkinci cümle.')));
    assert.ok(result.every(b => b.snap === 'bubble'), JSON.stringify(result));
    const measure = () => page.evaluate(() => {
      Array.from(fixturePage.layer.children).forEach(pmFitBubbleText);
      return Array.from(fixturePage.layer.children).map(box => {
        const label = box.querySelector('.ml-auto-text');
        const r = box._mlTextRect, rect = label.getBoundingClientRect(), outer = box.getBoundingClientRect();
        return { count: fixturePage.layer.children.length, font: parseFloat(getComputedStyle(label).fontSize),
          fits: rect.left >= outer.left + outer.width * r.x - 1 && rect.right <= outer.left + outer.width * (r.x + r.w) + 1 &&
            rect.top >= outer.top + outer.height * r.y - 1 && rect.bottom <= outer.top + outer.height * (r.y + r.h) + 1,
          clip: getComputedStyle(box).clipPath.startsWith('polygon(') };
      });
    });
    const full = await measure();
    assert.ok(full.every(b => b.fits && b.clip));
    fs.mkdirSync('.hermes', { recursive: true });
    await page.screenshot({ path: '.hermes/bubble-fit-full.png' });
    await page.evaluate(() => {
      document.querySelector('canvas').style.width = '400px';
      document.querySelector('canvas').style.height = '250px';
      pmLayoutPage(fixturePage);
    });
    const half = await measure();
    assert.ok(half.every(b => b.fits && b.clip));
    assert.ok(half.every((b, i) => b.font < full[i].font));
    await page.screenshot({ path: '.hermes/bubble-fit-half.png' });
    const geometry = await page.evaluate(() => {
      const holder = document.querySelector('#holder'), el = fixturePage.el;
      holder.style.cssText = 'position:relative;width:650px;height:350px;overflow:auto;border:12px solid red;padding:18px;transform:scale(0.8,0.6);transform-origin:top left';
      el.style.cssText = 'width:800px;height:500px;border:10px solid blue;padding:14px;box-sizing:content-box';
      holder.scrollLeft = 65; holder.scrollTop = 75;
      pmLayoutPage(fixturePage);
      const actual = fixturePage.layer.getBoundingClientRect(), image = el.getBoundingClientRect();
      const expected = { x: image.left + 24 * 0.8, y: image.top + 24 * 0.6, w: 800 * 0.8, h: 500 * 0.6 };
      return { actual: { x: actual.left, y: actual.top, w: actual.width, h: actual.height }, expected };
    });
    for (const axis of ['x', 'y', 'w', 'h']) {
      assert.ok(Math.abs(geometry.actual[axis] - geometry.expected[axis]) < 1, JSON.stringify(geometry));
    }
    const crop = await page.evaluate(async () => {
      const el = document.createElement('canvas');
      el.width = 800; el.height = 2000;
      el.style.cssText = 'position:absolute;left:0;top:-600px;width:800px;height:2000px';
      const holder = document.createElement('div');
      holder.style.cssText = 'position:absolute;left:0;top:0;width:800px;height:2000px';
      document.body.appendChild(holder); holder.appendChild(el);
      el.toDataURL = () => { throw new Error('simulated tainted reader'); };
      window.captureVisibleRect = async r => {
        const c = document.createElement('canvas');
        c.width = Math.round(r.right - r.left); c.height = Math.round(r.bottom - r.top);
        return c;
      };
      const record = pmPageRecord(el, 'crop-test');
      const acquired = await pmAcquireImage(record);
      pmBuildJobs(record, acquired);
      const firstKey = record.cacheKey;
      record.image = null; // Test coordinate mapping independently of pixel detection.
      record.bubbles = [{ text: 'Original', translation: 'Çeviri', xPct: 0.25, yPct: 0.25, wPct: 0.5, hPct: 0.25 }];
      pmFinalizePage(record);
      const result = record.bubbles[0];
      const box = record.layer.firstElementChild.getBoundingClientRect();
      el.style.top = '-900px';
      const second = pmPageRecord(el, 'crop-test');
      pmBuildJobs(second, await pmAcquireImage(second));
      const secondKey = second.cacheKey;
      const originalCapture = captureVisibleRect;
      window.captureVisibleRect = async r => {
        const c = await originalCapture(r); el.style.top = '-950px'; return c;
      };
      let rejectedMovement = false;
      try { await pmAcquireImage(second); } catch (error) { rejectedMovement = /hareket/.test(error.message); }
      return { region: acquired.region, result, box: { x: box.x, y: box.y, w: box.width, h: box.height },
        separateKeys: firstKey !== secondKey, rejectedMovement };
    });
    assert.deepEqual(crop.region, { x: 0, y: 0.3, w: 1, h: 0.4 });
    assert.equal(crop.result.yPct, 0.4);
    assert.equal(crop.result.hPct, 0.1);
    for (const [key, value] of Object.entries({ x: 200, y: 200, w: 400, h: 200 })) {
      assert.ok(Math.abs(crop.box[key] - value) < 1, JSON.stringify(crop));
    }
    assert.ok(crop.separateKeys, 'different visible parts must have separate cache keys');
    assert.ok(crop.rejectedMovement, 'moving screenshot must not be placed using old coordinates');
    const errorDisplay = await page.evaluate(() => {
      pmEnsureStyles = function () {};
      pmReportError('API erişimi reddedildi. https://example.test?key=private-test-token');
      pmUpdatePill(); // A progress update must not erase the actual cause.
      const details = document.getElementById('ml-error-details');
      return { open: details.open, hidden: details.hidden,
        text: document.getElementById('ml-error-message').textContent };
    });
    assert.equal(errorDisplay.open, true);
    assert.equal(errorDisplay.hidden, false);
    assert.ok(errorDisplay.text.includes('API erişimi reddedildi'));
    assert.ok(!errorDisplay.text.includes('private-test-token'));
    console.log(JSON.stringify({ full, half, merged: result }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
