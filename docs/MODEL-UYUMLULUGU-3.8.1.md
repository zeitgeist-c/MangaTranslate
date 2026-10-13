# MangaLens TR 3.8.1 — model bazlı uyumluluk

13 Ekim 2026. Kullanıcı Qwen Flash ve DeepSeek denemelerinin başarısız olduğunu,
Haiku 5.5 ve Muse Spark 1.3 ile çalışabildiğini bildirdi. Eski hata mesajları
silinmiş olduğundan bu koşuların kesin hata nedeni yeniden oluşturulamadı.
Canlı ücretli deneme yapılmadı; API anahtarlarına veya çalışan Brave profiline dokunulmadı.

## Doğrulanmış bulgular

OpenRouter'ın herkese açık model kataloğunda altı modelin tamamı görsel girişini
destekliyor. Qwen 3.7/3.8 Flash ve DeepSeek V4.1 Flash için `default_enabled:true`,
`mandatory:false`; DeepSeek varsayılan eforu `high`. Eski istek bunları sağlayıcının
varsayılanına bırakıyordu. Düşünme token'ları görünür çıktı bütçesini tüketebilir;
boş/kesilmiş çıktı veya gecikme oluşması mümkündür. Bu, kullanıcının eski hatasının
kesin teşhisi değildir.

DeepSeek uçlarının bir kısmında `response_format` desteği yok. Önceki istek
JSON istiyordu fakat `require_parameters` göndermiyordu; bu parametrenin varsayılanı
false olduğundan desteklenmeyen parametre göz ardı edilebilirdi.

## Model kararları ve fiyat görüntüsü

1 milyon token başına USD; aşağıdaki fiyatlar snapshot anındaki katalog taban
fiyatlarıdır. Sağlayıcı, uzun bağlam, görsel token hesabı ve hesap koşulları toplamı değiştirir.

| Model | Girdi / çıktı | Karar |
|---|---|---|
| Qwen3.7 Flash | 0,03 / 0,13 | Korundu; düşünme kapalı, gerekli parametreler zorunlu. 32k/256k üzeri girdi fiyat basamakları var. |
| Qwen3.8 Flash | 0,15 / 0,47 | Korundu; düşünme kapalı, gerekli parametreler zorunlu. |
| DeepSeek V4.1 Flash | 0,0441 / 0,63 | Korundu; düşünme kapalı, JSON destekleyen uç şartı. |
| Claude Haiku 5.5 | 0,10 / 0,50 | Korundu; kullanıcı çalıştığını bildirdi, düşünme politikası değiştirilmedi. 100k üzeri fiyat basamağı var. |
| Muse Spark 1.3 | 1,25 / 4,25 | Korundu; kullanıcı çalıştığını bildirdi, zorunlu düşünmeye dokunulmadı. |
| Muse Spark 1.3 Contributor | 0,10 / 0,20 | Korundu; mevcut açık veri paylaşımı onayı ve hesap koşulları sürüyor. |

İki modele indirmek için yeterli kanıt yok; desteklenen ve ucuz Qwen seçenekleri
bu uyumluluk düzeltmesinden sonra kullanıcı tarafından denenebilir. Henüz yeni,
gerçek kullanımı doğrulanmamış modeller eklenmedi. Doğrudan Gemini listesi aynı.

## Uygulama

- Yalnız Qwen 3.7/3.8 Flash ve DeepSeek V4.1 Flash: `reasoning:{enabled:false}`.
- Tüm OpenRouter istekleri: `provider.require_parameters:true`. Aynı model kullanılır;
  sağlayıcı/model fallback'i kapalı kalır, otomatik ücretli tekrar yok.
- Kapasite hesabı kullanılabilir ve bildirilen gerekli parametreleri destekleyen
  uçları esas alır. Eski metadata cache'i v2 anahtarıyla ayrılır; ağ hatasında mevcut
  12 kırpma/8192 çıktı muhafazakâr sınırı sürer. Hesap filtresi uygunluğunu public
  metadata kanıtlamaz; asıl yönlendirme OpenRouter tarafından uygulanır.
- 400 düşünme/JSON reddi, 404 uygun uç yokluğu, hesap veri politikası engeli ve
  çıktı sınırında kesilme ayrı açıklamalarla gösterilir.
- Akış içindeki hata mesajı artık kaybolmaz; kişisel anahtar maskelenir ve mesaj
  boyutu sınırlandırılır. Düşünme içeriği çeviri olarak kullanılmaz.
- Tanılama özeti saklı işin görsel hata mesajlarını da içerir. Anahtar, görsel
  kırpması ve tam prompt bu özete eklenmez. Özet paylaşmadan önce gözden geçirilmelidir.
- Başarılı çeviriler, iş/cache sürümü ve tespit/koordinat algoritması korunur.

## Doğrulama sınırı ve güncelleme

90 otomatik kontrol: mevcut 82 + düşünme politikası, yönlendirme uyumu, stream hata
detayı/maskeleme, kesilmiş çıktı ve metadata filtreleme kontrolleri.
İzole Brave model testi: popup'tan altı seçim, her modelde normal ve SSE olmak
üzere 12 sahte yanıt; ters sıradaki yanıtlar bölge kimlikleriyle doğru eşlendi.
Bu test, gerçek modelin manga okuma doğruluğu veya hesabın modele erişimi değildir.

Ayarlar smoke testi: anahtar aktarımı/çoklu anahtar, eşzamanlı ayar sekmeleri,
worker yeniden başlatma, model seçimi ve dar pencere geçti. Yerel okuyucu fixture'ı:
12 kart, 2 kontrol adayı, 0 işlem hatası; 1280/700 genişlikte hizalama farkı 0;
devam ve worker yeniden başlatma ek sağlayıcı çağrısı 0. Duraklat/devam, hesap
engeli, katlama ve kapatma yaşam döngüsü regresyonları da geçti. Çeviriler sahteydi.

MangaLensTR-3.8.1.zip yeni pakettir; 3.8.0 ve ilk 3.1.7 geri dönüş noktası korunur.
Aynı yüklenen klasör/uzantı kimliği üzerinden güncelleyin, Brave uzantı Yenile (↻)
düğmesine basın ve okuyucu/popup/ayarlar sayfalarını yenileyin. Önce Qwen/DeepSeek
ile küçük bir Alan Seç deneyin, ardından bölüm taraması yapın. Belirsiz eski istekleri
otomatik ücretli sürdürmeyin; yeni tarama veya açık yeniden deneme kullanıcı eylemidir.
Sorun devam ederse model adı ve Tanılama özetiyle bildirin.

## Kanıt ve kaynaklar

- `evaluation/evidence/model-metadata-3.8.1.json`: ücretsiz katalog/uç snapshot'ı.
- `evaluation/tools/model-compatibility-smoke.mjs`: gerçek uzantı + sahte sağlayıcı.
- https://openrouter.ai/api/v1/models
- https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
- https://openrouter.ai/docs/guides/routing/provider-selection
- https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output

Mağaza dağıtımı Unlisted olarak kalır; herkese açık HTTPS gizlilik adresi eksik.
Bu sürüm yerel pakettir; mağaza yükleme/inceleme/push yapılmış değildir.
