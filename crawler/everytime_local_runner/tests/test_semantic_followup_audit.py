"""Synthetic audit invariants; the 188 real bodies are checked by the audit CLI."""
from copy import deepcopy
import unittest

from crawler.everytime_local_runner.tests.test_quality_audit import row
from crawler.everytime_local_runner.semantic_followup_audit import (
    active_evidence, issue_resolved, meaning, render, successors, triage,
)


class SemanticFollowupAuditTests(unittest.TestCase):
    def test_routes_uncertainty_without_approval_or_mutation(self):
        for text, expected in [('중간 평균 5xx', 'malformed_numeric'),
                               ('중간 평균 50점 초중반', 'approximate_or_bound'),
                               ('중간 평균 80 정도', 'approximate_or_bound'),
                               ('중간 만점이 100점 변환 시', 'score_scale_ambiguous'),
                               ('시험 한 문제는 5점 만점', 'assessment_ambiguous'),
                               ('중간 평균 50', 'term_missing_only'),
                               ('2024년 1학기\n중간 평균 50', 'structure_clean')]:
            with self.subTest(text=text):
                original = row(text); snapshot = deepcopy(original); result = triage(original)
                self.assertEqual(result['category'], expected)
                self.assertEqual(original, snapshot)
                self.assertEqual(result['human_review_status'], 'unreviewed')
                self.assertFalse(result['ready_for_database_write'])

    def test_lineage_follows_evidence_owner_before_residual_id(self):
        old = row('중간 평균 50')['extraction']
        residual = deepcopy(old); residual['statistics']['average'] = None
        moved = deepcopy(old); moved['record_id'] = 'new'; moved['assessment']['kind'] = 'final'
        self.assertEqual(successors(old, [residual, moved]), [moved])

    def test_lineage_never_matches_another_review_by_number(self):
        old = row('중간 평균 50')['extraction']; other = deepcopy(old)
        other['source']['json_pointer'] = '/reviews/99'
        self.assertEqual(successors(old, [other]), [])

    def test_existing_joint_evidence_is_not_a_new_split(self):
        old = row('중간 평균 50')['extraction']; other = deepcopy(old)
        other['record_id'] = 'other'; other['assessment']['kind'] = 'final'
        self.assertEqual(successors(old, [old, other]), [old])

    def test_rejected_value_is_not_active_even_when_evidence_survives(self):
        r = row('중간 평균 50')['extraction']; r['statistics']['average'] = None
        self.assertEqual(active_evidence(r), [])

    def test_removal_without_preserved_evidence_is_not_resolution(self):
        old = row('중간 평균 50')['extraction']; new = deepcopy(old)
        new['statistics']['average'] = None
        finding = {'proposed_change': {'withhold_field': 'average'}}
        self.assertFalse(issue_resolved(old, [new], finding))
        new['candidates'] = deepcopy(old['evidence'])
        self.assertTrue(issue_resolved(old, [new], finding))

    def test_uncorrected_attribution_is_not_resolution(self):
        old = row('중간 평균 50')['extraction']
        finding = {'proposed_change': {'assessment_kind': 'final'}}
        self.assertFalse(issue_resolved(old, [old], finding))
        corrected = deepcopy(old); corrected['assessment']['kind'] = 'final'
        self.assertTrue(issue_resolved(old, [corrected], finding))

    def test_withheld_new_id_retains_source_lineage(self):
        old = row('중간 평균 50')['extraction']; new = deepcopy(old)
        new['record_id'] = 'new'; new['statistics']['average'] = None
        new['candidates'] = deepcopy(old['evidence'])
        self.assertEqual(successors(old, [new]), [new])

    def test_report_escapes_source_html(self):
        r = row('중간 평균 50')['extraction']
        html = render({}, [{'before': [r], 'after': [r], 'rules': ['guard'], 'original_text': '<script>bad()</script>'}], [])
        self.assertNotIn('<script>', html)
        self.assertIn('&lt;script&gt;', html)

    def test_nested_rule_version_is_not_a_semantic_change(self):
        a = row('중간 평균 80. 환산하면 평균 60.')['extraction']; b = deepcopy(a)
        b['score_scale_note']['observations'][0]['rule_version'] = 'next'
        self.assertEqual(meaning(a), meaning(b))


if __name__ == '__main__':
    unittest.main()
