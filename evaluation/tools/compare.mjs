import { readFile, writeFile } from 'node:fs/promises';
import { compareDetectors } from '../lib/comparison.mjs';
const [groupFile, lineFile, outputFile] = process.argv.slice(2);
if (!groupFile || !lineFile || !outputFile) throw new Error('Usage: node tools/compare.mjs GROUP_REPORT LINE_REPORT OUTPUT_JSON');
const [groups, lines] = await Promise.all([groupFile, lineFile].map(async file => JSON.parse(await readFile(file, 'utf8'))));
const report = compareDetectors(groups, lines);
await writeFile(outputFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, items: undefined }, null, 2));
