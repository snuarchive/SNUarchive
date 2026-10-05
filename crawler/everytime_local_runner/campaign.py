"""Immutable Priority A plan, per-course receipts and resumable checkpoints."""
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import argparse
import json

from crawler.everytime_collect.raw import read_json
from crawler.everytime_collect.run_v2 import require
from .local_matching import match_course, collector_target
from .storage import ROOT, write_new, sha, load_archive, compare_records
from .archived_files import read_bytes


def read(path):
    return read_json(read_bytes(path))


def verify_baselines(session):
    result = read(Path(session) / 'result.json')
    require(result['status'] == 'three_baselines_verified', 'Three live baselines must pass before Priority A')
    expected = {'603889': 37, '1785286': 61, '2680931': 55}
    require({r['id'] for r in result['courseResults']} == set(expected), 'Missing baseline identity')
    files = {}
    for entry in result['courseResults']:
        run = Path(entry['run'])
        saved = read(run / 'comparison.json')
        baseline = next(p for p in saved['baseline_files'] if Path(p).name == 'run_report.json')
        old, old_files = load_archive(baseline)
        new, new_files = load_archive(run / 'run_report.json')
        require(len(new) == expected[entry['id']] and compare_records(old, new)['identical_review_collection'],
                'Baseline contents are not equivalent')
        require(read(run / 'run_report.json')['ui_observation']['status'] == 'complete', 'Baseline incomplete')
        require(read(run / 'run_report.json')['ui_observation']['target']['url'] ==
                f'https://everytime.kr/lecture/view/{entry["id"]}?tab=article', 'Baseline ID differs from verified course')
        manifest = read(run / 'local_manifest.json')
        require(manifest['status'] == 'complete_for_observed_ui', 'Local baseline manifest incomplete')
        require((run / 'local_manifest.sha256').read_text().split()[0] == sha(run / 'local_manifest.json'),
                'Baseline manifest seal differs')
        for relative, checksum in manifest['files'].items():
            require(sha(run / relative) == checksum, 'Baseline manifest source changed')
            files[str((run / relative).resolve())] = checksum
        files.update(old_files)
        files.update(new_files)
        files[str(run / 'local_manifest.json')] = sha(run / 'local_manifest.json')
        files[str(run / 'comparison.json')] = sha(run / 'comparison.json')
    return files


def create_plan(queue, session, reuse_root, destination):
    destination = Path(destination).resolve()
    require(destination.parent == ROOT.resolve() and not destination.exists(), 'Use a new local campaign directory')
    baseline_files = verify_baselines(session)
    entries, source_files = [], {}
    for p in sorted((Path(queue) / 'A').glob('batch_*.json')):
        source_files[str(p.resolve())] = sha(p)
        data = read(p)
        require(data['priority'] == 'A', 'Only Priority A is authorized here')
        entries.extend(data['entries'])
    require(len(entries) == 229 and len({e['item_id'] for e in entries}) == 229, 'Priority A must contain 229 unique inputs')
    require(Counter(e['catalog_mapping'] for e in entries) == {'matched': 223, 'missing': 6}, 'Unexpected A catalog mapping')
    wanted = {(e['catalog_title'], e['catalog_instructor']) for e in entries if e['catalog_mapping'] == 'matched'}
    reusable = {}
    # Read only existing finalized archives. No raw is copied, merged or deleted.
    for report in sorted(Path(reuse_root).glob('**/run_report.json')):
        data = read(report)
        ui = data.get('ui_observation', {})
        target = ui.get('target', {})
        identity = (target.get('title'), target.get('instructor'))
        if identity not in wanted or ui.get('status') != 'complete':
            continue
        records, files = load_archive(report)
        reusable[identity] = {'report': str(report.resolve()), 'files': files, 'reviews_saved': len(records),
                              'target': target, 'status': 'empty' if not records else 'complete'}
    plan = []
    for e in entries:
        course = e['catalog_course']
        item = {'item_id': e['item_id'], 'catalog_mapping': e['catalog_mapping'], 'course': course,
                'original_title': e['original_title'], 'original_instructor': e['original_instructor'],
                'xlsx_rows': e['xlsx_rows'], 'reuse': reusable.get((e['catalog_title'], e['catalog_instructor']))}
        plan.append(item)
    write_new(destination / 'plan.json', {'version': 1, 'priority': 'A', 'created_at': datetime.now(timezone.utc).isoformat(),
              'baseline_files': baseline_files, 'source_files': source_files, 'entries': plan})
    for e in plan:
        if e['catalog_mapping'] == 'missing':
            finish(destination, e['item_id'], {'status': 'needs_review', 'match_status': 'catalog_missing',
                                             'reason': 'Do not invent a match for a missing catalog identity', 'reviews_saved': 0})
        elif e['reuse']:
            reuse = e['reuse']
            finish(destination, e['item_id'], {'status': reuse['status'], 'match_status': 'matched', 'reused': True,
                       'report': reuse['report'], 'files': reuse['files'], 'target': reuse['target'],
                       'reviews_saved': reuse['reviews_saved']})
    return summary(destination)


def plan(root):
    root = Path(root).resolve()
    require(root.parent == ROOT.resolve(), 'Campaign must be in isolated local output')
    return read(root / 'plan.json')


def latest(root):
    result = {}
    for path in sorted((Path(root) / 'entries').glob('*/attempt_*.json')):
        value = read(path)
        for file, checksum in value.get('files', {}).items():
            require(sha(file) == checksum, 'Previously recorded source/raw checksum changed')
        result[path.parent.name] = (path, value)
    return result


def committed_snapshot(root):
    """Read one immutable, fully written checkpoint while collection continues."""
    root = Path(root)
    p = plan(root)
    for file, checksum in {**p['source_files'], **p['baseline_files']}.items():
        require(sha(file) == checksum, 'Pinned campaign source changed')
    for checkpoint in sorted((root / 'checkpoints').glob('*.json'), reverse=True):
        try:
            data = read(checkpoint)
        except (ValueError, UnicodeError):
            # An exclusive new file can be visible before its final flush.
            continue
        require(data['plan_sha256'] == sha(root / 'plan.json'), 'Checkpoint plan mismatch')
        result = {}
        for item, reference in data['results'].items():
            receipt = Path(reference['file'])
            require(sha(receipt) == reference['sha256'], 'Snapshot receipt changed')
            value = read(receipt)
            require(value['item_id'] == item, 'Snapshot item mismatch')
            for file, checksum in value.get('files', {}).items():
                require(sha(file) == checksum, 'Snapshot raw/source changed')
            result[item] = (receipt, value)
        return result, checkpoint
    raise ValueError('No complete checkpoint is available')


def summary(root):
    p = plan(root)
    done = latest(root)
    counts = Counter(value['status'] for _, value in done.values())
    return {'inputs': len(p['entries']), 'recorded': len(done), 'pending': len(p['entries']) - len(done),
            'states': dict(counts), 'reviews_saved_or_reused': sum(v.get('reviews_saved', 0) for _, v in done.values()),
            'reused_courses': sum(bool(v.get('reused')) for _, v in done.values())}


def recoverable_name_search(value):
    """Retry only a verified name-search cap that has not used professor fallback."""
    if value.get('status') != 'needs_review' or value.get('match_status') != 'incomplete_search':
        return False
    if value.get('reason') not in {'search_candidate_limit', 'search_scroll_limit'}:
        return False
    files = value.get('files', {})
    if any(Path(f).name == 'name_bounded_search.json' for f in files):
        return False
    bounded = [f for f in files if Path(f).name == 'bounded_search.json']
    if len(bounded) != 1:
        return False
    file = bounded[0]
    require(sha(file) == files[file], 'Bounded search evidence changed')
    evidence = read(file)
    instructor = evidence.get('input', {}).get('instructor')
    return (isinstance(instructor, str) and instructor.strip() not in {'', '미정', '담당교수', '-', 'Staff', 'STAFF'}
            and evidence.get('scope', {}).get('ui_end') is False
            and evidence.get('checkpoint', {}).get('snapshot', {}).get('mode') == 'name')


def recoverable_professor_search(value):
    """One explicit extension of a legacy professor UI limit, never a block."""
    if (value.get('status') != 'needs_review' or value.get('match_status') != 'incomplete_search'
            or value.get('reason') not in {'search_candidate_limit', 'search_scroll_limit'}
            or value.get('retry_policy') == 'extended_professor_800_v1'):
        return False
    files = value.get('files', {})
    bounded = [p for p in files if Path(p).name == 'bounded_search.json']
    if len(bounded) != 1:
        return False
    file = bounded[0]
    require(sha(file) == files[file], 'Bounded search evidence changed')
    evidence = read(file)
    instructor = evidence.get('input', {}).get('instructor')
    snapshot = evidence.get('checkpoint', {}).get('snapshot', {})
    return (isinstance(instructor, str) and instructor.strip() not in {'', '미정', '담당교수', '-', 'Staff', 'STAFF'}
            and evidence.get('scope', {}).get('ui_end') is False
            and snapshot.get('mode') == 'professor' and snapshot.get('query') == instructor)


def pending(root, retry_partial=False, retry_search_limits=False, retry_professor_limits=False):
    p = plan(root)
    for file, checksum in {**p['source_files'], **p['baseline_files']}.items():
        require(sha(file) == checksum, 'Immutable plan or baseline source changed')
    done = latest(root)
    checkpoints = sorted((Path(root) / 'checkpoints').glob('*.json'))
    if checkpoints:
        last = read(checkpoints[-1])
        require(last['plan_sha256'] == sha(Path(root) / 'plan.json'), 'Campaign plan changed after checkpoint')
        for item, reference in last['results'].items():
            require(sha(reference['file']) == reference['sha256'], 'Checkpoint receipt checksum mismatch')
    require(not any(v['status'] == 'blocked' for _, v in done.values()), 'Campaign blocked; never automatically clear restriction')
    return [e for e in p['entries'] if e['item_id'] not in done or
            (retry_partial and done[e['item_id']][1]['status'] in ('partial', 'failed')) or
            (retry_search_limits and recoverable_name_search(done[e['item_id']][1])) or
            (retry_professor_limits and recoverable_professor_search(done[e['item_id']][1]))]


def finish(root, item_id, value):
    root = Path(root)
    p = plan(root)
    require(item_id in {e['item_id'] for e in p['entries']}, 'Item outside Priority A')
    require(value['status'] in {'complete', 'partial', 'empty', 'needs_review', 'blocked', 'failed', 'not_found'}, 'Unknown course status')
    folder = root / 'entries' / item_id
    number = len(list(folder.glob('attempt_*.json'))) + 1
    value = {**value, 'item_id': item_id, 'attempt': number, 'recorded_at': datetime.now(timezone.utc).isoformat()}
    write_new(folder / f'attempt_{number:03d}.json', value)
    records = latest(root)
    checkpoint = {'plan_sha256': sha(root / 'plan.json'), 'summary': summary(root),
                  'results': {key: {'file': str(file.resolve()), 'sha256': sha(file)} for key, (file, _) in records.items()}}
    count = len(list((root / 'checkpoints').glob('*.json'))) + 1
    write_new(root / 'checkpoints' / f'{count:05d}.json', checkpoint)
    return value


def search_decision(root, item_id, search_path, output):
    entry = next(e for e in plan(root)['entries'] if e['item_id'] == item_id)
    require(entry['catalog_mapping'] == 'matched', 'Cannot search missing catalog entries automatically')
    decision = match_course(entry['course'], read(search_path))
    write_new(output, decision)
    return {'status': decision['status'], 'target': collector_target(decision) if decision['status'] == 'matched' else None,
            'decision_file': str(Path(output).resolve()), 'decision_sha256': sha(output)}


def record_course(root, item_id, run, decision_path, *, original_receipt=None):
    run = Path(run)
    decision = read(decision_path)
    entry = next(e for e in plan(root)['entries'] if e['item_id'] == item_id)
    require(decision['input'] == entry['course'], 'Decision belongs to another queue item')
    target = collector_target(decision)
    archive = read(run / 'run_report.json')
    report = archive['ui_observation']
    expected = {**target, 'url': target['url'].split('?')[0] + '?tab=article'}
    require(report['target'] == expected, 'Report differs from matched target')
    records, files = load_archive(run / 'run_report.json')
    local = read(run / 'local_manifest.json')
    require((run / 'local_manifest.sha256').read_text().split()[0] == sha(run / 'local_manifest.json'),
            'Local manifest seal mismatch')
    for relative, checksum in local['files'].items():
        require(sha(run / relative) == checksum, 'Local run checksum mismatch')
        files[str((run / relative).resolve())] = checksum
    files[str(Path(decision_path).resolve())] = sha(decision_path)
    files[str((run / 'local_manifest.json').resolve())] = sha(run / 'local_manifest.json')
    if original_receipt is not None:
        files[str(Path(original_receipt).resolve())] = sha(original_receipt)
    status = 'complete' if local['status'] == 'complete_for_observed_ui' else local['status']
    # Prior partial attempts are preserved; duplicates across attempts are flagged,
    # not silently combined into this attempt's completeness claim.
    prior = latest(root).get(item_id)
    previous = None
    duplicate_occurrences = 0
    if prior and prior[1].get('report'):
        previous = prior[1]['report']
        old, _ = load_archive(previous)
        fingerprints = Counter(json.dumps(r['fingerprint'], sort_keys=True) for r in old)
        new = Counter(json.dumps(r['fingerprint'], sort_keys=True) for r in records)
        duplicate_occurrences = sum((fingerprints & new).values())
    return finish(root, item_id, {'status': status, 'match_status': 'matched', 'target': expected,
         'report': str((run / 'run_report.json').resolve()), 'files': files, 'reviews_saved': len(records),
         'displayed_total': report['displayed_total'], 'prior_partial_report': previous,
         'duplicate_candidates_against_prior_attempt': duplicate_occurrences, 'raw_merge_or_delete': False,
         'adopted_after_baseline_validation': original_receipt is not None,
         'original_receipt': str(Path(original_receipt).resolve()) if original_receipt is not None else None})


def adopt_completed(root, source, session):
    """Revalidate preserved, previously out-of-scope runs after the baseline gate.

    These are collection inputs only, never evidence for baseline equivalence.
    Incomplete attempts remain solely in the old campaign and are not combined.
    """
    require(Path(root).resolve() != Path(source).resolve(), 'Adoption needs a separate campaign')
    verified = verify_baselines(session)
    require(all(plan(root)['baseline_files'].get(f) == checksum for f, checksum in verified.items()),
            'New campaign must pin the freshly verified baseline evidence')
    pending(source)  # Checks immutable checkpoints, originals and access-stop status.
    available = {e['item_id']: e for e in pending(root)}
    old_entries = {e['item_id']: e for e in plan(source)['entries']}
    approved = []
    for item, (receipt, value) in latest(source).items():
        if item not in available or value['status'] not in ('complete', 'empty') or value.get('reused'):
            continue
        require(available[item]['course'] == old_entries[item]['course'], 'Old/new catalog identity differs')
        run = Path(value['report']).parent
        target = collector_target(read(run / 'match.json'))
        require(read(run / 'match.json')['input'] == available[item]['course'], 'Preserved search decision differs')
        report = read(run / 'run_report.json')
        require(report['ui_observation']['target'] == {**target, 'url': target['url'].split('?')[0]+'?tab=article'},
                'Preserved archive differs from observed search match')
        require(report['ui_observation']['status'] == 'complete', 'Incomplete archive cannot be adopted')
        records, _ = load_archive(run / 'run_report.json')
        manifest = read(run / 'local_manifest.json')
        require(manifest['status'] in ('complete_for_observed_ui', 'empty'), 'Local completion not verified')
        require((run / 'local_manifest.sha256').read_text().split()[0] == sha(run / 'local_manifest.json'),
                'Preserved manifest seal changed')
        require(all(sha(run / f) == checksum for f, checksum in manifest['files'].items()), 'Preserved local inputs changed')
        approved.append((item, receipt, run, len(records)))
    for item, receipt, run, _ in approved:
        record_course(root, item, run, run / 'match.json', original_receipt=receipt)
    report = {'source_campaign': str(Path(source).resolve()), 'baseline_session': str(Path(session).resolve()),
              'verified_after_authorization': True, 'baseline_data_uses_priority_results': False,
              'adopted_courses': len(approved), 'adopted_reviews': sum(n for _, _, _, n in approved),
              'items': [item for item, _, _, _ in approved], 'partial_attempts_adopted': 0,
              'raw_copied_merged_or_deleted': False, 'baseline_files': verified}
    write_new(Path(root) / 'adoption_report.json', report)
    return {**summary(root), 'adopted_courses': report['adopted_courses'], 'adopted_reviews': report['adopted_reviews']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ('create', 'pending', 'summary', 'match', 'record', 'finish', 'adopt'):
        p = sub.add_parser(name)
        p.add_argument('--root', required=True)
        if name == 'create':
            p.add_argument('--queue', required=True)
            p.add_argument('--baselines', required=True)
            p.add_argument('--reuse-root', required=True)
        if name == 'pending':
            p.add_argument('--retry-partial', action='store_true')
            p.add_argument('--retry-search-limits', action='store_true')
            p.add_argument('--retry-professor-limits', action='store_true')
        if name == 'adopt':
            p.add_argument('--source', required=True)
            p.add_argument('--baselines', required=True)
        if name in ('match', 'record', 'finish'):
            p.add_argument('--item', required=True)
        if name == 'match':
            p.add_argument('--search', required=True)
            p.add_argument('--output', required=True)
        if name == 'record':
            p.add_argument('--run', required=True)
            p.add_argument('--decision', required=True)
        if name == 'finish':
            p.add_argument('--input', required=True)
    a = parser.parse_args()
    if a.command == 'create': r = create_plan(a.queue, a.baselines, a.reuse_root, a.root)
    elif a.command == 'pending': r = pending(a.root, a.retry_partial, a.retry_search_limits, a.retry_professor_limits)
    elif a.command == 'summary': r = summary(a.root)
    elif a.command == 'match': r = search_decision(a.root, a.item, a.search, a.output)
    elif a.command == 'record': r = record_course(a.root, a.item, a.run, a.decision)
    elif a.command == 'adopt': r = adopt_completed(a.root, a.source, a.baselines)
    else: r = finish(a.root, a.item, read(a.input))
    print(json.dumps(r, ensure_ascii=False))


if __name__ == '__main__':
    main()
