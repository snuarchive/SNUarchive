"""Synthetic routing tests; no human decisions, site requests or DB writes."""
from copy import deepcopy
import unittest

from crawler.everytime_local_runner.import_candidates import candidate
from crawler.everytime_local_runner.quality_audit import triage, render
from crawler.everytime_local_runner.tests.test_import_candidates import fixture


def row(text):
    doc, record = fixture(text)
    return candidate(record, doc, 0)


class QualityTriageTests(unittest.TestCase):
    def test_clean_and_term_only_routes_do_not_approve(self):
        for text, expected in [('2024년 1학기\n중간 평균 44', 'structure_clean'),
                               ('중간 평균 44', 'term_missing_only')]:
            original = row(text); before = deepcopy(original); result = triage(original)
            self.assertEqual(result['category'], expected)
            self.assertEqual(original, before)
            self.assertEqual(result['human_review_status'], 'unreviewed')
            self.assertFalse(result['ready_for_database_write'])
            self.assertFalse(result['requires_content_review'])

    def test_remaining_categories_are_explicit_content_work(self):
        examples = [('시험 평균 44', 'assessment_ambiguous'),
                    ('중간 평균 44 평균 45 만점 100', 'multiple_observations_needs_split'),
                    ('중간 평균 44 최고점 90', 'other_review_required')]
        for text, expected in examples:
            result = triage(row(text))
            self.assertEqual(result['category'], expected)
            self.assertTrue(result['requires_content_review'])

    def test_scale_packet_is_counted_even_without_numeric_values(self):
        result = triage(row('중간 평균 80. 환산하면 평균 60.'))
        self.assertEqual(result['category'], 'score_scale_ambiguous')
        self.assertFalse(result['numeric_candidate'])
        self.assertTrue(result['requires_content_review'])
        self.assertTrue(result['candidate']['extraction']['score_scale_note']['observations'])

    def test_numbered_midterm_is_not_clean_database_identity(self):
        self.assertEqual(triage(row('중간1 평균 50'))['category'], 'assessment_ambiguous')

    def test_report_escapes_text(self):
        triaged = triage(row('중간 평균 44'))
        triaged['candidate']['extraction']['course_title'] = '<script>bad()</script>'
        html = render({}, [], {}, [triaged])
        self.assertNotIn('<script>', html)
        self.assertIn('&lt;script&gt;', html)


if __name__ == '__main__':
    unittest.main()
