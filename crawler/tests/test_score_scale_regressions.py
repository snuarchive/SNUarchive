"""Known-defect variants, synthetic only; not an independent holdout."""
import unittest
from crawler.everytime_stats.extract import extract_comment
from crawler.everytime_stats.models import Comment
from crawler.everytime_stats.validate import check_evidence


def parse(text):
    return extract_comment(Comment(0, 0, '합성 강의', '합성 교수', text, 'synthetic.json', 'b' * 64))


def numeric(result):
    return [r for r in result['records'] if any(v is not None for v in r['statistics'].values()) or r['observed_max'] is not None]


class ConfirmedSemanticRegressions(unittest.TestCase):
    def test_causal_reference_does_not_steal_final_anchor(self):
        for adjective in ('어려워서', '쉬워서'):
            text = f'중간고사 q3가 150/200이었다. 기말은 중간이 {adjective} 그런지 문제를 바꿨고 q3는 180/200이었다.'
            rows = numeric(parse(text))
            self.assertEqual([(r['assessment']['kind'], r['statistics']['q3'], r['statistics']['max_score']) for r in rows],
                             [('midterm', 150, 200), ('final', 180, 200)])
            self.assertFalse(any('conflicting_values' in r['review_reasons'] for r in rows))

    def test_explicit_assessments_remain_separate(self):
        text = '중간 Q3 70, 기말 Q3 80\n1차 Q3 31, 2차 Q3 42, 3차 Q3 53\n퀴즈1 평균 8, 퀴즈2 평균 9\n과제1 평균 18, 과제2 평균 19'
        rows = numeric(parse(text))
        self.assertEqual([(r['assessment']['kind'], r['assessment']['number']) for r in rows],
                         [('midterm', None), ('final', None), ('exam', 1), ('exam', 2), ('exam', 3),
                          ('quiz', 1), ('quiz', 2), ('assignment', 1), ('assignment', 2)])

    def test_score_conversion_variants_are_held_not_independent_values(self):
        for expression in ('환산하면', '기본점수 20 빼면', '기본점수 제외', '배점 변환', '100점 환산'):
            with self.subTest(expression=expression):
                text = f'중간 평균 80점. {expression} 평균 60점.'
                result = parse(text)
                self.assertEqual(numeric(result), [])
                held = [r for r in result['records'] if r.get('score_scale_note')]
                self.assertEqual(len(held), 1)
                self.assertEqual(held[0]['status'], 'review_required')
                self.assertIn('score_scale_ambiguous', held[0]['review_reasons'])
                self.assertEqual({e['value'] for e in held[0]['evidence'] if e.get('field') == 'average'}, {80, 60})
                check_evidence(held[0], text)

    def test_scale_tables_across_paragraphs_keep_all_evidence(self):
        text = ('기말시험 통계량입니다.\n\nMean 348 Q1 337 Q2 353 Q3 375\n\n'
                '기말의 기본점수가 278점임을 감안하여 122점 만점 스케일로 점수를 다시 보면,\n\n'
                'Mean 70 Q1 59 Q2 75 Q3 97 (122점 만점)')
        result = parse(text)
        self.assertEqual(numeric(result), [])
        held = [r for r in result['records'] if r.get('score_scale_note')]
        self.assertEqual(len(held), 1)
        self.assertGreaterEqual(len(held[0]['score_scale_note']['observations']), 3)
        self.assertIsNone(held[0]['statistics']['max_score'])
        self.assertEqual({e['value'] for e in held[0]['evidence'] if e.get('field') == 'average'}, {348, 70})
        check_evidence(held[0], text)

    def test_personal_score_conversion_is_not_population_data(self):
        for text in ('제 원점수 80, 기본점수 20 빼면 60',
                     '100점 환산 기준 중간 q3+16 기말 q3+2로 A+ 받았습니다'):
            self.assertEqual(numeric(parse(text)), [])
        rows = numeric(parse('중간 평균 70. 제 원점수 80, 기본점수 20 빼면 60'))
        self.assertEqual([r['statistics']['average'] for r in rows], [70])
        rows = numeric(parse('중간 평균 70. 제 원점수 80, 기본점수 20 빼면 60. 기말 평균 75'))
        self.assertEqual([r['statistics']['average'] for r in rows], [70, 75])

    def test_unrelated_final_statistic_is_not_suppressed(self):
        result = parse('중간 평균 80. 100점 환산하면 평균 60. 기말 평균 75')
        rows = numeric(result)
        self.assertEqual([(r['assessment']['kind'], r['statistics']['average']) for r in rows], [('final', 75)])

    def test_unlabelled_conversion_does_not_absorb_both_named_exams(self):
        result = parse('중간 평균 70, 기말 평균 80\n100점 환산하면 Q2 60')
        rows = numeric(result)
        self.assertEqual([(r['assessment']['kind'], r['statistics']['average']) for r in rows], [('midterm', 70)])
        held = next(r for r in result['records'] if r.get('score_scale_note'))
        self.assertNotIn('midterm', [r['assessment']['kind'] for r in held['score_scale_note']['observations']])

    def test_clean_preexisting_and_temporal_abstention(self):
        for header, expected in [('2024년 2학기\n', (2024, 3)), ('26-1 기준\n', (None, None)), ('25겨울\n', (None, None))]:
            rows = numeric(parse(header + '중간 평균 70 만점 100\n기말 Q1 40 Q2 60 Q3 80'))
            self.assertEqual(len(rows), 2)
            self.assertEqual([(r['year'], r['semester']) for r in rows], [expected, expected])
            self.assertFalse(any(r.get('score_scale_note') for r in rows))

    def test_plain_unlabelled_values_still_abstain(self):
        result = parse('중간 Q3 30, 42, 53')
        self.assertEqual(numeric(result), [])
        self.assertTrue(any('multiple_unlabelled_values' in r['review_reasons'] for r in result['records']))

    def test_scale_packet_preserves_source_and_original_observations(self):
        result = parse('중간 평균 80.\n\n100점 환산하면 평균 60.')
        held = next(r for r in result['records'] if r.get('score_scale_note'))
        self.assertEqual(len(held['score_scale_note']['observations']), 2)
        for original in held['score_scale_note']['observations']:
            self.assertEqual(original['source'], held['source'])
            check_evidence(original, '중간 평균 80.\n\n100점 환산하면 평균 60.')
        self.assertFalse(held['score_scale_note']['automatic_statistic_selection'])


if __name__ == '__main__':
    unittest.main()
