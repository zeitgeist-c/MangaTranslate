# Yerel balon tespiti pilotu

Pilot sayfa görsellerindeki balon ve metin kutularını gerçek resim piksellerinde saptar, `JSON` ve işaretli önizleme üretir. Belirsiz eşleşmeleri `needs_review` ile işaretler. Uzun sayfaları örtüşen parçalara böler; tek bir 640 piksellik görüntüye sıkıştırmaz. 3.4.0 uzantısında bu motor **deneysel ve varsayılan olarak kapalıdır**. Güvenilir balon ve metinlerin tamamı eşleşirse Gemini'ye OCR metni gönderilir; aksi durumda görüntülü çeviri korunur ve yalnız güvenli yerleşimler düzeltilir. Yerel yardımcı çalışmazsa mevcut yerleşim yolu kullanılır.

## Çalıştırma

`prepare-local-helper.ps1` Python 3.12 ile yalıtılmış sanal ortamı kurar ve dört ONNX modelini SHA-256 ile doğrular. Balon modeli [ogkalu/comic-text-and-bubble-detector](https://huggingface.co/ogkalu/comic-text-and-bubble-detector), OCR modelleri [RapidOCR PP-OCRv5](https://github.com/RapidAI/RapidOCR) kaynaklıdır. Balon modeli resimleri 640×640 boyutuna yeniden örnekler ve balon, balon içi metin, balon dışı metin sınıflarını döndürür.

```powershell
.\prepare-local-helper.ps1
.\.hermes\venv\Scripts\python.exe tools\detector_pilot.py C:\ornekler\sayfa1.png C:\ornekler\sayfa2.jpg
.\.hermes\venv\Scripts\python.exe -m unittest tests.test_detector_pilot -v
```

Önizlemeler ve JSON raporları `.hermes/pilot/` altına yazılır. `.hermes/` Git tarafından yok sayılır; manga görüntüleri ve kullanıcı verileri pakete girmez. Doğrulanmış modeller ise sürümlü yardımcı pakete kopyalanır.

## Doğrulama kapısı

En az 30 gerçek problemli sayfada şu değerler elle işaretlenip ölçülmeden deneysel özellik varsayılan yapılamaz: var olan balonların bulunma oranı, yanlış balon sayısı, metnin doğru balona atanma oranı ve kenar kayması. Her hatalı eşleşme ayrı incelenir. Balon dışı yazı/ses efekti hiçbir zaman balon temizleme maskesine alınmaz. Yapılanlar: İngilizce OCR, güvenilir sayfalar için yalnız metinle çeviri, görüntülü Gemini yanıtıyla yerel eşleştirme, OCR satırlarından açık renkli güvenli yazı dikdörtgeni, mevcut kontur/yazı sığdırma ile isteğe bağlı bağlantı ve elle düzeltme. **Henüz yapılmayanlar:** güvenilir yazı maskesiyle gerçek inpainting ve SAM/LaMa kalite karşılaştırması. Gerçek sayfalardaki sonuç kötü çıkarsa model veya bölümleme değiştirilir; mevcut uzantı deneyimi korunur.

## Gerçek bölüm ölçümü

Kullanıcının bildirdiği [Asura Scans 155. bölümünde](https://asurascans.com/comics/surviving-the-game-as-a-barbarian-6f7fe6eb/chapter/155) 25 görsel yerel olarak incelendi. Dedektör 337 metin adayı üretti; bunların 106'sı güvenilir balona bağlandı, 49'unda model balon sınırını yanlış çizse de OCR metnini çevreleyen açık renkli güvenli alan bulundu, 231 OCR satırı ise dedektör balonlarına bağlanamadı. Sayfalardan hiçbirinde bütün metinler güvenilir biçimde eşleşmedi. Bu yüzden bu bölümde salt OCR çevirisine otomatik geçilmez; görüntülü çeviri ve seçici OCR yerleşimi kullanılır. Bu rakamlar yerleştirme başarısı değil, yardımcı motorun aday/riski ölçümüdür; gerçek Gemini yanıtı ve kullanıcı tarayıcısındaki canlı uzantı henüz denenmedi. 3. görselde modelin yüksek güvenli balon kutusu metni kesti; taşma denetimi bunu işaretledi ve OCR'nin güvenli beyaz metin alanına yerleşen önizleme görsel olarak doğrulandı. Diğer görseller için elle etiketlenmiş referans kutuları olmadığı için kesin doğruluk yüzdesi verilmez.

Elle işaretlenen balon kutuları, `.hermes/labels.json` dosyasında `{"sayfa1": [[x0,y0,x1,y1], ...]}` biçiminde tutulabilir. `python -m tools.evaluate_detector_pilot .hermes/labels.json` komutu, tahminleri tek tek eşleyerek sayfa ve toplam düzeyinde bulunma oranı, doğruluk ve yanlış balon sayısını verir. Metin-balonu eşleşmesi ve kenar kayması ayrıca görsel olarak incelenir; bu iki değer henüz otomatik puanlanmıyor.

İlk kontrol için kamu malı [Atomic War paneli](https://commons.wikimedia.org/wiki/File:Atomic_War_0128_panel_2_spiked_balloon.jpg) kullanıldı. Üç konuşma balonunun üçü bulundu; üstteki başlık düşük güvenli fazladan balon olarak algılandı. Bu tek panel, kabul testi veya kullanıcının manga sitesindeki yerleşim doğrulaması sayılmaz.
