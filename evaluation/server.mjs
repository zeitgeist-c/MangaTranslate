import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir, stat, realpath } from 'node:fs/promises';
import { resolve, dirname, extname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { box } from './lib/geometry.mjs';
const root = dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream' };
const inside = path => { const p = relative(root, path); return !p.startsWith('..') && !isAbsolute(p); };
export async function startServer(port = 8766) {
  const server = createServer(async (req, res) => {
    try {
      const localOrigin = `http://127.0.0.1:${server.address().port}`;
      if (req.headers.host !== `127.0.0.1:${server.address().port}`) { res.writeHead(403); res.end(); return; }
      const url = new URL(req.url, localOrigin);
      if (url.pathname === '/favicon.ico' && req.method === 'GET') { res.writeHead(204); res.end(); return; }
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'");
      if (/^\/api\/labels\/[a-f0-9]{64}$/.test(url.pathname) && req.method === 'GET') {
        const id = url.pathname.split('/').at(-1);
        const labels = await readFile(resolve(root, '.local/labels', `${id}.json`), 'utf8').catch(e => { if (e.code !== 'ENOENT') throw e; return 'null'; });
        res.setHeader('Content-Type', types['.json']); res.end(labels); return;
      }
      if (url.pathname === '/api/datasets' && req.method === 'GET') {
        const datasets = [];
        for (const dir of await readdir(resolve(root, '.local'), { withFileTypes: true }).catch(() => [])) {
          if (!dir.isDirectory() || !/^chapter-\d+$/.test(dir.name)) continue;
          const manifest = JSON.parse(await readFile(resolve(root, '.local', dir.name, 'manifest.json'), 'utf8'));
          datasets.push({ name: dir.name, ...manifest });
        }
        res.setHeader('Content-Type', types['.json']); res.end(JSON.stringify(datasets)); return;
      }
      if (url.pathname.startsWith('/api/') && req.method === 'POST') {
        if (req.headers.origin !== localOrigin || req.headers['content-type'] !== 'application/json') { res.writeHead(403); res.end(); return; }
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > 10_000_000) throw new Error('Request too large'); chunks.push(chunk); }
        const data = JSON.parse(Buffer.concat(chunks));
        if (!/^[a-f0-9]{64}$/.test(data.imageId)) throw new Error('Invalid imageId');
        let file;
        if (url.pathname === '/api/report') {
          if (!['rtdetr-int8', 'rtdetr-fp32', 'rtdetr-v4-small', 'rtdetr-v4-small-gpu', 'ppocrv5-mobile-det'].includes(data.modelId) || !['wasm', 'webgpu'].includes(data.backend) || !Array.isArray(data.regions)) throw new Error('Invalid report');
          file = `reports/${data.imageId}-${data.modelId}-${data.backend}.json`;
        } else if (url.pathname === '/api/labels') {
          if (!Array.isArray(data.regions) || !Array.isArray(data.bubbles) || !Number.isSafeInteger(data.width) || !Number.isSafeInteger(data.height) || data.width < 1 || data.height < 1 ||
              !['unreviewed', 'human-reviewed'].includes(data.reviewStatus)) throw new Error('Invalid labels');
          const ids = new Set();
          for (const r of [...data.regions, ...data.bubbles]) {
            const id = r.id; if (typeof id !== 'string' || ids.has(id)) throw new Error('Duplicate or missing label id'); ids.add(id);
            const bounds = box(r.textBox ?? r.box);
            if (bounds[0] < 0 || bounds[1] < 0 || bounds[2] > data.width || bounds[3] > data.height) throw new Error('Label outside image');
          }
          for (const r of data.regions) if (r.bubbleId != null && !data.bubbles.some(b => b.id === r.bubbleId)) throw new Error('Unknown bubble id');
          file = `.local/labels/${data.imageId}.json`;
        } else { res.writeHead(404); res.end(); return; }
        const path = resolve(root, file); await mkdir(dirname(path), { recursive: true });
        await writeFile(path, JSON.stringify(data, null, 2));
        res.setHeader('Content-Type', types['.json']); res.end(JSON.stringify({ saved: file })); return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
      const file = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!inside(file) || !inside(await realpath(file))) { res.writeHead(403); res.end(); return; }
      const fileStat = await stat(file);
      if (!fileStat.isFile()) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
      res.setHeader('Content-Length', fileStat.size);
      if (req.method === 'HEAD') res.end(); else res.end(await readFile(file));
    } catch (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(error.code === 'ENOENT' ? 'Not found' : error.message);
    }
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(port, '127.0.0.1', yes); });
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await startServer(Number(process.env.PORT ?? 8766));
  console.log(`MangaLens tespit laboratuvarı: http://127.0.0.1:${server.address().port}`);
}
