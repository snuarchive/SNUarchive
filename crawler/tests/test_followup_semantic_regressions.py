"""Fourteen minimal reproductions from reviewed sources, plus direct variants.

Each case records the relevant wording (with minimal assessment context), previous
error, expected correction and reason. test_followup_real_cases.py additionally
replays all fourteen full original bodies from the immutable private followup.
"""
import unittest

from crawler.everytime_stats.extract import extract_comment
from crawler.everytime_stats.models import Comment
from crawler.everytime_stats.validate import check_evidence


CASES = [
    dict(id='c59b350f7e02a0719f0422b7', name='masked_maximum',
         original='중간 기말 합쳐서 만점이 5xx점인데, 그 중 1xx점을 맞았습니다',
         old='composite max_score=5', field='max_score', expected=None,
         reason='Unknown digits do not justify the exact prefix 5 or an inferred 500.'),
    dict(id='0b5a28d31c1dff0a64abecc8', name='masked_fraction',
         original='중간 q1이 87.x여서 중간 q1 기말 59여도 에마',
         old='midterm q1=87', field='q1', expected=None,
         reason='The decimal digit is unknown; 87.x is not exactly 87.'),
    dict(id='cf0e6eb077057a4a1fdced45', name='approximate_decade',
         original='중간고사 평균은 50점 초중반대로 형성이 되었던 것 같습니다.',
         old='midterm section average=50', field='average', expected=None,
         reason='A low-to-mid fifties range is not an exact mean of 50.'),
    dict(id='5d449635831b392e70b5e65a', name='quartile_upper_bound',
         original='중간고사 통계량도 q3가 80점이 채 되지 않아서',
         old='midterm q3=80', field='q3', expected=None,
         reason='Less than 80 is not equal to 80.'),
    dict(id='57874496bc1bbd424e038c8a', name='average_upper_bound',
         original='프로젝트도 15점 만점에 평균 11점이 채 안되기 때문에',
         old='average=11, max_score=15', field='average', expected=None, keep={'max_score': 15},
         reason='The mean is below 11; the separate explicit maximum 15 remains valid.'),
    dict(id='667ebfecdeee253b5b7b39fe', name='parenthetical_reference',
         original='중간2 76점 만점(중간1에서 4점짜리 오채점 이슈가 터지는 바람에 그냥 만점을 76점으로 바꿔버렸다나 뭐라나) q3 72.75점, q2 63점, q1 48점',
         old='midterm1 q1=48 q2=63 q3=72.75', field='q3', expected=72.75,
         identity=('midterm', 2, 'whole', None), keep={'q1': 48, 'q2': 63, 'max_score': 76},
         reason='The closed parenthesis explains midterm1; the outer statement is midterm2.'),
    dict(id='aa6eb4c7f6ab36adde82719d', name='negated_component',
         original='기말고사에서는 객관식은 없었고 마찬가지로 각 단원마다 대문제 하나가 나왔습니다. 128점 만점이었고',
         old='final objective section max_score=128', field='max_score', expected=128,
         identity=('final', None, 'whole', None),
         reason='An explicitly absent objective section cannot own the exam maximum.'),
    dict(id='43128cf3588807f564541f16', name='single_question_maximum',
         original='시험은 논술형 한 문제는 5점 만점인데, 논리적으로 오류가 없으면 4점',
         old='whole exam max_score=5', field='max_score', expected=None,
         reason='The bound belongs to one essay question, not the whole exam.'),
    dict(id='63251df75fd373607df1827e', name='each_question_maximum',
         original='조교님이 자체 문제를 중간고사에 몇 문제 넣으셨는데, 넣으신 모든 문제가 평균이 10점 만점에 1점대였으며',
         old='whole midterm max_score=10', field='max_score', expected=None,
         reason='The ten-point denominator describes individual inserted problems.'),
    dict(id='34acca9bbf73189f8389c43a', name='adjusted_ordinal_maxima',
         original='시험은 총 3번이고 360, 430, 500점 만점이었고, 중간1과 중간2는 실제 만점은 380. 460이었는데 문제 난이도 보정을 한다고 만점을 내리고, 360점과 430점을 넘긴 학생의 점수는 그대로 초과 점수로 인정해 주셨습니다.',
         old='midterm2 max_score=380; unknown max_score=500', field='max_score', expected=None,
         reason='Several exams and adjusted/native scales are interleaved; no single bound is established.'),
    dict(id='4c18c80e34dbe8d550901da3', name='alternative_maximum',
         original='시험 (80점인가 100점 만점)',
         old='exam max_score=100', field='max_score', expected=None,
         reason='The writer offers 80 or 100, not a confirmed bound of 100.'),
    dict(id='5d9e27b42258a94979276875', name='personal_converted_maximum',
         original='중간고사는 평균+40, 기말 대체 과제는 평균+32(100점 만점 변환 시 평균+21)로 A+',
         old='assignment max_score=100', field='max_score', expected=None,
         reason='100 is a conversion scale for a personal offset, not the native assignment bound.'),
    dict(id='c3d3842c0d60017f9eed7f30', name='hypothetical_maximum',
         original='과제는 100점 만점이라 치면 한 8-90 정도 맞고',
         old='assignment max_score=100', field='max_score', expected=None,
         reason='A hypothetical scale is not an actual assignment maximum.'),
    dict(id='1a221c31ad19a01a21f479fe', name='aggregate_not_assignment',
         original='과제는 열심히 하면 점수 잘 주시는 거 같습니다. 100점 중 출석 10프로 제외한 나머지 90점 만점에 90점이 2명 89,88 1명, 86 3명',
         old='assignment max_score=90', field='max_score', expected=90,
         identity=(None, None, 'composite', None),
         reason='The course aggregate excluding attendance is not an assignment maximum.'),
]


def parse(text):
    return extract_comment(Comment(0, 0, 'regression', 'regression', text, 'fixture.json', 'c' * 64))['records']


def assert_case(test, case, rows, text):
    values = [r for r in rows if r['statistics'][case['field']] is not None]
    if case['expected'] is None:
        test.assertEqual(values, [], case['old'] + ': ' + case['reason'])
        test.assertTrue(rows, 'Uncertain evidence must survive')
        test.assertTrue(any(r['candidates'] for r in rows))
    else:
        test.assertEqual(len(values), 1, case['reason'])
        r = values[0]
        test.assertEqual(r['statistics'][case['field']], case['expected'])
        if 'identity' in case:
            test.assertEqual((r['assessment']['kind'], r['assessment']['number'], r['scope'], r['component']), case['identity'])
    for field, value in case.get('keep', {}).items():
        test.assertTrue(any(r['statistics'][field] == value for r in rows))
    for r in rows:
        check_evidence(r, text)


class FollowupOriginalRegressions(unittest.TestCase):
    pass


for case in CASES:
    def run(self, case=case):
        assert_case(self, case, parse(case['original']), case['original'])
    run.__doc__ = f"{case['id']}: {case['old']} -> {case['expected']}. {case['reason']}"
    setattr(FollowupOriginalRegressions, 'test_' + case['name'], run)


class DirectNumericVariants(unittest.TestCase):
    def test_masked_number_before_maximum(self):
        for expression in ('5xx점 만점', '87.x점 만점', '9x 만점', '8?점 만점'):
            rows = parse('중간 ' + expression)
            self.assertTrue(rows)
            self.assertTrue(any('malformed_numeric' in r['review_reasons'] for r in rows))
            self.assertFalse(any(r['statistics']['max_score'] is not None for r in rows))

    def test_malformed_not_prefix(self):
        for expression in ('5xx', '87.x', '9x', '8?'):
            for label in ('중간 Q1 ', '기말 평균 ', '중간 만점이 '):
                with self.subTest(text=label + expression):
                    rows = parse(label + expression)
                    self.assertFalse(any(v is not None for r in rows for v in r['statistics'].values()))
                    self.assertTrue(any('malformed_numeric' in r['review_reasons'] for r in rows))

    def test_bounds_and_approximations(self):
        for expression in ('80 미만', '90 이상', '70~80대', '50보다 조금 높음', '80 정도', '80쯤', '약 80', '80인가 그랬음'):
            with self.subTest(expression=expression):
                rows = parse('중간 평균 ' + expression)
                self.assertFalse(any(r['statistics']['average'] is not None for r in rows))
                self.assertTrue(rows)
                self.assertTrue(any(r['candidates'] for r in rows))

    def test_exact_and_personal_controls(self):
        rows = parse('중간 Q1 40 Q2 60 Q3 80 Q4 95 평균 61 만점 100\n기말 Q1 45 Q2 65 Q3 85 Q4 98 평균 67 만점 110\n제 점수는 80이고 평균+19였습니다.')
        numeric = [r for r in rows if r['statistics']['q1'] is not None]
        self.assertEqual([r['statistics'] for r in numeric], [
            dict(q1=40, q2=60, q3=80, q4=95, average=61, max_score=100),
            dict(q1=45, q2=65, q3=85, q4=98, average=67, max_score=110)])

    def test_parenthesized_actual_statistics_keep_their_identity(self):
        rows = parse('중간 Q3 70 (기말 Q3 80) 중간 Q1 40')
        self.assertEqual([(r['assessment']['kind'], r['statistics']['q3']) for r in rows if r['statistics']['q3'] is not None], [('midterm', 70), ('final', 80)])

    def test_qualifier_does_not_poison_other_statistic(self):
        rows = parse('중간 Q1 40 Q2 60 Q3 80 정도, 만점 100')
        self.assertEqual(rows[0]['statistics']['q1'], 40)
        self.assertEqual(rows[0]['statistics']['q2'], 60)
        self.assertIsNone(rows[0]['statistics']['q3'])
        self.assertEqual(rows[0]['statistics']['max_score'], 100)


if __name__ == '__main__':
    unittest.main()
