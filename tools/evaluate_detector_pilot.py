"""Score manually labeled balloon boxes against detector pilot JSON reports."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from tools.detector_pilot import intersection_over_union


def score(predicted: list[dict], actual: list[list[float]], threshold: float = 0.5) -> dict:
    bubbles = [item for item in predicted if item["kind"] == "bubble"]
    candidates = sorted(
        ((intersection_over_union(item["box"], truth), i, j)
         for i, item in enumerate(bubbles) for j, truth in enumerate(actual)),
        reverse=True,
    )
    used_predictions: set[int] = set()
    used_truth: set[int] = set()
    overlaps = []
    for overlap, i, j in candidates:
        if overlap < threshold:
            break
        if i in used_predictions or j in used_truth:
            continue
        used_predictions.add(i)
        used_truth.add(j)
        overlaps.append(round(overlap, 4))
    return {"true_positive": len(overlaps), "missed": len(actual) - len(overlaps),
            "false_positive": len(bubbles) - len(overlaps), "matched_ious": overlaps}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("labels", type=Path, help="JSON map from image stem to list of [x0,y0,x1,y1] boxes")
    parser.add_argument("--reports", type=Path, default=Path(".hermes/pilot"))
    args = parser.parse_args()
    labels = json.loads(args.labels.read_text(encoding="utf-8"))
    total = {"pages": 0, "true_positive": 0, "missed": 0, "false_positive": 0}
    for stem, truth in labels.items():
        path = args.reports / f"{stem}.json"
        report = json.loads(path.read_text(encoding="utf-8"))
        result = score(report["detections"], truth)
        total["pages"] += 1
        for name in ("true_positive", "missed", "false_positive"):
            total[name] += result[name]
        print(stem, result)
    denominator = total["true_positive"] + total["missed"]
    total["recall"] = round(total["true_positive"] / denominator, 4) if denominator else None
    denominator = total["true_positive"] + total["false_positive"]
    total["precision"] = round(total["true_positive"] / denominator, 4) if denominator else None
    print("TOTAL", json.dumps(total, ensure_ascii=False))


if __name__ == "__main__":
    main()
