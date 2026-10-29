import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// AUD-MANGA-001: dil degisimi tum acik yuzeylere yayilmali.
// MLI18N.onChange aboneligi + watchStorage storage senkronu.
const sources = await Promise.all(
  ['i18n.js', 'i18n-strings.js', 'i18n-strings-content.js'].map(x => readFile(new URL('../src/' + x, import.meta.url), 'utf8'))
);

function fixture() {
  const data = {};
  const listeners = [];
  const context = vm.createContext({
    chrome: {
      storage: {
        sync: {
          get: async (keys) => ({ ...keys, ...data }),
          set: async (patch) => { Object.assign(data, patch); },
        },
        onChanged: { addListener: (fn) => listeners.push(fn) },
      },
    },
  });
  sources.forEach(s => vm.runInContext(s, context));
  vm.runInContext('MLI18N.watchStorage()', context);
  return {
    context, data, listeners,
    fire(changes) { listeners.forEach(fn => fn(changes, 'sync')); },
    lang() { return vm.runInContext('MLI18N.lang', context); },
  };
}

test('set() abonelere bildirir', () => {
  const f = fixture();
  // dogrudan cagir: onChange kaydi context icinde yapilir
  vm.runInContext('globalThis.__seen = []; MLI18N.onChange(l => globalThis.__seen.push(l)); MLI18N.set("de");', f.context);
  const seenIn = vm.runInContext('globalThis.__seen', f.context);
  assert.deepEqual([...seenIn], ['de']);
  assert.equal(f.data.uiLanguage, 'de');
});

test('storage degisimi dili gunceller ve bildirir', () => {
  const f = fixture();
  vm.runInContext('globalThis.__seen = []; MLI18N.onChange(l => globalThis.__seen.push(l));', f.context);
  f.fire({ uiLanguage: { newValue: 'ja' } });
  assert.equal(f.lang(), 'ja');
  const seenIn = vm.runInContext('globalThis.__seen', f.context);
  assert.deepEqual([...seenIn], ['ja']);
});

test('bilinmeyen kod ingilizceye duser', () => {
  const f = fixture();
  vm.runInContext('MLI18N.set("xx")', f.context);
  assert.equal(f.lang(), 'en');
});
