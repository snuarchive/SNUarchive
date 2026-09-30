import copy
import json
from pathlib import Path
import tempfile
import unittest

from crawler.everytime_collect.course_run import archive_course_run, validate_run_report
from crawler.everytime_collect.raw import ObservationError, read_document
from crawler.everytime_collect.tests.test_browser_capture import browser_observation
from crawler.everytime_collect.tests.test_collect import encoded


def report_fixture():
    def state(count, top, height):
        return {"count": count, "scroll_top": top, "scroll_height": height, "client_height": 800, "at_bottom": height - 800 - top <= 2}
    trace = [{"action": "initial", **state(20, 0, 3000)},
             {"action": "scroll_down_3_pages", "scroll": 1, "added": 17, **state(37, 2200, 7400)},
             {"action": "scroll_down_3_pages", "scroll": 2, "added": 0, **state(37, 6600, 7400)},
             {"action": "scroll_down_3_pages", "scroll": 3, "added": 0, **state(37, 6600, 7400)}]
    return {"source_url": "https://everytime.kr/lecture/view/603889?tab=article", "initial_loaded": 20, "final_loaded": 37,
            "added": 17, "attempted": 37, "succeeded": 37, "failed": 0, "failures": [], "batches": 2,
            "displayed_total": {"value": 37, "text": "(37개)", "page_url": "https://everytime.kr/lecture/view/603889",
                                "locator": "div.rating > div.title > span.count", "observed_at": "2026-09-30T03:00:00Z"},
            "loading_method": "scroll_inside_review_list", "ui_end_confirmed": True,
            "termination_reason": "displayed_total_matched_and_bottom_stable", "bottom_confirmations": 2,
            "final_state": state(37, 6600, 7400), "trace": trace, "finished_at": "2026-09-30T03:01:00Z"}


def batch_fixture(start, count, dom_count):
    doc = browser_observation(count)
    doc["capture"]["metadata"]["list_window"] = {"start_position": start, "end_position": start + count - 1, "dom_loaded_count": dom_count}
    doc["evidence"] = doc["evidence"][:1]
    for offset, review in enumerate(doc["reviews"]):
        text = f"합성 본문 {start + offset}\n둘째 줄  "
        key = f"body_{start + offset}"
        review["text_raw"] = text
        review["field_evidence"]["text_raw"] = {"evidence_id": key, "start": 0, "end": len(text)}
        doc["evidence"].append({"id": key, "kind": "visible_text", "text": text, "locator": f"synthetic position {start + offset}"})
    return doc


class CourseRunTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.private, self.output = self.root / "private", self.root / "output"
        self.private.mkdir()
        self.sources = [self.private / "one.json", self.private / "two.json"]
        self.documents = [batch_fixture(1, 20, 20), batch_fixture(21, 17, 37)]
        for path, doc in zip(self.sources, self.documents):
            path.write_bytes(encoded(doc))
        self.report = self.private / "report.json"
        self.report.write_bytes(encoded(report_fixture()))
        self.policy = {"private_root": self.private, "output_root": self.output}

    def test_full_run_preserves_batches_candidates_and_refuses_overwrite(self):
        before = [p.read_bytes() for p in self.sources]
        folder, summary = archive_course_run(self.sources, self.report, self.output / "new", against=[self.sources[0]], **self.policy)
        self.assertEqual(summary["reviews_saved"], 37)
        self.assertEqual(summary["duplicate_candidates"]["against_prior_reviews"], 20)
        self.assertEqual(summary["duplicate_candidates"]["within_run_reviews"], 0)
        self.assertEqual(summary["duplicate_candidates"]["appended_vs_initial_reviews"], 0)
        for index, original in enumerate(before, 1):
            self.assertEqual((folder / f"batch_{index:03d}" / "raw.json").read_bytes(), original)
        saved_report = (folder / "run_report.json").read_bytes()
        with self.assertRaises(FileExistsError):
            archive_course_run(self.sources, self.report, folder, **self.policy)
        self.assertEqual((folder / "run_report.json").read_bytes(), saved_report)

    def test_duplicate_appended_row_is_flagged_and_retained(self):
        duplicate = copy.deepcopy(self.documents[0]["reviews"][0])
        target = self.documents[1]
        target["reviews"][0]["text_raw"] = duplicate["text_raw"]
        target["reviews"][0]["field_evidence"]["text_raw"]["end"] = len(duplicate["text_raw"])
        target["evidence"][1]["text"] = duplicate["text_raw"]
        self.sources[1].write_bytes(encoded(target))
        _, summary = archive_course_run(self.sources, self.report, self.output / "duplicates", **self.policy)
        self.assertEqual(summary["reviews_saved"], 37)
        self.assertEqual(summary["duplicate_candidates"]["within_run_reviews"], 1)
        self.assertEqual(summary["duplicate_candidates"]["appended_vs_initial_reviews"], 1)
        self.assertEqual(summary["duplicate_candidates"]["automatically_merged_or_deleted"], 0)

    def test_false_end_claim_is_rejected_before_any_write(self):
        report = report_fixture()
        report["displayed_total"].update(value=40, text="(40개)")
        self.report.write_bytes(encoded(report))
        with self.assertRaises(ObservationError):
            archive_course_run(self.sources, self.report, self.output / "bad", **self.policy)
        self.assertFalse(self.output.exists())

    def test_overlapping_windows_are_not_silently_merged(self):
        self.documents[1]["capture"]["metadata"]["list_window"].update(start_position=20, end_position=36)
        self.sources[1].write_bytes(encoded(self.documents[1]))
        with self.assertRaises(ObservationError):
            archive_course_run(self.sources, self.report, self.output / "overlap", **self.policy)
        self.assertFalse(self.output.exists())

    def test_nonfinal_stop_can_be_archived_without_completeness_claim(self):
        report = report_fixture()
        report["displayed_total"].update(value=40, text="(40개)")
        report.update(ui_end_confirmed=False, termination_reason="bottom_stable_total_mismatch")
        validate_run_report(report)


if __name__ == "__main__":
    unittest.main()
