#!/bin/bash
# dosya: setup.sh
# MangaLens TR — Gerekli kütüphaneleri indir (macOS / Linux)
# Terminal'de: chmod +x setup.sh && ./setup.sh

echo "MangaLens TR — Kütüphaneler indiriliyor..."
echo ""

mkdir -p lib

echo "[1/3] Tesseract.js ana dosyası..."
curl -L "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js" -o lib/tesseract.min.js
echo "  → $(du -h lib/tesseract.min.js | cut -f1)"

echo "[2/3] Tesseract.js worker dosyası..."
curl -L "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js" -o lib/tesseract.worker.min.js
echo "  → $(du -h lib/tesseract.worker.min.js | cut -f1)"

echo "[3/3] Tesseract.js WASM core dosyası..."
curl -L "https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js" -o lib/tesseract-core.wasm.js
echo "  → $(du -h lib/tesseract-core.wasm.js | cut -f1)"

echo ""
echo "✅ Kurulum tamamlandı!"
echo "   Chrome'da chrome://extensions açın ve eklentiyi yeniden yükleyin."
