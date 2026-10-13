import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chapter = process.argv[2];
if (!chapter || new URL(chapter).origin !== 'https://asurascans.com') throw new Error('Pass a public https://asurascans.com chapter URL');
const slug = new URL(chapter).pathname.split('/').filter(Boolean).at(-1);
if (!/^\d+$/.test(slug)) throw new Error('Numeric chapter URL required');
const out = resolve(root, '.local', `chapter-${slug}`);
await mkdir(out, { recursive: true });
const previous = await readFile(resolve(out, 'manifest.json'), 'utf8').then(JSON.parse).catch(error => {
  if (error.code !== 'ENOENT') throw error; return null;
});
if (previous && previous.source !== chapter) throw new Error('Chapter directory belongs to another source; use a separate dataset directory.');
const response = await fetch(chapter, { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`Chapter HTTP ${response.status}`);
const html = (await response.text()).replaceAll('&quot;', '"').replaceAll('&amp;', '&');
const urls = [...new Set(html.match(/https:\/\/cdn\.asurascans\.com\/asura-images\/chapters\/[^"\s<>\\]+\.(?:webp|png|jpe?g)(?:\?[^"\s<>\\]*)?/g) ?? [])];
if (!urls.length) throw new Error('No chapter images; site markup may have changed');
const pages = [];
for (const [index, url] of urls.entries()) {
  const extension = new URL(url).pathname.split('.').at(-1);
  const file = `${String(index + 1).padStart(3, '0')}.${extension}`;
  let bytes;
  try {
    bytes = await readFile(resolve(out, file));
    const known = previous?.pages.find(page => page.file === file);
    if (!known || known.url !== url || known.imageId !== createHash('sha256').update(bytes).digest('hex'))
      throw new Error(`Existing image cannot be verified against its source: ${file}`);
  }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const image = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!image.ok || !image.headers.get('content-type')?.startsWith('image/')) throw new Error(`Image ${index}: HTTP ${image.status}`);
    bytes = Buffer.from(await image.arrayBuffer());
    if (bytes.length > 50_000_000) throw new Error('Image too large');
    await writeFile(resolve(out, file), bytes, { flag: 'wx' });
  }
  pages.push({ file, url, imageId: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
    sourceGroup: new URL(chapter).pathname.split('/chapter/')[0], split: 'development', reviewStatus: 'unreviewed' });
}
const manifest = { schemaVersion: 1, collectedAt: new Date().toISOString(), source: chapter,
  note: 'Private local evaluation only; original art is not included in extension packages. No human-reviewed labels yet.', pages };
await writeFile(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ chapter, images: pages.length, bytes: pages.reduce((n, p) => n + p.bytes, 0), out }));
