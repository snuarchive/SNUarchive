"""Create a new continuation plan; leave original raw, plans and receipts intact.

Only campaign metadata is copied. Original raw paths and checksum references
remain unchanged. No browser profile, session, cookies or review text is copied.
"""
from pathlib import Path
import argparse
import copy
import json
import os

from .storage import ROOT, sha, write_new
from .full_campaign import read


def copy_new(source, target):
    data = Path(source).read_bytes()
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('xb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    if sha(source) != sha(target):
        raise ValueError('Source changed while copying metadata')


def relocate(source, destination):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if destination.parent != ROOT.resolve() or destination.exists() or source == destination:
        raise ValueError('Use a new isolated destination')
    if (source / 'runner.lock').exists():
        raise ValueError('Source campaign is active')
    original = read(source / 'plan.json')
    manifest = read(source / 'manifest.json')
    for name, checksum in manifest['files'].items():
        if Path(name).name != name or sha(source / name) != checksum:
            raise ValueError('Source master manifest differs')
    if original['authorization'] != 'user_full_catalog_goal':
        raise ValueError('Expected authorized full campaign')
    plan = copy.deepcopy(original)
    provenance = {str(source / 'plan.json'): sha(source / 'plan.json'),
                  str(source / 'manifest.json'): sha(source / 'manifest.json')}
    # Preflight every destination before making the first copy.
    for shard in plan['shards']:
        old = Path(shard['root'])
        if old.parent != source.parent or not old.name.startswith(source.name + '_'):
            raise ValueError('Unexpected source shard location')
        new = destination.parent / (destination.name + old.name[len(source.name):])
        if new.exists() or sha(old / 'plan.json') != shard['plan_sha256']:
            raise ValueError('Shard exists or source plan differs')
    for shard in plan['shards']:
        old = Path(shard['root'])
        new = destination.parent / (destination.name + old.name[len(source.name):])
        copy_new(old / 'plan.json', new / 'plan.json')
        for receipt in sorted((old / 'entries').glob('*/attempt_*.json')):
            copy_new(receipt, new / receipt.relative_to(old))
        checkpoints = sorted((old / 'checkpoints').glob('*.json'))
        if checkpoints:
            latest = checkpoints[-1]
            checkpoint = read(latest)
            if checkpoint['plan_sha256'] != shard['plan_sha256']:
                raise ValueError('Source checkpoint plan differs')
            for item, ref in checkpoint['results'].items():
                if item not in shard['item_ids'] or sha(ref['file']) != ref['sha256']:
                    raise ValueError('Source receipt differs')
                receipt = Path(ref['file'])
                if receipt.parent.parent != old / 'entries':
                    raise ValueError('Unexpected receipt location')
                if sha(new / receipt.relative_to(old)) != ref['sha256']:
                    raise ValueError('Copied receipt differs')
            # Restart checkpoint numbering, preserving the original bytes and
            # original receipt paths. Later finish() writes a new checkpoint.
            copy_new(latest, new / 'checkpoints/00001.json')
            provenance[str(latest)] = sha(latest)
        provenance[str(old / 'plan.json')] = shard['plan_sha256']
        shard['root'] = str(new)
    for name in ('reuse.json', 'catalog_mapping_holds.json'):
        copy_new(source / name, destination / name)
    plan['reuse_file'] = str(destination / 'reuse.json')
    plan['input_files'].update(provenance)
    plan['storage_migration'] = {'source': str(source), 'original_raw_paths_preserved': True}
    write_new(destination / 'plan.json', plan)
    write_new(destination / 'manifest.json', {'files': {
        name: sha(destination / name) for name in ('plan.json', 'reuse.json', 'catalog_mapping_holds.json')}})
    report = {'source': str(source), 'destination': str(destination), 'shards': len(plan['shards']),
              'source_files_unchanged': all(sha(p) == h for p, h in provenance.items()),
              'raw_moved_or_modified': False, 'profile_copied': False,
              'source_stop_marker_preserved': (source / 'operator_stop_request.json').exists()}
    write_new(destination / 'storage_migration.json', report)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--destination', required=True)
    args = parser.parse_args()
    print(json.dumps(relocate(args.source, args.destination)))
