"""Synthetic raw -> unchanged extractor tests; enrollment is never exam metadata."""
import unittest
from crawler.everytime_local_runner.stats_adapter import extract_raw_review
from crawler.everytime_stats.validate import check_evidence


def extract(text, term='25년 1학기 수강자'):
    doc = {'course': {'title_raw': '합성강의', 'instructor_raw': '합성교수'},
           'capture': {'page_url': 'https://everytime.kr/lecture/view/12345?tab=article'},
           'reviews': [{'text_raw': text, 'enrollment_term_raw': term, 'field_evidence': {}}]}
    return extract_raw_review(doc, 0, 'synthetic/raw.json', 'a' * 64, complete=True)


class StatsAdapterTests(unittest.TestCase):
    def test_enrollment_does_not_fill_unknown_exam_term(self):
        result = extract('중간 평균 44점, 만점 100점')
        row = result['records'][0]
        self.assertIsNone(row['year'])
        self.assertIsNone(row['semester'])
        self.assertEqual(row['status'], 'review_required')
        self.assertEqual(row['source']['enrollment_term_raw'], '25년 1학기 수강자')
        self.assertFalse(row['source']['enrollment_is_assessment_term'])

    def test_body_term_wins_over_different_enrollment(self):
        text = '2024년 2학기\n중간 평균 44점, 만점 100점'
        row = extract(text)['records'][0]
        self.assertEqual((row['year'], row['semester']), (2024, 3))
        self.assertEqual(row['source']['json_pointer'], '/reviews/0')
        check_evidence(row, text)

    def test_observed_high_score_never_becomes_possible_maximum(self):
        row = extract('2024년 2학기\n중간 Max 83')['records'][0]
        self.assertEqual(row['observed_max'], 83)
        self.assertIsNone(row['statistics']['max_score'])
        self.assertIsNone(row['statistics']['q4'])

    def test_personal_score_not_population_statistic(self):
        result = extract('중간 Q3+8 기말 Q2-6으로 A0 받았습니다')
        self.assertEqual(result['classification'], 'excluded')

    def test_missing_values_stay_null_and_zero_is_preserved(self):
        row = extract('2024년 2학기\n중간 Q1 0 평균 44')['records'][0]
        self.assertEqual(row['statistics']['q1'], 0)
        self.assertIsNone(row['statistics']['q2'])
        self.assertIsNone(row['statistics']['max_score'])


if __name__ == '__main__':
    unittest.main()
