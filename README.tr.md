# MangaLens TR 3.8.6 — Yoğunluk dayanıklılığı ve Gemini yedeği

3.8.6: Geçici sağlayıcı yoğunluğu (429/503/5xx) en fazla 3 kez artan beklemeyle otomatik deneniyor; tükenirse sayaçlı bekleme ve otomatik devam devreye giriyor. 503’te paralel şeritler geçici kısılıyor. Gemini yedeği açıksa susan modelden listedeki sonrakine geçiliyor (Ayarlar → Çeviri Tercihleri → Sağlayıcı davranışı).

3.8.5: Gemini kuyruğu anahtar sayısı kadar paralel şerit açıyor (en fazla 4), anahtar başına 2,5 sn aralık korunuyor. Tanılama özeti kontrol nedenlerini ve düşen grupları kod bazında döküyor.

3.8.4: Gemini tarafında her anahtar dakikada en fazla 12 istek kullanır, kayıtlı anahtarlar arasında dönüşümlü gidilir; tüm anahtarlar dolarsa pencere bitiminde otomatik devam edilir. Sayfa paneli yenilendi: Tarama/Çeviri/Yerleşim hapları, ilerleme çubuğu, sağlayıcı isteği sayacı ve saatli canlı akış. Önbellek ve gönderilmeyenler sayılmaz.

3.8.3: DeepSeek V4.1 Flash OpenRouter listesinden çıkarıldı (5 model kaldı); kayıtlı modeli kaldırılana denk gelen kullanıcıya varsayılan model otomatik seçilip bilgi verilir. Zaman aşımı alan modelde sonraki gruplar geçici küçültülür, başarılı grup eski boyuta döndürür. Akan yanıtlarda parça geldikçe sıfırlanan sessizlik bekçisi ve iki katı mutlak tavan kullanılır; duran akış ayrı mesajla bildirilir. Otomatik ücretli tekrar yine yok.

3.8.2: Qwen/DeepSeek/Haiku için model başına 2 eşzamanlı istek; DeepSeek 8, Qwen/Haiku 12 kırpma. DeepSeek 120 sn, Qwen/Haiku 90 sn, Muse 60 sn watchdog kullanır. Eski iş hatası yeni işi durdurmaz. 429 kaynak modeli/geri sayımıyla gösterilir, worker restart'ta korunur. Kimliği belli tek bozuk yanıt alanı kontrol listesine ayrılır; diğer kartlar çizilir. Otomatik ücretli tekrar yok. [Ayrıntılar ve sınırlar](docs/KUYRUK-VE-YANIT-3.8.2.md).

3.8.1: Qwen 3.7/3.8 Flash ve DeepSeek V4.1 Flash çevirisinde varsayılan düşünme kapatıldı; OpenRouter yönlendirmesinde gerekli JSON/istek parametrelerinin desteklenmesi zorunlu. Altı model korundu. Haiku ve Muse Spark düşünme ayarları aynı; otomatik ücretli tekrar yok. [Model incelemesi ve doğrulama sınırları](docs/MODEL-UYUMLULUGU-3.8.1.md).

[English](README.md)

Brave/Chromium Manifest V3 uzantısı. İngilizce manga/manhwa/manhua yazılarını Gemini veya OpenRouter üzerinden Türkçeye çevirir. Alan Seç ve Oto Çevir korunur. Tam bölüm özelliği **önizlemedir**: bütün yazıların bulunması ve %98 kalite hedefi henüz insan etiketleriyle doğrulanmadı.

3.8.0: OpenRouter gönderimleri 4→6→8 uyarlanabilir paralellik kullanır; belgelenmiş kapasiteye göre en fazla 20 kırpma/16384 çıktı token’ı, metadata bilinmiyorsa 12/8192. Tam gövde sınırı 8 MiB. Sonuçlar geldikçe kartlar yerleşir; 60 saniyelik watchdog ve bölge bazlı kayıt tekrar ücret riskini sınırlar. OpenRouter listesindeki iki Gemini modeli kaldırıldı; doğrudan Gemini sekmesi korundu. [Ölçümler, gereksinim takibi ve sınırlar](docs/TOPLU-CEVIRI-3.8.0.md). Canlı model hız garantisi verilmez.

## Kullanım

1. `MangaLensTR-3.8.6.zip` dosyasını çıkar; `brave://extensions` → Geliştirici modu → Paketlenmemiş öğe yükle. Mevcut proje klasöründen kullanıyorsan uzantıyı ve manga sekmesini yeniden yükle. Açık eski ayarlar pencerelerini de yenile. 3.7.0 ve daha eski işlere Devam et yerine popup’tan yeni bölüm taraması başlat; bölge gruplama sürümü değişti.

   Güncellemede aynı yüklenmiş klasörü kullan: farklı klasörden ikinci bir uzantı eklemek ayrı uzantı kimliği oluşturabilir ve kayıtlı anahtarlarını yeni kimlikte göstermeyebilir. Mevcut uzantıyı kaldırmadan klasörünü güncelle ve **Yeniden yükle** kullan.
2. Popup'taki dişliyle **Ayarlar → API Anahtarları** aç. Gemini/OpenRouter için etiketli birden fazla anahtar ekleyebilirsin; **Aktif yap** ile seç. Eski Google listesi korunur, eski tek OpenRouter anahtarı otomatik aktarılır. Ana popup yalnız aktif anahtar etiketini gösterir.
3. Popup'ta sağlayıcı ve modeli seç; otomatik kaydedilir. İçerik türü, seri adı, yönerge ve sözlük için **Ayarlar → Çeviri Tercihleri → Kaydet** kullan. Sözlük seri adına göre yerel saklanır.
4. **Bölümün tamamını çevir** mevcut bölümün görsellerini yerel olarak tarar; komşu görsellerin yazılarını ortak gruplarda paralel çevirir; sonraki bölüme geçmez. Lazy-load taraması sınırlıdır ve kaydırma konumu geri getirilir.
5. Sayfa panelinde duruma göre Duraklat/Devam et ve Hatalıları yeniden dene görünür. **Görünüm ve kontrol araçları** bölümünde Orijinal/çeviri, Kutular, Kontrol listesi ve Kapat bulunur. Paneli katlamak taramayı durdurmaz; Kapat duraklatır. Belirsiz alanlar/sığmayan metin otomatik kaplanmaz; Alan Seç ile düzeltilebilir.

Anahtar kartındaki **Kayıtlı** ve **Bağlantı doğrulandı** farklıdır: Kontrol et çeviri üretmeden sağlayıcının anahtar/model-listesi uç noktasına bağlanır. Seçili model erişimini, kredinin yeterli olduğunu veya yaş onayını kanıtlamaz. Kontroller yalnız düğmeye basınca çalışır; anahtarlar her zaman maskelenir. Aktif anahtar silinirse ilk kalan seçilir; hiç kalmazsa bu sağlayıcıyla çeviri başlatılamaz. Anahtar değişimi sonraki çağrıları etkiler.

Yalnız seçili model kullanılır; başka modele sessiz geçiş olmaz. Hatalıları yeniden deneme yeni ücret oluşturabilir. Gönderilmiş bir isteğin cevabı kaybolursa otomatik tekrar yapılmaz. Tamamlanmış sonuçlar kaynak/model/profil/sözlük/bağlam cache'inden kullanılır. Başlamış iş ayarlarını sabitler; model değişimi yeni işleri etkiler.

3.5.1: Duraklat bekleyen yerel işlemi iptal eder; Devam et tek tıklamayla sürdürür. Yanıtsız adımlar süre sınırında hata olarak kaydedilir ve diğer görsellere geçilir. Gönderilmiş çeviri isteğinin geç cevabı önbelleğe alınabilir; devam ederken aynı çağrı paylaşılır. Sayfada zaten gösterilen tamamlanmış katmanlar yeniden işlenmez. Güncellemeden sonra uzantıyı ve manga sekmesini yeniden yükleyin.

## Modeller ve tespit

3.5.2: OpenRouter 18+ yaş onayı istediğinde tarama ilk etkilenen görselde durur ve ayarlar bağlantısı gösterir. Bu onay uzantıdan verilemez. Hesabınızda gerekli onayı kendiniz tamamladıktan sonra **Hatalıları yeniden dene** kullanın. Başka modele geçmek için popup’tan modeli seçip yeni bölüm taraması başlatın. Eksik/geçersiz anahtar ve kredi hataları da kalan kuyruğu durdurur; içerik denetimi nedeniyle verilen diğer 403 hataları yaş onayı sayılmaz. 3.5.1’den kalan bilinen yaş onayı hataları açılışta anlaşılır mesaja dönüştürülür.

Gemini: Gemini3.5 Flash Lite, Gemini3.1 Flash Lite, Gemma4 26B A4B.

OpenRouter: Qwen3.7/3.8 Flash, Claude Haiku5.5, Muse Spark1.3 ve Contributor. OpenRouter’daki Gemini2.5/3.1 Flash Lite kaldırıldı; doğrudan Gemini sekmesi korunur. Haiku4.5 yok. Contributor veri paylaşımı nedeniyle ayrı açık seçime bağlıdır. Hesap erişimi/fiyat/çeviri kalitesini kullanıcı deneyecek; canlı API testleri kullanıcı isteğiyle yapılmadı.

**Hızlı yazı taraması (önerilen)** varsayılandır: yazı dedektörü satırları kaynak piksel konumunda gruplar; ağır balon modeli çalışmaz. Desteklenen GPU’da PP-OCR WebGPU, desteklenmeyen veya başarısız GPU’da aynı doğrulanmış model WASM/CPU ile çalışır. Önceki Standart seçimi hızlı yola eşlenir. Önceden küçük modeli seçtiysen **Ayarlar → Çeviri Tercihleri → Yerel tarama** bölümünden hızlı yolu seçip Kaydet. Alternatif/ayrıntılı balon modelleri isteğe bağlı ve daha yavaştır.

Çeviri modeli koordinat üretmez: yerel kaynak-piksel kutuları ve sabit bölge kimlikleri kullanılır. Model yalnız kimlikli kırpmayı okur/çevirir. Çeviriler özgün görsel dosyası değiştirilmeden yazının üzerinde okunaklı koyu kartlarla gösterilir; zemin taklit edilmez. Sığmayan/çakışan kartlar ve çok küçük veya kesilmiş adaylar kontrol listesinde korunur. Süre özeti tarama, çeviri bekleme ve kart çizimini ayrı gösterir. Japonca/dikey yazı doğrulanmadı.

OpenRouter grupları uzantı genelinde ortak 4→6→8 paralel kuyrukla, Google’a ait sabit 2,5 saniyelik beklemeye girmeden yapılır; Google’ın kota aralığı korunur. Gemini tarafında her anahtar dakikada en fazla 12 istek kullanır ve kayıtlı anahtarlar arasında dönüşümlü gidilir; anahtar sayısı kadar paralel şerit açılır (en fazla 4), anahtar başına 2,5 sn aralık korunur; tüm anahtarlar dolarsa pencere bitimine kadar beklenip otomatik devam edilir. Sayfa başına istek sayısı sayaçta ve tanılama özetinde görünür. 429/eşzamanlı kredi bütçesi engelinde yeni gönderimler durur ve sağlayıcının bekleme süresi gözetilir; otomatik ücretli tekrar yapılmaz. Geçici sağlayıcı yoğunluğu (429/503/5xx) en fazla 3 kez artan beklemeyle otomatik denenir, tükenirse sayaçlı bekleme ve otomatik devam devreye girer. Veri politikası kaynaklı bilinen 404 hataları da taramayı durdurur. Zemin için ek bir AI çağrısı yoktur; daha fazla metin çevirmek sağlayıcı kullanımını artırabilir. Gerçek çeviri süresini seçtiğin model belirler. [Ölçüm ve sınırlar](docs/TOPLU-CEVIRI-3.8.0.md).

## Veri ve geri dönüş

Anahtarlar extension local storage'da tutulur; sayfaya verilmez ve yalnız kendi sağlayıcısına gönderilir. Tercihler sync, seri sözlükleri/iş kayıtları local storage, tespit/çeviri cache'i IndexedDB'dedir. Kırpmalar çeviri başlatıldığında seçilen sağlayıcıya gönderilir. Telemetri yoktur. unlimitedStorage izni büyük cache'in kota nedeniyle kaybolmaması içindir.

3.1.7 kaynak/Git ve şifreli Brave storage checkpoint'i korunur. [Geri dönüş](docs/GERI-DONUS-NOKTASI-2026-10-13.md) ve [uygulama/kabul takibi](docs/UYGULAMA-TAKIBI-2026-10-13.md). Gelecekte geri dönüşten önce yeni kaynak, local/sync verileri **ve IndexedDB** ayrı kurtarma yedeğine alınmalıdır.

## Geliştirme ve paket

```powershell
node --test tests/*.test.js tests/*.test.mjs evaluation/tests/*.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\package.ps1
```

Paket betiği aynı sürüm ZIP'inin üzerine yazmaz. Yerel kaynak commit/tag ve paket ilişkisi ayrıca doğrulanır. [Laboratuvar](evaluation/README.md): dört seriden 101 yerel görsel, serileri ayrılmış 35 görsellik inceleme kuyruğu; model tahmini insan etiketi sayılmaz.

src/page yerel çıkarım/şekil/cache; src/page-background.js sağlayıcı ve kalıcı kayıt; src/page-content.js kuyruk/katman; src/providers.js model/profil/kimlik sözleşmesi. [Üçüncü taraf lisanslar](src/page/licenses/). Projenin genel lisansı henüz belirlenmedi.
