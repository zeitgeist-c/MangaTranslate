# MangaLens TR v1.0 — Selection Mode

Google Chrome (Manifest V3) manga çeviri uzantısı.

## v1.0 Durumu (Backup)

**Çalışan:**
- Selection mode (mouse ile dikdörtgen çiz → alan capture → Google Gemini multimodal → Türkçe çeviri → overlay)
- Crop: sadece seçili alan AI'a gönderiliyor
- DPR-aware koordinat dönüşümü
- Watchdog: sayfa JS'i div'i silerse yeniden ekleme

**Çalışmayan / Sınırlar:**
- Tam sayfa otomatik çeviri (CORS tainted canvas nedeniyle)
- CORS olmayan sitelerde img.src değişmez, sadece overlay basılır

## Kurulum

1. `chrome://extensions` → Geliştirici modu AÇ
2. "Paketlenmemişi yükle" → `MangaTranslate` klasörünü seç
3. Manga sitesi aç → popup'ta "Alan Seç ve Çevir" → dikdörtgen çiz → Enter

## Teknik

- **AI:** Google Gemini 3.1 Flash Lite (`gemini-3.1-flash-lite`)
- **API key:** Hardcoded background.js'te (kullanıcı kendi key'ini ekleyebilir)
- **Prompt:** Manga panel analizi + Türkçe çeviri (boşluk SFX dahil)
- **Overlay:** Inline style + all:initial + z-index:max (site CSS'ini bypass)

## Dosya Yapısı

```
src/
  background.js  — multimodal API, capture tab
  content.js    — selection mode, overlay render
popup/
  popup.html    — ayar paneli
  popup.js      — ayar handler'ları
  style.css     — stiller
manifest.json
```

## Notlar

- API key'i kendi Gemini key'inle değiştir: `src/background.js` içinde `GEMINI_API_KEY`
- v2'de tam otomatik mod (sayfa açılınca otomatik çeviri) hedefleniyor
