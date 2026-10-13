# MangaLens TR 3.5.2 — OpenRouter hesap erişimi

13 Ekim 2026. Kullanıcı 3.5.1’de 0 otomatik, 5 kontrol ve 15 hata bildirdi. İlk sağlayıcı hatası HTTP 403 ve “18+ age confirmation” idi. Kaynak bu hatayı her görselde tekrarlıyor, bölüm sonunda normal tarama özeti gösteriyordu. Yaş onayı OpenRouter hesabından kullanıcı tarafından yapılır; uzantı bu koşulu kaldıramaz.

Düzeltme: bilinen yaş onayı hatası Türkçe yönerge, sabit güvenilir ayar URL’si ve iş durdurma koduyla iletilir. İlk etkilenen görselde iş blocked durumuna geçer; sonuçlar korunur, kalan görseller işlenmez. Devam et hesap engelini otomatik yeniden denemez; kullanıcı onayı tamamladıktan sonra Hatalıları yeniden dene ile açıkça tekrar çağrı yapabilir. Model değişimi için popup’tan yeni tarama gerekir; sessiz alternatif modele geçiş yoktur. 401 anahtar ve 402 kredi hataları da iş düzeyinde durdurulur. Diğer 403 içerik denetimi hataları yaş onayı olarak yorumlanmaz.

Yeni blocked önbellek kayıtları kod/yönergeyi korur. 3.5.1’in uncertain önbelleğindeki ve kaydedilmiş işindeki bilinen İngilizce yaş onayı hatası da tanınır; otomatik yeni API çağrısı yapılmaz. API anahtarları, gerçek hesap onayları ve canlı Brave profili değiştirilmedi. Önceki paket/etiketlerin üzerine yazmamak için yeni sürüm 3.5.2 seçildi.

Doğrulama: 47 otomatik kontrol geçti. İki yeni temel regresyon eski kaynakta başarısız oldu, düzeltmeyle geçti. Ek kontroller eski önbellekten/işten toparlanma, açık yeniden deneme, 401/402 ayrımı ve içerik denetimini yanlış sınıflandırmamayı kapsar. İzole Brave 155.0.8059.40 ağsız düğme testi yaş onayı mesajını, görünür doğru bağlantıyı, kalan görselin queued kalmasını ve Devam et’in tekrar çağrı yapmamasını doğruladı. Normal yüklü uzantı testi 3.5.2’de yerel modellerle geçti; örnek görsel 19 aday/7 kaplama/12 kontrol, iki genişlikte hizalama farkı 0, worker restart/devamda yeni sağlayıcı çağrısı 0. Bütün yanıtlar sentetik veya önbellekliydi; gerçek sağlayıcı çağrısı yoktur.

Bu sürüm hesap engeli yönetimini düzeltir; insan etiketli %98 tespit kabulü ve gerçek çeviri modeli kalitesi doğrulanmış sayılmaz. Kullanıcı hesabındaki onayın tamamlandığı tarafımızdan test edilmedi.

Resmi 403 kapsamı: https://github.com/OpenRouterTeam/docs/blob/main/api_reference/errors-and-debugging.mdx. Yaş onayı için kesin kanıt kullanıcının aktardığı gerçek hata mesajıdır; bütün 403 hatalarının bu anlama geldiği iddia edilmez. Kullanıcı adımı: https://openrouter.ai/settings/preferences.

Paket MangaLensTR-3.5.2.zip: 47.777.197 bayt, 30 dosya; her dosya kaynakla hash eşleşti. ZIP SHA-256 bb4c99223c252b705f2ce7e63860d86fa803a706c7920def0e326b8c7b3ca210. Kalıcı özet evaluation/evidence-3.5.2.json. Önceki 3.5.1 paketi ve 3.1.7 geri dönüş noktası değiştirilmedi.
