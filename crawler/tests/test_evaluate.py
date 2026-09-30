"""Synthetic expected records, including deliberate bad predictions."""
from copy import deepcopy
import unittest

from crawler.everytime_stats.evaluate import compare_records, validation_metadata


def expected_record():
    return {"year": 2023, "semester": 3, "kind": "quiz", "number": 1,
            "scope": "whole", "component": None,
            "statistics": {"q1": None, "q2": None, "q3": None, "q4": None,
                           "average": 42, "max_score": None}, "observed_max": None}


def prediction(expected):
    value = deepcopy(expected)
    value["assessment"] = {"kind": value.pop("kind"), "number": value.pop("number")}
    return value


class EvaluateTests(unittest.TestCase):
    def test_correct_record_passes(self):
        e = expected_record()
        self.assertTrue(compare_records([e], [prediction(e)], "numeric")["passed"])

    def test_wrong_year_and_semester_fail(self):
        e = expected_record()
        for field, value in (("year", 2024), ("semester", 1), ("year", None), ("semester", None)):
            p = prediction(e); p[field] = value
            self.assertFalse(compare_records([e], [p], "numeric")["passed"])

    def test_extracted_date_metadata_is_checked_end_to_end(self):
        from crawler.everytime_stats.extract import extract_comment
        from crawler.everytime_stats.models import Comment
        text = "2023년 2학기\n퀴즈1 평균 42"
        result = extract_comment(Comment(0, 0, "합성", "합성", text, "synthetic.json", "c" * 64))
        e = expected_record()
        self.assertTrue(compare_records([e], result["records"], "numeric")["passed"])
        for field, wrong in (("year", 2022), ("semester", 2)):
            bad = deepcopy(result["records"]); bad[0][field] = wrong
            self.assertFalse(compare_records([e], bad, "numeric")["passed"])

    def test_required_null_is_compared(self):
        e = expected_record(); p = prediction(e)
        p["statistics"]["max_score"] = 100
        self.assertFalse(compare_records([e], [p], "numeric")["passed"])

    def test_kind_number_scope_and_component_are_compared(self):
        e = expected_record()
        for path, value in (("kind", "exam"), ("number", 2), ("scope", "section"), ("component", "객관식")):
            p = prediction(e)
            (p["assessment"] if path in ("kind", "number") else p)[path] = value
            self.assertFalse(compare_records([e], [p], "numeric")["passed"])

    def test_same_value_in_two_assessments_cannot_collapse(self):
        a = expected_record(); b = deepcopy(a); b["number"] = 2
        self.assertFalse(compare_records([a, b], [prediction(a)], "numeric")["passed"])
        self.assertFalse(compare_records([a, b], [prediction(a), prediction(a)], "numeric")["passed"])

    def test_identical_occurrences_are_counted_not_set_deduplicated(self):
        e = expected_record()
        self.assertFalse(compare_records([e, e], [prediction(e)], "numeric")["passed"])
        self.assertTrue(compare_records([e, e], [prediction(e), prediction(e)], "numeric")["passed"])

    def test_all_mode_can_require_completely_null_record(self):
        e = expected_record(); e["statistics"]["average"] = None
        self.assertFalse(compare_records([e], [], "all")["passed"])
        self.assertTrue(compare_records([e], [prediction(e)], "all")["passed"])

    def test_v2_missing_metadata_or_null_fields_is_invalid(self):
        for field in ("year", "semester", "observed_max"):
            e = expected_record(); del e[field]
            with self.assertRaises(ValueError):
                compare_records([e], [], "numeric")
        e = expected_record(); del e["statistics"]["q1"]
        with self.assertRaises(ValueError):
            compare_records([e], [], "numeric")

    def test_matching_hash_alone_never_proves_independence(self):
        f = {"split": "validation", "code_sha256_at_annotation": "same"}
        self.assertEqual(validation_metadata(f, {"sha256": "same"})["validation_role"], "legacy_unclassified")

    def test_independence_requires_explicit_protocol_and_reuse_is_reported(self):
        f = {"validation_role": "independent_holdout"}
        with self.assertRaises(ValueError):
            validation_metadata(f, {"sha256": "frozen"})
        f["validation_protocol"] = {"selected_after_rule_freeze": True,
                                    "annotated_before_predictions": True,
                                    "disjoint_from_known_cases": True,
                                    "used_for_rule_changes": False,
                                    "frozen_code_sha256": "frozen"}
        self.assertEqual(validation_metadata(f, {"sha256": "frozen"})["validation_role"], "independent_holdout")
        f["validation_protocol"]["used_for_rule_changes"] = True
        self.assertEqual(validation_metadata(f, {"sha256": "frozen"})["validation_role"], "reused_regression")


if __name__ == "__main__":
    unittest.main()
