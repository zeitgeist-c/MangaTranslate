import { chromium } from 'playwright-core';
const STUB = () => {
  window.chrome = {
    storage: { onChanged: { addListener: () => {}, removeListener: () => {} },
      sync: { _s: { theme: 'dark', language: 'en', translationProvider: 'gemini' },
        get: function(k) { return Promise.resolve(typeof k === 'object' ? Object.assign({}, k, this._s) : Object.assign({}, this._s)); },
        set: function(p) { Object.assign(this._s, p); return Promise.resolve(); },
        remove: function() { return Promise.resolve(); } },
      local: { get: (k) => Promise.resolve({}), set: () => Promise.resolve(), remove: () => Promise.resolve() } },
    runtime: { sendMessage: (m) => Promise.resolve(m && String(m.type || '').startsWith('ML_KEYS') ? { ok: true, value: [] } : {}), getManifest: () => ({ version: '3.9.6' }), onMessage: { addListener: () => {} }, lastError: null },
    tabs: { query: () => Promise.resolve([]) }, scripting: { executeScript: () => Promise.resolve() },
  };
};
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
await page.addInitScript(STUB);
await page.goto('file:///C:/Users/mahmu/Projeler/MangaTranslate/popup/popup.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
{
  const cont = page.getByRole('button', { name: 'Continue' });
  if (await cont.count()) { await cont.click(); await page.waitForTimeout(1200); }
}
await page.screenshot({ path: 'docs/screenshots/01-popup-gemini.png' }); console.log('wrote 01');
await page.locator('.segmented button', { hasText: 'OpenRouter' }).click();
await page.waitForTimeout(1500);
await page.waitForTimeout(1000);
await page.screenshot({ path: 'docs/screenshots/02-popup-openrouter.png' }); console.log('wrote 02');
await browser.close();
