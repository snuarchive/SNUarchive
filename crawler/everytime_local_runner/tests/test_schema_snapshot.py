"""Synthetic snapshot selection tests; no browser or database."""
from copy import deepcopy
from pathlib import Path
import tempfile
import json
import unittest
from unittest.mock import patch
from crawler.everytime_local_runner.schema_snapshot import add_archive, run
from crawler.everytime_local_runner.stats_adapter import extract_archives
from crawler.everytime_local_runner.import_candidates import read as read_manifest
from crawler.everytime_collect.raw import read_json


class SchemaSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.entry = {'item_id': 'B_1', 'priority': 'B',
                      'course': {'course_key': 'key', 'title': 'synthetic', 'instructor': 'prof'}}
        self.value = {'status': 'complete', 'report': 'immutable/report.json', 'reviews_saved': 37}

    def test_selection_preserves_identity_and_source(self):
        entries = {}; original = deepcopy((self.entry, self.value))
        self.assertTrue(add_archive(entries, self.entry, self.value))
        self.assertEqual(entries['key']['priority'], 'B')
        self.assertEqual(entries['key']['report'], 'immutable/report.json')
        self.assertEqual((self.entry, self.value), original)

    def test_empty_and_partial_remain_distinct(self):
        for status, count in [('empty', 0), ('partial', 12)]:
            entries = {}; value = {**self.value, 'status': status, 'reviews_saved': count}
            self.assertTrue(add_archive(entries, self.entry, value))
            self.assertEqual(entries['key']['status'], status)
            self.assertEqual(entries['key']['reviews_saved'], count)

    def test_failed_or_unresolved_are_not_successful_raw(self):
        for status in ('blocked', 'failed', 'needs_review', 'not_found'):
            entries = {}
            self.assertFalse(add_archive(entries, self.entry, {**self.value, 'status': status}))
            self.assertFalse(entries)

    def test_reuse_and_new_collection_cannot_duplicate_a_course(self):
        entries = {}; add_archive(entries, self.entry, self.value)
        with self.assertRaises(ValueError): add_archive(entries, self.entry, self.value)

    def test_old_output_survives_aborted_repeat(self):
        with tempfile.TemporaryDirectory() as folder, patch('crawler.everytime_local_runner.schema_snapshot.ROOT', Path(folder)):
            output = Path(folder) / 'existing'; output.mkdir()
            old = output / 'manifest.json'; old.write_bytes(b'old immutable bytes')
            with self.assertRaises(ValueError): run('unused', 'existing')
            self.assertEqual(old.read_bytes(), b'old immutable bytes')

    def test_output_path_escape_is_rejected(self):
        with self.assertRaises(ValueError): run('unused', '../outside')

    def test_extraction_rejects_duplicate_course_before_reading_raw(self):
        with tempfile.TemporaryDirectory() as folder, patch('crawler.everytime_local_runner.stats_adapter.ROOT', Path(folder)):
            a = {'course': self.entry['course']}
            with self.assertRaises(ValueError): extract_archives([a, a], {}, Path(folder) / 'new', priority='B', remaining=0)
            self.assertFalse((Path(folder) / 'new').exists())

    def test_large_manifest_does_not_relax_browser_raw_size_limit(self):
        payload = json.dumps({'input_files': {'path': 'x' * (2 * 1024 * 1024)}}).encode()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'summary.json'; path.write_bytes(payload)
            self.assertEqual(len(read_manifest(path)['input_files']['path']), 2 * 1024 * 1024)
            with self.assertRaises(ValueError): read_json(payload)

    def test_large_manifest_reader_still_rejects_duplicate_keys(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'summary.json'; path.write_text('{"key":1,"key":2}')
            with self.assertRaises(ValueError): read_manifest(path)


if __name__ == '__main__':
    unittest.main()
