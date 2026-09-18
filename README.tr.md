# MangaTranslate (MangaLens TR) — İngilizce-Türkçe manga balon çevirisi

> English: [README.md](./README.md)

Chrome Manifest V3 uzantısı. Manga/manhwa/manhua sitelerindeki İngilizce konuşma balonlarını Gemini API ile Türkçe'ye çevirir — alan seçimi, oto çeviri, alternatif varyantlar, hız sınırlı kuyruk.

![MangaTranslate ekran görüntüleri](./docs/screenshots/)

> Ekran görüntüleri temiz kurulumdan ekleniyor (örnek veri yok). Yukarıdaki klasöre konacak.

## Kurulum

1. `MangaLensTR-3.1.3.zip` klasöre çıkarılır.
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
- **Model seçimi** — varsayılan `gemini-3.5-flash-lite`, yedek `gemini-3.1-flash-lite`, ek **Gemma 4 31B**; seçili model başarısız olursa modeller sırayla otomatik denenir.
- **Dayanıklı yakalama** — seçilen alan, sekme görüntüsünden yüksek çözünürlükte kırpılır (bölge ekranda görünür olmalı).
- **İstek kuyruğu** — min 6 sn aralık; 429/kota ve zaman aşımında 30→120 sn backoff (en fazla 3 tekrar), 45 sn zaman aşımı; ağ hatası hızlı başarısız olur.
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
