"""Synthetic campaign state tests; never opens the site or runs an extractor."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from crawler.everytime_collect.raw import ObservationError
from crawler.everytime_local_runner import campaign
from crawler.everytime_local_runner.storage import write_new, sha


class CampaignTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.patch = patch.object(campaign, 'ROOT', self.root)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.run = self.root / 'synthetic_campaign'
        self.entries = [{'item_id': f'A{i:04d}', 'catalog_mapping': 'matched',
                         'course': {'course_key': str(i), 'title': f'합성{i}', 'instructor': '합성교수'}} for i in range(1, 4)]
        write_new(self.run / 'plan.json', {'entries': self.entries, 'source_files': {}, 'baseline_files': {}})

    def test_resume_skips_terminal_and_partial_is_explicit(self):
        campaign.finish(self.run, 'A0001', {'status': 'complete', 'reviews_saved': 3})
        campaign.finish(self.run, 'A0002', {'status': 'partial', 'reviews_saved': 2})
        self.assertEqual([e['item_id'] for e in campaign.pending(self.run)], ['A0003'])
        self.assertEqual([e['item_id'] for e in campaign.pending(self.run, True)], ['A0002', 'A0003'])
        self.assertEqual(len(list((self.run / 'checkpoints').glob('*.json'))), 2)

    def test_attempts_append_and_old_files_are_preserved(self):
        campaign.finish(self.run, 'A0001', {'status': 'partial', 'reviews_saved': 2})
        before = {p: p.read_bytes() for p in self.run.rglob('*') if p.is_file()}
        campaign.finish(self.run, 'A0001', {'status': 'complete', 'reviews_saved': 5})
        self.assertEqual(before, {p: p.read_bytes() for p in before})
        self.assertEqual(campaign.summary(self.run)['reviews_saved_or_reused'], 5)

    def test_changed_receipt_or_raw_blocks_resume(self):
        raw = self.root / 'synthetic_raw.json'
        write_new(raw, {'synthetic': True})
        campaign.finish(self.run, 'A0001', {'status': 'complete', 'files': {str(raw): sha(raw)}, 'reviews_saved': 1})
        receipt = self.run / 'entries/A0001/attempt_001.json'
        receipt.write_bytes(receipt.read_bytes() + b' ')
        with self.assertRaises(ObservationError):
            campaign.pending(self.run)

    def test_blocked_is_never_automatically_resumed(self):
        campaign.finish(self.run, 'A0001', {'status': 'blocked', 'reviews_saved': 0})
        with self.assertRaises(ObservationError):
            campaign.pending(self.run, True)

    def test_name_limit_recovery_is_explicit_verified_and_does_not_repeat_professor_attempt(self):
        evidence = self.root / 'bounded_search.json'
        write_new(evidence, {'input': {'instructor': '합성교수'}, 'scope': {'ui_end': False},
                             'checkpoint': {'snapshot': {'mode': 'name'}}})
        value = {'status': 'needs_review', 'match_status': 'incomplete_search',
                 'reason': 'search_candidate_limit', 'reviews_saved': 0, 'files': {str(evidence): sha(evidence)}}
        campaign.finish(self.run, 'A0001', value)
        prior = (self.run / 'entries/A0001/attempt_001.json').read_bytes()
        self.assertNotIn('A0001', [e['item_id'] for e in campaign.pending(self.run)])
        self.assertIn('A0001', [e['item_id'] for e in campaign.pending(self.run, retry_search_limits=True)])
        self.assertEqual(prior, (self.run / 'entries/A0001/attempt_001.json').read_bytes())
        attempted = {**value, 'files': {**value['files'], str(self.root / 'name_bounded_search.json'): 'synthetic'}}
        self.assertFalse(campaign.recoverable_name_search(attempted))
        self.assertFalse(campaign.recoverable_name_search({**value, 'status': 'blocked'}))
        self.assertFalse(campaign.recoverable_name_search({**value, 'reason': 'input_instructor_unknown'}))
        evidence.write_bytes(evidence.read_bytes() + b' ')
        with self.assertRaises(ObservationError):
            campaign.recoverable_name_search(value)

    def test_item_outside_queue_and_failed_baseline_gate_rejected(self):
        with self.assertRaises(ObservationError):
            campaign.finish(self.run, 'B0001', {'status': 'complete'})
        write_new(self.root / 'baseline/result.json', {'status': 'login_failed'})
        with self.assertRaises(ObservationError):
            campaign.verify_baselines(self.root / 'baseline')

    def test_professor_limit_retry_is_verified_explicit_and_not_repeated(self):
        evidence = self.root / 'bounded_search.json'
        write_new(evidence, {'input': {'instructor': '합성교수'}, 'scope': {'ui_end': False},
                             'checkpoint': {'snapshot': {'mode': 'professor', 'query': '합성교수'}}})
        value = {'status': 'needs_review', 'match_status': 'incomplete_search',
                 'reason': 'search_candidate_limit', 'reviews_saved': 0, 'files': {str(evidence): sha(evidence)}}
        campaign.finish(self.run, 'A0001', value)
        self.assertNotIn('A0001', [e['item_id'] for e in campaign.pending(self.run)])
        self.assertIn('A0001', [e['item_id'] for e in campaign.pending(self.run, retry_professor_limits=True)])
        self.assertFalse(campaign.recoverable_professor_search({**value,'retry_policy':'extended_professor_800_v1'}))
        self.assertFalse(campaign.recoverable_professor_search({**value,'status':'blocked'}))
        evidence.write_bytes(evidence.read_bytes()+b' ')
        with self.assertRaises(ObservationError): campaign.recoverable_professor_search(value)

    def test_plan_change_rejected_after_checkpoint(self):
        campaign.finish(self.run, 'A0001', {'status': 'needs_review', 'reviews_saved': 0})
        p = self.run / 'plan.json'
        p.write_bytes(p.read_bytes() + b' ')
        with self.assertRaises(ObservationError):
            campaign.pending(self.run)

    def test_snapshot_ignores_only_unfinished_new_checkpoint(self):
        campaign.finish(self.run, 'A0001', {'status': 'complete', 'reviews_saved': 3})
        (self.run / 'checkpoints/00002.json').write_text('{', encoding='utf-8')
        snapshot, checkpoint = campaign.committed_snapshot(self.run)
        self.assertEqual(set(snapshot), {'A0001'})
        self.assertEqual(checkpoint.name, '00001.json')

    def test_adoption_rechecks_baselines_before_touching_prior_results(self):
        write_new(self.root / 'bad_baseline/result.json', {'status': 'unexpected_ui'})
        before = (self.run / 'plan.json').read_bytes()
        with self.assertRaises(ObservationError):
            campaign.adopt_completed(self.run, self.root / 'old', self.root / 'bad_baseline')
        self.assertEqual((self.run / 'plan.json').read_bytes(), before)
        self.assertFalse((self.run / 'entries').exists())


if __name__ == '__main__':
    unittest.main()
