import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server.mjs';
test('evaluation server rejects cross-origin writes and never serves the repository backup', async () => {
  const server = await startServer(0), origin = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(origin)).status, 200);
    assert.equal((await fetch(`${origin}/%2e%2e/.rollback/2026-10-13-before-page-mode/checkpoint.json`)).status, 404);
    const reject = await fetch(`${origin}/api/labels`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' }, body: '{}' });
    assert.equal(reject.status, 403);
    const invalid = await fetch(`${origin}/api/labels`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ imageId: '../escape', width: 100, height: 100, reviewStatus: 'human-reviewed', regions: [], bubbles: [] }) });
    assert.equal(invalid.status, 400);
    const missing = await fetch(`${origin}/api/labels/${'0'.repeat(64)}`);
    assert.equal(missing.status, 200); assert.equal(await missing.json(), null);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
