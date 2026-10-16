# Mağaza alan paketi — MangaLens TR 3.8.6 (güncelleme yayını)

Kayıt zaten açık; sıfırdan ürün açılmıyor. Sıra: Package → Store listing → Privacy → Distribution → Test instructions → Submit. Aşağıdaki metinler aynen yapıştırılabilir.

## 1) Package
- `Package → Upload new package → MangaLensTR-3.8.6.zip` (proje kökünde).
- Kaynak yedeği veya şifreli profil yedeği yüklenmez. Hera AI kaydı seçilmez.

## 2) Store listing (mevcut değerleri koru, açıklamayı güncelle)
- Dil: Türkçe.
- Açıklama: `store/LISTING-TR.md` dosyasındaki "Açıklama" bölümü (6. maddeden sonrası dahil güncel).
- İkon: `store/assets/icon128.png` (128x128, doğrulandı).
- Ekran görüntüleri: `store/assets/settings.png`, `store/assets/preferences.png` (1280x800, doğrulandı; gerçek anahtar yok).
- Küçük tanıtım: `store/assets/small-promo.png` (440x280, doğrulandı).
- TAVSİYE (zorunlu değil): 3.8.6 kurulu bir Brave penceresinde ayarlar sayfasını 1280x800 açıp iki görüntüyü yenile; yeni "Sağlayıcı davranışı" kartı ve yeni sayfa paneli görünsün. Eski görüntülerle de gönderim yapılır, sonra güncellenir.

## 3) Privacy (gizlilik sekmeleri)
- Single purpose: `Kullanıcının açtığı manga/manhwa/manhua görsellerindeki metinleri tespit edip seçtiği yapay zekâ sağlayıcısıyla Türkçe çeviriyi aynı sayfada göstermek.`
- İzin gerekçeleri (her iznin karşısına):
  - `storage`: sağlayıcı/model tercihleri, API anahtarları, iş durumu ve önbellek.
  - `activeTab`: kullanıcının başlattığı alan seçme/çeviri işlemlerinde etkin sayfaya erişim.
  - `scripting`: gerekli sayfa çeviri betiklerini etkin sekmeye bağlamak.
  - `offscreen`: yerel görsel işleme, model çıkarımı, canvas ve önbellek işlemleri.
  - `alarms`: arka plan istek kuyruğunun periyodik kontrolü.
  - `unlimitedStorage`: büyük bölüm görselleri ve yerel çeviri önbelleğinin depolama ihtiyacı.
  - `<all_urls>`: farklı okuyucu sitelerindeki görselleri bulmak, kaynak görselleri okumak ve çeviri kartlarını sayfaya yerleştirmek. Genel tarama geçmişi analitiği amacıyla kullanılmaz.
- Remote code: `No, I am not using remote code.` (betikler, ONNX modelleri ve WASM paketin içinde; sağlayıcı yanıtları çeviri verisidir, kod çalıştırılmaz).
- Data usage: aşağıdaki üçünü kapsayacak kutuları işaretle, "satılmıyor / sınırlı kullanım" sertifikalarını onayla:
  1. Sayfa/görsel içeriği (kırpmalar, metinler),
  2. Sayfa adresleri (iş kayıtlarında tutulur),
  3. Kimlik bilgileri (sağlayıcı API anahtarları).
  "Hiç veri toplanmıyor" seçilmez.
- Privacy policy URL: `PRIVACY-TR.md` bu dosya tek başına geçmez; herkese açık HTTPS adres gerekir. ADRES HENÜZ YOK — gönderimden önce netleştirilmeli.

## 4) Distribution
- Visibility: Unlisted (mevcut değer korunur). Bölge kısıtı konmadıysa aynen bırak.

## 5) Test instructions (aynen yapıştır)
`Uzantı kendi Gemini veya OpenRouter API anahtarını gerektirir. Bağlantı kontrolü çeviri üretmez; ücretli çeviri için ayrı kullanıcı eylemi gerekir. Arayüz anahtarsız incelenebilir; çeviri düğmeleri anahtar eklenene kadar pasiftir. 1. Ayarlar → API Anahtarları → sağlayıcı → anahtar ekle. 2. Popup'tan aynı sağlayıcıyı ve erişilebilir modeli seç. 3. İngilizce yazılı, kullanım izni bulunan bir çizgi roman sayfasında Alan Seç veya Bölümün tamamını çevir. 4. Kartların kaynak yazının yerinde oluştuğunu ve Orijinal/çeviri geçişini kontrol et. 5. Tam bölümde duraklat/devam ve kontrol listesini dene.`

## 6) Submit
- `Submit for Review`. Zamanlama istenirse işareti kaldırıp (deferred) önce elle yayınlanır.
- Yayınlanan bağlantı Unlisted olduğu için ayrıca paylaşılır.

## Yayın sonrası (5 dk)
- Mağaza bağlantısından kurulum denemesi (temiz profilde): anahtar ekleme → alan seç → 1 çeviri.
- Eski geliştirici-modu kurulumu duruyorsa ikisinden birini devre dışı bırak (çift çalışma olmasın).
