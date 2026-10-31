import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { interior, wrapText, fuseGroups, fitText } from '../src/page/layout.mjs';
const context = vm.createContext({});
for (const f of ['i18n.js','i18n-strings-all.js','providers.js']) vm.runInContext(await readFile(new URL('../src/'+f, import.meta.url), 'utf8'), context);
vm.runInContext("MLI18N.__testLang('tr')", context);
const providers = context.MLProviders;
test('providers preserve separate selected models and require explicit contributor consent', () => {
  assert.equal(providers.settings({}).provider, 'gemini');
  assert.equal(providers.settings({ translationProvider: 'openrouter' }).model, 'openai/gpt-6-luna');
  assert.throws(() => providers.settings({ translationProvider: 'openrouter', openrouterModel: 'anthropic/claude-haiku-4.5' }), /desteklenmiyor/);
  assert.throws(() => providers.settings({ translationProvider: 'openrouter', openrouterModel: 'meta/muse-spark-1.3-contributor' }), /onaylayın/);
  assert.equal(providers.settings({ translationProvider: 'openrouter', openrouterModel: 'meta/muse-spark-1.3-contributor', contributorConsent: true }).provider, 'openrouter');
});
test('ollama provider validates models and builds native chat bodies', () => {
  assert.equal(providers.settings({}).provider, 'gemini');
  assert.equal(providers.settings({ translationProvider: 'ollama' }).model, 'gemma4:31b');
  assert.equal(providers.settings({ translationProvider: 'ollama', ollamaModel: 'gemma4:31b' }).model, 'gemma4:31b');
  assert.throws(() => providers.settings({ translationProvider: 'ollama', ollamaModel: 'openai/gpt-6-luna' }), /desteklenmiyor/);
  assert.equal(providers.providerModelKey('ollama'), 'ollamaModel');
  assert.equal(providers.providerModelKey('openrouter'), 'openrouterModel');
  assert.equal(providers.providerModelKey('gemini'), 'geminiModel');
  const mg = providers.migrate({ translationProvider: 'ollama', ollamaModel: 'gemma4:31b' });
  assert.equal(mg.provider, 'ollama'); assert.equal(mg.model, 'gemma4:31b'); assert.equal(mg.migrated, false);
  assert.equal(providers.migrate({ translationProvider: 'ollama', ollamaModel: 'gpt-oss:20b' }).migrated, true);
  const body = providers.ollamaBody('gemma4:31b', 'Translate', [{ regionId: 'r1', dataUrl: 'data:image/png;base64,AAAA' }, { regionId: 'r2', dataUrl: 'data:image/jpeg;base64,BBBB' }]);
  assert.equal(body.model, 'gemma4:31b'); assert.equal(body.stream, false); assert.equal(body.format, 'json');
  assert.equal(JSON.stringify(body.messages[0].images), JSON.stringify(['AAAA', 'BBBB']));
  assert.ok(body.messages[0].content.includes('regionId=r1') && body.messages[0].content.includes('regionId=r2'));
  assert.throws(() => providers.ollamaBody('openai/gpt-6-luna', '', []), /Bilinmeyen Ollama/);
  const policy = providers.ollamaPolicy('gemma4:31b');
  assert.equal(policy.maxRegions, 12);  assert.ok(policy.timeoutMs >= 60000);
});
test('removed models migrate openly to the provider default', () => {
  const moved = what => { const m = providers.migrate(what); return [m.provider, m.model, m.migrated]; };
  assert.deepEqual(moved({ translationProvider: 'openrouter', openrouterModel: 'openai/gpt-6-luna' }), ['openrouter', 'openai/gpt-6-luna', false]);
  assert.deepEqual(moved({ translationProvider: 'openrouter', openrouterModel: 'deepseek/deepseek-v4.1-flash' }), ['openrouter', 'openai/gpt-6-luna', true]);
  assert.equal(providers.migrate({ translationProvider: 'openrouter', openrouterModel: 'meta/muse-spark-1.3-contributor' }).migrated, false);
  assert.deepEqual(moved({}), ['gemini', 'gemini-3.5-flash-lite', true]);
  assert.equal(providers.migrate({ translationProvider: 'gemini', geminiModel: 'gemma-4-26b-a4b-it' }).migrated, false);
});
test('gemini fallback chain follows catalog order and stays opt-in', () => {
  assert.equal(providers.nextGeminiModel('gemini-3.5-flash-lite'), 'gemini-3.1-flash-lite');
  assert.equal(providers.nextGeminiModel('gemini-3.1-flash-lite'), 'gemma-4-26b-a4b-it');
  assert.equal(providers.nextGeminiModel('gemma-4-26b-a4b-it'), null);
  assert.equal(providers.nextGeminiModel('unknown'), null);
  assert.equal(providers.settings({}).geminiFallback, false);
  assert.equal(providers.settings({ translationProvider: 'gemini', geminiFallback: true }).geminiFallback, true);
});
test('translation association uses identity even with shuffled replies; missing/duplicate IDs fail', () => {
  const values = [{ regionId: 'b', sourceText: 'English', status: 'translated', translatedText: 'Türkçe' }, { regionId: 'a', sourceText: '', status: 'unreadable', translatedText: '' }];
  assert.deepEqual(Array.from(providers.parse('<think>reasoning</think>' + JSON.stringify({ regions: values }), ['a', 'b']), r => r.regionId), ['a', 'b']);
  assert.throws(() => providers.parse(JSON.stringify({ regions: [values[0], values[0]] }), ['a', 'b']), /kimlik/);
  assert.throws(() => providers.parse(JSON.stringify({ regions: [values[0]] }), ['a', 'b']), /sayısı/);
  assert.throws(() => providers.parse(JSON.stringify({ regions: [{ ...values[1], translatedText: 'uydurma' }] }), ['a']), /Geçersiz/);
});
test('router sends chosen model only, vision crops and JSON without silent provider fallback', () => {
  const config = providers.settings({ translationProvider: 'openrouter' });
  const request = providers.routerBody(config.model, providers.prompt(config, [{ regionId: 'x' }]), [{ regionId: 'x', dataUrl: 'data:image/png;base64,AAAA' }]);
  assert.equal(request.model, config.model); assert.equal(request.provider.allow_fallbacks, false);
  assert.equal(request.messages[0].content.at(-1).type, 'image_url');
  assert.ok(request.messages[0].content[0].text.includes('Never invent unreadable text'));
});

test('one malformed field is review-only in batch mode; valid neighbors stay usable', () => {
  const raw=JSON.stringify({regions:[{regionId:'a',sourceText:'Hi',translatedText:'Merhaba',status:' TRANSLATED '},
    {regionId:'b',sourceText:null,translatedText:12,status:'translated'}]});
  const values=providers.parse(raw,['a','b'],true);
  assert.equal(values[0].translatedText,'Merhaba');assert.equal(values[0].status,'translated');
  assert.equal(values[1].status,'unreadable');assert.equal(values[1].translatedText,'');assert.equal(values[1].validationError,'invalid_translation_result');
  assert.throws(()=>providers.parse(raw,['a','b']),/Geçersiz/);
});

test('partial batch mode never guesses missing or duplicate identities and null unreadable text is normalized',()=>{
  assert.throws(()=>providers.parse('{"regions":[{"regionId":"x"}]}',['a'],true),/kimlik/);
  assert.throws(()=>providers.parse('{"regions":[]}',['a'],true),/sayısı/);
  const value=providers.parse('{"regions":[{"regionId":"a","sourceText":null,"translatedText":null,"status":"Unreadable"}]}',['a'],true)[0];
  assert.equal(value.sourceText,'');assert.equal(value.translatedText,'');assert.equal(value.validationError,undefined);
});

test('schema is restricted to supported batch models; manual crop keeps its separate output contract',()=>{
  const images=[{regionId:'a',dataUrl:'data:image/png;base64,AAAA'}];
  for(const model of ['openai/gpt-6-luna']){
    const batch=providers.routerBody(model,'JSON',images,16384,true);
    assert.equal(batch.response_format.type,'json_schema');assert.equal(batch.response_format.json_schema.strict,true);
    assert.deepEqual(Array.from(batch.response_format.json_schema.schema.properties.regions.items.properties.regionId.enum),['a']);
    assert.equal(providers.routerBody(model,'JSON',images).response_format.type,'json_object');
  }
  assert.equal(providers.routerBody('google/gemma-4-26b-a4b-it','JSON',images,8192,true).response_format.type,'json_object');
});
test('independent uncovered lines remain reviewable; no guessed bubble assignment', () => {
  const result = fuseGroups({ regions: [], bubbles: [] }, { regions: [{ regionId: 'x', textBox: [1, 1, 10, 10] }] });
  assert.equal(result.length, 1); assert.equal(result[0].needsReview, true);
});
test('flat interior accepts safe ink holes, refuses colorful art and border crossing', () => {
  const pixels = new Uint8ClampedArray(100 * 100 * 4).fill(255);
  for (let y = 40; y < 50; y++) for (let x = 40; x < 50; x++) { const i = (y * 100 + x) * 4; pixels[i] = pixels[i + 1] = pixels[i + 2] = 0; }
  const shape = interior(pixels, 100, 100, [35, 35, 60, 60]); assert.ok(shape); assert.ok(shape.rows[45]);
  for (let y = 35; y < 60; y++) for (let x = 35; x < 60; x++) pixels[(y * 100 + x) * 4] = 150;
  assert.equal(interior(pixels, 100, 100, [35, 35, 60, 60]), null);
});
test('Turkish layout never truncates or silently shrinks below minimum', () => {
  assert.equal(wrapText('sığmayacak', text => text.length * 10, 20), null);
  const ctx = { canvas: { width: 100 }, measureText: text => ({ width: text.length * 10 }) };
  assert.equal(fitText(ctx, 'çok uzun bir metin', { rows: Array(20).fill([0, 20]) }, [0, 0, 20, 20], 12), null);
});
test('verified uniform tinted background retains its actual color; textured gradients fail', () => {
  const pixels = new Uint8ClampedArray(100 * 100 * 4);
  for (let p = 0; p < pixels.length; p += 4) pixels.set([150, 210, 240, 255], p);
  const shape = interior(pixels, 100, 100, [30, 30, 70, 70]);
  assert.deepEqual(shape.background, [150, 210, 240]); assert.equal(shape.light, true);
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) pixels.set([x * 2, y * 2, 100, 255], (y * 100 + x) * 4);
  assert.equal(interior(pixels, 100, 100, [30, 30, 70, 70]), null);
});
