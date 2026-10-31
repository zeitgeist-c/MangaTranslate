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
