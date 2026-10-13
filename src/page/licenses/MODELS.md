# Model ve çalışma zamanı kaynakları

13 Ekim 2026:

- RT-DETR int8: https://huggingface.co/ogkalu/comic-text-and-bubble-detector ; revision `16e8a622f91fabc6b5b65c96d32d1183f8843546`, model kartında Apache-2.0; ayrı LICENSE dosyası depoda bulunmadı. SHA-256 `b5022ad46416b6fe4f88b0cc082cfd2ff5b1cfc624088c2f19879485493f5913`.
- Aynı depodaki küçük deneysel aday: `detector-v4-s_int8.onnx`, aynı revizyon, 11.120.765 bayt; SHA-256 `5fe9e4f576e49d4e7e8b0e029d6d3cdc252abd4694113e1cae120e62c931ea79`. Standart model yerine yalnız açık Hızlı tarama seçiminde kullanılır. Kalite eşdeğerliği kanıtlanmadı.
- PP-OCRv5 mobile ONNX: https://huggingface.co/ilaylow/PP_OCRv5_mobile_onnx ; revision `f97b337b3ac256f9dffcac5fc53955082d919d58`, model kartında Apache-2.0. Üçüncü taraf Paddle2ONNX dönüştürmesi; kaynak https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det . SHA-256 `1eb7b4f7ab657ebd1c66d5f79bca7497f29768a2e3c15e52daecbba1a8e4a039`. Kaynak-model eşdeğerliği henüz bağımsız ölçülmedi.
- ONNX Runtime Web 1.30.0: https://github.com/microsoft/onnxruntime/tree/v1.30.0 , MIT. LICENSE ve ThirdPartyNotices bu dizinde.

Model dosyaları değiştirilmedi. Kendi adaptörümüz, bağlı bileşen/yerleşim uygulamamız eklendi. PaddleOCR Apache lisansının tam metni bu dizindedir. GPL/AGPL projelerden kod taşınmadı. Görseller dağıtılmaz.

3.8.0: DB quad son işleme referansı PaddlePaddle/PaddleOCR ppocr/postprocess/db_postprocess.py (Apache-2.0), 13 Ekim 2026. JavaScript kontur/minimum dikdörtgen/raster ve analitik dikdörtgen unclip uygulaması bağımsız Python/OpenCV/Pyclipper fixture’larıyla sınırlı toleransta karşılaştırıldı; OpenCV bit düzeyi eşdeğerlik iddiası yok. OpenCV, Shapely ve Pyclipper yalnız izole test bağımlılıklarıdır, uzantıda dağıtılmaz.
