"""Synthetic JS -> Python integration; never contacts the site."""
import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from crawler.everytime_collect.raw import ObservationError, canonical, validate_document
from crawler.everytime_collect.run_v2 import finalize_run, save_event, validate_report
from crawler.everytime_collect.transfer import unpack

HERE = Path(__file__).parent


class GeneralizedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        result = subprocess.run(["node", str(HERE / "fake_browser.cjs")], capture_output=True, check=True)
        cls.scenarios = json.loads(result.stdout)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.private, self.output = root / "private", root / "output"
        self.private.mkdir()
        self.policy = {"private_root": self.private, "output_root": self.output}

    def archive(self, name, events=None):
        events = events or self.scenarios[name]
        folder = self.output / name
        sources = []
        for event in events:
            if event["type"] not in ("batch", "failed_batch"):
                continue
            number = event["batch"]
            path = self.private / f"{name}_{number}.json"
            path.write_bytes(canonical(event))
            batch, _ = save_event(path, folder / f"batch_{number:03d}", **self.policy)
            sources.append(batch / "batch_event.json")
        report = self.private / f"{name}_report.json"
        report.write_bytes(canonical(events[-1]["report"]))
        return finalize_run(sources, report, folder, **self.policy)

    def test_all_requested_scenarios_validate_and_archive(self):
        for name, events in self.scenarios.items():
            with self.subTest(name=name):
                report = events[-1]["report"]
                validate_report(report)
                folder, summary = self.archive(name)
                self.assertEqual(summary["reviews_saved"], report["succeeded"])
                self.assertEqual(summary["review_failures"], report["failed"])
                self.assertTrue((folder / "run_report.json").is_file())
        self.assertEqual(self.scenarios["preloaded"][-1]["report"]["initial_loaded"], 37)
        self.assertEqual(self.scenarios["multi"][-1]["report"]["succeeded"], 61)
        for name in ("mismatch", "wrong", "interrupted", "failed_row", "all_failed", "batch_limit", "loading_failed"):
            self.assertEqual(self.scenarios[name][-1]["report"]["status"], "partial")

    def test_duplicates_retained_and_empty_has_no_fabricated_raw(self):
        folder, summary = self.archive("duplicate")
        self.assertEqual(summary["reviews_saved"], 25)
        self.assertEqual(summary["duplicate_candidates"]["within_run_reviews"], 1)
        self.assertEqual(summary["duplicate_candidates"]["automatically_merged_or_deleted"], 0)
        empty, summary = self.archive("empty")
        self.assertEqual(list(empty.glob("**/raw.json")), [])
        self.assertTrue(summary["ui_observation"]["ui_end_confirmed"])

    def test_false_completion_and_unverified_empty_are_rejected(self):
        for name in ("mismatch", "wrong", "interrupted", "batch_limit", "loading_failed"):
            report = copy.deepcopy(self.scenarios[name][-1]["report"])
            report.update(status="complete", ui_end_confirmed=True, termination_reason="displayed_total_matched_and_bottom_stable")
            with self.subTest(name=name), self.assertRaises(ObservationError):
                validate_report(report)
        report = copy.deepcopy(self.scenarios["empty"][-1]["report"])
        report["trace"][0]["empty_text"] = None
        with self.assertRaises(ObservationError):
            validate_report(report)

    def test_v2_requires_exact_target_and_null_unobserved_fields(self):
        for field in ("title", "instructor", "url"):
            doc = copy.deepcopy(self.scenarios["small"][0]["observation"])
            doc["capture"]["metadata"]["target"][field] += "x"
            with self.subTest(field=field), self.assertRaises(ObservationError):
                validate_document(doc)

    def test_existing_outputs_and_midrun_batches_remain_unchanged(self):
        folder, summary = self.archive("interrupted")
        before = {p: p.read_bytes() for p in folder.rglob("*") if p.is_file()}
        with self.assertRaises(FileExistsError):
            self.archive("interrupted")
        self.assertEqual(before, {p: p.read_bytes() for p in before})
        self.assertEqual(summary["reviews_saved"], 25)

    def test_transport_roundtrip_including_unicode_whitespace_and_corruption(self):
        script = "const {load}=require(process.argv[1]);const pack=load('browser_pack.js');process.stdout.write(JSON.stringify(pack(JSON.parse(process.argv[2]))));"
        value = self.scenarios["multi"][0]
        result = subprocess.run(["node", "-e", script, str(HERE / "fake_browser.cjs"), json.dumps(value, ensure_ascii=False)], capture_output=True, check=True)
        packed = json.loads(result.stdout)
        self.assertEqual(json.loads(unpack(packed)), value)
        packed["fnv1a64"] = "0000000000000000"
        with self.assertRaises(ObservationError):
            unpack(packed)

    def test_overlapping_window_and_wrong_run_course_rejected(self):
        for name in ("overlap", "other_course"):
            events = copy.deepcopy(self.scenarios["preloaded"])
            if name == "overlap":
                events[1]["window"].update(start_position=20, end_position=36)
                events[1]["observation"]["capture"]["metadata"]["list_window"] = events[1]["window"]
            else:
                events[-1]["report"]["target"]["instructor"] = "다른교수"
            with self.subTest(name=name), self.assertRaises(ObservationError):
                self.archive(name, events)
