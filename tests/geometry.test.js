const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/background.js'), 'utf8');
const chrome = {
  runtime: { onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener() {} } },
  alarms: { onAlarm: { addListener() {} } },
  storage: { session: { get: async () => ({}), set: async () => {} } },
};
const context = vm.createContext({
  chrome, console, AbortController, setTimeout, clearTimeout,
  fetch: async () => { throw new Error('geometry testlerinde ag kullanilmaz'); },
});
vm.runInContext(source, context);

(function () {
  // vm dunyasindan gelen nesnelerin prototipi farklidir; karsilastirma icin normalize et
  const plain = (v) => JSON.parse(JSON.stringify(v));

  // ── clampInt ─────────────────────────────────────────────────────────────
  assert.equal(context.clampInt(5, 0, 10), 5);
  assert.equal(context.clampInt(-3, 0, 10), 0);
  assert.equal(context.clampInt(99, 0, 10), 10);
  assert.equal(context.clampInt('abc', 2, 9), 2, 'sayi degilse alt sinir');

  // ── fitBubbleBoxToImage: goruntu ici kutu aynen gecer ─────────────────────
  assert.deepEqual(
    plain(context.fitBubbleBoxToImage(10, 20, 100, 50, 800, 600)),
    { x: 10, y: 20, width: 100, height: 50, adjusted: false },
  );

  // ── negatif koken sifira cekilir ──────────────────────────────────────────
  const neg = context.fitBubbleBoxToImage(-30, -10, 100, 50, 800, 600);
  assert.equal(neg.x, 0);
  assert.equal(neg.y, 0);
  assert.equal(neg.adjusted, true);

  // ── sag/alt tasma goruntu icine sigdirilir ────────────────────────────────
  const over = context.fitBubbleBoxToImage(750, 570, 100, 50, 800, 600);
  assert.equal(over.x, 700);
  assert.equal(over.y, 550);
  assert.equal(over.adjusted, true);

  // ── tamamen disaridaki kutu atilir ────────────────────────────────────────
  assert.equal(context.fitBubbleBoxToImage(900, 700, 50, 50, 800, 600), null);
  assert.equal(context.fitBubbleBoxToImage('x', 10, 50, 50, 800, 600), null);

  // ── sifir olcu kalan alana genisler ───────────────────────────────────────
  const zero = context.fitBubbleBoxToImage(10, 10, 0, 0, 800, 600);
  assert.equal(zero.width, 790);
  assert.equal(zero.height, 590);

  // ── validateBubbles: gecerli balon korunur ────────────────────────────────
  const ok = context.validateBubbles(
    [{ text: 'Hi', translation: 'Merhaba', x: 10, y: 10, width: 100, height: 40 }],
    800, 600,
  );
  assert.equal(ok.length, 1);
  assert.equal(ok[0].text, 'Hi');
  assert.equal(ok[0].translation, 'Merhaba');

  // ── bos metin + gecersiz girdi elenir ─────────────────────────────────────
  assert.deepEqual(
    plain(context.validateBubbles(
      [{ text: '', translation: '', x: 10, y: 10, width: 100, height: 40 }, null, 'x', 5],
      800, 600,
    )),
    [],
  );

  // ── goruntu disi balon elenir, uzun metin 200 karaktere kirpilir ──────────
  assert.deepEqual(
    plain(context.validateBubbles([{ text: 'Hi', x: 900, y: 700, width: 50, height: 50 }], 800, 600)),
    [],
  );
  const long = context.validateBubbles(
    [{ text: 'a'.repeat(500), x: 10, y: 10, width: 100, height: 40 }],
    800, 600,
  );
  assert.equal(long.length, 1);
  assert.equal(long[0].text.length, 200);

  console.log('Geometri (clamp/fit/validate) testleri gecti.');
})();
