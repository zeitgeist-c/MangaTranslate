# MangaLens TR 3.6.0 — uygulama ve doğrulama

13 Ekim 2026. Kullanıcı kompakt koyu popup, ayrı ayarlar sekmesi, iki sağlayıcıda çoklu anahtar listesi ve sayfa kontrol panelinin birlikte yenilenmesini onayladı. Uygulama onaylanan plana göre tamamlandı; tespit kalitesi algoritması değişmedi.

| Gereksinim | Sonuç ve kanıt |
| --- | --- |
| Küçük popup | 360 piksel; otomatik sağlayıcı/model kaydı, aktif anahtar etiketi, üç çeviri aracı ve tek satır istatistik. Kayıt hatasında seçim geri alınır. |
| Ortak anahtar listesi | Gemini ve OpenRouter: maskeli kart, aktif seçim, ekle/etiket değiştir/sil/kontrol et. Anahtar işlemleri background’da sıralı. |
| Veri aktarımı | Google kayıtları korunur. Eski OpenRouter anahtarı yalnız liste yoksa aktarılır; boş liste silinen anahtarı diriltmez. Eski tekil alan aktif anahtarla eşlenir. |
| Ayrı ayarlar | options_ui, mevcut sekmeyi odaklama; API, tercihler, hakkında. Kirli tercihleri dış değişiklik ezmez; ayrılma uyarısı ve açık Kaydet. Seri sözlüğü korunur. |
| Sayfa paneli | Katlama taramayı durdurmaz; durum/sayaç; görünüm araçları açılır bölümde. Kapat duraklatır; hesap engeli katlanmış halde de görünür. |
| Anahtar sınırı | Yalnız tam popup/options URL’sinden yönetim mesajı kabul edilir. Yanıtlar maskelidir; anahtar sadece local storage ve kendi sağlayıcı başlığında. |
| Kontrol anlamı | OpenRouter GET /api/v1/key, Google GET /v1beta/models; çeviri üretilmez. Başarı model erişimi/kredi/yaş onayı iddiası değildir. Eski “çalışıyor” işaretleri yeni bağlantı kontrolü sayılmaz; eski test verileri silinmez. |
| Doğrulama | Mevcut 47 + yeni 7 = 54 otomatik kontrol geçti. İzole Brave arayüz, panel ve yüklü yerel model kontrolleri ayrıca yapıldı. |

Yeni anahtar mesajları ML_KEYS_LIST/ADD/RENAME/ACTIVATE/DELETE/CHECK; provider gemini/openrouter, kayıt işlemlerinde id kullanılır. Eklerken key/label, ad değiştirirken label iletilir. Safe yanıt id/label/masked/active/status/message/testedAt içerir; key içermez. Yeni yerel alanlar openrouterApiKeys/activeOpenrouterApiKeyId. Mevcut Google alanları ve Google kayıtlarındaki ek bilgiler korunur. Silme/kontrol yarışında geç cevap silinen anahtarı geri getirmez; eşzamanlı etiket/aktif değişikliği korunur. Kontrol 15 saniyede zaman aşımına uğrar; ağ kontrolü anahtar işlem kuyruğunu kilitlemez.

İzole Brave 155.0.8059.40: aktarım, iki sağlayıcıda çoklu kayıt, iki ayarlar sekmesi, kayıt hatasında seçim geri alma, kayıtlı anahtarın DOM’da tam görünmemesi, 1000/500/360 genişlik, büyütülmüş metin, son anahtarda düğmelerin kapanması, ayarlar sekmesini tekrar kullanma ve worker yeniden başlatma geçti. Metadata yanıtları sentetikti; gerçek anahtar ve canlı sağlayıcı kullanılmadı. Panelde katlama/duraklatma/engeli gösterme/görünüm/kapama ayrı fixture ile doğrulandı.

Yüklü uzantı ve gerçek yerel model örneği: 19 aday, 7 sentetik kaplama, 12 kontrol; iki okuyucu genişliğinde dış sınır farkı 0. Türkçe karakter/taşma/sanat koruma ve worker restart sonrası devamda yeni sağlayıcı çağrısı 0. Eski test profilindeki derlenmiş importScripts önbelleği ancak uzantı yenilenince güncellendi; kullanıcıya da uzantı ve eski sekmeleri yenilemesi söylenmelidir. Bu tek görsel/sentetik çeviri kanıtıdır; gerçek model veya tam bölüm kalite kabulü değildir.

Kontroller: node --test tests/*.test.js tests/*.test.mjs evaluation/tests/*.test.mjs; evaluation altında tools/settings-smoke.mjs, tools/page-lifecycle-smoke.mjs ve tools/extension-smoke.mjs. Ham raporlar ve ekran görüntüleri evaluation/reports altında yerel kalır. Sabit özet evaluation/evidence-3.6.0.json. Önceki paketler, tarihî Git etiketleri ve 3.1.7 checkpoint’i korunur. GitHub push/deploy yapılmaz.

Son arayüz koşusu klavyeyle anahtar ekleme, silme onayı, sağlayıcı/model değişimi, Contributor onayı, katalog kontrolü, aç/kapat ve üç çeviri düğmesinin gerçek content-script bağlantısını da doğruladı. Oto Çevir düğmesi mevcut sekme durumuna göre açar/kapatır. Otomatik kayıt sürerken input’un eski değere sıçraması gerçek düğme testinde yakalanıp düzeltildi; kayıt bitene kadar ilgili kontroller kilitlenir.

Paket MangaLensTR-3.6.0.zip: 47.776.758 bayt, 33 dosya; her dosya kaynakla SHA-256 eşleşti. ZIP SHA-256 63a7d65e78da5b842f8611017d96495e9b3f7a71d658a3aba0d264473f995e67. Paket testleri 33/33, bütün otomatik kontroller 54/54 geçti. 3.5.2 ZIP, 3.1.7 kaynak ZIP ve şifreli Brave yedeğinin eski hashleri yeniden doğrulandı. Güncellerken aynı uzantı kimliğini korumak için mevcut yüklenen klasör güncellenmeli ve Brave’de uzantı/okuyucu/ayarlar sekmeleri yeniden yüklenmelidir.
