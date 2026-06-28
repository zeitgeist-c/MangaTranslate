# MangaLens TR — Düzeltme Planı

## 🔴 KRİTİK (4 adet)

### FIX-01: Event listener sızıntısı — `content.js`
- **Dosya:** `src/content.js`
- **Satır:** `exitSelectionMode()` fonksiyonu (~783-786)
- **Sorun:** `enterSelectionMode`'da listenerlar `true` (capture) flag'iyle ekleniyor
  ama `exitSelectionMode`'da flag olmadan kaldırılıyor → hiçbir zaman temizlenmiyor.
- **Düzeltme:** `removeEventListener` çağrılarına `true` flag'i ekle.

### FIX-02: Device Pixel Ratio hatası — `content.js`
- **Dosya:** `src/content.js`
- **Fonksiyon:** `captureArea()`
- **Sorun:** `captureVisibleTab()` gerçek piksel cinsinden döner (DPR=2 ekranda 2x büyük).
  `captureArea` DPR'ı hesaba katmadan `area.x/y` koordinatlarını kullanır → yanlış kırpma.
- **Düzeltme:** `window.devicePixelRatio` ile koordinatları ve canvas boyutlarını ölçekle.

### FIX-03: Tesseract `corePath` + `workerBlobURL` eksikliği — `content.js` + `manifest.json`
- **Dosya:** `src/content.js`, `manifest.json`, `setup.bat`, `setup.sh`
- **Sorun:** MV3'te blob URL'ler kısıtlı; `corePath` verilmezse CDN'den çekmeye çalışır
  ama CSP engeller.
- **Düzeltme:**
  - `initTesseract`'a `corePath` ve `workerBlobURL: false` ekle.
  - `manifest.json` `web_accessible_resources`'a `tesseract-core.wasm.js` ekle.
  - `setup.bat` ve `setup.sh`'a core dosyası indirme adımı ekle.

### FIX-04: Service Worker state kaybı — `background.js`
- **Dosya:** `src/background.js`
- **Sorun:** MV3 service worker ~30sn boşlukta uyur; `activeRequests` ve `requestQueue`
  sıfırlanır, kuyrukta bekleyen istekler kaybolur.
- **Düzeltme:** `chrome.storage.session` ile kuyruk durumunu kalıcı hale getir;
  alternatif olarak her istek için bağımsız hata yakalama + retry ekle.

---

## 🟡 ÖNEMLİ (6 adet)

### FIX-05: `removeArea()` index kayması — `content.js`
- **Sorun:** Silme sonrası `querySelectorAll` kalan DOM elemanlarını döndürür,
  index'ler `selectedAreas` array'iyle uyuşmaz.
- **Düzeltme:** Her kutuya `data-area-index` attribute'u ekle; DOM sırasına güvenme.

### FIX-06: `setupUrlObserver` gereksiz tetiklenme — `content.js`
- **Sorun:** Observer, MangaLens'in kendi eklediği DOM mutasyonlarında da tetiklenebilir.
- **Düzeltme:** Observer'ı sadece `<title>` veya `<meta>` değişikliklerini izleyecek
  şekilde daralt; body subtree izlemeyi kaldır.

### FIX-07: `cacheEnabled` ayarı kullanılmıyor — `content.js`
- **Sorun:** Popup'ta kaydedilen `cacheEnabled` ayarı `fetchTranslations()`'da
  hiç okunmuyor.
- **Düzeltme:** `fetchTranslations()` içinde settings'ten `cacheEnabled` oku,
  false ise önbelleği atla.

### FIX-08: `SETTINGS_UPDATED` quality class'larını siliyor — `content.js`
- **Sorun:** Overlay stili güncellenirken `el.className` tamamen yeniden yazılıyor,
  `mangalens-quality-*` class'ları kayboluyor.
- **Düzeltme:** Sadece style class'ını regex ile değiştir.

### FIX-09: `imgKey` rastgele fallback — `content.js`
- **Sorun:** `img.src` boşsa her çağrıda farklı key üretiliyor → duplicate overlay.
- **Düzeltme:** `WeakMap` kullan; ilk görüldüğünde key üret ve sakla.

### FIX-10: `processingSet` src çakışması — `content.js`
- **Sorun:** Aynı `src`'ye sahip farklı `<img>` elementleri biri işlenince diğeri atlanıyor.
- **Düzeltme:** `processingSet`'i `img.src` yerine `img` referansı ile kullan.

---

## 🟢 MİNÖR (3 adet)

### FIX-11: `fitFontSize` maksimum sınırı — `content.js`
- **Sorun:** Max 15px manga sayfalarında küçük kalıyor.
- **Düzeltme:** `Math.max(9, Math.min(18, ...))` olarak güncelle.

### FIX-12: `isMangaImage` satır birleşimleri — `content.js`
- **Sorun:** 210. ve 214. satırlarda iki ifade aynı satırda; okunabilirlik sorunu.
- **Düzeltme:** Ayrı satırlara böl.

### FIX-13: `imgQueue` limiti için log uyarısı — `content.js`
- **Sorun:** 50 limit aşılınca görseller sessizce atlanıyor.
- **Düzeltme:** Limit aşılınca bir kez console.warn yaz.

---

## Uygulama Sırası

1. FIX-01 (kritik, kolay)
2. FIX-02 (kritik, kolay)
3. FIX-03 (kritik, setup gerektiriyor)
4. FIX-04 (kritik, background.js)
5. FIX-05 → FIX-10 (önemli, hepsi content.js)
6. FIX-11 → FIX-13 (minör, content.js)
