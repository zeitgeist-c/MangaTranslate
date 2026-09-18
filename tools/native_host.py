"""MangaLens TR Chrome native-messaging host. No image is written to disk."""

from __future__ import annotations

import base64
import io
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys

import onnxruntime as ort
from PIL import Image, ImageOps

try:
    from tools.detector_pilot import associate, detect
except ModuleNotFoundError:  # source invocation: python tools/native_host.py
    from detector_pilot import associate, detect


MAX_REQUEST = 60 * 1024 * 1024
MAX_RESPONSE = 1024 * 1024
MODEL_SHA256 = "b5022ad46416b6fe4f88b0cc082cfd2ff5b1cfc624088c2f19879485493f5913"
_session = None
_rapid_ocr = None


def model_path() -> Path:
    root = Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent.parent
    return root / "models" / "detector_int8.onnx" if getattr(sys, "frozen", False) else root / ".hermes" / "models" / "detector_int8.onnx"


def ocr_paths() -> tuple[Path, Path, Path]:
    folder = model_path().parent
    return folder / "ocr_det.onnx", folder / "ocr_rec.onnx", folder / "ocr_cls.onnx"


def rapid_ocr():
    global _rapid_ocr
    if _rapid_ocr is None:
        from rapidocr import EngineType, LangDet, LangRec, ModelType, OCRVersion, RapidOCR
        det, rec, cls = ocr_paths()
        if not all(path.is_file() for path in (det, rec, cls)):
            raise FileNotFoundError("Yerel OCR modelleri eksik")
        _rapid_ocr = RapidOCR(params={
            "Global.use_cls": False,
            "Det.engine_type": EngineType.ONNXRUNTIME,
            "Det.lang_type": LangDet.CH,
            "Det.model_type": ModelType.MOBILE,
            "Det.ocr_version": OCRVersion.PPOCRV5,
            "Det.model_path": str(det),
            "Cls.model_path": str(cls),
            "Rec.engine_type": EngineType.ONNXRUNTIME,
            "Rec.lang_type": LangRec.EN,
            "Rec.model_type": ModelType.MOBILE,
            "Rec.ocr_version": OCRVersion.PPOCRV5,
            "Rec.model_path": str(rec),
        })
    return _rapid_ocr


def ocr_lines(image: Image.Image) -> list[dict]:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    result = rapid_ocr()(buf.getvalue())
    if result.boxes is None:
        return []
    lines = []
    for box, text, score in zip(result.boxes, result.txts, result.scores):
        if score < 0.35 or not text:
            continue
        xs = [float(p[0]) for p in box]
        ys = [float(p[1]) for p in box]
        lines.append({"box": [min(xs), min(ys), max(xs), max(ys)], "text": str(text)})
    return lines


def assign_ocr(matches: list[dict], lines: list[dict]) -> int:
    assigned = [[] for _ in matches]
    unassigned = 0
    for line in lines:
        lx0, ly0, lx1, ly1 = line["box"]
        cx, cy = (lx0 + lx1) / 2, (ly0 + ly1) / 2
        candidates = []
        for index, match in enumerate(matches):
            box = match["bubble_box"] or match["text_box"]
            x0, y0, x1, y1 = box
            if x0 - 5 <= cx <= x1 + 5 and y0 - 5 <= cy <= y1 + 5:
                area = (box[2] - box[0]) * (box[3] - box[1])
                candidates.append((area, index))
        if candidates:
            _, index = min(candidates)
            assigned[index].append(line)
        else:
            unassigned += 1
    for match, selected in zip(matches, assigned):
        selected.sort(key=lambda item: (round(item["box"][1] / 12), item["box"][0]))
        match["ocr"] = " ".join(line["text"] for line in selected)[:600]
        if not selected or not match["bubble_box"]:
            continue
        bounds = [min(item["box"][0] for item in selected),
                  min(item["box"][1] for item in selected),
                  max(item["box"][2] for item in selected),
                  max(item["box"][3] for item in selected)]
        match["ocr_box"] = bounds
        bx0, by0, bx1, by1 = match["bubble_box"]
        margin = min(12, max(3, (by1 - by0) * .03))
        if bounds[0] < bx0 + margin or bounds[1] < by0 + margin or bounds[2] > bx1 - margin or bounds[3] > by1 - margin:
            match["needs_review"] = True
            match["reason"] = "text_outside_detected_bubble"
    return unassigned


def safe_ocr_rectangle(image: Image.Image, match: dict) -> list[float] | None:
    bounds = match.get("ocr_box")
    if not bounds:
        return None
    x0, y0, x1, y1 = [round(value) for value in bounds]
    pad = min(12, max(7, round((y1 - y0) * .04)))
    x0, y0, x1, y1 = x0 - pad, y0 - pad, x1 + pad, y1 + pad
    if x0 < 0 or y0 < 0 or x1 >= image.width or y1 >= image.height:
        return None
    mx, my = (x0 + x1) // 2, (y0 + y1) // 2
    samples = [(x0, y0), (x1, y0), (x0, y1), (x1, y1),
               (mx, y0), (mx, y1), (x0, my), (x1, my)]
    colors = [image.getpixel(point) for point in samples]
    if any(min(color) < 210 or max(color) - min(color) > 35 for color in colors):
        return None
    return [float(x0), float(y0), float(x1), float(y1)]


def ocr_candidates(image: Image.Image, lines: list[dict]) -> list[dict]:
    ordered = sorted(lines, key=lambda line: (line["box"][1], line["box"][0]))
    candidates = []
    for start in range(len(ordered)):
        selected = []
        for line in ordered[start:start + 8]:
            if selected:
                previous = selected[-1]["box"]
                height = max(previous[3] - previous[1], line["box"][3] - line["box"][1])
                if line["box"][1] - previous[3] > max(36, height * 1.5):
                    break
            selected.append(line)
            bounds = [min(item["box"][0] for item in selected),
                      min(item["box"][1] for item in selected),
                      max(item["box"][2] for item in selected),
                      max(item["box"][3] for item in selected)]
            text = " ".join(item["text"] for item in selected).strip()
            if len(text) < 5:
                continue
            rect = safe_ocr_rectangle(image, {"ocr_box": bounds})
            if rect:
                candidates.append({"ocr": text[:600], "ocr_safe_rect": rect,
                                   "reason": "ocr_only", "needs_review": True})
            if len(candidates) >= 500:
                return candidates
    return candidates


def session() -> ort.InferenceSession:
    global _session
    if _session is None:
        path = model_path()
        if not path.is_file():
            raise FileNotFoundError(f"Yerel model bulunamadı: {path}")
        _session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    return _session


def tesseract_path() -> str | None:
    return shutil.which("tesseract") or (
        r"C:\Program Files\Tesseract-OCR\tesseract.exe"
        if Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe").is_file() else None
    )


def read_text(image: Image.Image, box: list[float]) -> str:
    executable = tesseract_path()
    if not executable:
        return ""
    x0, y0, x1, y1 = (round(v) for v in box)
    crop = image.crop((x0, y0, x1, y1))
    if crop.width < 5 or crop.height < 5:
        return ""
    crop = ImageOps.grayscale(crop)
    if crop.width < 700:
        crop = crop.resize((crop.width * 2, crop.height * 2), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    crop.save(buf, format="PNG")
    try:
        result = subprocess.run(
            [executable, "stdin", "stdout", "-l", "eng", "--psm", "6"],
            input=buf.getvalue(), capture_output=True, timeout=12, check=False,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    except (OSError, subprocess.TimeoutExpired):
        return ""
    if result.returncode != 0:
        return ""
    return " ".join(result.stdout.decode("utf-8", errors="replace").split())[:600]


def handle(message: dict) -> dict:
    request_id = message.get("id")
    operation = message.get("type")
    if operation == "ping":
        return {"id": request_id, "ok": True, "model": model_path().is_file(),
                "ocr": all(path.is_file() for path in ocr_paths()) or bool(tesseract_path())}
    if operation != "analyze":
        return {"id": request_id, "ok": False, "error": "Bilinmeyen işlem"}
    data_url = message.get("dataUrl", "")
    if not isinstance(data_url, str) or "," not in data_url or not data_url.startswith("data:image/"):
        return {"id": request_id, "ok": False, "error": "Geçersiz resim"}
    raw = base64.b64decode(data_url.partition(",")[2], validate=True)
    if len(raw) > 20 * 1024 * 1024:
        return {"id": request_id, "ok": False, "error": "Resim çok büyük"}
    with Image.open(io.BytesIO(raw)) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
    if image.width * image.height > 100_000_000:
        return {"id": request_id, "ok": False, "error": "Resim çözünürlüğü çok büyük"}
    findings = detect(session(), image, 0.35)
    matches = associate(findings)
    try:
        lines = ocr_lines(image)
    except Exception as error:
        print(f"RapidOCR kullanılamadı: {error}", file=sys.stderr)
        lines = []
    unassigned_ocr = assign_ocr(matches[:100], lines)
    for match in matches[:100]:
        if not match["ocr"]:
            match["ocr"] = read_text(image, match["text_box"])
        if match.get("reason") == "text_outside_detected_bubble":
            match["ocr_safe_rect"] = safe_ocr_rectangle(image, match)
    return {"id": request_id, "ok": True, "size": [image.width, image.height],
            "matches": matches[:100], "unassigned_ocr": unassigned_ocr,
            "ocr_candidates": ocr_candidates(image, lines)}


def read_frame(stream: io.BufferedReader) -> dict | None:
    header = stream.read(4)
    if not header:
        return None
    if len(header) != 4:
        raise ValueError("Eksik ileti başlığı")
    length = struct.unpack("<I", header)[0]
    if length == 0 or length > MAX_REQUEST:
        raise ValueError("Geçersiz ileti uzunluğu")
    raw = stream.read(length)
    if len(raw) != length:
        raise ValueError("Eksik ileti")
    return json.loads(raw.decode("utf-8"))


def write_frame(stream: io.BufferedWriter, result: dict) -> None:
    raw = json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(raw) > MAX_RESPONSE:
        raise ValueError("Yanıt çok büyük")
    stream.write(struct.pack("<I", len(raw)))
    stream.write(raw)
    stream.flush()


def main() -> None:
    while True:
        try:
            message = read_frame(sys.stdin.buffer)
            if message is None:
                return
            try:
                result = handle(message)
            except Exception as error:
                result = {"id": message.get("id"), "ok": False, "error": str(error)[:500]}
            write_frame(sys.stdout.buffer, result)
        except (BrokenPipeError, EOFError):
            return


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        print(json.dumps(handle({"id": 1, "type": "ping"}), ensure_ascii=False))
    else:
        main()
