"""Synthetic schema-2 envelopes; no real reviews or live browser requests."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

from crawler.everytime_collect.archive import archive_observation
from crawler.everytime_collect.raw import ObservationError, read_document
from crawler.everytime_collect.tests.test_collect import synthetic_observation, encoded


def browser_observation(count=20):
    doc = synthetic_observation()
    doc["schema_version"] = 2
    base = "https://everytime.kr/lecture/view/603889"
    doc["capture"].update(method="browser_dom_observation", page_url=base + "?tab=article")
    doc["capture"]["metadata"] = {
        "overview_page_url": base,
        "collection": {"adapter": "everytime_visible_dom_v1", "requested_limit": count,
                       "loaded_count": count, "attempted": count, "succeeded": count,
                       "failed": 0, "not_attempted_loaded": 0, "failures": [], "complete_course": False},
    }
    doc["reviews"] = [copy.deepcopy(doc["reviews"][0]) for _ in range(count)]
    return doc


class BrowserCaptureTests(unittest.TestCase):
    def test_twenty_rows_roundtrip_and_old_five_row_limit_remains(self):
        doc = browser_observation()
        self.assertEqual(read_document(encoded(doc)), doc)
        old = synthetic_observation()
        old["reviews"] *= 6
        with self.assertRaises(ObservationError):
            read_document(encoded(old))

    def test_counts_cannot_hide_failed_or_dropped_rows(self):
        for field, value in (("succeeded", 19), ("failed", 1), ("attempted", 19),
                             ("not_attempted_loaded", 1), ("requested_limit", 21), ("complete_course", True)):
            doc = browser_observation()
            doc["capture"]["metadata"]["collection"][field] = value
            with self.subTest(field=field), self.assertRaises(ObservationError):
                read_document(encoded(doc))

    def test_partial_capture_has_a_failure_position_and_reason(self):
        doc = browser_observation(10)
        doc["reviews"].pop()
        doc["capture"]["metadata"]["collection"].update(succeeded=9, failed=1,
            failures=[{"list_position": 10, "reason": "body_missing_or_ambiguous"}])
        self.assertEqual(len(read_document(encoded(doc))["reviews"]), 9)
        doc["capture"]["metadata"]["collection"]["failures"][0]["list_position"] = 11
        with self.assertRaises(ObservationError):
            read_document(encoded(doc))

    def test_unobserved_course_and_wrong_method_rejected(self):
        for field, value in (("page_url", "https://everytime.kr/lecture/view/1?tab=article"),
                             ("method", "manual_browser_observation")):
            doc = browser_observation()
            doc["capture"][field] = value
            with self.assertRaises(ObservationError):
                read_document(encoded(doc))

    def test_archive_counts_bytes_and_existing_folder_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            private, output = root / "private", root / "output"
            private.mkdir()
            source = private / "browser.json"
            original = encoded(browser_observation())
            source.write_bytes(original)
            policy = {"private_root": private, "output_root": output}
            folder, manifest = archive_observation(source, output / "one", **policy)
            self.assertEqual(manifest["collection"]["succeeded"], 20)
            self.assertEqual(manifest["collection"]["failed"], 0)
            self.assertEqual((folder / "raw.json").read_bytes(), original)
            before = (folder / "manifest.json").read_bytes()
            with self.assertRaises(FileExistsError):
                archive_observation(source, folder, **policy)
            self.assertEqual((folder / "manifest.json").read_bytes(), before)
            second, _ = archive_observation(source, output / "two", **policy)
            self.assertNotEqual(folder, second)


if __name__ == "__main__":
    unittest.main()
