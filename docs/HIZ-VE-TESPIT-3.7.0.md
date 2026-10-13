# MangaLens TR 3.7.0 — hız ve kaçan yazı incelemesi

13 Ekim 2026. Kullanıcı aşırı yavaşlık ve üç okunabilir kırpmanın çevrilmemesini bildirdi. Sonraki açık kararı: özgün zemin benzerliği ikinci planda; hızlı, yazının yerinde okunaklı çeviri kartı gösterilsin ve özgün görsel dosyası korunsun. Gerçek sağlayıcı testine izin vermediği önceki karar korundu.

## Ölçülen nedenler

| Aşama | Önce | Yeni yol |
| --- | --- | --- |
| 900×16000 yerel model taraması | RT-DETR standard 32,56 sn + PP-OCR CPU 4,72 sn | PP-OCR GPU yaklaşık 0,84 sn; ağır model çalışmıyor |
| Aynı uzun görsel, hızlı yolun crop hazırlaması | PNG idle kodlamalı hazırlama 18,16 sn, sıcak önbellek 17,23 sn | Hazırlama yaklaşık 1,01 sn, sıcak önbellek 0,14 sn |
| Aynı 12 kartın çizimi | 12,11 sn | yaklaşık 0,046 sn |
| 18 görselin son sürüm tam bölüm testi | Hızlı ilk prototip 33,43 sn | Kısaltılmış viewport beklemesiyle 18,33 sn; 175 kart, 93 kontrol, 0 işlem hatası |

Süreler Brave155.0.8059.40 / yerel fixture üzerinde ölçüldü. Tam bölüm koşusunda 37 sağlayıcı yanıtı sentetikti; çeviri bekleme toplamı 0,25 sn idi. Gerçek AI gecikmesi ve ücretleri bu 18,33 saniyeye dahil değildir. Eski 11 dakikalık farklı dedektör sürümü doğrudan karşılaştırılabilir kabul edilmedi.

OffscreenCanvas.convertToBlob ve FileReader yolu görünmeyen belgede her crop için yaklaşık bir saniyelik idle zamanlaması biriktiriyordu. Bounded HTML canvas toDataURL encoder aynı PNG piksellerini senkron üretir; 160×80 renk geçişi/Türkçe karakter fixture’ında iki kodlayıcının RGBA çıktısı birebir eşleşti. Kaynak kırpma/çeviri protokolü hâlâ PNG data URL. Aynı görüntüyü kart çiziminde tekrar indirmek ve zemini analiz etmek kaldırıldı. Ağ kontrolü/gerçek çeviri yapılmadan metin üretildiği iddia edilmez.

## Uygulama kararları ve gereksinim takibi

| Gereksinim | Durum |
| --- | --- |
| Ağır balon tespiti varsayılan olmasın | PP-OCR kaynak-piksel satır/kelime gruplama varsayılan. Ayrıntılı ve küçük RT-DETR isteğe bağlı. |
| GPU çalışsın, hata halinde iş kaybolmasın | Aynı hash doğrulanmış PP-OCR modeli; desteklenmeyen GPU/create/run hatasında bir kez WASM’a geçer. RT-DETR GPU etkinleştirilmedi. |
| Üç zor örneğin yazıları görünür olsun | Mor, başlık ve siyah zemin kırpmalarında ikişer grup; 6/6 yerel tespit ve Türkçe sentetik kart yerleşimi, 0 sorun. |
| Zemin eşleştirme pahalı olmasın | Sade opak koyu kartlar. Özgün dosya değişmez; Orijinal/çeviri katmanı açıp kapatır. |
| Bölüm başlangıç beklemesi azalsın | Bütün viewport adımları korunur; normal adım 160→40 ms, sayfa altı stabilizasyonu 160 ms kalır. Görsel decode beklemesi/sınırlar korunur. |
| Sağlayıcı beklemesi doğru ölçülsün | OpenRouter seri çağrıları Google’ın 2,5 sn taban kuyruğundan ayrıldı. Google aralığı korundu. 429 ve bilinen veri politikası 404 ilk hatada durur. |
| Sonuç sayısı yanıltmasın | Özet gösterilen çeviri kartlarını, işlenen görselleri, kontrol alanlarını ve hataları ayrı sayar. Kontrol listesi ve özet aşama sürelerini gösterir. |

Yeni processingVersion page-v5 ve detection-v5 cache anahtarları eski bölge gruplarını karıştırmaz. Eski Standart ayarı fast’e eşlenir; explicit small seçimi korunur, yeni detailed seçeneği ağır modeldir. 3.6 işine devamda yeni tarama gerektiği açıklanır; eski cache silinmez veya otomatik ücretli tekrar yapılmaz. Çok küçük/kesilmiş bölgeler API’ye gönderilmez; taşan/çakışan kartlar görünür sorun olarak korunur. Kelimeyi keyfi kesme veya min font altına küçültme yoktur.

## Kanıt ve sınırlar

61 otomatik kontrol; gerçek GPU başarısızlığına karşı bir kez CPU fallback, seri OpenRouter kuyruğu, Google aralığı, 404/429 ayrımı, kaynak kutularında kart sığması ve metin gruplama dahil. Gerçek GPU/CPU PP-OCR karşılaştırması üç kırpma ve uzun örnekte aynı aday sayılarını ve koordinatları verdi (maksimum koordinat farkı 0); bu yalnız bu donanım/örnek kanıtıdır. Üretim GPU yolu gerçek offscreen belge içinde ayrıca çalıştırıldı.

İzole Brave’de kullanıcı kırpmaları, tam bölüm, kaydırma/iki genişlikte hizalama, Türkçe karakter, taşma, duraklat/devam, worker restart ve yeni API yönetimi test edildi. İşaretli üç kırpmanın yerel chapter174 dosyalarıyla eşleştirme denemesi güvenilir eşleşme üretmedi (en iyi korelasyonlar 0,44–0,60; kabul eşiği 0,85). Bu yüzden kırpma başarısı onların özgün tam sayfalarında doğrulanmış sayılmaz. Canlı model okuma/çeviri doğruluğu, insan etiketli %98 kalite ve bütün metinlerin bulunduğu iddiası halen açık kabul kapılarıdır.

Tekrar üretim: evaluation/tools/profile-detection.mjs (PROFILE_GPU=1 ile CPU/GPU); fast-regression-smoke.mjs; extension-smoke.mjs (FULL_CHAPTER=1, yeni izole profil); page-lifecycle-smoke.mjs; settings-smoke.mjs. Kırpmalar evaluation/.local/regressions altında özel yerel fixture; raporlar evaluation/reports altında. Görseller, anahtarlar, test profilleri ve rapor PNG’leri pakete/Git’e alınmaz. Kalıcı özet evaluation/evidence-3.7.0.json.

## Sonraki geliştirmeye bırakılan karar

Kullanıcının açık önceliği gereği zeminin rengini/dokusunu kopyalama, eski harfleri kusursuz temizleme ve özgün balon estetiğini yeniden kurma bu sürümün hedefi değildir. Bunlar ayrı kalite ve maliyet ölçümüyle sonraki geliştirme olarak ele alınacak; bugün ek AI/inpainting çağrısı yapılmaz. Kartların daha fazla metni görünür kılması çeviri hacmini ve gerçek sağlayıcı kullanımını artırabilir; daha düşük fatura garantisi verilmez.

## Dağıtım doğrulaması

MangaLensTR-3.7.0.zip: 47020012 bayt, 33 dosya. SHA-256: 5c615f0ec8aca7e419a02a86939d8c1a28124ee93ef14f0d7fedeacf16260639. Her arşiv girdisinin SHA-256 değeri kaynak dosyayla eşleşti. Önceki paketler korunur; gerçek sağlayıcı çağrısı yapılmadı.
