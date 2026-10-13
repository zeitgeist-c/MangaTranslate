# Tam sayfa uygulama takibi

13 Ekim 2026. Kullanıcı bütün planın uygulanmasına devam edilmesini istedi. **Canlı API testi yapılmaması, modellerin kullanıcı tarafından denenmesi** kararı bu tarihte ayrıca verildi.

Bu kayıt uygulama ilerlemesini kabulden ayırır. Manifest 3.5.0 bir önizleme adayıdır; %98 tespit kalitesi veya bütün sayfalarda kusursuz yerleşim iddiası değildir. Önceki 3.1.7 checkpoint'i değişmez.

| Gereksinim | Uygulama | Kabul durumu |
|---|---|---|
| R01 geri dönüş | Değişmez 3.1.7 ZIP, Git bundle, şifreli Brave storage yedeği korunuyor | Kaynak geri açma ve hash kontrolü var; canlı Brave restore yok |
| R02 doğru yerleşim | Kaynak-piksel kutular, kimlikli cevaplar, object-fit/position ve yeniden boyut/kaydırma katmanı | Fixture ve hedef okuyucunun tek görselinde 1280/700 genişlikte 0 CSS piksel sınır farkı; tüm alanların doğruluğu açık |
| R03 bütün yazılar | Yerel RT-DETR + bağımsız PP-OCR, eşleşmeyenleri kontrol listesinde tutma | İnsan etiketli %98 kabul kapısı geçilmedi |
| R04 çizimi koruma | Düz zemin iç alanı, yalnız harf piksellerini temizleme, okunabilir minimum font, sığmama bildirimi | Gerçek örnekte kısmi yerleşim; dokulu/renkli veya belirsiz alan otomatik temizlenmiyor |
| R05 tek tık sıralı bölüm | Sınırlı lazy-load tarama, mevcut bölümde sıralı işleme, sonraki bölüme otomatik geçmeme | 18 gerçek dosya / sentetik çeviriyle uçtan uca sıralı işleme geçti; bütün balonların kaliteli çevirisi anlamına gelmez |
| R06 maliyet/hız | Sağlayıcı seçimi, 6 kırpma/istek, model/profil/sözlük/bağlam cache'i | Yerel modeller ölçülüyor; canlı maliyet testi kullanıcı kararıyla kapsam dışı |
| R07 manuel akış | Alan Seç/Oto Çevir korunuyor; seçili sağlayıcıyla çalışıyor | Eski regresyonlar + yeni adaptör testleri |
| R08 iptal/devam | Kalıcı sekme/URL iş durumu, IDB sonuç cache'i, geç cevap reddi, belirsiz çağrıda açık yeniden deneme | Güncel tek görselde resume ve worker restart sonrası 0 yeni sağlayıcı çağrısı; belirsiz ücretli istekte otomatik tekrar yok |
| R09 sağlayıcı/model listesi | Gemini/OpenRouter sekmeleri, 8 OpenRouter modeli; Haiku4.5 hariç, Contributor ayrı onay | Katalog kimlikleri resmi API'de doğrulandı; gerçek hesap erişimi kullanıcı testinde |
| R10 manga dili | Ortak profil, karakter/sahne sesi, seri adları, kullanıcı terim sözlüğü, bozuk OCR'da uydurmama | Sözleşme testleri; Türkçe kalite değerlendirmesini kullanıcı yapacak |

## Mimari

Yerel modeller ve ONNX JS/WASM uzantıyla paketlenir. Offscreen belge kaynak görseli dilimler, yerel koordinatları üretir, kimlikli kırpmalar hazırlar. Service worker API anahtarlarını tutar; sayfaya/çevrilen görsel sunucusuna anahtar gönderilmez. Model yalnız kırpma metnini okur/çevirir, yerleşim koordinatı üretmez.

İlk uygulamada yerel OCR tanıyıcı yerine **yerel kutuya bağlı görüntü kırpması + seçili modelle okuma/çeviri** yolu kullanılıyor. Bu, ana plandaki iki aday yoldan biridir. Dikey Japonca ve SFX desteği kanıtlanmış sayılmaz. Bağımsız satır dedektörünün doğrulanmamış sonuçları otomatik diyalog grubu yapılmaz.

Şekil çıkarımı baskın düz rengin bağlı iç alanı ve güvenli çevre kontrolüdür; beyaz/siyah yanında doğrulanmış tek renk zemin korunur. Yalnız eski harf pikselleri değiştirilir. Katman, kaynak kırpması üzerine ön birleştirilir; böylece ölçeklemede saydam harf maskesinin eski yazıyla tekrar karışıp gölge bırakması önlenir. Dokulu zemin ve çizim boyanmaz. Manuel Alan Seç fallback'i tam otomatik kalite hedefinin yerine geçmez.

İş kaydı yalnız URL/kimlik/durum/hata bilgisi içerir; büyük kırpmalar kalıcı Chrome storage'a yazılmaz. Görsel hash'i + tespit sürümü ve sağlayıcı/model + profil/sözlük + önceki bağlam çeviri cache'ini ayırır. Her görselin başlangıç bağlamı sabitlenir; devam etme, önceki sayfaları yeni bağlamla tekrar ücretlendirmez. Tamamlanmış çeviriler IDB'de tutulur. İstek gönderildikten sonra cevap kaybolursa otomatik ücretli tekrar yerine belirsiz durum tutulur.

## Açık kabul kapıları

35 temsili farklı sayfa / 200 insan kontrolünden geçmiş bölge; bağımsız seri bazında geliştirme/kabul ayrımı; tespit precision/recall ve tam başarılı sayfa oranı; cihazlar arası bellek/hız; gerçek okuyucuda yaşam döngüsü; Türkçe kalite. İnsan etiketlerini model çıktısından üretip kabul geçilmiş gösterilmeyecek. Canlı sağlayıcı çağrıları kullanıcının 13 Ekim kararıyla yapılmayacak.

## Doğrulanmış koşular ve sınırları

- `node --test tests/*.test.js tests/*.test.mjs evaluation/tests/*.test.mjs`: 36/36 geçti. Eski fallback yardımcıları için regresyonlar korunuyor; yeni normal işte fallback/otomatik ücretli tekrar kapalıdır. 11 model adaptörü sahte yanıtlarla doğrulandı.
- Brave 155.0.8059.40, ayrı sentetik profil: 18 görsellik tam bölüm akışı 679,73 saniye sürdü; 21 sahte sağlayıcı çağrısı, 45 yerleştirilen alan, 387 kontrol adayı, 0 sayfa/worker hatası. **Bu, dilim/maske iyileştirmesi öncesi d3-small koşusudur.** Sonraki değişikliklerin bütün bölümde aynı sayılara ulaşacağı iddia edilmiyor. Kontrol adaylarının bir kısmı küçük gürültü/SFX/banner olabilir; sayılar doğrulanmış hata sayısı değildir. Dört sıfır adaylı görsel önceki koşuda done sayılmıştı; güncel kod bunları da inceleme gerektirir diye işaretler.
- Güncel d4-standard, 900×16000 kaynak: 19 aday, 7 sentetik çeviri katmanı, 12 kontrol alanı. Soğuk koşu 56,67 saniye, cache'den tekrar yaklaşık 4,2 saniye. Devam/restart sonrası 0 yeni sağlayıcı çağrısı. 1280/700 genişlik ve kaydırmada dış sınır farkı 0. Tekrarlı içerik enjeksiyonunda değişken çakışması giderildi; son koşu hatasız.
- Gerçek Asura okuyucu HTML/CSS'inde yalnız önbellekteki ikinci görsel bırakılarak kontrol yapıldı: 7 katman, 12 kontrol; 1280/700 genişlikte sınır farkı 0. Diğer görseller testte kaldırıldı; **tam canlı bölüm/lazy-load kabulü değildir**. API çağrıları engelliydi.
- Türkçe İĞÜŞÖÇ/ıişğüöç çizimi, aşırı uzun metinde `text_overflow`, yama dışındaki sanat pikselinin korunması geçti. Ekran görüntüsü incelemesinde bulunan harf gölgesi ön birleştirmeyle düzeltildi.
- Küçük yerel model laboratuvarda 9,24 saniye (eski ilk geçiş); standart 30,53 saniye. Bu süreler tam bölüm/çeviri süresi değildir. GPU küçük model MaxPool ceil_mode ile hata verdi. Stride=1 bayrağı kaldırılan türev üç dilimde WASM'da birebir eşdeğer çıktı verdi; fakat GPU'da sıfır aday üretti ve 30,88 saniye sürdü. Türev **reddedildi, üretim paketinde yok**. GPU uyumunu yalnız hata vermemeyle başarılı saymadık.
- Veri kümesi 101 dosya, dört seri; 35 benzersiz hash'li inceleme kuyruğu: 10 development, 20 acceptance, 5 stress. İnsan kontrolünden geçmiş bölge sayısı 0. SFX ignore-area ölçümü var; gerçek diyaloga dokunan tahmin SFX diye saklanamaz. Skorlayıcı şu an kabulü false raporluyor.
- Bellek örnekleme aracı hazır, fakat alınan örnekte test tarayıcısı kapanmış olduğundan `measured=false`. 0 MB kullanım iddiası yok; tepe bellek kabulü açık.

Kanıtlar `evaluation/reports/` altında yereldir: extension-full-chapter.json, extension-resume-smoke.json, live-reader-smoke.json, pool-rewrite-parity.json. Telifli görseller ve geçici test profilleri kaynak/pakete alınmaz. Aynı rapor dosyası tekrar koşuda değişebileceğinden sürüm özeti ayrıca kaynakta tutulur.

Özet kanıt: `evaluation/evidence-2026-10-13.json`. Paket `MangaLensTR-3.5.0.zip`, 47.774.933 bayt, 30 dosya; her dosya çalışma alanındaki kaynakla SHA-256 eşleşti. ZIP SHA-256 `8d42f2e01cc1b4e24017bf52c77d0684fbcc0e4419689bb0f176ea59ad225edc`. Yedekler, anahtarlar, gerçek görseller ve değerlendirme raporları pakette yok. Eski v3.2.0–v3.4.0 etiketleri bulunduğundan yeni kaynak için benzersiz v3.5.0 seçildi; tarihî etiketler değiştirilmedi. Önizleme paketlemesi insan etiketli kabulün geçildiği anlamına gelmez.

## Geri dönüşte yeni veri

13 Ekim 2026 ek düzeltme: güncel aday 3.5.1. Kullanıcının duraklat/devam kilitlenmesi giderildi; 42 otomatik kontrol ve izole Brave düğme/uzantı testleri geçti. Ayrıntı ve açık kalan kalite sınırı: [3.5.1 düzeltme kaydı](DURAKLAT-DEVAM-DUZELTMESI-3.5.1.md). Yukarıdaki 3.5.0 kanıtları önceki sürümün tarihî kaydıdır.

3.1.7 checkpoint dosyalarına dokunma. Gelecekte “geri dön” istenirse önce yeni kaynak/WIP ve güncel local/sync storage yanında **bu uzantının IndexedDB verisi** de ayrı yeni kurtarma yedeğine alınmalı. Mevcut anahtar/sözlük/job/cache verileri korunmadan eski yedek canlı profile uygulanmaz. Eski DPAPI arşivinin kapsamı yeni cache'i içeriyor diye varsayılmamalı.
