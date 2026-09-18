"""Local, read-only pilot for comic text and balloon detection.

Coordinates in the JSON report always refer to the original image pixels.
This intentionally does not alter the image or call the translation API.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw


LABELS = {0: "bubble", 1: "text_bubble", 2: "text_free"}
SIZE = 640
TILE = 1200
OVERLAP = 160


def prepare(image: Image.Image) -> tuple[np.ndarray, np.ndarray]:
    rgb = image.convert("RGB")
    resized = rgb.resize((SIZE, SIZE), Image.Resampling.BILINEAR)
    pixels = np.asarray(resized, dtype=np.float32) / 255.0
    tensor = np.transpose(pixels, (2, 0, 1))[None, :, :, :]
    # RT-DETR ONNX postprocessor uses height, width to return source-pixel boxes.
    sizes = np.asarray([[rgb.height, rgb.width]], dtype=np.int64)
    return tensor, sizes


def clamp_box(box: np.ndarray, width: int, height: int) -> list[float] | None:
    x0, y0, x1, y1 = (float(value) for value in box)
    x0, x1 = max(0.0, min(width, x0)), max(0.0, min(width, x1))
    y0, y1 = max(0.0, min(height, y0)), max(0.0, min(height, y1))
    if x1 - x0 < 2 or y1 - y0 < 2:
        return None
    return [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)]


def detect_tile(session: ort.InferenceSession, image: Image.Image, threshold: float) -> list[dict]:
    tensor, sizes = prepare(image)
    labels, boxes, scores = session.run(None, {"images": tensor, "orig_target_sizes": sizes})
    results = []
    for label, box, score in zip(labels[0], boxes[0], scores[0]):
        if float(score) < threshold or int(label) not in LABELS:
            continue
        bounds = clamp_box(box, image.width, image.height)
        if bounds is None:
            continue
        results.append({"kind": LABELS[int(label)], "confidence": round(float(score), 4), "box": bounds})
    return sorted(results, key=lambda item: (item["box"][1], item["box"][0]))


def tile_starts(length: int) -> list[int]:
    if length <= TILE:
        return [0]
    starts = list(range(0, length - TILE + 1, TILE - OVERLAP))
    last = length - TILE
    if starts[-1] != last:
        starts.append(last)
    return starts


def intersection_over_union(a: list[float], b: list[float]) -> float:
    width = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    height = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    intersection = width * height
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    return intersection / max(1.0, area_a + area_b - intersection)


def detect(session: ort.InferenceSession, image: Image.Image, threshold: float) -> list[dict]:
    # Tall webtoon strips must not be compressed into a single 640px-high image.
    results = []
    for top in tile_starts(image.height):
        for left in tile_starts(image.width):
            tile = image.crop((left, top, min(left + TILE, image.width), min(top + TILE, image.height)))
            for finding in detect_tile(session, tile, threshold):
                x0, y0, x1, y1 = finding["box"]
                finding["box"] = [x0 + left, y0 + top, x1 + left, y1 + top]
                results.append(finding)
    kept = []
    for finding in sorted(results, key=lambda item: item["confidence"], reverse=True):
        if any((old["kind"] == finding["kind"] and
                intersection_over_union(old["box"], finding["box"]) >= 0.5) or
               (old["kind"].startswith("text") and finding["kind"].startswith("text") and
                intersection_over_union(old["box"], finding["box"]) >= 0.7) for old in kept):
            continue
        kept.append(finding)
    return sorted(kept, key=lambda item: (item["box"][1], item["box"][0]))


def associate(detections: list[dict]) -> list[dict]:
    """Map each detected text region to one enclosing balloon; flag ambiguity."""
    bubbles = [item for item in detections if item["kind"] == "bubble"]
    texts = [item for item in detections if item["kind"].startswith("text")]
    matches = []
    for text in texts:
        a = text["box"]
        if text["kind"] == "text_free":
            matches.append({"text_box": a, "bubble_box": None,
                            "text_confidence": text["confidence"], "bubble_confidence": None,
                            "needs_review": True, "reason": "outside_bubble"})
            continue
        cx, cy = (a[0] + a[2]) / 2, (a[1] + a[3]) / 2
        candidates = []
        for index, bubble in enumerate(bubbles):
            b = bubble["box"]
            if b[0] <= cx <= b[2] and b[1] <= cy <= b[3]:
                candidates.append((index, (b[2] - b[0]) * (b[3] - b[1])))
        candidates.sort(key=lambda pair: pair[1])
        choice = candidates[0][0] if candidates else None
        matches.append({"text_box": a, "bubble_box": bubbles[choice]["box"] if choice is not None else None,
                        "text_confidence": text["confidence"],
                        "bubble_confidence": bubbles[choice]["confidence"] if choice is not None else None,
                        "needs_review": choice is None or len(candidates) > 1 or text["confidence"] < 0.55,
                        "reason": "multiple_bubbles" if len(candidates) > 1 else
                                  "no_bubble" if choice is None else
                                  "low_confidence" if text["confidence"] < 0.55 else None})
    return matches


def annotate(image: Image.Image, detections: list[dict], target: Path) -> None:
    preview = image.convert("RGB").copy()
    draw = ImageDraw.Draw(preview)
    colors = {"bubble": "#13ad6c", "text_bubble": "#e94f37", "text_free": "#2f6de1"}
    for item in detections:
        box = item["box"]
        color = colors[item["kind"]]
        draw.rectangle(box, outline=color, width=3)
        draw.text((box[0] + 2, box[1] + 2), f'{item["kind"]} {item["confidence"]:.2f}', fill=color)
    target.parent.mkdir(parents=True, exist_ok=True)
    preview.save(target)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("images", nargs="+", type=Path)
    parser.add_argument("--model", type=Path, default=Path(".hermes/models/detector_int8.onnx"))
    parser.add_argument("--out", type=Path, default=Path(".hermes/pilot"))
    parser.add_argument("--threshold", type=float, default=0.35)
    args = parser.parse_args()
    if not 0 < args.threshold < 1:
        parser.error("--threshold must be between 0 and 1")
    session = ort.InferenceSession(str(args.model), providers=["CPUExecutionProvider"])
    args.out.mkdir(parents=True, exist_ok=True)
    for source in args.images:
        with Image.open(source) as image:
            findings = detect(session, image, args.threshold)
            result = {"source": str(source), "size": [image.width, image.height],
                      "detections": findings, "matches": associate(findings)}
            base = args.out / source.stem
            base.with_suffix(".json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            annotate(image, findings, base.with_suffix(".png"))
            print(f"{source}: {len(findings)} regions -> {base.with_suffix('.json')}")


if __name__ == "__main__":
    main()
