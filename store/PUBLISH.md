# Chrome Web Store — ikinci uzantı, Unlisted

Durum: yerel hazırlık; hesapta yükleme/inceleme/yayın yapılmadı. Mevcut Hera AI kaydı değiştirilmeyecek.

1. Hera AI'nin bulunduğu yayıncı hesabıyla https://chrome.google.com/webstore/devconsole adresini açın.
2. **Add new item → Choose file → MangaLensTR-3.8.0.zip → Upload**. Kaynak yedeğini veya şifreli profil yedeğini yüklemeyin.
3. **Store listing**: LISTING-TR.md açıklaması, Türkçe dil, ikon ve ekran görüntüleri.
4. **Privacy**: tek amaç ve izin açıklamaları aşağıdadır. Herkese açık gizlilik politikası URL'si gerekir; Unlisted bunu kaldırmaz.
5. **Distribution → Visibility → Unlisted**. Bağlantıyı bilen herkes erişebilir. Yalnız arkadaş hesaplarına erişim istenirse Private seçeneği ayrıca değerlendirilmeli.
6. **Test instructions**: aşağıdaki test adımları. API gereksinimini açıkça belirtin.
7. Alanlar tamamlanınca **Submit for Review**. İnceleme sonrası otomatik yayını kapatarak önce kontrol edebilirsiniz. Yayınlanan yeni mağaza bağlantısını arkadaşlarla paylaşın.

## Tek amaç / izin gerekçeleri

Single purpose: Kullanıcının açtığı manga/manhwa/manhua görsellerindeki metinleri tespit edip seçtiği yapay zekâ sağlayıcısıyla Türkçe çeviriyi aynı sayfada göstermek.

- `storage`: sağlayıcı/model tercihleri, API anahtarları, iş durumu ve önbellek.
- `activeTab`: kullanıcının başlattığı alan seçme/çeviri işlemlerinde etkin sayfaya erişim.
- `scripting`: gerekli sayfa çeviri betiklerini etkin sekmeye bağlamak.
- `offscreen`: yerel görsel işleme, model çıkarımı, canvas ve önbellek işlemleri.
- `alarms`: arka plan istek kuyruğunun periyodik kontrolü.
- `unlimitedStorage`: büyük bölüm görselleri ve yerel çeviri önbelleğinin depolama ihtiyacı.
- `<all_urls>`: farklı okuyucu sitelerindeki görselleri bulmak, kaynak görselleri okumak ve çeviri kartlarını sayfaya yerleştirmek. Genel tarama geçmişi analitiği amacıyla kullanılmaz.
- Google API host erişimi: kullanıcının seçtiği doğrudan Gemini sağlayıcısı.

Remote code: uygulama betikleri, ONNX modelleri ve WASM çalışma zamanı paketin içindedir. Sağlayıcı yanıtları çeviri verisi olarak işlenir; uzaktan JavaScript kodu çalıştırılmaz.

Veri beyanı seçili sağlayıcıya gönderilen web sayfası/görsel içeriğini ve kimlik doğrulama için kullanılan API anahtarını kapsamalı. Geliştiricinin kendi sunucusu yok diye “hiç veri işlenmiyor” seçilmemeli. Nihai kutular panelin güncel tanımlarıyla eşleştirilmeli.

## İnceleme test yönergeleri

Uzantı kendi Gemini veya OpenRouter API anahtarını gerektirir. Bağlantı kontrolü çeviri üretmez; ücretli çeviri için ayrı kullanıcı eylemi gerekir. Arayüz anahtarsız incelenebilir; çeviri düğmeleri anahtar eklenene kadar pasiftir.

1. Ayarlar → API Anahtarları → sağlayıcı → anahtar ekle.
2. Popup'tan aynı sağlayıcıyı ve erişilebilir modeli seç.
3. İngilizce yazılı, kullanım izni bulunan bir çizgi roman sayfasında Alan Seç veya Bölümün tamamını çevir.
4. Kartların kaynak yazının yerinde oluştuğunu ve Orijinal/çeviri geçişini kontrol et.
5. Tam bölümde duraklat/devam ve kontrol listesini dene.

Gerekirse inceleme için sınırlı kredi/izinli ayrı bir anahtar yalnız güvenli mağaza test alanında paylaşılır; mevcut kişisel anahtarlar kaynak koduna, bu belgeye veya mağaza görsellerine konmaz. Henüz böyle bir anahtar hazırlanmadı.

## Mevcut kullanıcı verileri

Mağazadan yüklenen uzantı yeni bir kimlik alır. Geliştirici modundaki mevcut Brave uzantısının anahtarları, sözlüğü ve önbelleği bu kimliğe otomatik taşınmaz. Mevcut uzantıyı kaldırmayın. Önce mağaza sürümünü kurup anahtar/tercihleri yeniden ayarlayın; iki sürümün aynı sayfada birlikte çalışmasını önlemek için birini devre dışı bırakın. Eski profil yedeği orijinal kimlik için korunur.

## Kaynaklar

- https://developer.chrome.com/docs/webstore/publish
- https://developer.chrome.com/docs/webstore/cws-dashboard-listing
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
