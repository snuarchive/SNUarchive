"""Only invented examples. No private files, network, database or Excel required."""
import unittest

from crawler.everytime_stats.extract import extract_comment
from crawler.everytime_stats.models import Comment
from crawler.everytime_stats.validate import check_evidence


def parse(text):
    return extract_comment(Comment(0, 0, "합성 강의", "합성 교수", text, "synthetic.json", "a" * 64))


def with_field(result, field):
    return [r for r in result["records"] if (r["observed_max"] if field == "observed_max" else r["statistics"][field]) is not None]


class ExtractTests(unittest.TestCase):
    def test_observed_max_is_never_q4(self):
        r = parse("2024년 2학기\n중간 Max 83 / 만점 110")
        row = with_field(r, "observed_max")[0]
        self.assertEqual(row["observed_max"], 83)
        self.assertIsNone(row["statistics"]["q4"])
        self.assertEqual(row["statistics"]["max_score"], 110)
        self.assertIn("observed_max_q4_mapping_unresolved", row["review_reasons"])
        self.assertEqual(row["semester"], 3)

    def test_explicit_q4_with_explicit_term_is_accepted(self):
        result = parse("2024년 2학기\n중간 Q1 31 Q2 52 Q3 73 Q4 91 만점 110")
        self.assertEqual(result["classification"], "accepted")
        self.assertEqual(with_field(result, "q4")[0]["statistics"]["q4"], 91)

    def test_personal_offset_does_not_create_quantile(self):
        result = parse("중간 Q3+8 기말 Q2-6으로 A0 받았습니다")
        self.assertEqual(result["classification"], "excluded")

    def test_mixed_personal_and_population_scores(self):
        result = parse("중간 81점(q3:75.25) 기말 92점(q3:85)")
        rows = with_field(result, "q3")
        self.assertEqual([(r["assessment"]["kind"], r["statistics"]["q3"]) for r in rows], [("midterm", 75.25), ("final", 85)])
        self.assertTrue(all(r["statistics"]["max_score"] is None for r in rows))

    def test_distinct_exams_and_homework(self):
        result = parse("중간 평균 44\n기말 평균 66\nHW2 평균: 3.25/6")
        rows = with_field(result, "average")
        self.assertEqual([(r["assessment"]["kind"], r["assessment"]["number"], r["statistics"]["average"]) for r in rows], [("midterm", None, 44), ("final", None, 66), ("assignment", 2, 3.25)])

    def test_section_is_not_whole_exam(self):
        result = parse("중간 객관식 평균 18.75, 25점 만점\n기말 평균 62.5 100점 만점")
        rows = with_field(result, "average")
        self.assertEqual(rows[0]["scope"], "section")
        self.assertEqual(rows[0]["component"], "객관식")
        self.assertEqual(rows[1]["scope"], "whole")

    def test_unsupported_tuple_stays_for_review(self):
        result = parse("중간 통계량 21/42/63/84")
        self.assertEqual(result["classification"], "review_required")
        self.assertTrue(all(not any(v is not None for v in r["statistics"].values()) for r in result["records"]))

    def test_approximate_or_interval_not_exact(self):
        for text in ("중간 평균 45점대", "기말 Q3 66~77", "중간 평균 40 정도"):
            with self.subTest(text=text):
                result = parse(text)
                self.assertEqual(result["classification"], "review_required")
                self.assertFalse(with_field(result, "average") + with_field(result, "q3"))

    def test_no_missing_term_or_number_imputation(self):
        row = with_field(parse("퀴즈 평균 6.25"), "average")[0]
        self.assertIsNone(row["year"])
        self.assertIsNone(row["semester"])
        self.assertIsNone(row["assessment"]["number"])
        self.assertIn("missing_number", row["review_reasons"])

    def test_numbered_exam_is_not_midterm(self):
        row = with_field(parse("2차 시험 평균 43.75"), "average")[0]
        self.assertEqual(row["assessment"]["kind"], "exam")
        self.assertEqual(row["assessment"]["number"], 2)

    def test_multiline_headings_and_zero(self):
        result = parse("중간\nQ1: 0\nQ2: 24\n\n기말\nQ1: 11\nQ2: 32")
        self.assertEqual([r["statistics"]["q1"] for r in with_field(result, "q1")], [0, 11])

    def test_conflicting_values_are_not_overwritten(self):
        result = parse("중간 Q3 71 Q3 74")
        self.assertFalse(with_field(result, "q3"))
        self.assertIn("conflicting_values", result["records"][0]["review_reasons"])

    def test_no_cross_comment_context(self):
        parse("2024년 1학기\n중간 평균 41")
        row = with_field(parse("평균 43"), "average")[0]
        self.assertIsNone(row["assessment"]["kind"])
        self.assertIsNone(row["year"])

    def test_evidence_roundtrip_unicode_crlf(self):
        text = "😀 합성 예시\r\n중간 Q3는 61.375 기말 평균 39.25"
        result = parse(text)
        for record in result["records"]:
            check_evidence(record, text)
            for key in ("evidence", "context_evidence", "candidates"):
                for ev in record[key]:
                    self.assertEqual(text[ev["start"]:ev["end"]], ev["text"])
        self.assertEqual(with_field(result, "q3")[0]["statistics"]["q3"], 61.375)

    def test_no_implicit_hundred_or_highest_score(self):
        row = with_field(parse("기말 Q4 96"), "q4")[0]
        self.assertIsNone(row["statistics"]["max_score"])

    def test_shared_maximum_with_generic_exam_noun(self):
        for text in ("중간 기말 시험의 만점은 130점입니다.", "시험은 둘 다 130점 만점에 중간 Q3 95 기말 Q3 102"):
            rows = with_field(parse(text), "max_score")
            self.assertEqual({r["assessment"]["kind"] for r in rows}, {"midterm", "final"})
            self.assertEqual([r["statistics"]["max_score"] for r in rows], [130, 130])

    def test_unlabelled_tuple_does_not_replace_denominator(self):
        row = with_field(parse("중간 통계량 130점 만점 25/51/76/102"), "max_score")[0]
        self.assertEqual(row["statistics"]["max_score"], 130)
        self.assertTrue(all(row["statistics"][f"q{i}"] is None for i in range(1, 5)))

    def test_tuple_without_statistics_keyword_is_not_excluded(self):
        result = parse("중간 21/42/63/84")
        self.assertEqual(result["classification"], "review_required")

    def test_multiline_component_headings(self):
        result = parse("2024년 1학기\n중간 객관식\nQ1 12\nQ2 18\n중간 서술형\nQ1 24\n기말\nQ1 35")
        rows = with_field(result, "q1")
        self.assertEqual([(r["component"], r["scope"], r["statistics"]["q1"]) for r in rows], [("객관식", "section", 12), ("서술형", "section", 24), (None, "whole", 35)])

    def test_unsupported_labels_remain_candidates(self):
        for text in ("중간 최고 점수는 비공개입니다", "시험 메디안: 54", "기말 표준편차 8.5"):
            self.assertEqual(parse(text)["classification"], "review_required")

    def test_evidence_checker_rejects_mismatch(self):
        text = "중간 평균 38.75"
        row = with_field(parse(text), "average")[0]
        row["evidence"][0]["end"] -= 1
        with self.assertRaises(ValueError):
            check_evidence(row, text)

    def test_compound_quantile_label_does_not_yield_twenty_three(self):
        result = parse("기말 Q123가 모두 70점대")
        self.assertEqual(result["classification"], "review_required")
        self.assertFalse(with_field(result, "q1"))

    def test_average_duration_is_not_average_score(self):
        for text in ("수업 평균 2시간", "과제 평균 4시간 투자", "실험 평균이 3시간 반"):
            self.assertEqual(parse(text)["classification"], "excluded")

    def test_approximate_level_not_exact(self):
        result = parse("시험 75점 만점에 Q3 45점 수준")
        self.assertFalse(with_field(result, "q3"))
        self.assertEqual(with_field(result, "max_score")[0]["statistics"]["max_score"], 75)

    def test_explicit_maximum_survives_unparsed_mean(self):
        result = parse("시험 평균이 120점만점에 93점 언저리입니다")
        self.assertFalse(with_field(result, "average"))
        self.assertEqual(with_field(result, "max_score")[0]["statistics"]["max_score"], 120)

    def test_multiple_exam_mentions_do_not_leak_heading(self):
        result = parse("중간 Q3 81 기말은 어려웠다\n나중에 Q3 63이었다")
        rows = with_field(result, "q3")
        self.assertEqual([(r["assessment"]["kind"], r["statistics"]["q3"]) for r in rows], [("midterm", 81), (None, 63)])

    def test_assessment_ordinal_is_not_maximum(self):
        result = parse("중간1 만점, 중간2 Q3, 기말 83점(Q3 79.25)로 A0 받았습니다")
        self.assertFalse(with_field(result, "max_score"))

    def test_near_mean_and_hyphen_range_are_not_exact(self):
        for text in ("중간 기말 모두 평균 48점 근방", "중간 Q3 62-68", "기말 평균 58/100 정도"):
            result = parse(text)
            self.assertEqual(result["classification"], "review_required")
            self.assertFalse(with_field(result, "average") + with_field(result, "q3"))

    def test_approximate_denominator_is_not_exact(self):
        self.assertFalse(with_field(parse("중간 약 120점 만점"), "max_score"))

    def test_letter_grade_is_not_maximum_score(self):
        result = parse("A0 만점 비율을 보았어요")
        self.assertEqual(result["classification"], "review_required")
        self.assertFalse(with_field(result, "max_score"))

    def test_quantile_label_digit_is_not_ratio_numerator(self):
        result = parse("중간: Q1 28 / Q2 / 46.25 / Q3 72")
        self.assertEqual(result["classification"], "review_required")
        self.assertFalse(with_field(result, "max_score"))
        self.assertFalse(with_field(result, "q2"))
        self.assertEqual(with_field(result, "q1")[0]["statistics"]["q1"], 28)
        self.assertEqual(with_field(result, "q3")[0]["statistics"]["q3"], 72)

    def test_unmapped_comma_list_does_not_select_first_value(self):
        result = parse("시험 Q3는 42, 68 Q4는 둘 다 만점")
        self.assertEqual(result["classification"], "review_required")
        self.assertFalse(with_field(result, "q3"))
        self.assertIn("multiple_unlabelled_values", result["records"][0]["review_reasons"])

    def test_comma_before_explicit_denominator_is_not_value_list(self):
        result = parse("중간 Q3 42, 100점 만점")
        self.assertEqual(with_field(result, "q3")[0]["statistics"]["q3"], 42)
        self.assertEqual(with_field(result, "max_score")[0]["statistics"]["max_score"], 100)


if __name__ == "__main__":
    unittest.main()
