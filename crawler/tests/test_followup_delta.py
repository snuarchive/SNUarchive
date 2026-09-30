"""Synthetic regressions prompted by the post-change source audit."""
import unittest

from crawler.tests.test_v015_followup import parse, numeric_rows


class FollowupDeltaTests(unittest.TestCase):
    def test_calendar_numbers_are_not_exam_rounds(self):
        for label in ("중간 1월 9일", "기말 1월 23일", "중간 2일 10시", "기말 3시"):
            rows = numeric_rows(parse(label + "\nQ3 72점"), "q3")
            self.assertIsNone(rows[0]["assessment"]["number"])

    def test_personal_assignment_mean_is_not_a_group_mean(self):
        result = parse("저는 과제는 평균 7/10, 중간 Q3+12, 기말 Q2 정도로 A+ 받았습니다.")
        self.assertFalse(numeric_rows(result, "average"))
        self.assertFalse(numeric_rows(result, "max_score"))
        group = parse("과제 평균 7/10, 중간 Q3 53점. 저는 기말 Q2로 A+ 받았습니다.")
        self.assertEqual(numeric_rows(group, "average")[0]["statistics"]["average"], 7)

    def test_course_change_season_is_not_the_statistics_term(self):
        rows = numeric_rows(parse("이번 여름부터 기말 문제가 바뀌었습니다. 25-2 기준 중간 Q3 83점, 기말 Q3 74점"), "q3")
        self.assertTrue(rows)
        self.assertTrue(all((r["year"], r["semester"]) == (None, None) for r in rows))


if __name__ == "__main__":
    unittest.main()
