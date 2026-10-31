import { chromium } from 'playwright-core';
const STUB = () => {
  window.chrome = { storage: { onChanged: { addListener: () => {}, removeListener: () => {} },
    sync: { _s: { theme: 'dark', language: 'en' },
      get: function(k) { return Promise.resolve(typeof k === 'object' ? Object.assign({}, k, this._s) : Object.assign({}, this._s)); },
      set: function(p) { Object.assign(this._s, p); return Promise.resolve(); },
      remove: function() { return Promise.resolve(); } },
    local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } },
    runtime: { sendMessage: (m) => Promise.resolve(m && String(m.type || '').startsWith('ML_KEYS') ? { ok: true, value: [] } : {}), getManifest: () => ({ version: '3.9.6' }), onMessage: { addListener: () => {} } } };
};
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
await page.addInitScript(STUB);
await page.goto('file:///C:/Users/mahmu/Projeler/MangaTranslate/options/settings.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'docs/screenshots/03-ayarlar-anahtarlar.png' }); console.log('wrote 03');
await page.locator('button[data-section="preferences"]').click();
await page.waitForTimeout(1200);
await page.screenshot({ path: 'docs/screenshots/04-ceviri-tercihleri.png' }); console.log('wrote 04');
await page.locator('button[data-section="about"]').click();
await page.waitForTimeout(1200);
await page.screenshot({ path: 'docs/screenshots/05-hakkinda.png' }); console.log('wrote 05');
await browser.close();
