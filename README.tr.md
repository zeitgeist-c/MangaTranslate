# MangaLens TR 3.6.0 — yeni arayüz ve ortak API yönetimi

[English](README.md)

Brave/Chromium Manifest V3 uzantısı. İngilizce manga/manhwa/manhua yazılarını Gemini veya OpenRouter üzerinden Türkçeye çevirir. Alan Seç ve Oto Çevir korunur. Tam bölüm özelliği **önizlemedir**: bütün yazıların bulunması ve %98 kalite hedefi henüz insan etiketleriyle doğrulanmadı.

## Kullanım

1. `MangaLensTR-3.6.0.zip` dosyasını çıkar; `brave://extensions` → Geliştirici modu → Paketlenmemiş öğe yükle. Mevcut proje klasöründen kullanıyorsan uzantıyı ve manga sekmesini yeniden yükle. Açık eski ayarlar pencerelerini de yenile.

   Güncellemede aynı yüklenmiş klasörü kullan: farklı klasörden ikinci bir uzantı eklemek ayrı uzantı kimliği oluşturabilir ve kayıtlı anahtarlarını yeni kimlikte göstermeyebilir. Mevcut uzantıyı kaldırmadan klasörünü güncelle ve **Yeniden yükle** kullan.
2. Popup'taki dişliyle **Ayarlar → API Anahtarları** aç. Gemini/OpenRouter için etiketli birden fazla anahtar ekleyebilirsin; **Aktif yap** ile seç. Eski Google listesi korunur, eski tek OpenRouter anahtarı otomatik aktarılır. Ana popup yalnız aktif anahtar etiketini gösterir.
3. Popup'ta sağlayıcı ve modeli seç; otomatik kaydedilir. İçerik türü, seri adı, yönerge ve sözlük için **Ayarlar → Çeviri Tercihleri → Kaydet** kullan. Sözlük seri adına göre yerel saklanır.
4. **Bölümün tamamını çevir** mevcut bölümün görsellerini sırayla işler; sonraki bölüme geçmez. Lazy-load taraması sınırlıdır ve kaydırma konumu geri getirilir.
5. Sayfa panelinde duruma göre Duraklat/Devam et ve Hatalıları yeniden dene görünür. **Görünüm ve kontrol araçları** bölümünde Orijinal/çeviri, Kutular, Kontrol listesi ve Kapat bulunur. Paneli katlamak taramayı durdurmaz; Kapat duraklatır. Belirsiz alanlar/sığmayan metin otomatik kaplanmaz; Alan Seç ile düzeltilebilir.

Anahtar kartındaki **Kayıtlı** ve **Bağlantı doğrulandı** farklıdır: Kontrol et çeviri üretmeden sağlayıcının anahtar/model-listesi uç noktasına bağlanır. Seçili model erişimini, kredinin yeterli olduğunu veya yaş onayını kanıtlamaz. Kontroller yalnız düğmeye basınca çalışır; anahtarlar her zaman maskelenir. Aktif anahtar silinirse ilk kalan seçilir; hiç kalmazsa bu sağlayıcıyla çeviri başlatılamaz. Anahtar değişimi sonraki çağrıları etkiler.

Yalnız seçili model kullanılır; başka modele sessiz geçiş olmaz. Hatalıları yeniden deneme yeni ücret oluşturabilir. Gönderilmiş bir isteğin cevabı kaybolursa otomatik tekrar yapılmaz. Tamamlanmış sonuçlar kaynak/model/profil/sözlük/bağlam cache'inden kullanılır. Başlamış iş ayarlarını sabitler; model değişimi yeni işleri etkiler.

3.5.1: Duraklat bekleyen yerel işlemi iptal eder; Devam et tek tıklamayla sürdürür. Yanıtsız adımlar süre sınırında hata olarak kaydedilir ve diğer görsellere geçilir. Gönderilmiş çeviri isteğinin geç cevabı önbelleğe alınabilir; devam ederken aynı çağrı paylaşılır. Sayfada zaten gösterilen tamamlanmış katmanlar yeniden işlenmez. Güncellemeden sonra uzantıyı ve manga sekmesini yeniden yükleyin.

## Modeller ve tespit

3.5.2: OpenRouter 18+ yaş onayı istediğinde tarama ilk etkilenen görselde durur ve ayarlar bağlantısı gösterir. Bu onay uzantıdan verilemez. Hesabınızda gerekli onayı kendiniz tamamladıktan sonra **Hatalıları yeniden dene** kullanın. Başka modele geçmek için popup’tan modeli seçip yeni bölüm taraması başlatın. Eksik/geçersiz anahtar ve kredi hataları da kalan kuyruğu durdurur; içerik denetimi nedeniyle verilen diğer 403 hataları yaş onayı sayılmaz. 3.5.1’den kalan bilinen yaş onayı hataları açılışta anlaşılır mesaja dönüştürülür.

Gemini: Gemini3.5 Flash Lite, Gemini3.1 Flash Lite, Gemma4 26B A4B.

OpenRouter: Qwen3.7/3.8 Flash, Claude Haiku5.5, DeepSeekV4.1 Flash, Muse Spark1.3 ve Contributor, Gemini2.5/3.1 Flash Lite. Haiku4.5 yok. Contributor veri paylaşımı nedeniyle ayrı açık seçime bağlıdır. Hesap erişimi/fiyat/çeviri kalitesini kullanıcı deneyecek; canlı API testleri kullanıcı isteğiyle yapılmadı.

Yerel Standart tarama varsayılandır. Hızlı tarama daha küçük dedektörle deneysel seçenektir. Yerel modeller ücretli API kullanmaz. CPU/WASM çalışır; GPU adayları çıktı/uyumluluk kontrollerini geçmediği için etkin değildir.

Çeviri modeli koordinat üretmez: yerel kaynak-piksel kutuları ve sabit bölge kimlikleri kullanılır. Model yalnız kimlikli kırpmayı okur/çevirir. Düz zemin ve güvenli şekil doğrulanınca yalnız eski harf pikselleri temizlenir. Dokulu zemin, döndürülmüş/eğik görsel, erişilemeyen kaynak ve dekoratif SFX ayrıca kontrol gerektirir. Japonca/dikey yazı doğrulanmadı.

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
