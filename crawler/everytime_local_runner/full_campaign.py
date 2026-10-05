"""Complete catalog collection plan, split into bounded existing local campaigns.

No browser, extractor, DB, or writes to old campaigns. Reuse requires finalized
raw and exact observed identities. A completed queue pass is not a claim that
partial/ambiguous/failed entries were collected successfully.
"""
import argparse
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from crawler.everytime_collect.run_v2 import require
from . import campaign
from .campaign import read as read_small
from .storage import ROOT, load_archive, sha, write_new
from .archived_files import read_bytes


def now():
    return datetime.now(timezone.utc).isoformat()


def read(path):
    # Whole catalog/planning files exceed the collector's intentional small raw
    # capture limit. Keep that raw validator untouched; only plans use this reader.
    def unique(pairs):
        value = {}
        for key, item in pairs:
            require(key not in value, 'Duplicate JSON key in plan')
            value[key] = item
        return value
    return json.loads(read_bytes(path).decode('utf-8'), object_pairs_hook=unique)


def root_path(root):
    root = Path(root).resolve()
    require(root.parent == ROOT.resolve(), 'Use an isolated local output directory')
    return root


def target_for(course, url):
    return {'title': course['title'], 'instructor': course['instructor'], 'url': url.split('?')[0] + '?tab=article'}


def legacy_reuse(entry):
    old = entry.get('previous_result')
    if not old or old.get('collection_status') != 'complete':
        return None
    course = entry['catalog_course']
    require(old['input'] == course and old['ui_end_confirmed'], 'Legacy identity/end mismatch')
    result = Path(entry['previous_result_path'])
    require(sha(result) == entry['previous_result_sha256'] and read(result) == old, 'Legacy result changed')
    match = Path(old['match_path']); decision = read(match)
    require(decision == entry['previous_match'] and decision['status'] == 'matched', 'Legacy match changed')
    require(decision['course_key'] == course['course_key'] and sha(decision['search_path']) == decision['search_sha256'], 'Legacy search changed')
    report = Path(old['run_report'])
    require(sha(report) == old['report_sha256'], 'Legacy report changed')
    archive = read(report); records, files = load_archive(report)
    target = target_for(course, old['url'])
    require(archive['ui_observation']['status'] == 'complete' and archive['ui_observation']['target'] == target, 'Legacy completion mismatch')
    require(target_for(course, decision['target']['url']) == target and decision['target']['title'] == course['title'] and decision['target']['instructor'] == course['instructor'], 'Legacy observed match differs')
    require(len(records) == old['stored_reviews'] == old['displayed_reviews'], 'Legacy count mismatch')
    files.update({str(result.resolve()): sha(result), str(match.resolve()): sha(match),
                  str(Path(decision['search_path']).resolve()): decision['search_sha256']})
    return {'status': 'complete' if records else 'empty', 'report': str(report.resolve()),
            'reviews_saved': len(records), 'target': target, 'files': files, 'origin': 'verified_computer_use'}


def assemble(catalog, priority_entries, existing):
    """Pure catalog coverage/order gate, also used by synthetic tests."""
    by_key = {c['course_key']: c for c in catalog}
    require(len(by_key) == len(catalog), 'Catalog contains duplicate keys')
    entries, extra, seen = [], [], set()
    for e in priority_entries:
        c = e['catalog_course']
        if e['catalog_mapping'] != 'matched':
            extra.append(e)
            continue
        key = c['course_key']
        require(key in by_key and by_key[key] == c and key not in seen, 'Priority coverage duplicates or differs from catalog')
        seen.add(key)
        entries.append({'item_id': e['item_id'], 'priority': e['priority'], 'catalog_mapping': 'matched',
                        'course': c, 'original_title': e.get('original_title'), 'original_instructor': e.get('original_instructor'),
                        'xlsx_rows': e.get('xlsx_rows', []), 'reuse': existing.get(key)})
    require(seen == set(by_key), 'Priority plan does not cover the entire catalog')
    require(set(existing) <= seen, 'Reuse contains an out-of-catalog item')
    return entries, extra


def create(catalog_path, queue, baselines, a_campaign, root, *, chunk_size=50):
    root = root_path(root)
    require(not root.exists() and chunk_size == 50, 'Use a new master campaign, 50 inputs per shard')
    catalog_path, queue = Path(catalog_path).resolve(), Path(queue).resolve()
    catalog = read(catalog_path)
    require(len(catalog) == 19155, 'Expected complete 19,155 course catalog')
    qmanifest = read(queue / 'manifest.json')
    require(qmanifest['sources']['catalog']['sha256'] == sha(catalog_path), 'Priority catalog snapshot changed')
    inputs = {str(catalog_path): sha(catalog_path), str(queue / 'manifest.json'): sha(queue / 'manifest.json')}
    baseline_files = campaign.verify_baselines(baselines)
    all_entries = []
    for priority in 'ABC':
        for file in sorted((queue / priority).glob('batch_*.json')):
            data = read(file); require(data['priority'] == priority, 'Wrong priority file')
            inputs[str(file)] = sha(file); all_entries.extend(data['entries'])
    old_plan = campaign.plan(a_campaign)
    old_by_id = {e['item_id']: e for e in old_plan['entries']}
    snapshot, checkpoint = campaign.committed_snapshot(a_campaign)
    inputs.update({str(Path(a_campaign).resolve() / 'plan.json'): sha(Path(a_campaign) / 'plan.json'), str(checkpoint.resolve()): sha(checkpoint)})
    existing = {}
    for item, (receipt, result) in snapshot.items():
        if result['status'] not in ('complete', 'empty'):
            continue
        c = old_by_id[item]['course']; records, files = load_archive(result['report'])
        report = read(result['report'])
        require(report['ui_observation']['status'] == 'complete' and report['ui_observation']['target'] == target_for(c, result['target']['url']), 'A reuse identity/completion differs')
        require(len(records) == result['reviews_saved'], 'A reuse count differs')
        files.update(result['files']); files[str(receipt.resolve())] = sha(receipt)
        existing[c['course_key']] = {'status': result['status'], 'target': result['target'], 'report': result['report'],
                                     'reviews_saved': len(records), 'files': files, 'origin': 'verified_priority_A', 'original_receipt': str(receipt.resolve())}
    require(len(existing) == 223, 'Expected all 223 completed Priority A catalog entries')
    for e in all_entries:
        if e['catalog_course'] and e['course_key'] not in existing:
            value = legacy_reuse(e)
            if value:
                existing[e['course_key']] = value
    entries, extras = assemble(catalog, all_entries, existing)
    # Catalog-missing source labels remain explicit sidecar holds, not invented
    # catalog courses or guessed Everytime URLs.
    for value in existing.values():
        inputs.update(value['files'])
    inputs.update(baseline_files)
    require(all(sha(f) == h for f, h in inputs.items()), 'Source changed while building full plan')
    shards = []
    for priority in 'ABC':
        pending = [e for e in entries if e['priority'] == priority and not e['reuse']]
        for start in range(0, len(pending), chunk_size):
            directory = ROOT / f'{root.name}_{priority}_{start // chunk_size + 1:04d}'
            require(not directory.exists(), 'Shard already exists; never overwrite')
            shards.append({'priority': priority, 'root': str(directory.resolve()), 'entries': pending[start:start+chunk_size]})
    # Existing campaign.py validators/storage are reused unchanged per bounded
    # shard, avoiding quadratic verification over all 19,155 items per course.
    root.mkdir()
    write_new(root / 'reuse.json', existing)
    write_new(root / 'catalog_mapping_holds.json', extras)
    shard_specs = []
    for shard in shards:
        directory = Path(shard['root'])
        provenance = {str(catalog_path): sha(catalog_path), str(queue / 'manifest.json'): sha(queue / 'manifest.json')}
        write_new(directory / 'plan.json', {'version': 1, 'priority': shard['priority'], 'authorization': 'user_full_catalog_goal',
                  'created_at': now(), 'source_files': provenance, 'baseline_files': baseline_files, 'entries': shard['entries']})
        shard_specs.append({'priority': shard['priority'], 'root': str(directory), 'inputs': len(shard['entries']),
                            'item_ids': [e['item_id'] for e in shard['entries']], 'plan_sha256': sha(directory / 'plan.json')})
    plan = {'version': 1, 'created_at': now(), 'objective': 'Collect the entire catalog through normal UI, preserving uncollectable/review states',
            'authorization': 'user_full_catalog_goal', 'catalog_count': len(catalog), 'priority_counts': dict(Counter(e['priority'] for e in entries)),
            'reuse_count': len(existing), 'reuse_reviews': sum(r['reviews_saved'] for r in existing.values()),
            'reuse_file': str(root / 'reuse.json'), 'input_files': inputs,
            'catalog_mapping_holds': len(extras), 'pending_initial': sum(s['inputs'] for s in shard_specs), 'shards': shard_specs,
            'collection_policy': {'headless': False, 'browser_channel': 'chrome', 'transport': 'DOM to local files',
                                  'stop_on_access_warning': True, 'extractor': False, 'database_write': False}}
    write_new(root / 'plan.json', plan)
    write_new(root / 'manifest.json', {'files': {p.name: sha(p) for p in root.iterdir() if p.is_file()}})
    return summary(root)


def verify(root, *, all_raw=False):
    root = root_path(root); plan = read(root / 'plan.json')
    require(plan['authorization'] == 'user_full_catalog_goal' and plan['catalog_count'] == 19155, 'Not a full catalog plan')
    manifest = read(root / 'manifest.json')
    require(all(sha(root / f) == h for f, h in manifest['files'].items()), 'Full plan manifest changed')
    if all_raw:
        require(all(sha(f) == h for f, h in plan['input_files'].items()), 'Pinned baseline/raw changed')
    for shard in plan['shards']:
        require(sha(Path(shard['root']) / 'plan.json') == shard['plan_sha256'], 'Shard plan changed')
    return plan


def states(shard, *, all_raw=False):
    root = Path(shard['root']); checkpoints = sorted((root / 'checkpoints').glob('*.json'))
    if not checkpoints:
        return {}
    if all_raw:
        values, _ = campaign.committed_snapshot(root)
        return {k: v for k, (_, v) in values.items()}
    for p in reversed(checkpoints):
        try:
            data = read(p)
        except (ValueError, UnicodeError):
            continue
        require(data['plan_sha256'] == shard['plan_sha256'], 'Checkpoint plan changed')
        values = {}
        for item, ref in data['results'].items():
            require(item in shard['item_ids'] and sha(ref['file']) == ref['sha256'], 'Receipt changed')
            values[item] = read(ref['file'])
        return values
    raise ValueError('No complete shard checkpoint')


def summary(root, *, all_raw=False):
    plan = verify(root, all_raw=all_raw)
    reused = read(plan['reuse_file']); counts = Counter(v['status'] for v in reused.values())
    reviews = sum(v['reviews_saved'] for v in reused.values()); recorded = len(reused)
    per_priority = {}; unresolved = []
    for shard in plan['shards']:
        values = states(shard, all_raw=all_raw); per_priority.setdefault(shard['priority'], Counter()).update(v['status'] for v in values.values())
        counts.update(v['status'] for v in values.values()); recorded += len(values)
        reviews += sum(v.get('reviews_saved', 0) for v in values.values())
        unresolved.extend({'item_id': item, 'root': shard['root'], 'status': v['status']} for item, v in values.items() if v['status'] not in ('complete', 'empty', 'not_found'))
    pending = plan['catalog_count'] - recorded
    return {'catalog_count': plan['catalog_count'], 'reused_complete': len(reused), 'recorded': recorded, 'pending': pending,
            'states': dict(counts), 'new_states_by_priority': {p: dict(c) for p, c in per_priority.items()},
            'reviews_saved_or_reused': reviews, 'unresolved_count': len(unresolved), 'unresolved': unresolved,
            'catalog_mapping_sidecar_holds': plan['catalog_mapping_holds'],
            'first_pass_finished': pending == 0, 'collection_complete': pending == 0 and not unresolved,
            'all_raw_verified': all_raw}


def pending_shards(root):
    plan = verify(root, all_raw=True); pending = []
    for shard in plan['shards']:
        values = states(shard)
        require(not any(v['status'] == 'blocked' for v in values.values()), 'Catalog campaign blocked; no automatic restart')
        if len(values) < shard['inputs'] or any(campaign.recoverable_name_search(v) for v in values.values()):
            pending.append(shard)
    return pending


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('create', 'pending', 'summary'))
    parser.add_argument('--root', required=True); parser.add_argument('--catalog', default='public/courses.json')
    parser.add_argument('--queue'); parser.add_argument('--baselines'); parser.add_argument('--priority-a')
    parser.add_argument('--verify-all', action='store_true')
    a = parser.parse_args()
    if a.command == 'create': result = create(a.catalog, a.queue, a.baselines, a.priority_a, a.root)
    elif a.command == 'pending': result = pending_shards(a.root)
    else: result = summary(a.root, all_raw=a.verify_all)
    import json
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
