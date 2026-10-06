import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from crawler.everytime_local_runner.compact_storage import pack
from crawler.everytime_local_runner.archived_files import read_bytes


class CompactStorageTests(unittest.TestCase):
    def test_sealed_bytes_remain_readable_without_staging(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);run=root/'priority_test_123'
            (root/'compact_policy.json').write_text('{"version":1,"minimum_free_gib":20}')
            (run/'batch_001').mkdir(parents=True)
            raw=run/'batch_001/raw.json';raw.write_bytes('합성 원문'.encode())
            search=run/'search.json';search.write_bytes(b'{}')
            result=pack(run,root)
            self.assertEqual(result['files'],2)
            self.assertFalse(raw.exists());self.assertTrue(search.exists())
            with patch.dict(os.environ,{'EVERYTIME_COMPACT_ROOT':str(root)}):
                self.assertEqual(read_bytes(raw),'합성 원문'.encode())
            with self.assertRaises(FileExistsError):pack(run,root)

    def test_non_run_directory_is_never_removed(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);run=root/'campaign';run.mkdir()
            (root/'compact_policy.json').write_text('{"version":1}')
            (run/'plan.json').write_text('{}')
            with self.assertRaises(ValueError):pack(run,root)
            self.assertTrue((run/'plan.json').exists())

    def test_verification_failure_keeps_every_staging_source(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);run=root/'priority_interrupted';run.mkdir()
            (root/'compact_policy.json').write_text('{"version":1}')
            source=run/'raw.json';source.write_bytes(b'original evidence')
            with patch('crawler.everytime_local_runner.compact_storage.ZipFile.read',
                       side_effect=ValueError('simulated archive read failure')):
                with self.assertRaises(ValueError):pack(run,root)
            self.assertEqual(source.read_bytes(),b'original evidence')
