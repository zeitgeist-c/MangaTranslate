'use strict';
/* MangaLens TR interface language (UI) — 13-language contract.
 * - Source language is English; each language keeps its own dictionary.
 * - English when unset; the browser/OS language never overrides.
 * - The UI language is not the manga translation target (a separate setting).
 * - Stored in chrome.storage.sync 'uiLanguage'. Updates never reset it.
 * - Missing keys fall back to EN (works), but the release gate fails on missing.
 */
globalThis.MLI18N = (() => {
  const LANGUAGES = [
    { code: 'en', label: 'English' },
    { code: 'tr', label: 'Türkçe' },
    { code: 'de', label: 'Deutsch' },
    { code: 'es', label: 'Español' },
    { code: 'fr', label: 'Français' },
    { code: 'it', label: 'Italiano' },
    { code: 'pt-BR', label: 'Português (Brasil)' },
    { code: 'ru', label: 'Русский' },
    { code: 'pl', label: 'Polski' },
    { code: 'nl', label: 'Nederlands' },
    { code: 'zh-CN', label: '简体中文' },
    { code: 'ja', label: '日本語' },
    { code: 'ko', label: '한국어' },
  ];
  const CODES = new Set(LANGUAGES.map(l => l.code));
  const KEY = 'uiLanguage';
  let lang = 'en';

  function resolve(code) { return CODES.has(code) ? code : 'en'; }

  async function get() {
    try {
      const s = await chrome.storage.sync.get({ [KEY]: null });
      // Without a record the current language is kept (test hook / early default untouched).
      if (s[KEY] != null) lang = resolve(s[KEY]);
    } catch { /* lang korunur */ }
    return lang;
  }

  function set(code) {
    lang = resolve(code);
    try { chrome.storage.sync.set({ [KEY]: lang }); } catch { /* yoksay */ }
    notify();
    return lang;
  }

  const listeners = new Set();
  /** Dil degisince cagrilacak abone (her acik yuzey kendi UI'ini yeniler). */
  function onChange(fn) {
    if (typeof fn === 'function') listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function notify() {
    for (const fn of [...listeners]) {
      try { fn(lang); } catch { /* yoksay */ }
    }
  }

  /** Storage'dan gelen dil degisimini ic dile uygula + abonelere bildir. */
  function watchStorage() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes && changes[KEY]) {
          const next = resolve(changes[KEY].newValue);
          if (next !== lang) { lang = next; notify(); }
        }
      });
    } catch { /* yoksay */ }
  }

  function t(key, vars) {
    const table = STRINGS[lang] || {};
    let out = Object.hasOwn(table, key) ? table[key] : (STRINGS.en[key] ?? key);
    if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
    return out;
  }

  /** data-i18n (metin), data-i18n-aria, data-i18n-title, data-i18n-ph (placeholder). */
  function applyStatic(root = document) {
    for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
    for (const el of root.querySelectorAll('[data-i18n-title]')) el.setAttribute('title', t(el.dataset.i18nTitle));
    for (const el of root.querySelectorAll('[data-i18n-ph]')) el.setAttribute('placeholder', t(el.dataset.i18nPh));
  }

  async function init(root) {
    await get();
    try {
      if (root === undefined) root = typeof document !== 'undefined' ? document : null;
      if (root !== null) applyStatic(root);
      if (typeof document !== 'undefined') document.documentElement.lang = lang;
    } catch { /* service worker: DOM yok */ }
    return lang;
  }

  const STRINGS = { en: {}, tr: {}, de: {}, es: {}, fr: {}, it: {}, 'pt-BR': {}, ru: {}, pl: {}, nl: {}, 'zh-CN': {}, ja: {}, ko: {} };
  return { LANGUAGES, CODES, KEY, get, set, t, applyStatic, init, onChange, watchStorage, STRINGS,
    /** Synchronous language pinning for tests (storageless vm environments). */
    __testLang(code) { if (CODES.has(code)) lang = code; return lang; },
    get lang() { return lang; } };
})();
