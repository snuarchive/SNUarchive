"""Synthetic tests only: no website, browser, account, extractor or database."""
import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from crawler.everytime_collect.raw import ObservationError, canonical, fingerprints, duplicate_relation
from crawler.everytime_local_runner.storage import (archive_batch, classify, compare, compare_records, finalize,
                                                   load_archive, sha, write_new)


class StorageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture = Path(__file__).resolve().parents[2] / 'everytime_collect/tests/fake_browser.cjs'
        cls.scenarios = json.loads(subprocess.run(['node', str(fixture)], capture_output=True, check=True).stdout)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def archive(self, name, events=None):
        run = self.root / name
        (run / 'incoming').mkdir(parents=True)
        events = events or self.scenarios[name]
        for event in events:
            if event['type'] in ('batch', 'failed_batch'):
                write_new(run / 'incoming' / f'event_{event["batch"]:03d}.json', event)
                archive_batch(run, event['batch'], root=self.root)
        write_new(run / 'incoming/ui_report.json', events[-1]['report'])
        return run, finalize(run, root=self.root)

    def test_identity_mismatch_and_statuses(self):
        report = copy.deepcopy(self.scenarios['wrong'][-1]['report'])
        self.assertEqual(classify(report), 'needs_review')
        for error in ('Course instructor identity differs', 'Course title identity differs'):
            report['stop_error'] = error
            self.assertEqual(classify(report), 'needs_review')
        report['stop_error'] = 'BLOCKED: login required'
        self.assertEqual(classify(report), 'blocked')
        report['stop_error'] = 'login_failed: login_expired'
        self.assertEqual(classify(report), 'failed')
        report['stop_error'] = 'Wrong course or login page'
        self.assertEqual(classify(report), 'needs_review')
        self.assertEqual(classify(self.scenarios['loading_failed'][-1]['report']), 'failed')

    def test_empty_partial_complete(self):
        for name, expected in [('empty', 'empty'), ('mismatch', 'partial'), ('small', 'complete_for_observed_ui'),
                               ('interrupted', 'blocked'), ('failed_row', 'partial')]:
            with self.subTest(name=name):
                run, manifest = self.archive(name)
                self.assertEqual(manifest['status'], expected)
                if name == 'empty':
                    self.assertEqual(list(run.glob('batch_*/raw.json')), [])

    def test_duplicate_candidates_kept_and_fingerprints_exact(self):
        run, manifest = self.archive('duplicate')
        self.assertEqual(manifest['details']['reviews_saved'], 25)
        self.assertEqual(manifest['details']['duplicate_candidates']['within_run_reviews'], 1)
        doc = self.scenarios['small'][0]['observation']
        review = doc['reviews'][0]
        a = fingerprints(doc, review)
        self.assertEqual(duplicate_relation(a, fingerprints(doc, copy.deepcopy(review))), 'possible_duplicate_without_both_ids')
        changed = copy.deepcopy(review)
        changed['text_raw'] += ' '
        self.assertNotEqual(a['content_sha256'], fingerprints(doc, changed)['content_sha256'])
        changed = copy.deepcopy(review)
        changed['enrollment_term_raw'] = '25년 1학기 수강자'
        self.assertNotEqual(a['content_sha256'], fingerprints(doc, changed)['content_sha256'])

    def test_manifest_checksums_and_tamper_rejected(self):
        run, manifest = self.archive('small')
        for name, checksum in manifest['files'].items():
            self.assertEqual(sha(run / name), checksum)
        self.assertEqual((run / 'local_manifest.sha256').read_text().split()[0], sha(run / 'local_manifest.json'))
        raw = run / 'batch_001/raw.json'
        raw.write_bytes(raw.read_bytes() + b' ')
        with self.assertRaises(ObservationError):
            load_archive(run / 'run_report.json')

    def test_order_ignored_but_multiplicity_and_paired_fields_checked(self):
        run, _ = self.archive('duplicate')
        rows, _ = load_archive(run / 'run_report.json')
        self.assertTrue(compare_records(rows, list(reversed(rows)))['identical_review_collection'])
        self.assertFalse(compare_records(rows, rows[:-1])['identical_review_collection'])
        changed = copy.deepcopy(rows)
        changed[0]['source_url'] += '&changed=1'
        self.assertFalse(compare_records(rows, changed)['fields']['source_url']['equal'])
        changed = copy.deepcopy(rows)
        changed[0]['enrollment_term_raw'] = '25년 1학기 수강자'
        self.assertFalse(compare_records(rows, changed)['review_multiset']['equal'])

    def test_storage_interruption_never_overwrites_or_commits_checkpoint(self):
        events = self.scenarios['preloaded']
        run = self.root / 'interrupted_write'
        write_new(run / 'incoming/event_001.json', events[0])
        archive_batch(run, 1, root=self.root)
        before = {p: p.read_bytes() for p in run.rglob('*') if p.is_file()}
        write_new(run / 'incoming/event_002.json', events[1])
        from crawler.everytime_local_runner import storage
        original = storage.save_event
        def fail_after_archive(*args, **kwargs):
            original(*args, **kwargs)
            raise OSError('Synthetic disk interruption before checkpoint')
        with patch.object(storage, 'save_event', side_effect=fail_after_archive):
            with self.assertRaises(OSError):
                archive_batch(run, 2, root=self.root)
        self.assertFalse((run / 'checkpoints/002.json').exists())
        self.assertEqual(before, {p: p.read_bytes() for p in before})
        write_new(run / 'incoming/ui_report.json', events[-1]['report'])
        with self.assertRaises(FileNotFoundError):
            finalize(run, root=self.root)
        with self.assertRaises(FileExistsError):
            archive_batch(run, 2, root=self.root)
        self.assertEqual(before, {p: p.read_bytes() for p in before})

    def test_exclusive_write_preserves_existing_bytes(self):
        file = self.root / 'original.json'
        write_new(file, {'text': '😀\r\n한글  '})
        before = file.read_bytes()
        with self.assertRaises(FileExistsError):
            write_new(file, {'different': True})
        self.assertEqual(before, file.read_bytes())

    def test_false_completion_rejected(self):
        report = copy.deepcopy(self.scenarios['mismatch'][-1]['report'])
        report.update(status='complete', ui_end_confirmed=True)
        with self.assertRaises(ObservationError):
            classify(report)

    def test_archive_comparison_writes_independent_checksum_and_refuses_replacement(self):
        left, _ = self.archive('left', self.scenarios['small'])
        right, _ = self.archive('right', self.scenarios['small'])
        output = right / 'comparison.json'
        result = compare(left / 'run_report.json', right / 'run_report.json', output)
        self.assertTrue(result['identical_review_collection'])
        self.assertEqual(Path(str(output) + '.sha256').read_text().split()[0], sha(output))
        before = output.read_bytes()
        with self.assertRaises(FileExistsError):
            compare(left / 'run_report.json', right / 'run_report.json', output)
        self.assertEqual(before, output.read_bytes())


if __name__ == '__main__':
    unittest.main()
