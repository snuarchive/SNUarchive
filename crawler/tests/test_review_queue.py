"""Synthetic review-material tests; no private files or corpus are required."""
from copy import deepcopy
import unittest

from crawler.everytime_stats.models import Comment, FIELDS, evidence
from crawler.everytime_stats.review import REVIEW_STATUSES, build_review_materials


def comment(index, text="중간 평균 60점. 기말 통계량은 미공개.", title="합성 과목", instructor="합성 교수"):
    return Comment(index, 0, title, instructor, text, "synthetic.json", "a" * 64)


def record(source, index=0, field="average", value=60, span="평균 60", kind="midterm", number=None):
    figures = dict.fromkeys(FIELDS)
    items = []
    observed_max = None
    if field is not None:
        if field == "observed_max":
            observed_max = value
        else:
            figures[field] = value
        start = source.text.index(span)
        items.append(evidence(source.text, start, start + len(span), "synthetic_label", field=field, value=value))
    return {
        "record_id": f"synthetic-{source.course_index}-{index}",
        "source": source.source(), "course_title": source.title, "instructor": source.instructor,
        "assessment": {"kind": kind, "number": number, "raw_label": kind},
        "scope": "whole", "component": None, "year": 2025, "semester": 1,
        "statistics": figures, "observed_max": observed_max,
        "evidence": items, "candidates": [], "context_evidence": [],
        "status": "accepted" if field is not None else "review_required",
        "review_reasons": [] if field is not None else ["unsupported_stat_expression"],
        "xlsx_refs": [{"sheet": "합성", "row": 2, "cell": "C2", "xlsx_sha256": "b" * 64}],
    }


def result(source, *records):
    excluded = None if records else {
        "source": source.source(), "status": "excluded", "reason": "no_statistic_marker", "evidence": [],
    }
    return {
        "records": list(records), "excluded": excluded, "non_score_evidence": [],
        "classification": "review_required" if any(row["status"] == "review_required" for row in records) else "accepted" if records else "excluded",
    }


class ReviewQueueTests(unittest.TestCase):
    def test_grouping_keeps_numeric_and_empty_records_without_deduplicating_exams(self):
        source = comment(0)
        first = record(source, number=1)
        second = record(source, index=1, number=2)
        empty = record(source, index=2, field=None, kind="final")
        start = source.text.index("통계량")
        empty["candidates"] = [evidence(source.text, start, len(source.text), "unsupported_stat_expression")]
        data = build_review_materials([source], {source.pointer: result(source, first, second, empty)})
        self.assertEqual(data["summary"]["numeric_candidates"], 2)
        self.assertEqual(data["summary"]["numeric_comments"], 1)
        self.assertEqual(data["summary"]["all_candidates_in_numeric_comments"], 3)
        entry = data["queue"][0]
        self.assertEqual(entry["source"], source.source())
        self.assertEqual(entry["original_text"], source.text)
        self.assertEqual([row["assessment"]["number"] for row in entry["candidates"]], [1, 2, None])
        self.assertEqual(entry["candidates"][2]["candidates"], empty["candidates"])
        self.assertEqual(entry["candidates"][0]["xlsx_refs"], first["xlsx_refs"])
        self.assertEqual(data["summary"]["omission_sampling"]["group_counts"], {"mention_only": 0, "excluded": 0})

    def test_dynamic_counts_include_bounds_and_observed_max(self):
        sources = [comment(0), comment(1), comment(2, "기말 최고점 88점", instructor="합성 교수 2")]
        results = {
            sources[0].pointer: result(sources[0], record(sources[0])),
            sources[1].pointer: result(sources[1], record(sources[1], field="max_score", span="60", value=60)),
            sources[2].pointer: result(sources[2], record(sources[2], field="observed_max", span="최고점 88", value=88, kind="final")),
        }
        data = build_review_materials(sources, results)
        self.assertEqual(data["summary"]["numeric_candidates"], 3)
        self.assertEqual(data["summary"]["numeric_comments"], 3)
        self.assertEqual(data["summary"]["numeric_course_instructor_pairs"], 2)
        self.assertEqual(data["summary"]["numeric_candidate_tiers"], {"quartiles_or_average": 1, "bounds_only": 2})
        observed = data["queue"][2]["candidates"][0]
        self.assertEqual(observed["value_evidence_links"], {"observed_max": {"value": 88, "evidence_indices": [0]}})

    def test_value_links_only_reference_the_same_field_and_value(self):
        source = comment(0, "중간 평균 60점, Q2 60점, 평균 60점")
        row = record(source)
        median_start = source.text.index("Q2")
        repeated_start = source.text.rindex("평균")
        row["statistics"]["q2"] = 60
        row["evidence"].extend([
            evidence(source.text, median_start, median_start + len("Q2 60"), "synthetic_label", field="q2", value=60),
            evidence(source.text, repeated_start, repeated_start + len("평균 60"), "synthetic_label", field="average", value=60),
        ])
        data = build_review_materials([source], {source.pointer: result(source, row)})
        copied = data["queue"][0]["candidates"][0]
        self.assertEqual(copied["value_evidence_links"]["average"]["evidence_indices"], [0, 2])
        self.assertEqual(copied["value_evidence_links"]["q2"]["evidence_indices"], [1])
        self.assertEqual(copied["evidence"], row["evidence"])
        for field, link in copied["value_evidence_links"].items():
            for index in link["evidence_indices"]:
                item = copied["evidence"][index]
                self.assertEqual((item["field"], item["value"]), (field, link["value"]))
                self.assertEqual(source.text[item["start"]:item["end"]], item["text"])

    def test_all_review_statuses_start_unreviewed_even_for_accepted_values(self):
        source = comment(0)
        original = {source.pointer: result(source, record(source))}
        snapshot = deepcopy(original)
        data = build_review_materials([source], original)
        entry = data["queue"][0]
        for subject in (entry, *entry["candidates"]):
            self.assertTrue(all(subject[name] == "unreviewed" for name in REVIEW_STATUSES))
        self.assertEqual(entry["candidates"][0]["status"], "accepted")
        entry["candidates"][0]["statistics"]["average"] = 1
        entry["candidates"][0]["source"]["file_sha256"] = "changed"
        self.assertEqual(original, snapshot)

    def test_broken_source_or_evidence_links_are_rejected(self):
        source = comment(0)
        for damage in ("span", "source", "missing_value_evidence"):
            with self.subTest(damage=damage):
                row = record(source)
                if damage == "span":
                    row["evidence"][0]["start"] += 1
                elif damage == "source":
                    row["source"]["comment_sha256"] = "incorrect"
                else:
                    row["evidence"].clear()
                with self.assertRaises(ValueError):
                    build_review_materials([source], {source.pointer: result(source, row)})

    def test_omission_groups_are_separate_deterministic_and_respect_reservations(self):
        sources = [comment(index) for index in range(10)]
        results = {}
        for source in sources:
            if source.course_index < 4:
                results[source.pointer] = result(source, record(source, field=None))
            elif source.course_index < 8:
                results[source.pointer] = result(source)
            else:
                results[source.pointer] = result(source, record(source), record(source, index=1, field=None))
        reserved = [sources[0].pointer, sources[4].pointer, sources[8].pointer]
        data = build_review_materials(sources, results, seed=7, sample_size=2, reserved_pointers=reserved)
        repeated = build_review_materials(reversed(sources), dict(reversed(list(results.items()))), seed=7, sample_size=2, reserved_pointers=reserved)
        self.assertEqual(data, repeated)
        self.assertEqual(data["summary"]["omission_sampling"], {
            "group_counts": {"mention_only": 4, "excluded": 4},
            "eligible_counts": {"mention_only": 3, "excluded": 3},
            "sampled_counts": {"mention_only": 2, "excluded": 2},
            "reserved_comments": 3,
        })
        queue_pointers = {entry["source"]["json_pointer"] for entry in data["queue"]}
        self.assertIn(sources[8].pointer, queue_pointers)
        sampled = []
        for group, entries in data["omission_samples"]["groups"].items():
            for entry in entries:
                sampled.append(entry["source"]["json_pointer"])
                self.assertEqual(entry["original_text"], sources[0].text)
                self.assertTrue(all(entry[name] == "unreviewed" for name in REVIEW_STATUSES))
                self.assertEqual(bool(entry["candidates"]), group == "mention_only")
        self.assertEqual(len(sampled), len(set(sampled)))
        self.assertFalse(set(sampled) & (set(reserved) | queue_pointers))

    def test_empty_queue_and_zero_sample_size_keep_full_pool_counts(self):
        first, second = comment(0), comment(1)
        results = {first.pointer: result(first, record(first, field=None)), second.pointer: result(second)}
        data = build_review_materials([first, second], results, sample_size=0)
        self.assertEqual(data["queue"], [])
        self.assertEqual(data["summary"]["numeric_candidates"], 0)
        self.assertEqual(data["summary"]["numeric_course_instructor_pairs"], 0)
        self.assertEqual(data["omission_samples"]["groups"], {"mention_only": [], "excluded": []})
        self.assertEqual(data["summary"]["omission_sampling"]["group_counts"], {"mention_only": 1, "excluded": 1})

    def test_missing_extra_or_duplicate_comment_results_are_rejected(self):
        source = comment(0)
        examples = [
            ([source], {}),
            ([], {source.pointer: result(source)}),
            ([source, source], {source.pointer: result(source)}),
        ]
        for sources, results in examples:
            with self.subTest(count=len(sources)), self.assertRaises(ValueError):
                build_review_materials(sources, results)

    def test_sample_size_larger_than_pool_returns_each_comment_once(self):
        sources = [comment(0), comment(1)]
        results = {source.pointer: result(source) for source in sources}
        data = build_review_materials(sources, results, sample_size=10)
        sample = data["omission_samples"]["groups"]["excluded"]
        self.assertEqual({entry["source"]["json_pointer"] for entry in sample}, set(results))
        self.assertEqual(len(sample), 2)


if __name__ == "__main__":
    unittest.main()
