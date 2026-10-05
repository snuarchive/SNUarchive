"""Read-only comparison of supplied references and a frozen collection snapshot.

Reports exact matching coverage, never treats the legacy spreadsheet as labels.
Chat contents are not copied: only file hashes and relevant line locations remain.
"""
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path
import argparse
import json
import re

from crawler.everytime_collect.run_v2 import require
from crawler.everytime_stats.extract import extract_comment, RULE_VERSION
from crawler.everytime_stats.models import Comment
from .full_campaign import read
from .storage import ROOT, sha, write_new
from .quality_audit import lines
from .import_candidates import write_jsonl


def audit(snapshot_path, destination):
    import openpyxl  # Read-only reference inspection; no workbook authoring.
    snapshot_path, destination = Path(snapshot_path).resolve(), Path(destination).resolve()
    require(destination.parent == ROOT.resolve() and not destination.exists(), 'Use a new reference audit output')
    source = Path(__file__).resolve().parents[3]
    json_file = source / 'everytime_강의평_숫자포함_전체 (1).json'
    xlsx_file = source / 'everytime_시험점수_통계량.xlsx'
    chat_file = source / 'KakaoTalk_20261002_2038_55_143_group.txt'
    files = [json_file, xlsx_file, chat_file, source / 'schema.sql', source / 'openapi.yaml']
    inputs = {str(p): sha(p) for p in files}
    snapshot = read(snapshot_path / 'snapshot.json')
    inputs[str(snapshot_path / 'snapshot.json')] = sha(snapshot_path / 'snapshot.json')
    saved = defaultdict(set)
    for a in snapshot['selected']:
        report_path = Path(a['report']); report = read(report_path)
        for batch in report['batches']:
            if batch['raw_sha256'] is None: continue
            raw = report_path.parent / batch['directory'] / 'raw.json'
            require(sha(raw) == batch['raw_sha256'], 'Raw archive changed')
            doc = read(raw); key = (doc['course']['title_raw'], doc['course']['instructor_raw'])
            saved[key].update(r['text_raw'] for r in doc['reviews'])
        saved[(a['course']['title'], a['course']['instructor'])]  # Include verified empty courses.
    legacy = json.loads(json_file.read_text(encoding='utf-8-sig'))
    global_bodies = defaultdict(set)
    for key, bodies in saved.items():
        for body in bodies: global_bodies[body].add(key)
    catalog = read(Path(__file__).resolve().parents[2] / 'public/courses.json')
    catalog_pairs = {(c['title'], c['instructor']) for c in catalog}
    legacy_pairs, legacy_bodies = set(), defaultdict(set)
    legacy_counts = Counter(); covered_comments = matched_comments = 0
    differences = []
    compact = lambda text: re.sub(r'\s+', '', text)
    for i, course in enumerate(legacy):
        key = (course['강의명'], course['교수']); legacy_pairs.add(key)
        for k, body in enumerate(course['댓글']):
            legacy_bodies[key].add(body)
            result = extract_comment(Comment(i, k, *key, body, str(json_file), inputs[str(json_file)]))
            legacy_counts[result['classification']] += 1
            if key in saved:
                covered_comments += 1; matched_comments += body in saved[key]
                if body not in saved[key]:
                    normalized = compact(body)
                    matches = [s for s in saved[key] if compact(s) == normalized]
                    best = max((SequenceMatcher(None, normalized, compact(s)).ratio() for s in saved[key]), default=0)
                    differences.append({'legacy_json_pointer': f'/{i}/댓글/{k}', 'course_title': key[0], 'instructor': key[1],
                                        'whitespace_only_match': bool(matches), 'best_text_similarity': best,
                                        'exact_text_found_other_courses': sorted(global_bodies.get(body, set()) - {key}),
                                        'resolution': 'unreviewed', 'automatically_replaced': False})
    wb = openpyxl.load_workbook(xlsx_file, read_only=True, data_only=True)
    ws = wb['시험점수 통계량']; rows = list(ws.values)[1:]; wb.close()
    excel_rows, excel_counts = [], Counter()
    for index, (instructor, title, body) in enumerate(rows, 2):
        key = (title, instructor)
        result = extract_comment(Comment(index, 0, title, instructor, body, str(xlsx_file), inputs[str(xlsx_file)]))
        excel_counts[result['classification']] += 1
        excel_rows.append({'xlsx_row': index, 'course_title': title, 'instructor': instructor,
                           'in_catalog_exact': key in catalog_pairs, 'collected_in_snapshot': key in saved,
                           'exact_text_in_legacy_json': body in legacy_bodies[key],
                           'exact_text_in_collected_raw': body in saved.get(key, set()),
                           'whitespace_insensitive_excerpt_in_legacy_json': any(compact(body) in compact(s) for s in legacy_bodies[key]),
                           'whitespace_insensitive_excerpt_in_collected_raw': any(compact(body) in compact(s) for s in saved.get(key, set())),
                           'extractor_classification': result['classification'],
                           'numeric_candidates': sum(any(v is not None for v in r['statistics'].values()) or
                                                     r['observed_max'] is not None for r in result['records']),
                           'human_review_status': 'unreviewed'})
    # Preserve prior derived versions as history; no old proposal is an approval.
    history = []
    prefixes = ('stats_A_', 'import_A_', 'quality_A_', 'review_A_', 'followup_A_',
                'review_annotations_A_', 'followup_annotations_A_', 'verification_A_')
    for folder in sorted(ROOT.iterdir()):
        if folder.is_dir() and folder.name.startswith(prefixes):
            protected = {str(p): sha(p) for p in folder.rglob('*') if p.is_file()}
            history.append({'directory': str(folder.resolve()), 'role': 'historical_not_current_approval',
                            'files': protected})
    current = read(snapshot_path / 'summary.json')
    old_a = {r['candidate_id']: r for r in lines(ROOT / 'import_A_root_schema_20261002_01/import_candidates.jsonl')}
    new = {r['candidate_id']: r for r in lines(Path(current['candidates']) / 'import_candidates.jsonl')}
    unchanged = sum(k in new and all(v[field] == new[k][field] for field in
                    ('extraction', 'review_fingerprints', 'database_projection', 'database_mapping')) for k, v in old_a.items())
    require(unchanged == len(old_a), 'Previously aligned A candidates changed')
    unresolved_pairs = {(d['course_title'], d['instructor']) for d in differences if not d['whitespace_only_match']}
    source_holds = []
    for a in snapshot['selected']:
        if (a['course']['title'], a['course']['instructor']) in unresolved_pairs:
            source_holds.append({'course': a['course'], 'report': a['report'], 'collection_status': a['status'],
                                 'candidate_ids': [cid for cid, r in new.items() if r['extraction']['priority_reference']['course_key'] == a['course']['course_key']],
                                 'hold_reason': 'legacy_source_comparison_unresolved',
                                 'status': 'unreviewed', 'automatically_remapped': False})
    relevant_lines = []
    for n, line in enumerate(chat_file.read_text(encoding='utf-8-sig').splitlines(), 1):
        if re.search('통계량|스키마|schema|openapi|크롤링|10월 3일', line) and len(line) < 400:
            relevant_lines.append(n)  # Do not store chat text or credentials.
    result = {'input_files': inputs, 'rule_version': RULE_VERSION,
              'legacy_json': {'course_records': len(legacy), 'unique_pairs': len(legacy_pairs),
                              'comments': sum(legacy_counts.values()), 'rule_classifications': dict(legacy_counts),
                              'exact_catalog_pairs': len(legacy_pairs & catalog_pairs),
                              'collected_pairs': len(legacy_pairs & set(saved)), 'covered_comments': covered_comments,
                              'exact_matching_comments': matched_comments,
                              'nonmatching_comments_within_collected_pairs': covered_comments - matched_comments},
              'xlsx': {'rows': len(rows), 'unique_pairs': len({(r[1], r[0]) for r in rows}),
                       'rule_classifications': dict(excel_counts),
                       'exact_text_in_legacy_json': sum(r['exact_text_in_legacy_json'] for r in excel_rows),
                       'exact_text_in_collected_raw': sum(r['exact_text_in_collected_raw'] for r in excel_rows)},
              'previous_A_candidates_preserved': unchanged, 'previous_A_candidate_count': len(old_a),
              'historical_artifact_files_preserved': sum(len(h['files']) for h in history),
              'chat_requirement_line_locations': relevant_lines,
              'limitations': ['Rule classifications are not human correctness labels',
                             'Exact text mismatch can reflect edits, line breaks, selected excerpts or missing data; not automatically a collector error',
                             'Matching legacy reviews is not proof of full-site recall',
                             'Root SQL/API have no resolved anonymous crawler contributor/source policy',
                             'Prior review proposals remain unapproved'],
              'database_writes': 0}
    result['legacy_json']['whitespace_only_differences'] = sum(r['whitespace_only_match'] for r in differences)
    result['legacy_json']['remaining_text_differences'] = sum(not r['whitespace_only_match'] for r in differences)
    result['legacy_json']['exact_text_found_other_courses'] = sum(bool(r['exact_text_found_other_courses']) for r in differences)
    result['source_comparison_hold_courses'] = len(source_holds)
    result['source_comparison_hold_numeric_candidates'] = sum(len(r['candidate_ids']) for r in source_holds)
    result['xlsx']['excerpt_matches_legacy_json'] = sum(r['whitespace_insensitive_excerpt_in_legacy_json'] for r in excel_rows)
    result['xlsx']['excerpt_matches_collected_raw'] = sum(r['whitespace_insensitive_excerpt_in_collected_raw'] for r in excel_rows)
    result['xlsx']['catalog_missing_rows'] = sum(not r['in_catalog_exact'] for r in excel_rows)
    require(all(sha(f) == h for f, h in inputs.items()), 'Reference input changed')
    require(all(sha(f) == h for row in history for f, h in row['files'].items()), 'Historical output changed')
    destination.mkdir()
    write_new(destination / 'summary.json', result)
    write_new(destination / 'historical_outputs.json', history)
    write_jsonl(destination / 'xlsx_row_comparison.jsonl', excel_rows)
    write_jsonl(destination / 'legacy_text_differences.jsonl', differences)
    write_new(destination / 'source_comparison_holds.json', source_holds)
    write_new(destination / 'manifest.json', {'files': {p.name: sha(p) for p in destination.iterdir() if p.is_file()}})
    return {k: v for k, v in result.items() if k not in ('input_files', 'chat_requirement_line_locations')}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--snapshot', required=True); p.add_argument('--output', required=True)
    args = p.parse_args()
    print(json.dumps(audit(args.snapshot, args.output), ensure_ascii=False))
