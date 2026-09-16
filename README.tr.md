# MangaTranslate (MangaLens TR) — İngilizce-Türkçe manga balon çevirisi

> English: [README.md](./README.md)

Chrome Manifest V3 uzantısı. Manga/manhwa/manhua sitelerindeki İngilizce konuşma balonlarını Gemini API ile Türkçe'ye çevirir — alan seçimi, tek tuşla sayfa modu, oto çeviri, alternatif varyantlar, hız sınırlı kuyruk.

![MangaTranslate ekran görüntüleri](./docs/screenshots/)

> Ekran görüntüleri temiz kurulumdan ekleniyor (örnek veri yok). Yukarıdaki klasöre konacak.

## Kurulum

1. `MangaLensTR-3.2.0.zip` klasöre çıkarılır.
2. `chrome://extensions` → Geliştirici modu → Paketlenmemiş öğe yükle (`manifest.json` içeren klasör).
3. Popup → API sekmesi → en az 1 Gemini anahtarı ekle/test et/aktif yap.
4. Sayfada: Sayfayı Çevir / Alan Seç / Oto Çevir.

Paketleme: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\package.ps1` (sürümü manifest'ten okur, MV3 + JS doğrular, 12 dosyayı zipler).

## Özellikler

- **Sayfa modu (tek tuş)** — önce görünen sayfayı çevirir, kaydırdıkça devam eder (ya da tüm bölümü); her balonun üstüne yazısı otomatik sığan Türkçe kutu koyar, üzerine gelince İngilizce orijinal görünür, sonuçlar sayfa bazında önbelleğe alınır.
- **Balona oturtma (ek istek yok)** — kutular, resmin gerçek içerik alanı hesaplanarak (object-fit/kenarlık) yerel piksel analiziyle beyaz balon bölgesine oturtulur; kayma ve üst üste binme giderilir, Gemini kotası değişmez.
- **Alan seçimi** — en fazla 12 alan (min 24px), Enter ile toplu çeviri.
- **Oto çeviri** — çizilen her alan beklemeden çevrilir.
- **Alternatif varyant** — `Yeniden` önceki sonucu göndermeden görseli yeniden okur; 3 strateji (günlük dil / ton-duygu-bağlam / kısa balon uyumu), yüksek yaratıcılık yedek modelde.
- **Sonuç araçları** — her kutuda `Yeniden` + `×`.
- **Yazı boyutu** — 16px / 20px, tüm sonuçlara (`chrome.storage.sync`).
- **Çoklu anahtar** — Gemini anahtarı ekle/test/aktifleştir (`chrome.storage.local`).
- **Model seçimi** — varsayılan `gemini-3.5-flash-lite` / `gemini-3.1-flash-lite`; 3.5 hata verirse 1 kez 3.1 denemesi.
- **Dayanıklı yakalama** — orijinal görseli servis çalışanı indirir (CORS engeli yok), canvas okuyucular doğrudan okunur, görünür-alan kırpması son çaredir.
- **İstek kuyruğu** — min 6 sn aralık, 429/zaman aşımında 30→120 sn bekleme (ağ hatası hızlı başarısız olur), 45 sn zaman aşımı.
- **İstatistik** — dakika/gün/toplam sayaç, yalnız yerel.

## Proje yapısı

```text
manifest.json         MV3 (<all_urls> + generativelanguage host)
src/background.js     Gemini API, prompt'lar, kuyruk/hız sınırı, anahtarlar, sayfa önbelleği
src/content.js        alan seçimi, oto çeviri, yakalama, sonuç kutuları
src/pagemode-core.js  sayfa modu matematiği (bant, tekrar temizliği, koordinat) — SW + node testleri ile ortak
src/pagemode.js       sayfa modu: tarama, görsel alma, bindirme, ilerleme çubuğu
styles/pagemode.css   sayfa modu stilleri
popup/popup.html      Çeviri/API sekmeli arayüz
popup/popup.js        mod/tercih/istatistik/anahtar yönetimi
popup/style.css
assets/               ikonlar 16/48/128
tests/                node --test paketleri (saf mantık)
package.ps1           paketleme betiği
```

## Testler

```bash
node --test tests/*.test.js
```

## Katkı

Küçük PR, koda/örneğe API anahtarı konmaz. Bkz. [.github/PULL_REQUEST_TEMPLATE.md](./.github/PULL_REQUEST_TEMPLATE.md).

## Lisans

Bkz. [LICENSE](./LICENSE) (bekliyor — teyit edilecek).
