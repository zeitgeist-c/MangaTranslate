# MangaLens TR 3.5.1 — 13 Ekim 2026

Kapsam: kullanıcının ekran görüntüsündeki “Önceki adımın bitmesi bekleniyor” durumunda kalma ve duraklat/devam sonrası ilerlememe hatası. Canlı sağlayıcı testi kullanıcı talimatıyla yapılmadı.

## Neden ve düzeltme

3.5.0'da Duraklat yalnız bayrak değiştiriyor; beklenen runtime mesajını sonlandırmıyordu. Yanıt dönene kadar running açık kaldığı için Devam et reddediliyordu. Yanıt hiç dönmezse süre sınırı da yoktu. İptal komutu offscreen tarafında bulunmasına rağmen content/background tarafından iletilmiyordu. Önbellek okumaları da uzun yerel tespitin arkasında aynı sırayı bekliyordu.

3.5.1 içerik isteğine AbortController, işlem kimliği ve sonlu bekleme süresi ekler. Yerel tespit/çizim iptali yalnız isteğin sahibi sekmeden iletilir. Devam et, temizleme henüz bitmediyse talebi saklar ve tek tıklamayla devam eder. Geç sonuçlar ve eski ilerleme mesajları yeni işi değiştirmez. Tespit 180, çizim 60, çeviri 120, kısa kayıt/ayar istekleri 15 saniyeyle sınırlıdır; background yerel sınırları biraz daha kısadır. İptal edilen WASM çekirdeği yürüyen tek çıkarımı bitirdikten sonra durabilir; içerik bu çekirdeği bekleyerek kilitlenmez.

Ücretli sağlayıcı isteği duraklatma sırasında otomatik tekrarlanmaz veya kaybedilmez: yürüyen çağrı aynı önbellek kimliğinde paylaşılır, cevabı korunur. Offscreen önbelleği ağır çıkarım sırasından ayrıldı. Zaten sayfada gösterilen tamamlanmış/kontrol gerektiren katmanlar devamda tekrar işlenmez; sekme yenilenince önbellekten yeniden çizilebilir.

## Doğrulama

- Yeni içerik testleri eski kaynakta başarısız oldu; düzeltmeyle geçti: hiç dönmeyen tespit sırasında duraklat/devam, süre sınırı sonrası hata/yeniden deneme, geç ilerleme izolasyonu.
- Background/offscreen testleri: sekmeler arası iptal engeli, doğru işlem kimliği, bekleyen çıkarım sırasında önbellek erişimi, iptal edilen sıradaki işin hiç çalışmaması.
- Sağlayıcı sözleşmesi: aynı bekleyen çeviriye devamda iki abone, yalnız bir sentetik sağlayıcı işlemi ve tamamlanan cevabın önbellekten yeniden kullanılması.
- Toplam 42 otomatik kontrol geçti; yerel HTTP kontrolü izinli ortamda çalıştırıldı.
- İzole Brave 155.0.8059.40 gerçek düğme testi: tespit beklerken ve çeviri beklerken iki duraklat/devam, tek sentetik sağlayıcı işlemi, bitmiş iş ve geç cevabın yok sayılması. Ağ engellendi; gerçek API çağrısı sıfır.
- Yüklü uzantı / gerçek yerel modeller / önbellekli örnek görsel: 19 aday, 7 kaplama, 12 kontrol; 1280 ve 700 genişlikte konum farkı 0. Türkçe çizim, taşma reddi, worker yeniden başlatma ve devamda sıfır yeni sağlayıcı çağrısı geçti.

Tekrarlanabilir komutlar: ana klasörde node --test tests/*.test.js tests/*.test.mjs evaluation/tests/*.test.mjs; evaluation klasöründe node tools/page-lifecycle-smoke.mjs ve node tools/extension-smoke.mjs (BRAVE_EXECUTABLE, ikincisinde izole ML_TEST_PROFILE). Ham yerel raporlar evaluation/reports altında, kullanıcı verisi ve paket dışında tutulur.

Bu düzeltme tespit kalitesinin kabul edildiği anlamına gelmez. Örnek görseldeki 12 kontrol alanı halen otomatik kaplanmıyor. İnsan etiketli %98 kalite kapısı, gerçek model çeviri kalitesi ve tam bölüm kabulü açıktır. 3.1.7 geri dönüş noktası ve 3.5.0 paketi korunmuştur. Güncel sürümün kullanılması için Brave'de uzantı ve manga sekmesi yeniden yüklenmelidir.

Paket: MangaLensTR-3.5.1.zip, 47.776.013 bayt, 30 dosya. Her ZIP dosyası çalışma alanındaki kaynakla SHA-256 eşleşti. ZIP SHA-256: 61dfbc5f088b6a70b58ce45ca8a574587cbb5e3c7a2b1249efadcb592c2c3abe. Kalıcı özet: evaluation/evidence-3.5.1.json. Özgün 3.1.7 ZIP ve DPAPI arşivi hashleri yeniden doğrulandı; değişmedi.
