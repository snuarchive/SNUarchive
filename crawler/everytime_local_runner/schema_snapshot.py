"""Immutable offline snapshot of collected catalog archives, with root SQL projection.

Does not start a browser, mutate the running queue, write SQL, or approve reviews.
The receipt cutoff is captured before extraction; subsequent collections are excluded.
"""
import argparse
from collections import Counter
from pathlib import Path
import json

from crawler.everytime_collect.run_v2 import require
from . import campaign, full_campaign
from .storage import ROOT, sha, write_new
from .stats_adapter import extract_archives
from .import_candidates import build, write_jsonl
from .quality_audit import lines
from .semantic_followup_audit import triage, CATEGORIES
from .schema_contract import verify_schema


def add_archive(selected, entry, value):
    if value['status'] not in ('complete', 'empty', 'partial') or not value.get('report'):
        return False
    key = entry['course']['course_key']
    require(key not in selected, 'Repeated course in snapshot')
    selected[key] = {'item_id': entry['item_id'], 'course': entry['course'],
                     'priority': entry['priority'], 'report': value['report'],
                     'status': value['status'], 'reviews_saved': value['reviews_saved']}
    return True


def freeze(master):
    master = full_campaign.root_path(master)
    p = full_campaign.verify(master, all_raw=True)
    started = full_campaign.now()
    inputs = {**p['input_files'], **verify_schema(),
              str(master / 'plan.json'): sha(master / 'plan.json'),
              str(master / 'manifest.json'): sha(master / 'manifest.json'),
              str(Path(p['reuse_file']).resolve()): sha(p['reuse_file'])}
    entries = {}
    for file in p['input_files']:
        path = Path(file)
        if path.name.startswith('batch_') and path.parent.name in ('A', 'B', 'C'):
            for e in full_campaign.read(path)['entries']:
                if e['catalog_mapping'] == 'matched':
                    entries[e['course_key']] = {'item_id': e['item_id'], 'priority': e['priority'],
                                                'course': e['catalog_course']}
    require(len(entries) == p['catalog_count'], 'Priority identity coverage changed')
    selected, checkpoints, skipped = {}, [], []
    for key, value in full_campaign.read(p['reuse_file']).items():
        add_archive(selected, entries[key], value)
    # Freeze every checkpoint reference first. Reads thereafter are immutable.
    for shard in p['shards']:
        root = Path(shard['root'])
        for checkpoint in sorted((root / 'checkpoints').glob('*.json'), reverse=True):
            try:
                data = full_campaign.read(checkpoint)
            except (ValueError, UnicodeError):
                continue
            require(data['plan_sha256'] == shard['plan_sha256'], 'Checkpoint plan changed')
            checkpoints.append({'shard': shard, 'file': str(checkpoint), 'sha256': sha(checkpoint), 'data': data})
            break
    ended = full_campaign.now()
    for checkpoint in checkpoints:
        shard = checkpoint['shard']; root = Path(shard['root'])
        inputs[checkpoint['file']] = checkpoint['sha256']
        inputs[str(root / 'plan.json')] = shard['plan_sha256']
        by_id = {e['item_id']: e for e in campaign.plan(root)['entries']}
        for item, ref in checkpoint['data']['results'].items():
            require(item in by_id and sha(ref['file']) == ref['sha256'], 'Receipt changed')
            value = full_campaign.read(ref['file'])
            require(value['item_id'] == item, 'Receipt identity changed')
            inputs[str(Path(ref['file']).resolve())] = ref['sha256']
            inputs.update(value.get('files', {}))
            if not add_archive(selected, by_id[item], value):
                skipped.append({'item_id': item, 'status': value['status']})
    require(all(sha(f) == h for f, h in inputs.items()), 'Snapshot source changed')
    return {'capture_started_at': started, 'capture_finished_at': ended,
            'cutoff_policy': 'One immutable checkpoint per shard captured during this interval; later receipts excluded',
            'catalog_count': p['catalog_count'], 'selected': list(selected.values()), 'skipped': skipped,
            'input_files': inputs, 'priority_counts': dict(Counter(a['priority'] for a in selected.values()))}


def run(master, name, *, frozen=None, extraction=None):
    require(Path(name).name == name and name not in ('', '.', '..'), 'Use one output name')
    root = ROOT / name
    require(bool(frozen) == bool(extraction), 'Resume requires both immutable snapshot and extraction')
    stats = Path(extraction).resolve() if extraction else ROOT / (name + '_stats')
    candidates = ROOT / (name + '_candidates')
    require(not any(p.exists() for p in (root, candidates)), 'Never overwrite existing output')
    if not extraction: require(not stats.exists(), 'Never overwrite existing extraction')
    snapshot = full_campaign.read(frozen) if frozen else freeze(master)
    root.mkdir()
    write_new(root / 'snapshot.json', snapshot)
    inputs = {**snapshot['input_files'], str((root / 'snapshot.json').resolve()): sha(root / 'snapshot.json')}
    if extraction:
        require(stats.parent == ROOT.resolve(), 'Expected isolated extraction')
        extracted = full_campaign.read(stats / 'summary.json')
        require(extracted['input_snapshot'].get(str(Path(frozen).resolve())) == sha(frozen), 'Extraction uses another snapshot')
    else:
        extracted = extract_archives(snapshot['selected'], inputs, stats, priority='catalog_collected_snapshot',
                                     remaining=snapshot['catalog_count'] - len(snapshot['selected']))
    require(extracted['counts']['reviews'] == sum(a['reviews_saved'] for a in snapshot['selected']), 'Snapshot count differs')
    result = build(stats, candidates)
    numeric = lines(candidates / 'import_candidates.jsonl')
    mentions = lines(candidates / 'mention_review.jsonl')
    routed = [triage(row) for row in numeric]
    held = [triage(row) for row in mentions]
    write_jsonl(root / 'numeric_triage.jsonl', routed)
    write_jsonl(root / 'mention_triage.jsonl', held)
    # A review packet retains every candidate for each source, including empty candidates.
    grouped = {}
    for row in numeric + mentions:
        s = row['extraction']['source']; key = (s['file'], s['json_pointer'])
        grouped.setdefault(key, {'source': s, 'candidates': [], 'value_review_status': 'unreviewed',
                                 'assessment_review_status': 'unreviewed', 'term_review_status': 'unreviewed'})['candidates'].append(row)
    write_jsonl(root / 'review_queue.jsonl', list(grouped.values()))
    summary = {**result, 'selected_courses': len(snapshot['selected']), 'raw_reviews': extracted['counts']['reviews'],
               'priority_counts': snapshot['priority_counts'], 'stats': str(stats.resolve()), 'candidates': str(candidates.resolve()),
               'numeric_triage': {c: sum(r['category'] == c for r in routed) for c in CATEGORIES},
               'mention_triage': {c: sum(r['category'] == c for r in held) for c in CATEGORIES},
               'numeric_content_review': sum(r['requires_content_review'] for r in routed),
               'review_packets': len(grouped), 'human_approved': 0, 'database_writes': 0,
               'raw_preserved': True, 'later_collections_require_next_snapshot': True}
    write_new(root / 'summary.json', summary)
    write_new(root / 'manifest.json', {'files': {p.name: sha(p) for p in root.iterdir() if p.is_file()},
                                      'stats_manifest': sha(stats / 'manifest.json'),
                                      'candidates_manifest': sha(candidates / 'manifest.json')})
    return summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--master', required=True)
    parser.add_argument('--name', required=True)
    parser.add_argument('--frozen-snapshot')
    parser.add_argument('--extraction')
    args = parser.parse_args()
    print(json.dumps(run(args.master, args.name, frozen=args.frozen_snapshot, extraction=args.extraction), ensure_ascii=False))
