# MangaTranslate (MangaLens TR) — İngilizce-Türkçe manga balon çevirisi

> English: [README.md](./README.md)

Chrome Manifest V3 uzantısı. Manga/manhwa/manhua sitelerindeki İngilizce konuşma balonlarını Gemini API ile Türkçe'ye çevirir — alan seçimi, oto çeviri, alternatif varyantlar, hız sınırlı kuyruk.

![MangaTranslate ekran görüntüleri](./docs/screenshots/)

> Ekran görüntüleri temiz kurulumdan ekleniyor (örnek veri yok). Yukarıdaki klasöre konacak.

## Kurulum

1. `MangaLensTR-3.1.4.zip` klasöre çıkarılır.
2. `chrome://extensions` → Geliştirici modu → Paketlenmemiş öğe yükle (`manifest.json` içeren klasör).
3. Popup → API sekmesi → en az 1 Gemini anahtarı ekle/test et/aktif yap.
4. Sayfada: Alan Seç veya Oto Çevir.

Paketleme: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\package.ps1` (sürümü manifest'ten okur, MV3 + JS doğrular, 9 dosyayı zipler).

## Özellikler

- **Alan seçimi** — en fazla 12 alan (min 24px), Enter ile toplu çeviri.
- **Oto çeviri** — çizilen her alan beklemeden çevrilir.
- **Alternatif varyant** — `Yeniden` önceki sonucu göndermeden görseli yeniden okur; 3 strateji (günlük dil / ton-duygu-bağlam / kısa balon uyumu), yüksek yaratıcılık.
- **Sonuç araçları** — her kutuda `Yeniden` + `×`.
- **Yazı boyutu** — 16px / 20px, tüm sonuçlara (`chrome.storage.sync`).
- **Çoklu anahtar** — Gemini anahtarı ekle/test/aktifleştir (`chrome.storage.local`).
- **Model seçimi** — varsayılan `gemini-3.5-flash-lite` (~1 sn/istek), ek `gemini-3.1-flash-lite` (~2 sn), **Gemma 4 26B A4B** (~4 sn) ve **Gemma 4 31B** (yavaş: 30-60 sn); seçili model başarısız olursa diğerleri sırayla, en hızlı önce denenir. Yavaş işaretli modelin ilk denemesi 12 sn'lik yumuşak tavanla kesilir; tavanı aşarsa model 10 dk boyunca zincirin sonuna alınır.
- **Dayanıklı yakalama** — seçilen alan, sekme görüntüsünden yüksek çözünürlükte kırpılır (bölge ekranda görünür olmalı).
- **İstek kuyruğu** — adaptif aralık (2.5 sn taban, 429'da 6→30 sn'ye çıkar, temiz geçişte azalır); 429/kota ve zaman aşımında 30→120 sn backoff (en fazla 3 tekrar), 45 sn sert zaman aşımı; ağ hatası hızlı başarısız olur. Kuyruk derinse içerik tarafı daha uzun bekler — sabit 75 sn yüzünden sonuç kaybı olmaz.
- **İstatistik** — dakika/gün/toplam sayaç, yalnız yerel.

## Proje yapısı

```text
manifest.json        MV3 (<all_urls> + generativelanguage host)
src/background.js    Gemini API, prompt stratejileri, kuyruk/hız sınırı, anahtarlar
src/content.js       alan seçimi, oto çeviri, yakalama, sonuç kutuları
popup/popup.html     Çeviri/API sekmeli arayüz
popup/popup.js       mod/tercih/istatistik/anahtar yönetimi
popup/style.css
assets/              ikonlar 16/48/128
package.ps1          paketleme betiği
```

## Katkı

Küçük PR, koda/örneğe API anahtarı konmaz. Bkz. [.github/PULL_REQUEST_TEMPLATE.md](./.github/PULL_REQUEST_TEMPLATE.md).

## Lisans

Bkz. [LICENSE](./LICENSE) (bekliyor — teyit edilecek).
