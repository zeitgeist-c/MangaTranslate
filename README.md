# MangaLens TR v2.3 — Gemini Görsel Çeviri

Google Chrome (Manifest V3) manga çeviri uzantısı.

## v2.3 Durumu

**Çalışan:**
- Google Gemini 3.1 Flash Lite (multimodal) ile görsel → balon bulma + Türkçe çeviri
- "Bu Sayfayı Otomatik Çevir" — viewport'taki manga sayfalarını 3×3 grid ile çevirir
- "Alan Seç ve Çevir" — manuel crop ile tek balon bölgesi çevirisi
- Rate limit yönetimi: 15 RPM için 4000 ms aralık + exponential backoff
- Per-page + per-cell cache (SHA-256, chrome.storage.local)
- Viewport-aware: scroll edilince yeni sayfaları çevirir, çevrilmiş sayfaları atlar
- Image-wrapper-level overlay: her manga img kendi overlay container'ında
- DPR-aware koordinat dönüşümü + scaleX/scaleY
- Watchdog + ResizeObserver: overlay sayfa scroll/resize'da img ile senkron

## Kurulum

1. `chrome://extensions` → Geliştirici modu AÇ
2. "Paketlenmemişi yükle" → `MangaTranslate` klasörünü seç
3. Manga sitesi aç → popup'ta "Bu Sayfayı Otomatik Çevir"
4. Bir manga sayfasına scroll et → tekrar "Bu Sayfayı Otomatik Çevir" (yeni sayfa çevrilir, eski cache'ten gelir)
5. Tüm çevirileri yeniden yapmak için "Yeniden Çevir (cache temizle)"

## Teknik

- **AI:** Google Gemini 3.1 Flash Lite (`gemini-3.1-flash-lite`) — multimodal native API
- **API key:** `src/background.js` içinde `GEMINI_API_KEY` hardcoded. Değiştirmek için düzenleyin.
- **Grid:** 3×3 parça, 16 px overlap
- **Rate limit:** Her istek arası 4000 ms (15 RPM güvenli). 429 alırsa 30s/60s/120s exponential backoff.
- **Cache:** `chrome.storage.local`, SHA-256 anahtarlı, `unlimitedStorage` izni
- **Overlay:** Img parent'ına `position:absolute`, scaleX/scaleY ile koordinat dönüşümü, ResizeObserver ile scroll/resize senkron

## Dosya Yapısı

```
src/
  background.js  — Gemini multimodal API, rate limit queue, cache
  content.js    — Selection mode + pageId bazlı viewport ceviri + overlay
  modules/       — yardımcı kodlar (constants, imagePipeline, canvasDraw, cache, observer, vb.)
popup/
  popup.html    — CTA butonları + basit ayar paneli
  popup.js      — handler'lar
  style.css     — stiller
manifest.json
```

## Git Tag'leri

- `v1.0-selection-mode` — İlk çalışan versiyon (selection mode)
- `v2.0-auto-page` — Otomatik grid ceviri + rate limit
- `v2.1-overlay-refactor` — Image-wrapper-level overlay
- `v2.2-pageid-viewport` — Viewport bazlı pageId cache
- `v2.3-gemini-only` — 9Router/OpenRouter kaldırıldı (bu versiyon)

Geri dönmek için: `git checkout <tag>`

## Notlar

- API key'i değiştirmek: `src/background.js` içinde `GEMINI_API_KEY` sabitini güncelle
- Cache temizleme: popup'taki "Yeniden Çevir" butonu veya `chrome://settings → Site ayarları → MangaTranslate → Depolama → Temizle`
- Rate limit nedeniyle 9 parçalık bir sayfa ~36 saniye sürer
