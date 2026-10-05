"""Read preserved legacy output from a verified ZIP without extracting to disk.

Only the exact archived root is eligible. Live files take precedence. Existing
checksums and provenance paths remain unchanged; callers still validate content.
"""
import json
import os
from functools import lru_cache
from pathlib import Path
from zipfile import ZipFile

LEGACY_ROOT = Path(__file__).resolve().parents[1] / 'output' / 'everytime_local_runner'
_config = Path(__file__).resolve().parents[2] / '.local-data' / 'archive-config.json'
_archive = os.environ.get('EVERYTIME_LEGACY_ARCHIVE')
if not _archive and _config.is_file():
    _archive = json.loads(_config.read_text(encoding='utf-8'))['archive']
ARCHIVE = Path(_archive) if _archive else None


@lru_cache(maxsize=1)
def archive_handle():
    if ARCHIVE is None:
        raise FileNotFoundError('Set EVERYTIME_LEGACY_ARCHIVE to the verified legacy ZIP')
    verified = json.loads(ARCHIVE.with_name('verified.json').read_text(encoding='utf-8'))
    if (Path(verified['source']).resolve() != LEGACY_ROOT.resolve()
            or Path(verified['archive']).resolve() != ARCHIVE.resolve()
            or verified.get('all_member_and_source_sha256_verified') is not True):
        raise ValueError('Archive verification does not match source')
    return ZipFile(ARCHIVE)


def read_bytes(path):
    path = Path(path)
    try:
        return path.read_bytes()
    except FileNotFoundError:
        try:
            relative = path.resolve().relative_to(LEGACY_ROOT.resolve())
        except ValueError:
            raise FileNotFoundError(path) from None
        if not relative.parts:
            raise FileNotFoundError(path)
        try:
            return archive_handle().read(relative.as_posix())
        except KeyError:
            raise FileNotFoundError(path) from None
