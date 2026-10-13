# MangaLens TR 3.8.0 — toplu ve uyarlanabilir bölüm çevirisi

13 Ekim 2026. Kullanıcının planı açık uygulama onayıyla yürütüldü. Canlı sağlayıcı testi yapılmadı; gerçek anahtarlar ve canlı Brave profili kullanılmadı.

## Sorun ve sonuç

Kullanıcının Muse Spark 1.3 Contributor sonucu: 24 görsel, 58 kart, 13 işlenen görsel, 57 kontrol, 11 hata; yerel hazırlama 8,9 sn, başarılı görsellerin çeviri beklemesi 295,1 sn, kart 0,1 sn. Eski özet başarısız görsellerin bekleme sürelerini toplamıyordu; ilk hata 25 saniyelik zaman aşımıydı. Bu, kullanıcı raporudur; diğer 10 hatanın da aynı olduğu varsayılmadı.

Yeni bölüm akışı yerel tespit, çeviri ve kart çizimini birbirinden ayırır. Aynı bölümün komşu görsellerinden kırpmalar ortak grupta gönderilir; ilk sonuçlar bölümün tamamı bitmeden yerleştirilir. Seçili model, seri, sözlük ve sabit bölüm bağlamı korunur. Gruplar birbirinin çevirisini beklemez.

## Gereksinim / uygulama / kanıt

| Gereksinim | Uygulama ve doğrulama |
| --- | --- |
| 4→6→8 paralellik | Tek worker kuyruğu bütün sekmelerde ortaktır. Her dört yeni başarıda kapasite iki artar, üst sınır 8. 20 işli birim testinde gerçek tepe 8; öğrenilen sınır yerel saklanır. |
| Daha büyük gruplar | En fazla 20 kırpma ve 8 MiB tam JSON gövdesi. Ücret oluşturmayan herkese açık endpoint metadata’sında en küçük doğrulanmış çıktı/bağlam/görsel sınırları kullanılır. |
| Belirsiz metadata | Varsayılan 12 kırpma/8192 çıktı token’ı. 16384 çıktı doğrulanırsa en fazla 20. Metadata arızası 10 dakika bellekte tutulur; her çeviri grubunda tekrar 5 saniye beklenmez. Başarılı metadata 24 saat yerel önbellektedir. |
| Bağlam kontrolü | Bilinen bağlamdan çıktı ve 65536 güvenli prompt bütçesi ayrılır; kırpma başına 10000 tahmini görüntü token’ıyla grup küçültülür. Gönderim öncesi gerçek prompt byte üst tahmini ayrıca kontrol edilir. Görüntü token hesabı modele özgü kesin tokenizer değildir; sağlayıcının belgelenmemiş görsel sınırı garanti edilmez. |
| Kayıp/tekrar ücret | Gönderim öncesi grup ve bölge rezervasyonları tek IndexedDB transaction’ında; başarılar yine atomik kaydedilir. Çakışan canlı gruplar aynı bölgeyi ikinci kez göndermez. Yeniden gruplamada bölge önbelleği kullanılır. |
| Duraklat/devam | Gönderilmemiş gruplar iptal edilir; gönderilmiş sonuçlar önbelleğe tamamlanabilir. Eski neslin yanıtı sayfaya uygulanmaz. Bölüm kayıtları tam çeviri metnini tekrar local storage’a kopyalamaz; kalıcı metin IndexedDB’dedir. |
| Kota/kredi engeli | 429 ve in-flight kredi bütçesi ayrı sınıflanır; yeni gönderimler durur. Açık sonraki denemede kapasite yarıya iner (en az 1). Retry-After saniye/tarih biçimi korunur. Gönderilmiş diğer işler tamamlanabilir. |
| 25 saniye kesilmesi | Watchdog 60 saniye. OpenRouter bölüm istekleri SSE akışı kullanır; tamamlanmış, doğru kimlikli JSON dışında sonuç kabul edilmez. Geçerli düşünce metni çeviriye eklenmez. Sınırlı işlem süresince worker heartbeat uygulanır. |
| Eksik/bozuk yanıt | Zaman aşımı, eksik/bozuk JSON, kesilen akış ve çıktı taşması otomatik ücretli tekrarlanmaz. Belirsiz rezervasyon worker restart sonrası da açık kullanıcı denemesi gerektirir. |
| Doğru süre | Gerçek geçen süre ile paralel sağlayıcı süreleri ayrıdır. Başarısız gruplar, kuyruk süresi, grup sayısı/büyüklüğü ve önbellek kaydedilir. Tanılama özeti açık düğmeyle gösterilip kopyalanabilir; anahtar/görsel/prompt içermez. |
| Model temizliği | OpenRouter Gemini 2.5/3.1 Flash Lite kaldırıldı; doğrudan Gemini korundu. Eski kaldırılmış seçim değiştirilmez; yeni model seçilene kadar çeviri düğmeleri kapalıdır. |

Gemini’nin mevcut kota aralığı değişmedi. Başlatılmış işin modeli sabittir; farklı modele otomatik geçiş veya ücretli sınır keşif çağrısı yoktur. Model metadata’sı anahtar bağlantı testi değildir ve çeviri üretmez. OpenRouter’ın tek genel görsel/paralellik tavanı olduğu iddia edilmez.

## Tespit ve referans sınırı

PP-OCR olasılık haritası artık DB quad zincirini kullanır: .3 eşik, konturun minimum alan dikdörtgeni, dikdörtgen içi .6 ortalama skor, alan×1.5/çevre genişletme. Convex dikdörtgenin yuvarlak offset minimum dikdörtgeni analitik hesaplanır; OpenCV/Clipper runtime eklenmez. JavaScript dış kontur/minimum dikdörtgen/raster uygulaması, bütün OpenCV RETR_LIST davranışlarının bit düzeyinde portu olarak sunulmaz.

Bağımsız Python/OpenCV 4.12/Pyclipper 1.3.0.post6 referansıyla dört sentetik fixture sınandı: dikdörtgen, döndürülmüş kutu, ayrık yazılar ve iç boşluk. Kutular için en çok 2 model pikseli, skor için .03 tolerans geçer. Python referans bağımlılıkları yalnız evaluation/.local/db-reference altında; dağıtıma/Git’e girmez. Kaynak algoritma Apache-2.0 PaddleOCR DBPostProcess; mevcut lisans dosyası korunur.

Koyu parçalarda bir ters renk geçişi ve sınırda kesilen adaylarda en fazla 16 kaydırılmış tarama eklenir. Normal/ters/kaydırılmış gözlemler kaynak koordinatlarında tekilleştirilir. Gruplamada yazı çekirdeği ile genişletilmiş kapsama kutusu ayrıdır; yalnız genişleyen kutular birbirine değdi diye konuşmalar birleştirilmez.

Eski üç ve yeni üç kırpmada toplam **10/10 konuşma bloğu** bulundu ve sentetik Türkçe kartlarla gösterildi. Yeni üçüncü kırpmanın sağ kenarında ayrıca bir küçük, ayrı görsel adayı kontrol için bırakılır. Bu aday gerçek konuşmanın kaybı değildir; yanlış pozitif kontrol adaylarının tamamen çözüldüğü iddia edilmez. Kırpma başarısı, özgün tam kaynak sayfalarda veya canlı modelin okumasında doğrulanmış başarı sayılmaz.

## Ölçümler ve kabul sınırı

82 otomatik kontrol geçti; önceki 61 davranış korunup toplu kuyruk, metadata, body/context sınırları, kayıt hatası, SSE, zaman aşımı, eski iş uyumluluğu ve DB referans kontrolleri eklendi. Kaldırılan model UI’da seçili kaldığında düğmelerin kapandığı ve başka modelin sessiz seçilmediği izole Brave’de doğrulandı. Aynı görsel iki farklı URL’de tekrarlandığında yalnız bir çeviri çağrısıyla iki konuma da kart çizildi; devam/restart ek çağrı yapmadı.

- Gerçek yerel model, 18 görsellik aynı bölüm fixture’ı, her sağlayıcı yanıtında 15 saniye sentetik gecikme: **47,47 sn**, 8 grup, 159 gönderilen bölge, 155 kart, 38 kontrol alanı, 0 işlem hatası. Önceki 3.7 yolunda 184 bölge/37 grup vardı; tespit adayları da değiştiği için bu sayılar tek başına kalite eşdeğerliği değildir.
- Ayrı, sabit **184 sentetik bölge** testi, gerçek worker/kuyruk/IndexedDB/SSE zinciri: **10 grup, 45,11 sn**. İlk yanıt 32 sn, diğerleri 15 sn; geç yanıt başarılı. Bu test tespit modeli veya gerçek çeviri doğruluğu testi değildir.
- İzole Brave’de iki genişlikte hizalama farkı 0; devam ve worker restart sonrası ek sağlayıcı çağrısı 0. Panel ve çoklu anahtar ayarları regresyonları korunur.
- Gerçek sağlayıcı çağrısı **0**. Muse Spark 1.3 Contributor’ın gerçek 1–2 dakika hedefi, maliyeti, büyük gruplarda okuma/çeviri kalitesi ve insan etiketli %98 kabulü kullanıcı denemesiyle açık kalır. Sentetik hız kabulü gerçek SLA değildir.

Kalıcı makine özeti: evaluation/evidence-3.8.0.json. Özel kırpmalar, görseller, test profilleri ve ayrıntılı raporlar Git/paket dışında tutulur.

## Güncelleme ve geri dönüş

processingVersion page-v6; detection-v6, translation-group-v2 ve translation-region-v2 ad alanları kullanılır. Eski kayıtlar silinmez; eski işe otomatik devam/tekrar ücret yapılmaz. Aynı uzantı klasörünü/kimliğini koruyup uzantı ve okuyucuyu yenile, yeni bölüm taraması başlat. Mevcut anahtarlar, tercihler, eski paketler ve 3.1.7 checkpoint korunur. Gelecekte geri dönüş öncesi güncel kaynak/local/sync/IndexedDB ayrıca korunmalıdır.

Zemin rengi/dokusu yeniden oluşturma ve kusursuz harf temizleme, kullanıcının kararı gereği sonraki geliştirme olarak kalır; bu sürümde ek AI/inpainting çağrısı yoktur.

Kaynaklar: https://openrouter.ai/docs/api_reference/limits ; https://openrouter.ai/docs/guides/overview/multimodal/image-understanding ; https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/postprocess/db_postprocess.py ; https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle . 13 Ekim 2026 tarihinde incelendi.

## Dağıtım doğrulaması

MangaLensTR-3.8.0.zip: 47028763 bayt, 35 dosya. SHA-256: b8209689fc9a0c0b58cdc101ccc9d9c112c61b0d11efddc1d7becbeec77c80ac. Arşiv girdilerinin tamamı kaynak dosyalarla hash eşleşti. Önceki 3.7.0 paketi, 3.1.7 kaynak paketi ve DPAPI yedeğinin SHA-256 değerleri değişmedi.
