"""Reuse the existing schema, fingerprints and archive validation without editing it."""
from collections import Counter
from pathlib import Path
import json
import os
from .archived_files import read_bytes

from crawler.everytime_collect.raw import canonical, digest, fingerprints, read_document, read_json
from .local_run_v2 import save_event, finalize_run, require, validate_report

_configured_root = os.environ.get('EVERYTIME_LOCAL_OUTPUT_ROOT')
if _configured_root and not Path(_configured_root).is_absolute():
    raise ValueError('Output root must be absolute')
ROOT = (Path(_configured_root).resolve() if _configured_root else
        Path(__file__).resolve().parents[1] / 'output' / 'everytime_local_runner')


def write_new(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('xb') as stream:
        stream.write(canonical(value))
        stream.flush()
        os.fsync(stream.fileno())


def sha(path):
    return digest(read_bytes(path))


def run_path(path, root=ROOT):
    path, root = Path(path).resolve(), Path(root).resolve()
    require(path.parent == root and path.is_dir(), 'Use an existing isolated new local-runner directory')
    return path


def archive_batch(run, number, *, root=ROOT):
    run = run_path(run, root)
    require(type(number) is int and 1 <= number <= 200, 'Invalid batch ordinal')
    source = run / 'incoming' / f'event_{number:03d}.json'
    destination = run / f'batch_{number:03d}'
    # Verify committed predecessors before extending this run.
    prior = []
    for index in range(1, number):
        checkpoint = read_json((run / 'checkpoints' / f'{index:03d}.json').read_bytes())
        for name, checksum in checkpoint['files'].items():
            require(sha(run / name) == checksum, 'Previously checkpointed file changed')
        raw = run / f'batch_{index:03d}' / 'raw.json'
        if raw.exists():
            prior.append(raw)
    # Per-batch manifest names its actual comparison window (legacy cap: 20).
    # Finalization separately compares ALL rows across ALL batches, without
    # dropping duplicates outside this bounded incremental window.
    _, manifest = save_event(source, destination, against=prior[-20:], private_root=run, output_root=run)
    files = [source, source.with_name(source.stem + '_raw.json')]
    files += list(destination.iterdir())
    files = [p for p in files if p.is_file()]
    for path in files:
        # Windows FlushFileBuffers requires a writable handle; no bytes change.
        with path.open('r+b') as stream:
            os.fsync(stream.fileno())
    checkpoint = {'version': 1, 'state': 'batch_saved', 'batch': number,
                  'reviews_saved': manifest['reviews_saved'] if manifest else 0,
                  'files': {p.relative_to(run).as_posix(): sha(p) for p in files}}
    write_new(run / 'checkpoints' / f'{number:03d}.json', checkpoint)
    return checkpoint


def classify(report):
    validate_report(report)
    error = (report['stop_error'] or '').lower()
    if error.startswith('login_failed:'):
        return 'failed'
    if any(s in error for s in ('blocked:', 'captcha', 'access restriction', 'access denied', 'security denial')):
        return 'blocked'
    if any(s in error for s in ('identity', 'course label', 'course value', 'title differs', 'filter or sort', 'cards changed', 'wrong course')):
        return 'needs_review'
    if 'login' in error:
        return 'blocked'  # Preserve the original single-runner's historical code.
    if report['status'] == 'complete':
        return 'empty' if report['succeeded'] == 0 else 'complete_for_observed_ui'
    return 'partial' if report['initial_loaded'] is not None else 'failed'


def seal(run, status, *, details=None):
    require(status in {'complete_for_observed_ui', 'partial', 'empty', 'needs_review', 'blocked', 'failed'},
            'Unknown local collection status')
    require(not (run / 'local_manifest.json').exists() and not (run / 'local_manifest.sha256').exists(),
            'Run already sealed; never replace its manifest')
    inventory = {p.relative_to(run).as_posix(): sha(p) for p in sorted(run.rglob('*')) if p.is_file()}
    manifest = {'version': 1, 'runner': 'everytime_local_runner', 'status': status,
                'transport': 'Playwright DOM -> Node file -> local Python validation; no review text in tool output',
                'files': inventory, 'details': details or {}}
    write_new(run / 'local_manifest.json', manifest)
    with (run / 'local_manifest.sha256').open('x', encoding='ascii') as stream:
        stream.write(sha(run / 'local_manifest.json') + '  local_manifest.json\n')
        stream.flush()
        os.fsync(stream.fileno())
    return manifest


def finalize(run, *, root=ROOT):
    run = run_path(run, root)
    report_path = run / 'incoming' / 'ui_report.json'
    report = read_json(report_path.read_bytes())
    validate_report(report)
    sources = []
    for number in range(1, report['batches'] + 1):
        checkpoint = read_json((run / 'checkpoints' / f'{number:03d}.json').read_bytes())
        for name, checksum in checkpoint['files'].items():
            require(sha(run / name) == checksum, 'Checkpoint checksum mismatch')
        sources.append(run / f'batch_{number:03d}' / 'batch_event.json')
    _, archive = finalize_run(sources, report_path, run, private_root=run, output_root=root)
    status = classify(report)
    return seal(run, status, details={'reviews_saved': archive['reviews_saved'],
                                     'displayed_total': report['displayed_total'],
                                     'duplicate_candidates': archive['duplicate_candidates']})


def load_archive(report_path):
    """Read explicit finalized archives only; preserve multiplicity and verify bytes."""
    report_path = Path(report_path).resolve()
    report = read_json(read_bytes(report_path))
    require(report.get('operation') == 'finalize_explicit_course_ui_run', 'Expected a finalized collector run')
    validate_report(report['ui_observation'])
    records, files = [], {str(report_path): sha(report_path)}
    for batch in report['batches']:
        directory = batch['directory']
        require(Path(directory).name == directory and directory.startswith('batch_'), 'Unsafe batch reference')
        if batch['raw_sha256'] is None:
            continue
        path = report_path.parent / directory / 'raw.json'
        data = read_bytes(path)
        require(digest(data) == batch['raw_sha256'], 'Baseline/raw checksum mismatch')
        manifest = read_json(read_bytes(path.parent / 'manifest.json'))
        require(manifest['raw_file']['sha256'] == digest(data), 'Batch manifest checksum mismatch')
        doc = read_document(data)
        target = report['ui_observation']['target']
        require(doc['capture']['page_url'] == target['url'] and
                doc['course']['title_raw'] == target['title'] and
                doc['course']['instructor_raw'] == target['instructor'], 'Raw identity differs from run')
        files[str(path)] = digest(data)
        for review in doc['reviews']:
            records.append({'text_raw': review['text_raw'], 'enrollment_term_raw': review['enrollment_term_raw'],
                            'source_url': doc['capture']['page_url'], 'course_title': doc['course']['title_raw'],
                            'instructor': doc['course']['instructor_raw'], 'fingerprint': fingerprints(doc, review)})
    require(len(records) == report['reviews_saved'] == report['ui_observation']['succeeded'], 'Archive review count mismatch')
    return records, files


def compare_records(old, new):
    fields = ('text_raw', 'enrollment_term_raw', 'source_url', 'course_title', 'instructor')
    def diff(left, right):
        return {'equal': left == right, 'only_baseline_occurrences': sum((left - right).values()),
                'only_local_occurrences': sum((right - left).values())}
    def counts(rows, keys):
        return Counter(canonical({key: row[key] for key in keys}) for row in rows)
    a, b = counts(old, ('fingerprint',)), counts(new, ('fingerprint',))
    joint = diff(counts(old, fields), counts(new, fields))
    return {'baseline_count': len(old), 'local_count': len(new),
            'fields': {key: diff(counts(old, (key,)), counts(new, (key,))) for key in fields},
            'review_multiset': joint, 'fingerprint_multiset': diff(a, b),
            'fingerprint_set': {'equal': set(a) == set(b), 'only_baseline': len(set(a) - set(b)),
                                'only_local': len(set(b) - set(a))},
            'identical_review_collection': joint['equal'] and a == b,
            'order_ignored': True, 'duplicates_preserved': True}


def compare(baseline, local, output):
    baseline_target = read_json(Path(baseline).read_bytes())['ui_observation']['target']
    local_target = read_json(Path(local).read_bytes())['ui_observation']['target']
    require(baseline_target == local_target, 'Cannot compare different target identities, including empty archives')
    old, baseline_files = load_archive(baseline)
    new, local_files = load_archive(local)
    result = {**compare_records(old, new), 'baseline_files': baseline_files, 'local_files': local_files}
    write_new(output, result)
    with Path(str(output) + '.sha256').open('x', encoding='ascii') as stream:
        stream.write(sha(output) + '  ' + Path(output).name + '\n')
        stream.flush()
        os.fsync(stream.fileno())
    return result
