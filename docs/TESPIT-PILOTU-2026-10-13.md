# P1–P2 tespit pilotu — 13 Ekim 2026

Durum: ilk çalışan laboratuvar hazır; **P1 ve P2 kabul kapıları henüz geçilmedi**. Kullanıcı plan uygulamasını onayladı. Çalışan uzantı 3.1.7 değiştirilmedi. Yeni sürüm veya dağıtım paketi üretilmedi.

## Uygulanan bölüm

`evaluation/` altında, uzantıdan ayrı yerel tarayıcı laboratuvarı kuruldu. Kaynak görselin piksel koordinatları tek referans: 1200 piksel dilimler, 200 piksel örtüşme, açık model ölçeği ve kaynak dönüşümü. Örtüşen adaylar birleştirilir; belirsiz veya balonla eşleşmeyen yazılar korunur. RT-DETR yazı grupları/balonları ile bağımsız PP-OCR satır adayları ayrı raporlanır. Model dosyaları sabit revizyon ve SHA-256 ile denetlenir.

Elle kontrol etiketi çizme, balona bağlama, kayıt/yeniden açma, taslak durumu ve IoU tabanlı ayrı tespit/eşleştirme ölçümleri eklendi. Model tahmininden otomatik insan etiketi üretilmez. Bağımsız satırların yazı grupları dışında kalması tanılama raporudur; doğrulanmış kaçak veya otomatik birleştirme kararı değildir.

Veri kaynağı: kullanıcının verdiği [bölüm174](https://asurascans.com/comics/revenge-of-the-iron-blooded-sword-hound-1bb35e56/chapter/174) ve aynı serinin bölüm173'ü. 18 + 21 = 39 dosya; banner/başlık/son kredi görselleri dahildir. **39 farklı temsili çizgi roman sayfası sayılmaz.** Hepsi development verisi; seri bazında bağımsız test ayrımı ve insan kontrolünden geçmiş etiketler yok.

## Gerçek Brave ölçümleri

Brave 155.0.8059.40, izole geçici profil; ONNX Runtime Web 1.30.0. WebGPU adaptörü AMD / rdna-2. API anahtarı, ücretli model çağrısı veya dış servise görsel yükleme kullanılmadı. Bu sonuçlar bu makinenin yerel laboratuvarına aittir.

900 × 16000 piksel `chapter-174/002.webp`, 16 dilim; SHA-256 `846eec925e1b44244f08f5a0963ab9579dc6ce9c4443d24a9738cbbe9e146118`:

| Yol | Adaylar | Çıkarım | İlk model yükleme | Sınır |
|---|---|---:|---:|---|
| RT-DETR int8 / WASM | 13 yazı grubu, 13 balon | 30,53 sn | 1,48 sn | 3 yazı inceleme gerektiriyor |
| RT-DETR fp32 / WASM | 14 yazı grubu, 14 balon | 56,49 sn | 0,91 sn | 3 yazı inceleme gerektiriyor |
| PP-OCR / WASM | 44 satır bileşeni | 4,85 sn | 0,45 sn | Grup veya balon tespiti değil |
| PP-OCR / WebGPU | 44 satır bileşeni | 2,42 sn | 0,53 sn | İlk GPU shader hazırlığı dahil |
| RT-DETR fp32 / WebGPU | Sonuç yok | Hata | — | AveragePool `ceil_mode` çekirdeği desteklenmiyor |

Hata görünür kaydedildi; CPU'ya sessiz geçişle GPU başarılı gösterilmedi. RT-DETR için int8 WebGPU ayrıca doğrulanmadı. PP-OCR uygulaması olasılık haritasının bağlı bileşenlerinden kutu çıkarır; tam DB çokgen/unclip ve diyalog gruplaması henüz uygulanmadı. ONNX dönüşümü Paddle kaynak modeliyle eşdeğerlik testinden geçmedi.

İlk karşılaştırmada 44 bağımsız satır adayının 34'ü tek yazı grubunun içinde, 3'ü birden fazla grubun içinde, 7'si grupların dışında. Sonuçlar `evaluation/reports/detector-comparison.json` içinde. Satır ile diyalog grubu farklı birimlerdir; bu sayılardan doğruluk oranı çıkarılmaz.

**Bölüm174'ün 18 dosyası tek komutla sırayla tarandı:** PP-OCR WebGPU, son koşuda 638 satır bileşeni adayı; toplam iş duvar saati **12,48 saniye** (model yükleme, decode, çıkarım ve rapor yazma dahil; başlangıç sayfa/arayüz açılışı hariç), çıkarım toplamı 10,15 saniye. Bu süre çeviri veya tamamlanmış balon yerleşimi süresi değildir. İlk görüntü GPU hazırlığını taşır, sonraki görüntüler sıcak oturum kullanır. Tarayıcı sayfa ve konsol hatası: 0. Kanıt: `evaluation/reports/brave-ppocr-chapter174-measured.json` ve görsel başına raporlar. Eski koşuda 641 aday ve 10,32 saniyelik yalnız çıkarım toplamı vardı. Koşular arasındaki üç adaylık farkın nedeni henüz ayrıştırılmadı; GPU/olasılık eşiği tekrarlanabilirliği ayrıca ölçülmeli. Süreler uçtan uca çeviriyle karıştırılmamalı.

## Kontroller

- Laboratuvar birim/sunucu testleri: **19/19**; mevcut uzantı test dosyaları: **2/2**. Komut: `node --test evaluation/tests/*.test.mjs tests/geometry.test.js tests/model.test.js`.
- Kaynak/model dönüşümü: kare olmayan görüntü, H/W sırası, dilim sonu, letterbox sınırı, tekrarlar, belirsiz balon, yanlış eşleşme ve boş kalite durumları sınandı.
- İzole Brave UI: DPR 1 / 1,25 / 2 ve pencere genişliği 1000 / 600; görsel–SVG dış sınır farkı altı durumda 0 CSS piksel. Elle çizim, etiket kaydı/yeniden açma ve model yüklenirken iptal edilen işin sonuç yazmaması geçti. Test etiketleri yalnız bellekteydi. Kanıt: `evaluation/reports/browser-ui-check.json`.
- Bütün yeni `.mjs` dosyaları sözdizimi kontrolünden geçti.
- Checkpoint'teki **23 başlangıç dosyasının SHA-256 değerleri aynı**. Kaynak ZIP hash'i aynı: `57ff4a8ad58376d92043195ecbc4292859cba1dce3b2125e3fc8cc1122df2f7a`.

## Açık kapılar ve sonraki iş

1. Farklı çizim tarzı/seri ve zor örneklerle veri kümesini genişlet; en az 35 temsili sayfa ve 200 insan kontrolünden geçmiş yazı bölgesi oluştur. Komşu bölümleri bağımsız geliştirme/test örneği sayma.
2. İncelenecek 7 dış aday ve belirsiz eşleşmeleri görselde sınıflandır. PP-OCR DB çokgenleri ve satır gruplaması; dilim kenarında ikinci geçiş ve iç balon şekli henüz gerekli. Recall/precision ve tam başarılı sayfa oranını bundan sonra ölç.
3. RT-DETR hızını ve GPU uyumunu çöz veya başka balon dedektörü karşılaştır. Tepe bellek, çoklu görsel p50/p95, model/cihaz varyasyonu henüz kapsamlı ölçülmedi; son dedektör kararı verilmedi.
4. Gerçek okuyucu DOM'unda object-fit/transform/lazy-load, MV3/offscreen/CSP, devam eden GPU işlemi sırasında iptal ve kalıcı iş devamı henüz denenmedi. Yerel SVG hizası canlı sitede bütün balonların doğru yerleştiği anlamına gelmez.
5. Kalite kapısından sonra P3 şekil maskesi ve Türkçe dizgi, P4 uzantı entegrasyonu, P5 Gemini/OpenRouter modelleri/çeviri profili, P6 kalıcı bölüm kuyruğu. Bu prototipin yerel sıralı taraması P6 tamamlandı demek değildir.

Çalıştırma ve etiketleme: [laboratuvar kılavuzu](../evaluation/README.md). Geri dönüş: [checkpoint kaydı](GERI-DONUS-NOKTASI-2026-10-13.md). Kaynak HEAD `7c64711f310fe4a88ed3e34226db2136590e44b0`, sürüm etiketi `v3.1.7`, checkpoint etiketi `checkpoint/2026-10-13-before-page-mode`. Yeni çalışma ek dosyalardır; yeni sürüm commit/tag veya push yapılmadı.
