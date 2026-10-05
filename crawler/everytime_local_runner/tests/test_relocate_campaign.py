"""Synthetic storage relocation: no browser, real raw or profile access."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from crawler.everytime_local_runner import relocate_campaign as migration, campaign
from crawler.everytime_local_runner.storage import write_new, sha


class RelocationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        base = Path(self.tmp.name)
        self.old = base / 'old/master'
        self.new = base / 'new/continuation'
        self.shard = self.old.parent / 'master_C_0001'
        write_new(self.shard / 'plan.json', {'entries': [{'item_id': 'C1'}, {'item_id': 'C2'}],
                  'source_files': {}, 'baseline_files': {}})
        receipt = self.shard / 'entries/C1/attempt_001.json'
        write_new(receipt, {'item_id': 'C1', 'status': 'empty', 'reviews_saved': 0, 'files': {}})
        write_new(self.shard / 'checkpoints/00050.json', {'plan_sha256': sha(self.shard / 'plan.json'),
                  'results': {'C1': {'file': str(receipt), 'sha256': sha(receipt)}}})
        write_new(self.old / 'plan.json', {'authorization': 'user_full_catalog_goal', 'input_files': {},
                  'shards': [{'root': str(self.shard), 'item_ids': ['C1', 'C2'],
                  'plan_sha256': sha(self.shard / 'plan.json')}], 'reuse_file': str(self.old / 'reuse.json')})
        write_new(self.old / 'reuse.json', {})
        write_new(self.old / 'catalog_mapping_holds.json', [])
        write_new(self.old / 'manifest.json', {'files': {n: sha(self.old / n) for n in
                  ('plan.json', 'reuse.json', 'catalog_mapping_holds.json')}})
        write_new(self.old / 'operator_stop_request.json', {'preserve': True})

    def test_preserve_bytes_and_continue_with_new_checkpoint_numbers(self):
        before = {p: sha(p) for p in self.old.parent.rglob('*') if p.is_file()}
        with patch.object(migration, 'ROOT', self.new.parent):
            result = migration.relocate(self.old, self.new)
        self.assertTrue(result['source_files_unchanged'])
        self.assertTrue(result['source_stop_marker_preserved'])
        new_shard = self.new.parent / 'continuation_C_0001'
        with patch.object(campaign, 'ROOT', self.new.parent):
            self.assertEqual([e['item_id'] for e in campaign.pending(new_shard)], ['C2'])
            campaign.finish(new_shard, 'C2', {'status': 'empty', 'reviews_saved': 0, 'files': {}})
            self.assertEqual(campaign.pending(new_shard), [])
            self.assertEqual(len(campaign.committed_snapshot(new_shard)[0]), 2)
        self.assertTrue((new_shard / 'checkpoints/00002.json').exists())
        self.assertEqual(before, {p: sha(p) for p in before})
        with patch.object(migration, 'ROOT', self.new.parent):
            with self.assertRaises(ValueError): migration.relocate(self.old, self.new)

    def test_changed_manifest_stops_before_copy(self):
        (self.old / 'reuse.json').write_text('{"tampered":true}')
        with patch.object(migration, 'ROOT', self.new.parent):
            with self.assertRaises(ValueError): migration.relocate(self.old, self.new)
        self.assertFalse(self.new.exists())

    def test_active_source_is_rejected(self):
        write_new(self.old / 'runner.lock', {'pid': 1})
        with patch.object(migration, 'ROOT', self.new.parent):
            with self.assertRaises(ValueError): migration.relocate(self.old, self.new)
        self.assertFalse(self.new.exists())
