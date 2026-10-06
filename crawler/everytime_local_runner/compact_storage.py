"""Seal one new collection run into a verified ZIP, preserving provenance paths.

Only opt-in compact output roots and priority_* runs are eligible. Search JSON
stays live for the Node search cache. No old source directories are eligible.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED


def pack(run, root):
    run, root = Path(run).resolve(), Path(root).resolve()
    policy = json.loads((root / 'compact_policy.json').read_text())
    if policy.get('version') != 1 or run.parent != root or not run.name.startswith('priority_'):
        raise ValueError('Not an authorized compact run')
    files = sorted(p for p in run.rglob('*') if p.is_file())
    if not files or any(p.is_symlink() or not p.resolve().is_relative_to(run) for p in files):
        raise ValueError('Invalid run inventory')
    if len(files) > 10000:
        raise ValueError('Unexpected run size')
    target = root / (run.name + '.zip')
    rows = {}
    with target.open('xb') as stream:
        with ZipFile(stream, 'w', compression=ZIP_DEFLATED) as z:
            for p in files:
                data = p.read_bytes()
                name = p.relative_to(run).as_posix()
                rows[name] = hashlib.sha256(data).hexdigest()
                z.writestr(name, data)
            z.writestr('_compact_checksums.json', json.dumps(rows, separators=(',', ':')))
        stream.flush()
        os.fsync(stream.fileno())
    # Verify the complete container before removing any expendable staging copy.
    with ZipFile(target) as z:
        for name, checksum in rows.items():
            if hashlib.sha256(z.read(name)).hexdigest() != checksum:
                raise ValueError('Compact archive checksum mismatch')
    for p in files:
        name = p.relative_to(run).as_posix()
        if hashlib.sha256(p.read_bytes()).hexdigest() != rows[name]:
            raise ValueError('Staging source changed during packing')
    for p in files:
        if p.name != 'search.json':
            p.unlink()
    for p in sorted((p for p in run.rglob('*') if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
        if not any(p.iterdir()):
            p.rmdir()
    return dict(archive=str(target), files=len(rows), archive_bytes=target.stat().st_size)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', required=True)
    parser.add_argument('--root', required=True)
    args = parser.parse_args()
    print(json.dumps(pack(args.run, args.root)))
