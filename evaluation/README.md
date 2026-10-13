# Tespit laboratuvarı — P1/P2 prototipi

Çalışan MangaLens TR 3.1.7 uzantısından bağımsızdır. OCR ile metin okuma, çeviri, yazı silme veya üretim balon dizgisi yapmaz. API anahtarı kullanmaz. Model çıkarımı yereldir; ilk kurulum model/veri indirmesi için internete çıkar.

PowerShell, Node.js 24; proje kökünden:

```powershell
Set-Location evaluation
npm ci --ignore-scripts
node tools/fetch-models.mjs
npm run collect -- https://asurascans.com/comics/revenge-of-the-iron-blooded-sword-hound-1bb35e56/chapter/174
npm test
npm run serve
```

Arayüz: http://127.0.0.1:8766 . Sunucu yalnız loopback dinler; uzantı dosyaları ve Brave profili bu sunucunun kökünde değildir. Prototip için geçici geliştirici sunucusudur; ürün mimarisinde yardımcı sunucu kararı verilmedi.

Model indirici sabit Hugging Face revizyonunu ve SHA-256 değerini denetler. Yerel `.local/models/registry.json` kaynak, lisans ve hash kaydıdır. RT-DETR int8/fp32 modelleri Apache-2.0 ogkalu deposundan; PP-OCRv5 mobile ONNX, Apache-2.0 ilaylow dönüştürmesindendir. Paddle kaynak modeli ile dönüşüm eşdeğerliği henüz ölçülmedi. Görseller, modeller, bağımlılıklar ve raporlar Git dışında tutulur; telifli görseller dağıtım paketine eklenmez.

## Kullanım ve ölçüm sınırları

- RT-DETR: yazı grubu ve balon kutuları. Ölçülen WASM yolu çalışıyor; fp32 WebGPU AveragePool `ceil_mode` hatası veriyor. Hata görünür; sessiz backend değişimi yok.
- PP-OCR: bağımsız satır bileşeni adayları. Tam DB çokgen/unclip uygulaması ve diyalog gruplaması yok; bu adaylar doğrudan çeviri balonu sayılmaz. WASM ve WebGPU çalıştı.
- Turuncu alanlar inceleme gerektirir. Balona eşleşmeyen yazılar silinmez. Model tahmini insan doğrulaması yerine geçmez.
- İnsan etiketleri: önce model çizgilerini gizle, yazı grupları ve balonları çiz, eşleştir. Görselin tamamını kontrol edince doğrulama kutusunu işaretle ve kaydet. Taslaklar kabul ölçümüne girmez. Etiketler `.local/labels/` altındadır; bunları ayrıca koru.
- `node tools/score.mjs rtdetr-int8 wasm` yalnız sabit inceleme kuyruğundaki insan kontrolünden geçmiş, aynı hash/boyuttaki görselleri puanlar. Geliştirme/kabul/stres ayrı; seri sızıntısı ve en az 35 görsel/200 bölge denetlenir. `detectionAcceptancePassed` yalnız bu kapılar ve kabul/stres kalite hedefleri geçerse true olur; tek başına ürün kabulü değildir. Kapsam dışı SFX etiketinde “Kapsam içi” kutusunu kaldır. Yalnız bu alanda kalan, gerçek diyaloga dokunmayan eşleşmemiş tahminler precision hesabından çıkarılır.
- `node tools/compare.mjs GROUP_REPORT LINE_REPORT OUTPUT_JSON` her bağımsız satırı koruyarak kapsanan, belirsiz ve dışarıda kalan adayları listeler. Bu sayılar recall/precision değildir; otomatik birleştirme yapmaz.
- Aynı serinin komşu bölümleri bağımsız kabul/test kümelerine dağıtılmamalı. Şu an bütün görseller development verisidir. Farklı seri ve kaynak grupları, insan etiketleri, okuma sırası ve şekil ölçümleri eklenmeli.

## İzole Brave kontrolleri

```powershell
$env:BRAVE_EXECUTABLE = 'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe'
node tools/browser-ui-check.mjs
$env:MODELS = 'ppocrv5-mobile-det'
$env:BACKEND = 'webgpu'
$env:BATCH = '1'
$env:REPORT_NAME = 'my-detection-run'
node tools/browser-smoke.mjs
```

Gerçek kullanıcı profilini kullanmaz. UI kontrolü sentetik etiketleri bellekte tutar, gerçek etiket dosyalarını değiştirmez. Smoke varsayılan olarak bölüm174 içindeki ikinci görseli seçer; `BATCH=1` seçili bölümün bütün dosyalarını sırayla işler. `CHAPTER` ve `SOURCE_PAGE` ile değiştirilebilir. Raporlarda çıkarım süresi ile tüm işin duvar saati ayrı tutulur. Soğuk model yüklemesi, sıcak shader/önbellek ve GPU donanımı süreyi değiştirir.

Tarayıcıdaki yerel SVG hizası, gerçek okuyucu sitesindeki CSS/lazy-load/DOM hizasının kanıtı değildir. MV3/offscreen, gerçek sayfa yaşam döngüsü, tepe bellek, iptal sırasında GPU işinin kesilmesi ve kalıcı devam ayrıca sınanacak. İş iptali mevcut çıkarım bittikten sonra geç sonucu reddeder; GPU çekirdeğini ortada durdurmayı vaat etmez.
