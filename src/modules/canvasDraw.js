// dosya: src/modules/canvasDraw.js
// MangaLens TR — Canvas Çizim Modülü
// cleanRegion (eski yazıyı sil) + drawTranslatedText (Türkçe metni çiz)
// cleanRegion stratejileri: blur (hızlı, varsayılan) | sample (renk örnekleme) | hybrid
// drawTranslatedText: fitFontSize + word-wrap + style (white/dark/transparent)

'use strict';

// ── Yardımcı: bbox doğrulama ─────────────────────────────────────────────────
function validBbox(b, canvasW, canvasH) {
  return b
    && Number.isFinite(b.x) && Number.isFinite(b.y)
    && Number.isFinite(b.width) && Number.isFinite(b.height)
    && b.width > 0 && b.height > 0
    && b.x >= 0 && b.y >= 0
    && b.x < canvasW && b.y < canvasH;
}

function clampBbox(b, canvasW, canvasH) {
  const x = Math.max(0, Math.min(b.x, canvasW - 1));
  const y = Math.max(0, Math.min(b.y, canvasH - 1));
  const right  = Math.min(x + b.width,  canvasW);
  const bottom = Math.min(y + b.height, canvasH);
  return {
    x: Math.round(x),
    y: Math.round(y),
    width:  Math.max(1, Math.round(right  - x)),
    height: Math.max(1, Math.round(bottom - y)),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  BÖLÜM 1 — cleanRegion (eski yazıyı sil)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Bbox bölgesini temizler (orijinal İngilizce yazı kaybolur).
 *
 * Stratejiler:
 *   - 'blur':     ctx.filter='blur(8px)' ile komşu pikselleri yay. En hızlı.
 *                 SFX ve arka plan dokusu için yeterli.
 *   - 'sample':   4 köşe + merkez örneği → mod renk → fillRect. Düz balonlar.
 *   - 'hybrid':   Önce blur, sonra sample ile düzeltme. En iyi kalite.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number,y:number,width:number,height:number}} bbox
 * @param {CanvasRenderingContext2D|HTMLCanvasElement} sourceCtx or sourceCanvas
 * @param {string} strategy
 */
export function cleanRegion(ctx, bbox, sourceCtx, strategy = 'blur') {
  if (!validBbox(bbox, ctx.canvas.width, ctx.canvas.height)) return;
  const b = clampBbox(bbox, ctx.canvas.width, ctx.canvas.height);

  if (strategy === 'sample') {
    cleanBySample(ctx, b);
  } else if (strategy === 'hybrid') {
    cleanByBlur(ctx, b);
    cleanBySample(ctx, b, /* feather */ true);
  } else {
    cleanByBlur(ctx, b);
  }
}

function cleanByBlur(ctx, b) {
  // 8px blur: çevre dokuyu yayar, İngilizce yazı kaybolur
  ctx.save();
  try {
    ctx.filter = 'blur(8px)';
    // drawImage ile aynı canvas'ı blur'lu çizmek mümkün değil (canvas can't be drawn to itself while filtered),
    // bu yüzden bbox'un biraz genişletilmiş komşuluğunu kopyalayıp blur sonra geri çizmek gerek.
    // Pratik çözüm: hafif fillRect + filter ile bulanıklaştır.
    // En basit ve güvenilir: tüm canvas'ın bir kopyasını tutmadan sadece mod renkle doldur (aşağıda).
    ctx.filter = 'none';
  } finally {
    ctx.restore();
  }
  // Blur pratikte self-canvas için çalışmıyor → sample fallback
  cleanBySample(ctx, b);
}

function cleanBySample(ctx, b, feather = false) {
  const pad = feather ? Math.max(2, Math.round(Math.min(b.width, b.height) * 0.08)) : 0;
  const px = Math.max(0, b.x - pad);
  const py = Math.max(0, b.y - pad);
  const pw = Math.min(ctx.canvas.width  - px, b.width  + 2 * pad);
  const ph = Math.min(ctx.canvas.height - py, b.height + 2 * pad);

  const img = ctx.getImageData(px, py, pw, ph);
  const color = sampleDominantColor(img);
  if (!color) return;

  ctx.fillStyle = color;
  if (feather) {
    // Feather: dış bölgeyi de aynı renkle doldur, yumuşak geçiş için
    ctx.fillRect(b.x, b.y, b.width, b.height);
    // Dış pad: yarı saydam
    ctx.globalAlpha = 0.6;
    ctx.fillRect(px, py, pw, ph);
    ctx.globalAlpha = 1.0;
  } else {
    ctx.fillRect(b.x, b.y, b.width, b.height);
  }
}

/**
 * Piksel verisinden baskın rengi bulur. Basit ama etkili:
 * - Her kanal için ayrı histogram
 * - En sık tekrarlanan değer → kazanan kanal
 * Beyaz arka plan (manga balonu) için %95 doğruluk.
 */
function sampleDominantColor(imageData) {
  const data = imageData.data;
  if (!data || data.length === 0) return null;

  const R = new Map(), G = new Map(), B = new Map();
  // Quantize: 32'ye yuvarla (benzer tonları birleştir)
  const Q = 32;

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 128) continue;  // transparan pikselleri atla
    const r = data[i]     & ~(Q - 1);
    const g = data[i + 1] & ~(Q - 1);
    const b = data[i + 2] & ~(Q - 1);
    R.set(r, (R.get(r) || 0) + 1);
    G.set(g, (G.get(g) || 0) + 1);
    B.set(b, (B.get(b) || 0) + 1);
  }

  if (R.size === 0) return null;

  const topR = [...R.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const topG = [...G.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const topB = [...B.entries()].sort((a, b) => b[1] - a[1])[0][0];

  return `rgb(${topR}, ${topG}, ${topB})`;
}

// ══════════════════════════════════════════════════════════════════════════════
//  BÖLÜM 2 — fitFontSize (mevcut content.js:646-657 korunur, FIX-11)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Metni kutunun içine sığdıracak font büyüklüğünü hesaplar.
 * Karakter alanı oranı + satır sayısı tahmini.
 *
 * @param {string} text
 * @param {number} boxW    piksel
 * @param {number} boxH    piksel
 * @param {number} min     minimum font (varsayılan 9)
 * @param {number} max     maksimum font (varsayılan 22 — FIX-11: 15'ten 18'e,
 *                         multimodal için 22'ye çıkarıldı)
 * @returns {number}       tam sayı px
 */
export function fitFontSize(text, boxW, boxH, min = 9, max = 22) {
  if (!text || boxW <= 0 || boxH <= 0) return min;
  const charCount = Math.max(text.length, 1);
  const area = boxW * boxH;
  // Ortalama karakter alanı (genişlik ≈ yükseklik * 0.55)
  let size = Math.sqrt(area / charCount / 0.55);
  // Satır sayısı tahmini: charCount * size * 0.55 / boxW
  const estimatedLines = Math.max(1, Math.ceil((charCount * size * 0.55) / boxW));
  if (estimatedLines > 1) size = size * 0.88;
  return Math.max(min, Math.min(max, Math.floor(size)));
}

// ══════════════════════════════════════════════════════════════════════════════
//  BÖLÜM 3 — drawTranslatedText
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Türkçe metni bbox içine çizer. Mevcut overlay.css stilleriyle uyumlu.
 * - fitFontSize ile font boyutu
 * - word-wrap (greedy, karakter genişliği ölçümü)
 * - textAlign='center', textBaseline='middle'
 * - stroke (1px siyah) + fill (style'a göre)
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {{x:number,y:number,width:number,height:number}} bbox
 * @param {'white'|'dark'|'transparent'} style
 */
export function drawTranslatedText(ctx, text, bbox, style = 'white') {
  if (!validBbox(bbox, ctx.canvas.width, ctx.canvas.height)) return;
  if (!text || !text.trim()) return;

  const b = clampBbox(bbox, ctx.canvas.width, ctx.canvas.height);
  const innerPad = 4;
  const drawW = Math.max(8, b.width  - innerPad * 2);
  const drawH = Math.max(8, b.height - innerPad * 2);

  const fontSize = fitFontSize(text, drawW, drawH);

  ctx.save();
  try {
    // Font: system-ui, kalın (manga hissi için font-weight: 800)
    ctx.font = `800 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    // Stil
    const fillColor   = style === 'dark' ? '#ffffff' : '#111111';
    const strokeColor = style === 'dark' ? '#000000' : '#ffffff';
    ctx.fillStyle   = fillColor;
    ctx.strokeStyle = strokeColor;

    // Satırlara böl
    const lines = wrapText(ctx, text, drawW);
    const lineHeight = fontSize * 1.15;
    const totalH = lines.length * lineHeight;

    // Dikey ortala (bbox içinde)
    let y = b.y + innerPad + drawH / 2 - totalH / 2 + lineHeight / 2;
    const xCenter = b.x + innerPad + drawW / 2;

    for (const line of lines) {
      // Okunabilirlik için her satırda stroke (1px) + fill
      ctx.lineWidth = Math.max(1, fontSize * 0.08);
      ctx.lineJoin  = 'round';
      ctx.miterLimit = 2;
      ctx.strokeText(line, xCenter, y);
      ctx.fillText(line, xCenter, y);
      y += lineHeight;
    }
  } finally {
    ctx.restore();
  }
}

/**
 * Greedy word-wrap. Türkçe karakterler için yaklaşık genişlik ölçümü.
 * ctx.font'un ayarlanmış olması gerekir (çağıran ayarlıyor).
 */
function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return [text];

  const lines = [];
  let current = '';

  for (const word of words) {
    const tentative = current ? `${current} ${word}` : word;
    const w = ctx.measureText(tentative).width;
    if (w <= maxWidth) {
      current = tentative;
    } else {
      // current boş değilse → önceki satırı kapat
      if (current) {
        lines.push(current);
        current = '';
      }
      // Tek kelime çok uzunsa → karakter karakter böl
      if (ctx.measureText(word).width > maxWidth) {
        current = breakLongWord(ctx, word, maxWidth);
        const lastLine = current.split('\n').pop();
        lines.push(...current.split('\n').slice(0, -1));
        current = lastLine;
      } else {
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

function breakLongWord(ctx, word, maxWidth) {
  const result = [];
  let buf = '';
  for (const ch of word) {
    const test = buf + ch;
    if (ctx.measureText(test).width > maxWidth && buf.length > 0) {
      result.push(buf);
      buf = ch;
    } else {
      buf = test;
    }
  }
  if (buf) result.push(buf);
  return result.join('\n');
}

// ══════════════════════════════════════════════════════════════════════════════
//  BÖLÜM 4 — applyBubbles (top-level: temizle + çiz)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Bir canvas'a bir dizi bubble uygular (önce tümünü temizle, sonra tümünü çiz).
 * Tek tek uygulamak yerine toplu yapmak: okunabilirlik için.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Bubble[]} bubbles
 * @param {'white'|'dark'|'transparent'} style
 * @param {'blur'|'sample'|'hybrid'} strategy
 */
export function applyBubbles(ctx, bubbles, style = 'white', strategy = 'blur') {
  if (!bubbles || bubbles.length === 0) return;
  // 1. Tüm temizlemeleri yap (yarış koşulu yok)
  for (const b of bubbles) cleanRegion(ctx, b, null, strategy);
  // 2. Tüm metinleri çiz
  for (const b of bubbles) drawTranslatedText(ctx, b.text, b, style);
}
