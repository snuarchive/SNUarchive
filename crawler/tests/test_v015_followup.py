"""Synthetic follow-up cases for v0.1.5. No private corpus required.

These tests intentionally fail on the uploaded 0.1.5 snapshot. They check
interpretation and attribution, not the total count of extracted candidates.
"""
import unittest
from crawler.everytime_stats.extract import extract_comment
from crawler.everytime_stats.models import Comment


def parse(text):
    return extract_comment(Comment(0, 0, "합성 과목", "합성 교수", text,
                                   "synthetic.json", "a" * 64))


def numeric_rows(result, field, kind=None):
    return [r for r in result["records"]
            if r["statistics"][field] is not None
            and (kind is None or r["assessment"]["kind"] == kind)]


class V015FollowupTests(unittest.TestCase):
    def test_combined_score_is_not_replicated_to_individual_exams(self):
        result = parse("2025년 1학기 중간과 기말을 합쳐서 평균 140점, 만점 200점입니다.")
        individual = [r for r in result["records"]
                      if r["scope"] == "whole"
                      and r["assessment"]["kind"] in ("midterm", "final")
                      and (r["statistics"]["average"] == 140
                           or r["statistics"]["max_score"] == 200)]
        self.assertFalse(individual)
        self.assertEqual(result["classification"], "review_required")
        self.assertTrue(result["records"], "Keep an unresolved/composite candidate instead of dropping it.")

    def test_conditional_mean_is_not_an_observed_value(self):
        result = parse("2025년 1학기 중간고사 평균 50점이라면 높은 편입니다.")
        self.assertFalse(numeric_rows(result, "average"))
        self.assertEqual(result["classification"], "review_required")

    def test_uncertain_median_is_preserved_as_uncertain(self):
        result = parse("2025년 1학기 중간고사 평균 95점, 만점 150점입니다. 중간값이 94인가 그랬어요.")
        self.assertFalse(numeric_rows(result, "q2"))
        self.assertEqual(numeric_rows(result, "average", "midterm")[0]["statistics"]["average"], 95)
        self.assertEqual(numeric_rows(result, "max_score", "midterm")[0]["statistics"]["max_score"], 150)
        self.assertEqual(result["classification"], "review_required")

    def test_english_label_with_korean_particle_is_recognized(self):
        result = parse("2025년 1학기 중간고사 평균 14.8점, median은 16.3점, Q3는 18.2점입니다.")
        rows = numeric_rows(result, "q2", "midterm")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["statistics"]["q2"], 16.3)
        self.assertEqual(rows[0]["statistics"]["average"], 14.8)

    def test_later_personal_total_does_not_cancel_explicit_group_means(self):
        result = parse("2025년 1학기 중간 평균 42.2 / 기말 평균 41.1 / 저는 합쳐서 90 정도 나왔고 A+이었습니다.")
        rows = numeric_rows(result, "average", "final")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["statistics"]["average"], 41.1)
        self.assertEqual(numeric_rows(result, "average", "midterm")[0]["statistics"]["average"], 42.2)
        self.assertTrue(all(r["statistics"]["average"] != 90 for r in result["records"]))

    def test_later_local_term_does_not_backfill_previous_paragraph(self):
        result = parse("중간고사 평균 60점.\n\n2025년 1학기 기말고사 평균 70점.")
        mid = numeric_rows(result, "average", "midterm")[0]
        final = numeric_rows(result, "average", "final")[0]
        self.assertIsNone(mid["year"])
        self.assertIsNone(mid["semester"])
        self.assertEqual((final["year"], final["semester"]), (2025, 1))

    def test_spaced_midterm_numbers_do_not_collapse(self):
        result = parse("2025년 1학기\n중간 1: 평균 30점\n중간 2: 평균 50점")
        self.assertEqual(sorted((r["assessment"]["number"], r["statistics"]["average"])
                                for r in numeric_rows(result, "average", "midterm")),
                         [(1, 30), (2, 50)])
        # A numbered midterm need not be API-compatible; do not remap it to quiz/exam.

    def test_explicit_winter_is_kept_without_inventing_a_year(self):
        result = parse("이번 겨울학기에 수강했습니다.\n중간고사 평균 73.7점입니다.")
        row = numeric_rows(result, "average", "midterm")[0]
        self.assertIsNone(row["year"])
        self.assertEqual(row["semester"], 4)
        self.assertEqual(row["status"], "review_required")

    def test_actual_is_not_the_personal_pronoun_suffix(self):
        result = parse("2025년 1학기 중간고사 실제 평균은 30점입니다.")
        rows = numeric_rows(result, "average", "midterm")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["statistics"]["average"], 30)


if __name__ == "__main__":
    unittest.main()
