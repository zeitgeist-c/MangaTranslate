import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const src = (p) => readFile(new URL(`src/${p}`, root), 'utf8');

test('service worker scripts share one scope without redeclaration', async () => {
  const bg = await src('background.js');
  const m = bg.match(/importScripts\(([^)]+)\)/);
  assert.ok(m, 'background.js must declare its importScripts list');
  const files = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.ok(files.includes('page-background.js'));
  const parts = [];
  for (const f of files) parts.push(await src(f));
  parts.push(bg);
  const combined = parts.join('\n;\n');
  assert.doesNotThrow(
    () => new vm.Script(combined, { filename: 'service-worker-scope' }),
    'importScripts order must evaluate without SyntaxError (no duplicate lexical declarations)',
  );
  const tDecls = [...combined.matchAll(/^(?:const|let)\s+T\s*=/gm)].length;
  assert.equal(tDecls, 1, `expected exactly one top-level T declaration, found ${tDecls}`);
});

async function combinedScope(urls, filename) {
  const parts = [];
  for (const u of urls) parts.push(await readFile(new URL(u, root), 'utf8'));
  const combined = parts.join('\n;\n');
  assert.doesNotThrow(
    () => new vm.Script(combined, { filename }),
    `${filename} must evaluate without SyntaxError (no duplicate lexical declarations)`,
  );
  const tDecls = [...combined.matchAll(/^(?:const|let)\s+T\s*=/gm)].length;
  assert.equal(tDecls, 1, `${filename}: expected exactly one top-level T declaration, found ${tDecls}`);
  return combined;
}

test('popup scripts share one scope without redeclaration (popup.html order)', async () => {
  await combinedScope([
    'src/i18n.js',
    'src/i18n-strings-all.js',
    'src/providers.js',
    'popup/ui.js',
    'popup/popup.js',
  ], 'popup-scope');
});

test('settings scripts share one scope without redeclaration (settings.html order)', async () => {
  await combinedScope([
    'src/i18n.js',
    'src/i18n-strings-all.js',
    'src/providers.js',
    'popup/ui.js',
    'options/settings.js',
  ], 'settings-scope');
});
