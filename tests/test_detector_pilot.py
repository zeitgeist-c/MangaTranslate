import unittest
import io
from PIL import Image

from tools.detector_pilot import associate, clamp_box, intersection_over_union, tile_starts
from tools.evaluate_detector_pilot import score
from tools.native_host import assign_ocr, handle, ocr_candidates, read_frame, safe_ocr_rectangle, write_frame


class DetectorPilotGeometryTests(unittest.TestCase):
    def test_clamp_uses_source_pixel_space(self):
        self.assertEqual(clamp_box([-10, 20, 120, 200], 100, 150), [0.0, 20.0, 100.0, 150.0])
        self.assertIsNone(clamp_box([101, 20, 120, 40], 100, 150))

    def test_tall_page_tiles_cover_end_with_overlap(self):
        starts = tile_starts(4000)
        self.assertEqual(starts[0], 0)
        self.assertEqual(starts[-1] + 1200, 4000)
        self.assertTrue(all(b - a <= 1040 for a, b in zip(starts, starts[1:])))

    def test_same_class_overlap_dedupe_measure(self):
        self.assertAlmostEqual(intersection_over_union([0, 0, 100, 100], [0, 0, 100, 100]), 1)
        self.assertEqual(intersection_over_union([0, 0, 10, 10], [20, 20, 30, 30]), 0)

    def test_text_chooses_smallest_enclosing_bubble(self):
        findings = [
            {"kind": "bubble", "confidence": 0.9, "box": [0, 0, 300, 300]},
            {"kind": "bubble", "confidence": 0.8, "box": [80, 80, 180, 180]},
            {"kind": "text_bubble", "confidence": 0.95, "box": [100, 110, 140, 130]},
        ]
        match = associate(findings)[0]
        self.assertEqual(match["bubble_box"], [80, 80, 180, 180])
        self.assertTrue(match["needs_review"])
        self.assertEqual(match["reason"], "multiple_bubbles")

    def test_uncontained_text_remains_unassigned(self):
        findings = [{"kind": "text_free", "confidence": 0.9, "box": [5, 5, 20, 20]}]
        self.assertIsNone(associate(findings)[0]["bubble_box"])
        self.assertEqual(associate(findings)[0]["reason"], "outside_bubble")

    def test_uncontained_dialogue_remains_unassigned(self):
        findings = [{"kind": "text_bubble", "confidence": 0.9, "box": [5, 5, 20, 20]}]
        self.assertEqual(associate(findings)[0]["reason"], "no_bubble")

    def test_evaluation_does_not_count_one_detection_twice(self):
        findings = [{"kind": "bubble", "confidence": 0.9, "box": [0, 0, 100, 100]}]
        result = score(findings, [[0, 0, 100, 100], [0, 0, 100, 100]])
        self.assertEqual((result["true_positive"], result["missed"], result["false_positive"]), (1, 1, 0))

    def test_native_frames_round_trip_and_ping(self):
        stream = io.BytesIO()
        write_frame(stream, {"id": 9, "type": "ping"})
        stream.seek(0)
        request = read_frame(stream)
        self.assertEqual(request["id"], 9)
        self.assertTrue(handle(request)["ok"])

    def test_native_rejects_invalid_image(self):
        result = handle({"id": 10, "type": "analyze", "dataUrl": "bad"})
        self.assertFalse(result["ok"])

    def test_ocr_line_belongs_to_smallest_overlapping_bubble(self):
        matches = [
            {"text_box": [0, 0, 200, 200], "bubble_box": [0, 0, 220, 220]},
            {"text_box": [80, 80, 140, 130], "bubble_box": [70, 70, 150, 150]},
        ]
        assign_ocr(matches, [{"box": [90, 90, 130, 110], "text": "Hello"}])
        self.assertEqual(matches[0]["ocr"], "")
        self.assertEqual(matches[1]["ocr"], "Hello")

    def test_ocr_exposes_detector_clipping_on_real_page_geometry(self):
        match = {"text_box": [84, 331, 823, 524], "bubble_box": [49, 214, 857, 644],
                 "needs_review": False, "reason": None}
        lines = [{"box": [204, 436, 505, 473], "text": "FIGHTING MORE"},
                 {"box": [75, 547, 634, 586], "text": "FRONT LINES"},
                 {"box": [238, 624, 470, 661], "text": "EXPLORERS"}]
        assign_ocr([match], lines)
        self.assertEqual(match["ocr"], "FIGHTING MORE FRONT LINES EXPLORERS")
        self.assertEqual(match["reason"], "text_outside_detected_bubble")
        self.assertTrue(match["needs_review"])

    def test_ocr_safe_rectangle_requires_light_background(self):
        image = Image.new("RGB", (900, 1152), "white")
        match = {"ocr_box": [75, 436, 634, 661]}
        self.assertEqual(safe_ocr_rectangle(image, match), [66.0, 427.0, 643.0, 670.0])
        image.putpixel((66, 427), (20, 20, 20))
        self.assertIsNone(safe_ocr_rectangle(image, match))

    def test_ocr_candidates_group_adjacent_lines_without_crossing_large_gaps(self):
        image = Image.new("RGB", (900, 1152), "white")
        lines = [{"box": [100, 400, 300, 430], "text": "FIGHTING MORE"},
                 {"box": [90, 435, 350, 465], "text": "BRAVELY"},
                 {"box": [100, 700, 300, 730], "text": "OTHER BALLOON"}]
        texts = [item["ocr"] for item in ocr_candidates(image, lines)]
        self.assertIn("FIGHTING MORE BRAVELY", texts)
        self.assertNotIn("FIGHTING MORE BRAVELY OTHER BALLOON", texts)


if __name__ == "__main__":
    unittest.main()
