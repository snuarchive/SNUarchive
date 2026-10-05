"""Separate, user-authorized observed-URL queue. No catalog identity approval."""
import argparse
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import json

from crawler.everytime_collect.target import validate_target, course_urls
from crawler.everytime_collect.run_v2 import require
from . import campaign
from .storage import ROOT, write_new, sha, load_archive, classify


def read(p):
    return json.loads(Path(p).read_text(encoding='utf-8'))


def create(proposal, destination, *, expected_count=2670):
    proposal, destination = Path(proposal).resolve(), Path(destination).resolve()
    require(destination.parent == ROOT.resolve() and not destination.exists(), 'New isolated output required')
    offered = read(proposal)
    coverage_path = proposal.parent / 'remaining_observed_url_coverage_01.json'
    identity_path = proposal.parent / 'remaining_identity_source_comparison_01.json'
    require(sha(coverage_path) == offered['source_sha256'], 'Coverage proposal changed')
    coverage = read(coverage_path)
    require(sha(identity_path) == coverage['source_sha256'], 'Identity evidence changed')
    holds = {x['item_id']: x for x in read(identity_path)['items']}
    offered_targets = offered['observed_targets']
    require(len(offered_targets) == expected_count, 'Unexpected authorized URL count')
    entries, seen, loaded = [], set(), {}
    for ordinal, item in enumerate(offered_targets, 1):
        target = validate_target(item['target'])
        require(target['instructor'].strip() not in {'미정', '담당교수', '-', 'Staff', 'STAFF'}, 'Unknown site instructor')
        require(target['url'] not in seen and item['catalog_items'], 'Repeated URL or missing provenance')
        seen.add(target['url']); sources = {}
        for catalog_item in item['catalog_items']:
            hold = holds[catalog_item]
            require(hold['course']['title'] == target['title'], 'Not an exact-title scope candidate')
            file = hold['evidence_file']; checksum = hold['evidence_sha256']
            if file not in loaded:
                require(sha(file) == checksum, 'Observed search source changed')
                e = read(file)
                loaded[file] = (checksum, e['search']['candidates'] if 'search' in e else e['checkpoint']['snapshot']['candidates'])
            require(loaded[file][0] == checksum, 'Conflicting source digest')
            require(any(course_urls(c['url'])[1] == target['url'] and c['title'] == target['title'] and
                        c['instructor'] == target['instructor'] for c in loaded[file][1]), 'URL/identity not observed in supplied search')
            sources[file] = checksum
        entries.append({'item_id': f'O{ordinal:05d}', 'target': target,
                        'catalog_items': item['catalog_items'], 'catalog_mapping_approved': False,
                        'observed_sources': sources})
    shared = {str(p): sha(p) for p in (proposal, coverage_path, identity_path)}
    shards = []
    for start in range(0, len(entries), 50):
        group = entries[start:start + 50]
        shard = destination.with_name(destination.name + f'_O_{len(shards)+1:04d}')
        require(not shard.exists(), 'Shard already exists')
        sources = dict(shared)
        for entry in group: sources.update(entry['observed_sources'])
        write_new(shard / 'plan.json', {'version': 1, 'kind': 'observed_url_followup',
                  'authorization': 'user_approved_additional_exact_title_urls_20261005',
                  'source_files': sources, 'baseline_files': {}, 'entries': group})
        shards.append({'root': str(shard), 'inputs': len(group), 'plan_sha256': sha(shard / 'plan.json')})
    write_new(destination / 'plan.json', {'kind': 'observed_url_followup_master', 'count': len(entries),
              'created_at': datetime.now(timezone.utc).isoformat(), 'source_files': shared, 'shards': shards,
              'catalog_mapping_approved': False, 'database_writes': 0})
    write_new(destination / 'manifest.json', {'plan_sha256': sha(destination / 'plan.json')})
    return master_summary(destination)


def verify_master(root):
    root = Path(root).resolve()
    require(root.parent == ROOT.resolve(), 'Invalid master output root')
    require(sha(root / 'plan.json') == read(root / 'manifest.json')['plan_sha256'], 'Master plan changed')
    p = read(root / 'plan.json')
    require(p['kind'] == 'observed_url_followup_master' and p['catalog_mapping_approved'] is False, 'Wrong plan type')
    for file, digest in p['source_files'].items(): require(sha(file) == digest, 'Proposal source changed')
    for shard in p['shards']: require(sha(Path(shard['root']) / 'plan.json') == shard['plan_sha256'], 'Shard plan changed')
    return p


def master_summary(root):
    p = verify_master(root); counts = Counter(); reviews = 0; pending_shards = []
    for shard in p['shards']:
        checkpoints = sorted((Path(shard['root']) / 'checkpoints').glob('*.json'))
        values = []
        if checkpoints:
            cp = read(checkpoints[-1]); require(cp['plan_sha256'] == shard['plan_sha256'], 'Checkpoint changed')
            for item, ref in cp['results'].items():
                require(sha(ref['file']) == ref['sha256'], 'Receipt changed')
                value = read(ref['file']); require(value['item_id'] == item, 'Receipt identity changed')
                values.append(value)
        counts.update(v['status'] for v in values)
        reviews += sum(v.get('reviews_saved', 0) for v in values)
        if len(values) < shard['inputs']: pending_shards.append(shard)
    recorded = sum(counts.values())
    return {'inputs': p['count'], 'recorded': recorded, 'pending': p['count'] - recorded,
            'states': dict(counts), 'reviews_saved': reviews, 'pending_shards': pending_shards,
            'collection_complete': recorded == p['count'] and set(counts) <= {'complete', 'empty'},
            'catalog_mapping_approved': False}


def record(root, item, run):
    p = campaign.plan(root); require(p['kind'] == 'observed_url_followup', 'Wrong queue type')
    entry = next(e for e in p['entries'] if e['item_id'] == item)
    run = Path(run).resolve(); require(run.parent == ROOT.resolve(), 'Wrong archive root')
    report = read(run / 'run_report.json'); ui = report['ui_observation']
    require(ui['target'] == entry['target'], 'Observed course identity differs')
    rows, files = load_archive(run / 'run_report.json')
    manifest = read(run / 'local_manifest.json')
    require((run / 'local_manifest.sha256').read_text().split()[0] == sha(run / 'local_manifest.json'), 'Seal changed')
    require(manifest['status'] == classify(ui), 'Manifest status differs from UI')
    for relative, digest in manifest['files'].items():
        file = (run / relative).resolve(); require(file.is_relative_to(run), 'Unsafe manifest path')
        require(sha(file) == digest, 'Raw/checkpoint checksum changed'); files[str(file)] = digest
    files[str(run / 'local_manifest.json')] = sha(run / 'local_manifest.json')
    for file, digest in entry['observed_sources'].items():
        require(sha(file) == digest, 'Observed URL source changed'); files[file] = digest
    return campaign.finish(root, item, {'status': 'complete' if manifest['status'] == 'complete_for_observed_ui' else manifest['status'],
        'match_status': 'observed_site_identity_only', 'target': entry['target'], 'report': str(run / 'run_report.json'),
        'reviews_saved': len(rows), 'files': files, 'catalog_items': entry['catalog_items'],
        'catalog_mapping_approved': False, 'raw_merge_or_delete': False})


def audit(root, output):
    values, checkpoint = campaign.committed_snapshot(root)
    entries = {e['item_id']: e for e in campaign.plan(root)['entries']}
    states = Counter(); reviews = 0
    require(set(values) <= set(entries), 'Unknown receipt item')
    for item, (_, value) in values.items():
        require(value.get('catalog_mapping_approved') is False, 'Unexpected catalog approval')
        states[value['status']] += 1
        if value.get('report'):
            rows, _ = load_archive(value['report']); ui = read(value['report'])['ui_observation']
            require(ui['target'] == entries[item]['target'], 'Target changed')
            status = classify(ui); status = 'complete' if status == 'complete_for_observed_ui' else status
            require(status == value['status'] and len(rows) == value['reviews_saved'], 'Status/count mismatch')
            reviews += len(rows)
        else:
            require(value['status'] in {'blocked', 'failed', 'partial'}, 'Missing successful archive')
    result = {'recorded': len(values), 'states': dict(states), 'reviews': reviews,
              'checkpoint': str(checkpoint), 'checkpoint_sha256': sha(checkpoint),
              'catalog_mapping_approved': False}
    write_new(output, result)
    return {**result, 'audit_sha256': sha(output)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['create','master-summary','pending','summary','record','finish','audit'])
    parser.add_argument('--root', required=True); parser.add_argument('--proposal')
    parser.add_argument('--item'); parser.add_argument('--run'); parser.add_argument('--input')
    parser.add_argument('--output')
    parser.add_argument('--retry-failed', action='store_true')
    a = parser.parse_args()
    if a.command == 'create': result = create(a.proposal, a.root)
    elif a.command == 'master-summary': result = master_summary(a.root)
    elif a.command == 'pending': result = campaign.pending(a.root, retry_partial=a.retry_failed)
    elif a.command == 'summary': result = campaign.summary(a.root)
    elif a.command == 'record': result = record(a.root, a.item, a.run)
    elif a.command == 'audit': result = audit(a.root, a.output)
    else: result = campaign.finish(a.root, a.item, read(a.input))
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__': main()
