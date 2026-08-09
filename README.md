# MangaLens TR v3.1.1

Google Chrome Manifest V3 tabanlı manga, manhwa ve manhua görsel çeviri uzantısı.

## Özellikler

- **Alan Seç:** Manga görselinde bir veya daha fazla alan çizip Enter ile toplu çevirir.
- **Oto Çevir:** Çizilen her alanı beklemeden otomatik olarak çevirir.
- **Alternatif çeviri:** Sonuç kutusundaki `Yeniden` düğmesi kaynak görseli bağımsız yeniden okuyup farklı bir Türkçe çeviri stratejisi uygular.
- **Sonuç kontrolü:** Her sonuç kutusu `Yeniden` ve `×` araçlarına sahiptir.
- **Yazı boyutu:** Normal (16 px) ve Büyük (20 px) seçenekleri bütün sonuçlara uygulanır.
- **Çoklu API anahtarı:** Google Gemini anahtarları popup üzerinden eklenebilir, test edilebilir ve aktifleştirilebilir.
- **Model seçimi:** Gemini 3.5 Flash-Lite ve Gemini 3.1 Flash-Lite arasında popup üzerinden geçiş yapılabilir.
- **Dayanıklı görsel yakalama:** Önce orijinal görsel denenir; CORS veya site kısıtında görünür sekme kırpma yöntemine geçilir.
- **İstek kuyruğu:** Gemini istekleri rate limit ve geçici hata geri çekilmesiyle sıralı yürütülür.

## Kurulum

1. `MangaLensTR-3.1.1.zip` dosyasını ayrı bir klasöre çıkarın.
2. `chrome://extensions` sayfasını açın.
3. Geliştirici modunu etkinleştirin.
4. **Paketlenmemiş öğe yükle** ile ZIP'ten çıkardığınız ve `manifest.json` dosyasını içeren klasörü seçin.
5. Popup içindeki API sekmesinden en az bir Gemini API anahtarı ekleyip aktif yapın.
6. Manga sayfasında **Alan Seç** veya **Oto Çevir** modunu kullanın.

## ZIP Paketini Oluşturma

PowerShell'i proje klasöründe açıp çalıştırın:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\package.ps1
```

Betik sürümü `manifest.json` dosyasından okur, JavaScript sözdizimini denetler ve yalnızca uzantının çalışması için gereken dosyaları `MangaLensTR-<sürüm>.zip` paketine ekler.

## Yeniden Çevir Nasıl Çalışır?

Önceki Türkçe sonuç modele gönderilmez. Kaynak görsel yeniden analiz edilir ve denemeler sırayla şu yaklaşımları kullanır:

1. Doğal, günlük Türkçe diyalog.
2. Karakter tonu, duygu ve sahne bağlamı.
3. Kısa, akıcı ve konuşma balonuna uygun Türkçe.

Alternatif isteklerde daha yüksek yaratıcılık kullanılır. Bu yöntem farklı sonuç olasılığını artırır ancak üretken modeller nedeniyle her denemede farklı sonuç garanti edilemez.

## Teknik Notlar

- **Varsayılan model:** `gemini-3.5-flash-lite`
- **Alternatif model:** `gemini-3.1-flash-lite`; 3.5 seçiliyken istek başarısız olursa aynı işlem 3.1 ile bir kez yeniden denenir.
- **Model tercihi:** `chrome.storage.sync` içindeki `geminiModel` alanında saklanır.
- **API anahtarları:** `chrome.storage.local` içinde saklanır; aktif anahtar service worker tarafından okunur.
- **Kullanıcı tercihleri:** Etkinlik, yazı boyutu ve model seçimi `chrome.storage.sync` içinde saklanır.
- **Capture:** Orijinal `img/canvas` veya görünür sekme kırpması.
- **İstatistikler:** Başarılı Gemini çeviri istekleri dakika, gün ve toplam olarak yerel saklanır.
- **Rate limit:** İstekler sıraya alınır; 429 ve geçici ağ hatalarında kontrollü geri çekilme uygulanır.

## Dosya Yapısı

```
src/
  background.js  - Gemini API, alternatif prompt stratejileri, rate limit ve API anahtarı okuma
  content.js     - Alan seçimi, Oto Çevir, görsel yakalama ve sonuç kutuları

popup/
  popup.html     - Birleşik çeviri/tercihler ve API arayüzü
  popup.js       - Popup davranışı ve API anahtarı yönetimi
  style.css      - Popup stilleri
```

## Sorun Giderme

- **API anahtarı yok/geçersiz:** API sekmesinde anahtarı ekleyin, test edin ve aktif yapın.
- **Alan seçilemiyor:** Manga görselinin görünür olduğundan emin olun ve uzantıyı yeniden yükleyin.
- **Görsel okunamıyor:** CORS nedeniyle orijinal görsel alınamazsa uzantı görünür sekme kırpmasına geçer; seçili alan ekranda görünür olmalıdır.
- **Rate limit/kota:** Başka bir API anahtarını aktif yapın veya kota yenilenmesini bekleyin.
