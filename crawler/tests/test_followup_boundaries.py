"""Invented boundary/positive controls accompanying the unchanged reviewer tests."""
import unittest

from crawler.tests.test_v015_followup import parse, numeric_rows


class FollowupBoundaryTests(unittest.TestCase):
    def test_explicit_each_is_not_combined(self):
        rows = numeric_rows(parse("2025년 1학기 중간과 기말 모두 각각 평균 70점"), "average")
        self.assertEqual([(r["assessment"]["kind"], r["scope"], r["statistics"]["average"])
                          for r in rows], [("midterm", "whole", 70), ("final", "whole", 70)])

    def test_qualifier_and_number_remain_traceable(self):
        for label, qualifier, field in (("평균 51", "점이라면", "average"), ("중간값 93", "인가 그랬어요", "q2")):
            text = "중간 " + label + qualifier + ". 기말 평균 68점"
            result = parse(text)
            self.assertEqual(numeric_rows(result, "average", "final")[0]["statistics"]["average"], 68)
            candidate = next(c for r in result["records"] for c in r["candidates"] if c.get("field") == field)
            self.assertIsNotNone(candidate["value"])
            self.assertIn(candidate["value_text"], candidate["text"])
            self.assertIn(candidate["qualifier"], candidate["text"])
            self.assertEqual(text[candidate["start"]:candidate["end"]], candidate["text"])

    def test_global_header_survives_paragraph_breaks(self):
        rows = numeric_rows(parse("2025년 1학기\n\n중간 평균 31점\n\n기말 평균 52점"), "average")
        self.assertEqual([(r["year"], r["semester"]) for r in rows], [(2025, 1), (2025, 1)])

    def test_inline_date_does_not_escape_its_paragraph(self):
        rows = numeric_rows(parse("중간 평균 31점\n\n2025년 1학기 기말 평균 52점\n\n퀴즈 평균 4점"), "average")
        self.assertEqual([(r["year"], r["semester"]) for r in rows], [(None, None), (2025, 1), (None, None)])

    def test_inline_date_does_not_escape_to_next_exam_line(self):
        rows = numeric_rows(parse("중간 평균 31점\n2025년 1학기 기말 평균 52점\n퀴즈 평균 4점"), "average")
        self.assertEqual([(r["year"], r["semester"]) for r in rows], [(None, None), (2025, 1), (None, None)])

    def test_two_dated_midterms_remain_separate(self):
        rows = numeric_rows(parse("2024년 1학기 중간 평균 31점 / 2025년 2학기 중간 평균 52점"), "average")
        self.assertEqual([(r["year"], r["semester"], r["statistics"]["average"]) for r in rows], [(2024, 1, 31), (2025, 3, 52)])

    def test_later_full_term_overrides_earlier_semester_only(self):
        rows = numeric_rows(parse("이번 겨울학기에 수강했습니다.\n중간 평균 31점\n2025년 1학기 기말 평균 52점"), "average")
        self.assertEqual([(r["year"], r["semester"]) for r in rows], [(None, 4), (2025, 1)])

    def test_points_and_fraction_are_not_exam_numbers(self):
        for text in ("중간 1점 (평균 31점)", "중간 1/100 (평균 31점)", "중간 1 / 100 (평균 31점)", "중간 1.5점 평균 31점", "중간 12점 평균 31점"):
            with self.subTest(text=text):
                rows = numeric_rows(parse(text), "average")
                self.assertIsNone(rows[0]["assessment"]["number"])
        for label in ("중간1", "중간 1", "중간고사 1"):
            self.assertEqual(numeric_rows(parse(label + ": 평균 31점"), "average")[0]["assessment"]["number"], 1)

    def test_english_word_and_numeric_boundaries(self):
        for label in ("premedian은", "median2", "median16.3", "median_value"):
            self.assertFalse(numeric_rows(parse("중간 " + label + " 16.3점"), "q2"))
        malformed = parse("중간 median은 16.3.5")
        self.assertFalse(numeric_rows(malformed, "q2"))
        self.assertEqual(malformed["classification"], "review_required")
        self.assertFalse(numeric_rows(parse("중간 만점 16.3.5"), "max_score"))

    def test_personal_pronoun_still_blocks_personal_mean(self):
        self.assertFalse(numeric_rows(parse("중간 제 평균은 31점"), "average"))
        self.assertFalse(numeric_rows(parse("중간 내 점수 평균은 31점"), "average"))
        self.assertEqual(numeric_rows(parse("중간 실제 평균은 31점"), "average")[0]["statistics"]["average"], 31)


if __name__ == "__main__":
    unittest.main()
