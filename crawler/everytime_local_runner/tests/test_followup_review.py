"""Synthetic abstention and approval-boundary tests; no browser or DB."""
from copy import deepcopy
import unittest

from crawler.everytime_collect.raw import digest, ObservationError
from crawler.everytime_local_runner.stats_adapter import extract_raw_review
from crawler.everytime_local_runner.import_candidates import candidate
from crawler.everytime_local_runner.quality_audit import triage
from crawler.everytime_local_runner.review_followup import screening
from crawler.everytime_local_runner.term_linker import link
from crawler.everytime_local_runner.tests.test_import_candidates import fixture


def setup(text):
    doc, record = fixture(text)
    return record, triage(candidate(record, doc, 0))


def hint(record, text, needle, status='proposed_from_body', assumptions=()):
    start = text.index(needle)
    return {'candidate_id': record['record_id'], 'comment_sha256': digest(text.encode()),
            'term': {'status': status, 'proposed_year': 2026, 'proposed_semester': 1,
                     'assumptions': list(assumptions), 'evidence': [{'start': start, 'end': start + len(needle), 'text': needle}]}}


class TermLinkerTests(unittest.TestCase):
    def test_literal_full_year_header_is_separate_unapproved_link(self):
        text = '2024년 2학기\n중간 평균 44'; record, _ = setup(text); before = deepcopy(record)
        result = link(record, text)
        self.assertEqual((result['linked_year'], result['linked_semester']), (2024, 3))
        self.assertEqual(record, before)
        self.assertEqual(result['human_review_status'], 'unreviewed')
        self.assertFalse(result['ready_for_database_write'])

    def test_short_year_never_uses_prior_20xx_proposal(self):
        text = '26-1 기준\n중간 평균 44'; record, _ = setup(text)
        result = link(record, text, hint(record, text, '26-1 기준'))
        self.assertIsNone(result['linked_year'])
        self.assertEqual(result['linked_semester'], 1)
        self.assertIn('short_year_century_not_inferred', result['blocked_inferences'])
        self.assertFalse(result['prior_numeric_proposal_applied'])

    def test_winter_year_basis_remains_unresolved_even_with_four_digits(self):
        text = '2024년 겨울\n중간 평균 44'; record, _ = setup(text)
        result = link(record, text)
        self.assertIsNone(result['linked_year'])
        self.assertEqual(result['linked_semester'], 4)
        self.assertEqual(result['status'], 'winter_year_basis_requires_review')

    def test_enrollment_metadata_never_fills_year(self):
        text = '중간 평균 44'; record, _ = setup(text)
        result = link(record, text)
        self.assertIsNone(result['linked_year']); self.assertIsNone(result['linked_semester'])
        self.assertFalse(result['enrollment_term_used'])

    def test_unrelated_past_and_future_terms_not_linked(self):
        for text in ('2028년 1학기에 다음 개설 예정.\n중간 평균 44', '2023년 2학기 기출을 참고했다.\n중간 평균 44'):
            record, _ = setup(text); result = link(record, text)
            self.assertIsNone(result['linked_year'])
            result = link(record, text, hint(record, text, text.splitlines()[0], status='unresolved'))
            self.assertEqual(result['status'], 'unrelated_or_unscoped_reference')
            self.assertIsNone(result['linked_year'])

    def test_ambiguous_dash_two_does_not_choose_fall_or_summer(self):
        text = '25-2 기준 중간 평균 44'; record, _ = setup(text)
        h = hint(record, text, '25-2 기준', status='partial_from_body', assumptions=['dash_2_encoding_unresolved'])
        result = link(record, text, h)
        self.assertIsNone(result['linked_year']); self.assertIsNone(result['linked_semester'])

    def test_explicit_season_only_leaves_year_null(self):
        text = '여름학기 수강자입니다.\n중간 평균 44'; record, _ = setup(text)
        result = link(record, text, hint(record, text, '여름학기 수강자입니다.', status='partial_from_body'))
        self.assertEqual(result['linked_semester'], 2); self.assertIsNone(result['linked_year'])

    def test_nonstandard_academic_year_not_expanded(self):
        text = '26학년 1학기 기준 중간 평균 44'; record, _ = setup(text)
        result = link(record, text, hint(record, text, '26학년 1학기'))
        self.assertIsNone(result['linked_year'])
        self.assertIn('nonstandard_year_wording', result['blocked_inferences'])

    def test_changed_body_or_hint_rejected(self):
        text = '26-1 기준\n중간 평균 44'; record, _ = setup(text)
        h = hint(record, text, '26-1 기준'); h['term']['evidence'][0]['text'] = 'fake'
        with self.assertRaises(ObservationError): link(record, text, h)
        with self.assertRaises(ObservationError): link(record, text + 'changed')

    def test_score_range_is_not_a_short_year_term(self):
        text = '중간 평균 44. 90-100 A+, 80-89 A0'; record, _ = setup(text)
        result = link(record, text)
        self.assertEqual(result['status'], 'no_body_term')
        self.assertEqual(result['body_discovery'], [])


class ScreeningTests(unittest.TestCase):
    def test_confirmed_finding_does_not_change_or_approve_candidate(self):
        text = '중간 평균 44'; record, row = setup(text); before = deepcopy(row)
        ev = record['evidence']
        d = {'candidate_id': row['candidate_id'], 'comment_sha256': digest(text.encode()),
             'reviewer_role': 'assistant', 'coverage': 'evidence_context_screening', 'evidence': ev,
             'disposition': 'confirmed_semantic_issue', 'findings': [{'severity': 'confirmed_semantic_issue',
             'code': 'synthetic_issue', 'reason': 'Test only', 'evidence': ev, 'applied': False}]}
        result = screening(row, text, d)
        self.assertEqual(row, before); self.assertEqual(result['original_triage'], before)
        self.assertFalse(result['canonical_extraction_modified'])
        self.assertFalse(result['ready_for_database_write'])
        self.assertEqual(result['human_review_status'], 'unreviewed')

    def test_no_human_role_or_mismatched_review(self):
        text = '중간 평균 44'; record, row = setup(text)
        d = {'candidate_id': row['candidate_id'], 'comment_sha256': digest(text.encode()),
             'reviewer_role': 'human', 'coverage': 'evidence_context_screening', 'evidence': record['evidence']}
        with self.assertRaises(ObservationError): screening(row, text, d)


if __name__ == '__main__':
    unittest.main()
