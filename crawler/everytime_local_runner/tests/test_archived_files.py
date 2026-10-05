import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

from crawler.everytime_local_runner import archived_files as archive


class ArchivedFilesTest(unittest.TestCase):
    def test_live_precedence_missing_fallback_and_scope(self):
        # Synthetic fixture only, not an Everytime live test.
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[3] / 'data') as temp:
            root = Path(temp) / 'legacy'
            root.mkdir()
            zipped = Path(temp) / 'source.zip'
            with ZipFile(zipped, 'w') as z:
                z.writestr('run/raw.json', b'preserved bytes')
            (Path(temp) / 'verified.json').write_text(json.dumps(dict(
                source=str(root), archive=str(zipped), all_member_and_source_sha256_verified=True)))
            with patch.object(archive, 'LEGACY_ROOT', root), patch.object(archive, 'ARCHIVE', zipped):
                archive.archive_handle.cache_clear()
                try:
                    self.assertEqual(archive.read_bytes(root / 'run/raw.json'), b'preserved bytes')
                    with self.assertRaises(FileNotFoundError):
                        archive.read_bytes(root / 'missing.json')
                    with self.assertRaises(FileNotFoundError):
                        archive.read_bytes(root / '../outside.json')
                    (root / 'run').mkdir()
                    (root / 'run/raw.json').write_bytes(b'live data')
                    self.assertEqual(archive.read_bytes(root / 'run/raw.json'), b'live data')
                finally:
                    archive.archive_handle().close()
                    archive.archive_handle.cache_clear()


if __name__ == '__main__':
    unittest.main()
