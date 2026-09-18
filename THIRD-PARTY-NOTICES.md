# Third-party model notices

The optional Windows helper distributes these model files under their respective Apache-2.0 licenses:

- `native/models/detector_int8.onnx`: [ogkalu/comic-text-and-bubble-detector](https://huggingface.co/ogkalu/comic-text-and-bubble-detector), SHA-256 `b5022ad46416b6fe4f88b0cc082cfd2ff5b1cfc624088c2f19879485493f5913`.
- `native/models/ocr_det.onnx`: [RapidOCR PP-OCRv5 detection](https://github.com/RapidAI/RapidOCR), SHA-256 `4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae`.
- `native/models/ocr_rec.onnx`: [RapidOCR PP-OCRv5 English recognition](https://github.com/RapidAI/RapidOCR), SHA-256 `c3461add59bb4323ecba96a492ab75e06dda42467c9e3d0c18db5d1d21924be8`.
- `native/models/ocr_cls.onnx`: [RapidOCR text orientation classifier](https://github.com/RapidAI/RapidOCR), SHA-256 `e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c`.

The helper uses [ONNX Runtime](https://github.com/microsoft/onnxruntime), [RapidOCR](https://github.com/RapidAI/RapidOCR), [Pillow](https://github.com/python-pillow/Pillow), and NumPy. Their licenses and notices remain with the bundled Python packages in `native/_internal/` where supplied by those projects. The models run locally. The extension sends images to the selected Gemini API for translation when local OCR is incomplete; fully matched pages can use text-only requests.
