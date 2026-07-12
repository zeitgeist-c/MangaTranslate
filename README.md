# MangaLens TR v3.0.0

Google Chrome Manifest V3 tabanlı manga, manhwa ve manhua görsel çeviri uzantısı.

## Özellikler

- **Alan Seç:** Manga görselinde bir veya daha fazla alan çizip Enter ile toplu çevirir.
- **Oto Çevir:** Çizilen her alanı beklemeden otomatik olarak çevirir.
- **Alternatif çeviri:** Sonuç kutusundaki `Yeniden` düğmesi kaynak görseli bağımsız yeniden okuyup farklı bir Türkçe çeviri stratejisi uygular.
- **Sonuç kontrolü:** Her sonuç kutusu `Yeniden` ve `×` araçlarına sahiptir.
- **Yazı boyutu:** Normal (16 px) ve Büyük (20 px) seçenekleri bütün sonuçlara uygulanır.
- **Çoklu API anahtarı:** Google Gemini anahtarları popup üzerinden eklenebilir, test edilebilir ve aktifleştirilebilir.
- **Dayanıklı görsel yakalama:** Önce orijinal görsel denenir; CORS veya site kısıtında görünür sekme kırpma yöntemine geçilir.
- **İstek kuyruğu:** Gemini istekleri rate limit ve geçici hata geri çekilmesiyle sıralı yürütülür.

## Kurulum

1. `chrome://extensions` sayfasını açın.
2. Geliştirici modunu etkinleştirin.
3. **Paketlenmemiş öğe yükle** ile `MangaTranslate` klasörünü seçin.
4. Popup içindeki API sekmesinden en az bir Gemini API anahtarı ekleyip aktif yapın.
5. Manga sayfasında **Alan Seç** veya **Oto Çevir** modunu kullanın.

## Yeniden Çevir Nasıl Çalışır?

Önceki Türkçe sonuç modele gönderilmez. Kaynak görsel yeniden analiz edilir ve denemeler sırayla şu yaklaşımları kullanır:

1. Doğal, günlük Türkçe diyalog.
2. Karakter tonu, duygu ve sahne bağlamı.
3. Kısa, akıcı ve konuşma balonuna uygun Türkçe.

Alternatif isteklerde daha yüksek yaratıcılık kullanılır. Bu yöntem farklı sonuç olasılığını artırır ancak üretken modeller nedeniyle her denemede farklı sonuç garanti edilemez.

## Teknik Notlar

- **Model:** `gemini-3.1-flash-lite`
- **API anahtarları:** `chrome.storage.local` içinde saklanır; aktif anahtar service worker tarafından okunur.
- **Kullanıcı tercihleri:** Etkinlik ve yazı boyutu `chrome.storage.sync` içinde saklanır.
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