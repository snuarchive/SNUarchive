"""Invented regression sentences for the 0.1.4 review; no private inputs."""
import unittest

from crawler.everytime_stats.extract import extract_comment
from crawler.everytime_stats.models import Comment


def parse(text):
    return extract_comment(Comment(0, 0, "합성 과목", "합성 교수", text, "synthetic.json", "b" * 64))


def values(result, field):
    return [r for r in result["records"] if r["statistics"][field] is not None]


class ReviewRegressions(unittest.TestCase):
    def test_workload_measurements_are_not_scores(self):
        for text in ("리딩 평균 32페이지", "PPT 평균 18장", "매주 평균 7문제", "과제 평균 12문제씩", "발언 평균 2회", "평균 900원"):
            with self.subTest(text=text):
                result = parse(text)
                self.assertFalse(values(result, "average"))
                self.assertEqual(result["classification"], "excluded")
                self.assertTrue(result["excluded"]["evidence"])

    def test_units_have_distinct_score_non_score_and_unknown_paths(self):
        self.assertEqual(values(parse("중간 평균 47점"), "average")[0]["statistics"]["average"], 47)
        self.assertEqual(parse("평균 3시간")["classification"], "excluded")
        unknown = parse("자료의 평균 47이라고 적혔는데 단위는 알려주지 않았다")
        self.assertFalse(values(unknown, "average"))
        self.assertEqual(unknown["classification"], "review_required")
        self.assertTrue(any("uncertain_stat_unit" in r["review_reasons"] for r in unknown["records"]))

    def test_labelled_table_without_point_suffix_is_preserved(self):
        result = parse("중간 통계량\nQ1 19 Q2 37 Q3 58\n평균 41.5")
        self.assertEqual(values(result, "q3")[0]["statistics"]["q3"], 58)
        self.assertEqual(values(result, "average")[0]["statistics"]["average"], 41.5)

    def test_comparison_does_not_replace_exam_heading(self):
        result = parse("중간1은 퀴즈보다 쉬웠다. (평균 152점)")
        row = values(result, "average")[0]
        self.assertEqual((row["assessment"]["kind"], row["assessment"]["number"]), ("midterm", 1))

    def test_problem_source_does_not_replace_exam_heading(self):
        for source in ("과제에서", "과제애서"):
            result = parse(f"기말고사는 {source} 나온 문제였다. Q4는 312점이고 평균은 188점")
            self.assertTrue(all(r["assessment"]["kind"] == "final" for r in values(result, "average") + values(result, "q4")))

    def test_generic_exam_reference_does_not_replace_numbered_heading(self):
        result = parse("중간2는 어려웠다. 모든 시험에서 정정 공지는 없다. 평균 123점")
        row = values(result, "average")[0]
        self.assertEqual((row["assessment"]["kind"], row["assessment"]["number"]), ("midterm", 2))

    def test_project_alias_is_not_final(self):
        result = parse("기말은 Q3, 플젝은 만점(중앙값 12/16)이었다")
        row = values(result, "q2")[0]
        self.assertEqual(row["assessment"]["kind"], "other")
        self.assertEqual(row["statistics"]["max_score"], 16)

    def test_ambiguous_mention_does_not_claim_kind(self):
        result = parse("중간은 끝났다. 프로젝트 이야기도 했다. 평균은 43점이라고만 적혔다")
        row = values(result, "average")[0]
        self.assertIsNone(row["assessment"]["kind"])

    def test_combined_statistics_are_not_copied_to_each_exam(self):
        result = parse("중간+기말 합산 평균 110점, 만점 200")
        rows = values(result, "average")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["scope"], "composite")
        self.assertIsNone(rows[0]["assessment"]["kind"])
        self.assertEqual(rows[0]["statistics"]["max_score"], 200)

    def test_whole_scope_resets_section_in_same_line_and_next_line(self):
        for separator in (" / ", "\n"):
            result = parse("중간 객관식 평균22" + separator + "전체 평균65")
            rows = values(result, "average")
            self.assertEqual([(r["scope"], r["component"], r["statistics"]["average"]) for r in rows], [("section", "객관식", 22), ("whole", None, 65)])

    def test_percentage_is_not_points_or_converted(self):
        result = parse("중간 평균70%, 만점200")
        self.assertFalse(values(result, "average"))
        self.assertEqual(values(result, "max_score")[0]["statistics"]["max_score"], 200)
        self.assertTrue(any("unsupported_score_unit" in r["review_reasons"] for r in result["records"]))

    def test_rank_denominator_is_not_maximum(self):
        result = parse("중간 평균 52점, 저는 23/80등이었습니다")
        self.assertEqual(values(result, "average")[0]["statistics"]["average"], 52)
        self.assertFalse(values(result, "max_score"))

    def test_grouped_numbers_are_not_truncated(self):
        result = parse("중간 평균1,200 / 만점2,000")
        self.assertFalse(values(result, "average"))
        self.assertFalse(values(result, "max_score"))
        self.assertEqual(result["classification"], "review_required")

    def test_hypothetical_mean_is_not_observed(self):
        result = parse("중간 평균50이라고 가정하면 결과는 달라진다")
        self.assertFalse(values(result, "average"))
        self.assertTrue(any("hypothetical_value" in r["review_reasons"] for r in result["records"]))

    def test_ambiguous_quartile_and_avg_are_detected(self):
        result = parse("중간 사분위값이 87점이었다")
        self.assertEqual(result["classification"], "review_required")
        self.assertTrue(all(not values(result, k) for k in ("q1", "q2", "q3", "q4")))
        avg = parse("중간 avg 65.4")
        self.assertEqual(avg["classification"], "review_required")
        self.assertEqual(values(avg, "average")[0]["statistics"]["average"], 65.4)

    def test_score_ratio_with_point_suffixes(self):
        result = parse("중간2: 108점/160점을 받았고 평균 97점이었다")
        row = values(result, "average")[0]
        self.assertEqual(row["statistics"]["max_score"], 160)

    def test_shared_unspecified_exams_keep_kind_but_not_invented_number(self):
        row = values(parse("두 시험 모두 60점 만점이었다"), "max_score")[0]
        self.assertEqual(row["assessment"]["kind"], "exam")
        self.assertIsNone(row["assessment"]["number"])

    def test_parenthesized_score_table_without_exam_name(self):
        row = values(parse("54/80 (평균 39, 표준편차 12)"), "average")[0]
        self.assertEqual(row["statistics"]["max_score"], 80)
        self.assertIsNone(row["assessment"]["kind"])

    def test_comma_after_denominator_is_a_separator(self):
        row = values(parse("1차: 63/90, (평균 51.5)"), "average")[0]
        self.assertEqual(row["statistics"]["max_score"], 90)

    def test_repeated_quiz_reference_keeps_explicit_heading(self):
        row = values(parse("3. 퀴즈: 과제와 동일하게 진행했다. 퀴즈에서 감점은 적다. 평균 3.8점"), "average")[0]
        self.assertEqual(row["assessment"]["kind"], "quiz")

    def test_explicit_assignment_statistic_introduction(self):
        row = values(parse("과제가 코딩 과제인지라 Q2 72 Q3 81로 통계량이 높았다"), "q2")[0]
        self.assertEqual(row["assessment"]["kind"], "assignment")

    def test_combined_label_without_point_suffix_keeps_value(self):
        row = values(parse("중간+기말 합산 평균 112"), "average")[0]
        self.assertEqual(row["scope"], "composite")
        self.assertIsNone(row["assessment"]["kind"])

    def test_review_priority_and_value_vs_date_issues(self):
        distribution = values(parse("중간 평균 42"), "average")[0]
        self.assertEqual(distribution["candidate_tier"], "quartiles_or_average")
        self.assertEqual(distribution["review_issues"]["value_interpretation"], [])
        self.assertEqual(set(distribution["review_issues"]["temporal_metadata"]), {"missing_year", "missing_semester"})
        bound = values(parse("중간 만점 80"), "max_score")[0]
        self.assertEqual(bound["candidate_tier"], "bounds_only")
        mention = parse("중간 평균 40점 근방")["records"][0]
        self.assertEqual(mention["candidate_tier"], "mention_only")
        self.assertIn("approximate_value", mention["review_issues"]["value_interpretation"])

    def test_conditional_score_scale_is_not_an_observed_distribution(self):
        result = parse("시험은 120점 만점일 때 중앙값 57로 내는 것 같습니다")
        self.assertFalse(values(result, "q2"))
        self.assertFalse(values(result, "max_score"))
        self.assertEqual(result["classification"], "review_required")

    def test_final_comparison_to_midterm_keeps_final_identity(self):
        result = parse("기말고사는 중간고사와 비슷하게 나왔다. 중간고사와 다르게 만점 180점이다. 평균 132점")
        row = values(result, "average")[0]
        self.assertEqual(row["assessment"]["kind"], "final")
        self.assertEqual(row["statistics"]["max_score"], 180)

    def test_project_presentations_are_not_midterm_and_final_exams(self):
        result = parse("팀 프로젝트 중간 기말 발표 모두 80점 만점이었다")
        rows = values(result, "max_score")
        self.assertEqual(len(rows), 1)
        self.assertNotIn(rows[0]["assessment"]["kind"], ("midterm", "final"))

    def test_near_observed_maximum_is_not_exact(self):
        result = parse("시험 60점 만점에 최고점이 48점 근처였다")
        self.assertTrue(all(r["observed_max"] is None for r in result["records"]))
        self.assertEqual(values(result, "max_score")[0]["statistics"]["max_score"], 60)


if __name__ == "__main__":
    unittest.main()
