# MangaLens TR 3.8.2 — kuyruk ve yanıt dayanıklılığı

14 Ekim 2026. Kullanıcı DeepSeek'te 60 saniye zaman aşımı, Qwen'de geçersiz
çeviri sonucu, Haiku'da 429 ve ardından Muse Spark'ta ortak bekleme bildirdi.
Bu mesajlar bütün modellerin bozuk olduğunu kanıtlamaz. Özellikle Muse Spark
beklemesi, istek gönderilmeden önceki yerel 429 koruması olabilir.

## Neden ve düzeltme

| Durum | Doğrulanabilen neden | 3.8.2 davranışı |
|---|---|---|
| Eski işin hatası yeni işi durduruyor | 3.8.1 kuyruğunda geç kalan eski hata genel engeli yeniden açabiliyor. Baseline tekrarı: yeni iş çağrısı 0, DISPATCH_STOPPED. | Engeller iş sahibine ait. Yeni iş veya diğer sekme eski işin geç hatasıyla iptal edilmiyor. |
| Qwen geçersiz sonuç | Tek bir alanın status/metin türü/boşluğu tüm grubu başarısız sayıyordu. Kullanıcının tam ham alanı bilinmiyor. | Kimliği doğru olan alanlarda yalnız bozuk kayıt incelemeye ayrılır; sağlam kartlar ve sonuçlar korunur. |
| DeepSeek zaman aşımı | Sabit 60 sn watchdog; model gecikmesinin ağ/kuyruk/sağlayıcı dağılımı bilinmiyor. | Daha küçük grup, model başına sınırlı eşzamanlılık ve 120 sn üst sınır. Süre dolarsa belirsizlik açıkça korunur. |
| Haiku 429 | Sağlayıcı veya hesap gerçek isteği reddetmiş. Kesin kota kaynağı eski mesajda yok. | Daha düşük model yükü, Retry-After, kalıcı bekleme ve panelde geri sayım. |
| Ardından Muse beklemesi | Önceki 429 bütün modellere ortak uygulanıyordu; bu mesaj Muse'un sağlayıcı cevabı değildir. | Kaynağı sağlayıcı olarak bildirilen 429 ilgili modele; belirsiz/hesap kaynağı genel uygulanır. Kaynak model ve henüz gönderilmeyen istek açıkça belirtilir. |

## İstek profilleri

| Model | Uygulama grup üst sınırı | Aynı model için eşzamanlı istek | İstek zaman aşımı |
|---|---:|---:|---:|
| DeepSeek V4.1 Flash | 8 kırpma | 2 | 120 sn |
| Qwen3.7 / Qwen3.8 Flash | 12 kırpma | 2 | 90 sn |
| Claude Haiku 5.5 | 12 kırpma | 2 | 90 sn |
| Muse Spark 1.3 / Contributor | 20 kırpma | Ortak 4→6→8 sınırına tabi | 60 sn |

Bunlar OpenRouter'ın ilan ettiği kota değildir, uygulamanın yük sınırlarıdır.
Model metadata'sı, bağlam ve 8 MiB gövde daha düşük sınır gerektirebilir; kapasite
bilinmiyorsa Muse da en fazla 12 kırpma kullanır. Genel kuyruk 4→6→8 ortak kapasiteyi
korur; birden fazla sekme aynı model sınırını paylaşır. 429/kredi engelinde genel
kapasite azaltma korunur. Daha düşük eşzamanlılık güvenilirliği artırmayı hedefler,
her modelde 1–2 dakika garantisi değildir. Gerçek sağlayıcı yavaşlığını uzantı ortadan kaldıramaz.

## Yanıt güvenliği ve sonuçlar

- Qwen3.8 ve DeepSeek bölüm gruplarında destekleyen uçlardan JSON Schema istenir.
  Qwen3.7 JSON object biçimini korur; Haiku/Muse ve manuel alan seçimi sözleşmeleri aynı.
- Durum değerindeki büyük/küçük harf ve kenar boşluğu düzeltilir. Açık `unreadable`
  kaydındaki null/boş metin güvenle boş dizgeye çevrilir; çeviri uydurulmaz.
- Kimliği doğrulanmış fakat alanları geçersiz kayıt boş, `unreadable` ve
  `invalid_translation_result` işaretli olarak saklanır. Çeviri kartı çizilmez;
  kontrol listesinde Türkçe açıklama vardır. Alan Seç ile elle kontrol edilebilir.
- Eksik/yinelenen/başka kimlik, bozuk JSON ve kesilmiş çıktı hâlâ reddedilir;
  sıralamadan kimlik tahmini veya başka bölgeye metin taşıma yapılmaz.
- Başarılar ve inceleme sonuçları saklanır; devam/restart bunları otomatik yeniden
  ücretlendirmez. İnceleme kaydı yeniden çeviri yapılmış gibi gösterilmez.
- Timeout ve belirsiz sonuç otomatik tekrarlanmaz. Bekleme dolması da otomatik
  ücretli çağrı başlatmaz; kullanıcı “Hatalıları yeniden dene”ye basar.

## Bekleme ve güncelleme

HTTP ve SSE 429 aynı Retry-After mantığını kullanır. `provider_name` bildirilen,
hesap limit kaynağı/rate-limit başlığı olmayan hatada model kapsamı seçilir.
Kaynak belirsizse genel bekleme korunur; başka anahtara/model hesabına geçerek
gerçek hesap sınırı aşılmaya çalışılmaz. Yalnız model/kapsam/bitiş zamanı yerel
depolamaya kaydedilir; anahtar veya prompt bu kayda eklenmez. Worker restart
beklemeyi sıfırlamaz. Panelde yeniden deneme düğmesi süre dolana kadar pasiftir.

Eski işlerde devam ederken güncel grup sınırları yeniden alınır; aynı model,
bağlam ve başarılı çeviriler korunur. İşleme/cache sürümü aynı kalır. Yeni ZIP'i
aynı yüklenen klasöre güncelleyip uzantı Yenile (↻), okuyucu ve ayarlar sayfalarını
yenileyin. Kaynak/kullanıcı verisini silmeyin. Önceki 3.8.0 yedeği ve 3.8.1 paketi korunur.

## Doğrulama

101/101 otomatik kontrol geçti. ZIP'ten açılan 3.8.2 kopyasında model adaptörleri
ve aşağıdaki bozuk-alan/yerleşim/önbellek akışı ayrıca doğrulandı.

- Otomatik regresyonlar: eski işin geç hatası, sekmeler arası model sınırı,
  model/genel 429, kalıcı bekleme, SSE 429, 120/90/60 sn watchdog, JSON Schema ve
  bozuk tek alanın sağlam komşularını koruması.
- İzole Brave: gerçek yerel tespit ve sahte Qwen yanıtındaki bir null alanla
  11 kart / 3 kontrol / 0 işlem hatası. 1280/700 genişlikte hizalama farkı 0.
  Devam/restart ek sağlayıcı çağrısı 0. Bu, gerçek çeviri kalitesi değildir.
- Panel testi: 429 geri sayımı, süre bitene kadar pasif yeniden deneme, süre
  dolunca otomatik çağrı 0; yaş engeli, duraklat/devam ve kapatma korunur.
- Altı modelin gerçek popup seçimi ve normal/SSE adaptörleri sahte yanıtlarla sınanır.
  Gerçek anahtar, ücretli API veya canlı sağlayıcı testi yapılmaz.

Son sürüm kanıtı `evaluation/evidence-3.8.2.json`; halka açık metadata snapshot'ı
`evaluation/evidence/model-metadata-3.8.2.json` içindedir. Bu koşular gerçek
OpenRouter kota/hesap erişimi ve model yanıt doğruluğu garantisi oluşturmaz.

Kaynaklar:
- https://openrouter.ai/docs/api_reference/limits
- https://openrouter.ai/docs/api_reference/errors-and-debugging
- https://openrouter.ai/docs/guides/features/structured-outputs

Mağaza yükleme/push yapılmaz; Unlisted hazırlığı yeni pakete göre güncellenir.
