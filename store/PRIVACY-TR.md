# MangaLens TR Gizlilik Politikası

Tarih: 14 Ekim 2026 — sürüm 3.8.6 için taslak

İletişim: zeitgeist.geeker@gmail.com

MangaLens TR, kullanıcının açtığı çizgi roman sayfalarında metin alanlarını bulur ve kullanıcının seçtiği yapay zekâ sağlayıcısıyla Türkçe çeviri gösterir.

## İşlenen bilgiler

Uzantı, çeviri işlemi için sayfadaki görselleri ve görsel adreslerini işler. Bölge tespiti cihaz üzerinde paket içindeki modellerle yapılır. Çeviri istediğinizde seçilen görsel kırpmaları, kaynak/çeviri metinleri, seri adı, sözlük ve yazdığınız yönergeler seçtiğiniz Gemini veya OpenRouter hizmetine gönderilebilir. Bunlara hassas bilgi eklemeyin.

API anahtarları sağlayıcıya kimlik doğrulamak için kullanılır; uzantının yerel tarayıcı depolamasında tutulur. Anahtar yönetimi arayüzü kayıtlı anahtarları maskeler. Anahtarlar uzantı tarafından tarayıcı senkronizasyon deposuna kaydedilmez. Tarayıcı profilinize erişebilen yazılımlara karşı mutlak koruma vaat edilmez.

Tercihlerin bir bölümü tarayıcının senkronizasyon deposunda tutulur ve tarayıcı hesabınızın eşitleme ayarlarına tabi olabilir. İş durumu, ilgili sayfa adresi, bölgeler, sözlük ve çeviri önbelleği yerel depolamada/IndexedDB'de saklanabilir. Bunlar işlemi sürdürmek ve tamamlanan sonuçları yeniden kullanmak içindir.

## Üçüncü taraflar

Geliştirici, çevirileri alan kendi sunucusunu veya uzantı içinde analitik/reklam izleme hizmetini işletmez. Ancak çeviri sırasında veriler seçtiğiniz üçüncü taraf sağlayıcıya gider. OpenRouter istekleri yönlendirdiği model sağlayıcısını da kapsayabilir. İşleme, saklama ve eğitim koşulları seçilen model ve hesap ayarlarına bağlıdır. Contributor gibi veri katkısı koşulu bulunan modellerde istek/yanıtlar eğitim amacıyla kullanılabilir; uzantı tüm modeller için sıfır saklama veya eğitim dışında kalma garantisi vermez.

- Google: https://ai.google.dev/gemini-api/terms
- OpenRouter: https://openrouter.ai/privacy

Veriler geliştirici tarafından satılmaz veya reklam profili oluşturmak için kullanılmaz. Sağlayıcılara aktarım kullanıcının istediği çeviri işlevini yerine getirmek içindir.

## Kontrol ve silme

API anahtarlarını uzantının ayarlar sayfasından silebilir ve sağlayıcı hesabınızdan iptal edebilirsiniz. Tarayıcının uzantıya ait site/depolama verilerini temizlemek veya uzantıyı kaldırmak yerel kayıtları kaldırabilir; tarayıcı yedekleri ve sağlayıcılardaki kayıtlar ayrı kurallara tabidir. Sağlayıcıya gönderilmiş verilerin silinmesi için ilgili sağlayıcının başvuru kanallarını kullanın.

Bu metin yayınlanmadan önce herkese açık bir HTTPS adrese yerleştirilmelidir. Yerel Markdown dosyası tek başına mağaza gizlilik URL'si yerine geçmez.
