"""Invented observation envelopes; URLs below are NOT site routes or endpoints."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

from crawler.everytime_collect.archive import archive_observation, private_input
from crawler.everytime_collect.raw import ObservationError, duplicate_relation, fingerprints, read_document


def synthetic_observation():
    header = "합성강의\n합성교수"
    body = "😀 합성 리뷰\r\n중간이 재미있었어요.  "
    return {
        "schema_version": 1,
        "capture": {"method": "manual_browser_observation", "observed_at": "2026-09-30T10:00:00+09:00",
                    "page_url": "https://everytime.kr/", "page_title": "합성 화면", "coverage": "sample", "metadata": {}},
        "course": {"title_raw": "합성강의", "instructor_raw": "합성교수", "source_id": None, "metadata": {},
                   "field_evidence": {"title_raw": {"evidence_id": "heading", "start": 0, "end": 4},
                                      "instructor_raw": {"evidence_id": "heading", "start": 5, "end": 9}}},
        "reviews": [{"source_id": None, "text_raw": body, "enrollment_term_raw": None,
                     "created_at_raw": None, "updated_at_raw": None, "metadata": {},
                     "field_evidence": {"text_raw": {"evidence_id": "review-1", "start": 0, "end": len(body)}}}],
        "evidence": [{"id": "heading", "kind": "visible_text", "text": header, "locator": None},
                     {"id": "review-1", "kind": "visible_text", "text": body, "locator": None}],
    }


def encoded(doc):
    return json.dumps(doc, ensure_ascii=False, indent=2).encode("utf-8")


class RawTests(unittest.TestCase):
    def test_text_whitespace_unicode_and_unknowns_are_preserved(self):
        doc = synthetic_observation()
        self.assertEqual(read_document(encoded(doc)), doc)
        self.assertIsNone(doc["reviews"][0]["enrollment_term_raw"])

    def test_additional_site_metadata_is_preserved_with_evidence(self):
        doc = synthetic_observation()
        review = doc["reviews"][0]
        review["metadata"] = {"추가표시": {"labels": ["낮음", "보통"], "value": 0}}
        doc["evidence"].append({"id": "meta", "kind": "visible_text", "text": "추가표시 낮음 보통 0", "locator": None})
        review["field_evidence"]["metadata"] = {"evidence_id": "meta", "start": 0, "end": 12}
        self.assertEqual(read_document(encoded(doc))["reviews"][0]["metadata"], review["metadata"])

    def test_wrong_span_and_invented_term_fail(self):
        doc = synthetic_observation()
        doc["reviews"][0]["field_evidence"]["text_raw"]["end"] -= 1
        with self.assertRaises(ObservationError):
            read_document(encoded(doc))
        doc = synthetic_observation()
        doc["reviews"][0]["enrollment_term_raw"] = "2026년 1학기"
        with self.assertRaises(ObservationError):
            read_document(encoded(doc))

    def test_duplicate_keys_nonfinite_and_unknown_envelope_fail(self):
        for raw in (b'{"a":1,"a":2}', b'{"a":NaN}', b'{"a":1e999}'):
            with self.assertRaises(ObservationError):
                read_document(raw)
        doc = synthetic_observation()
        doc["unmapped"] = "do not silently discard"
        with self.assertRaises(ObservationError):
            read_document(encoded(doc))

    def test_credentials_rejected_without_echoing_value(self):
        for key in ("Cookie", "accessToken", "password", "storage_state", "request_headers"):
            doc = synthetic_observation()
            doc["capture"]["metadata"][key] = "SYNTHETIC_SECRET_VALUE"
            with self.assertRaises(ObservationError) as error:
                read_document(encoded(doc))
            self.assertNotIn("SYNTHETIC_SECRET_VALUE", str(error.exception))
        doc = synthetic_observation()
        doc["capture"]["page_url"] = "https://everytime.kr/?session_id=SYNTHETIC_SECRET_VALUE"
        with self.assertRaises(ObservationError):
            read_document(encoded(doc))

    def test_full_html_and_authorization_text_are_not_archived(self):
        for text in ("<html>example</html>", "Authorization: Bearer SYNTHETIC_SECRET_VALUE"):
            doc = synthetic_observation()
            doc["evidence"][0]["text"] = text
            with self.assertRaises(ObservationError):
                read_document(encoded(doc))

    def test_unsupported_transport_size_and_naive_time_fail(self):
        for key, value in (("method", "authenticated_http"), ("coverage", "complete"), ("observed_at", "2026-09-30T10:00:00")):
            doc = synthetic_observation()
            doc["capture"][key] = value
            with self.assertRaises(ObservationError):
                read_document(encoded(doc))
        doc = synthetic_observation()
        doc["reviews"] *= 6
        with self.assertRaises(ObservationError):
            read_document(encoded(doc))
        with self.assertRaises(ObservationError):
            read_document(b" " * (2 * 1024 * 1024 + 1))

    def test_source_url_requires_https_and_no_userinfo(self):
        for url in ("http://everytime.kr/", "https://everytime.kr.evil.invalid/", "https://name:pass@everytime.kr/"):
            doc = synthetic_observation()
            doc["capture"]["page_url"] = url
            with self.assertRaises(ObservationError):
                read_document(encoded(doc))

    def test_duplicate_candidates_do_not_confuse_ids_terms_or_courses(self):
        doc = synthetic_observation()
        review = doc["reviews"][0]
        a = fingerprints(doc, review)
        self.assertEqual(duplicate_relation(a, a), "possible_duplicate_without_both_ids")
        identified = {**review, "source_id": "synthetic-id"}
        b = fingerprints(doc, identified)
        self.assertEqual(duplicate_relation(b, b), "source_id_match_same_content")
        changed = fingerprints(doc, {**identified, "text_raw": "수정된 합성 원문"})
        self.assertEqual(duplicate_relation(b, changed), "source_id_match_changed_content")
        self.assertIsNone(duplicate_relation(b, fingerprints(doc, {**identified, "source_id": "different-id"})))
        self.assertIsNone(duplicate_relation(a, fingerprints(doc, {**review, "enrollment_term_raw": "다른 학기"})))
        other = copy.deepcopy(doc)
        other["course"]["title_raw"] = "다른 강의"
        self.assertIsNone(duplicate_relation(a, fingerprints(other, review)))


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.private = self.root / "private"
        self.output = self.root / "output"
        self.private.mkdir()
        self.output.mkdir()
        self.input = self.private / "input.json"
        self.original = encoded(synthetic_observation())
        self.input.write_bytes(self.original)
        self.policy = {"private_root": self.private, "output_root": self.output}

    def test_archive_exact_bytes_and_repeated_observation_without_overwrite(self):
        one, first = archive_observation(self.input, self.output / "one", **self.policy)
        self.assertEqual((one / "raw.json").read_bytes(), self.original)
        self.assertEqual(self.input.read_bytes(), self.original)
        two, second = archive_observation(self.input, self.output / "two", against=[one / "raw.json"], **self.policy)
        self.assertEqual(second["reviews_saved"], 1)
        self.assertEqual(second["reviews_with_duplicate_candidates"], 1)
        self.assertFalse(second["site_structure_verified"])
        self.assertEqual(second["network_requests"], 0)
        self.assertNotEqual(first["observed_at"], first["stored_at"])
        saved = (one / "manifest.json").read_bytes()
        with self.assertRaises(FileExistsError):
            archive_observation(self.input, one, **self.policy)
        self.assertEqual((one / "manifest.json").read_bytes(), saved)

    def test_duplicate_rows_inside_sample_are_retained(self):
        doc = synthetic_observation()
        doc["reviews"] *= 2
        self.input.write_bytes(encoded(doc))
        path, manifest = archive_observation(self.input, self.output / "dups", **self.policy)
        self.assertEqual(manifest["reviews_saved"], 2)
        self.assertEqual(manifest["reviews_with_duplicate_candidates"], 1)
        self.assertEqual(len(read_document((path / "raw.json").read_bytes())["reviews"]), 2)

    def test_outside_paths_rejected_before_writing(self):
        with self.assertRaises(ObservationError):
            archive_observation(self.input, self.root / "outside", **self.policy)
        outside = self.root / "public.json"
        outside.write_bytes(self.original)
        with self.assertRaises(ObservationError):
            private_input(outside, **self.policy)
        self.assertEqual(list(self.output.iterdir()), [])

    def test_invalid_input_creates_no_output(self):
        self.input.write_bytes(b"{}")
        with self.assertRaises(ObservationError):
            archive_observation(self.input, self.output / "bad", **self.policy)
        self.assertEqual(list(self.output.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
