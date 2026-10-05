"""Compare immutable candidate versions and route evidence, without approval.

Numeric candidates and withheld scale packets are counted separately. Term-only
routing is a work queue, not proof of correctness or a human approval surrogate.
"""
from collections import Counter, defaultdict
from html import escape
from pathlib import Path
import argparse
import json
import os
import re

from crawler.everytime_collect.run_v2 import require
from crawler.everytime_stats.validate import check_evidence
from .campaign import read
from .import_candidates import write_jsonl
from .storage import ROOT, sha, write_new

CATEGORIES = ('structure_clean', 'term_missing_only', 'assessment_ambiguous',
              'score_scale_ambiguous', 'multiple_observations_needs_split', 'other_review_required')
TEMPORAL = {'missing_year', 'missing_semester', 'ambiguous_term',
            'database_year_unresolved_or_out_of_range', 'database_semester_unresolved_or_out_of_range'}
IDENTITY = {'missing_assessment', 'missing_number', 'unsupported_assessment_number', 'unsupported_numbered_kind',
            'uncertain_assessment_scope', 'partial_assessment_scope', 'composite_assessment_scope',
            'database_assessment_unresolved_or_invalid'}
MEANING = ('assessment', 'scope', 'component', 'year', 'semester', 'statistics', 'observed_max',
           'evidence', 'candidates', 'context_evidence', 'review_reasons', 'score_scale_note')


def lines(path):
    return [json.loads(line) for line in Path(path).read_text(encoding='utf-8').splitlines()]


def occurrence(record):
    s = record['source']
    return s['file'], s['json_pointer'], s['comment_sha256']


def meaning(record):
    return {k: record.get(k) for k in MEANING}


def triage(row):
    record = row['extraction']; reasons = set(row['dataset_review_reasons'])
    if record.get('score_scale_note') or 'score_scale_ambiguous' in reasons or 'rescaled_or_bonus_score' in reasons:
        category = 'score_scale_ambiguous'
    elif 'conflicting_values' in reasons or 'multiple_observations_needs_split' in reasons:
        category = 'multiple_observations_needs_split'
    elif reasons & IDENTITY:
        category = 'assessment_ambiguous'
    elif reasons - TEMPORAL:
        category = 'other_review_required'
    elif reasons:
        category = 'term_missing_only'
    else:
        category = 'structure_clean'
    numeric = any(v is not None for v in record['statistics'].values()) or record['observed_max'] is not None
    return {'candidate_id': row['candidate_id'], 'category': category, 'numeric_candidate': numeric,
            'requires_content_review': category not in ('structure_clean', 'term_missing_only'),
            'requires_term_linking': bool(reasons & TEMPORAL),
            'route': 'term_linker' if category == 'term_missing_only' else 'content_review' if category != 'structure_clean' else 'approval_queue',
            'triage_basis': sorted(reasons), 'human_review_status': 'unreviewed',
            'ready_for_database_write': False, 'candidate': row}


def packet(path):
    path = Path(path).resolve(); manifest = read(path / 'manifest.json'); summary = read(path / 'summary.json')
    inputs = {str(path / name): h for name, h in manifest['files'].items()}
    inputs[str(path / 'manifest.json')] = sha(path / 'manifest.json')
    inputs.update(summary.get('input_files', summary.get('input_snapshot', {})))
    require(all(sha(f) == h for f, h in inputs.items()), 'Changed packet or source')
    return summary, inputs


def audit(old_dataset, new_dataset, destination):
    old_dataset, new_dataset, destination = map(lambda p: Path(p).resolve(), (old_dataset, new_dataset, destination))
    require(all(p.parent == ROOT.resolve() for p in (old_dataset, new_dataset, destination)), 'Use isolated local runner paths')
    require(not destination.exists(), 'Use a new quality audit output')
    old_summary, old_inputs = packet(old_dataset); new_summary, new_inputs = packet(new_dataset)
    old_extract = Path(old_summary['source_extraction']); new_extract = Path(new_summary['source_extraction'])
    oe, oi = packet(old_extract); ne, ni = packet(new_extract)
    require(oe['counts']['reviews'] == ne['counts']['reviews'] == 5753, 'Expected the complete Priority A raw snapshot')
    require(oe['input_snapshot'] == ne['input_snapshot'], 'Extraction did not use the same committed raw snapshot')
    inputs = {**old_inputs, **new_inputs, **oi, **ni, str(Path(__file__).resolve()): sha(__file__)}
    old = {r['candidate_id']: r for r in lines(old_dataset / 'import_candidates.jsonl')}
    new = {r['candidate_id']: r for r in lines(new_dataset / 'import_candidates.jsonl')}
    scale_packets = [r for r in lines(new_dataset / 'mention_review.jsonl') if r['extraction'].get('score_scale_note')]
    triaged = [triage(r) for r in list(new.values()) + scale_packets]
    counts = {name: sum(r['category'] == name for r in triaged) for name in CATEGORIES}
    value_changes, identity_changes, shared_changes = [], [], []
    for cid in sorted(old.keys() & new.keys()):
        a, b = old[cid]['extraction'], new[cid]['extraction']
        require((a['year'], a['semester']) == (b['year'], b['semester']), 'Unapproved temporal inference change')
        changed = [k for k in MEANING if a.get(k) != b.get(k)]
        if changed:
            shared_changes.append({'candidate_id': cid, 'changed_fields': changed,
                                   'before': meaning(a), 'after': meaning(b)})
        if a['statistics'] != b['statistics'] or a['observed_max'] != b['observed_max']:
            value_changes.append(cid)
        if any(a[k] != b[k] for k in ('assessment', 'scope', 'component')):
            identity_changes.append(cid)
    scale_held = {obs['record_id']: r['candidate_id'] for r in scale_packets
                  for obs in r['extraction']['score_scale_note']['observations']}
    removed = sorted(old.keys() - new.keys()); added = sorted(new.keys() - old.keys())
    require(all(cid in scale_held for cid in removed), 'Unexpected numeric removal outside known scale rule')
    split_links = []
    for cid in added:
        r = new[cid]['extraction']
        # Link by exact source occurrence and reassigned evidence, not just by
        # value or title (which can collide across different reviews/exams).
        parents = []
        for oid, row in old.items():
            prior = row['extraction']
            if occurrence(prior) != occurrence(r):
                continue
            shared = [e for e in r['evidence'] if e in prior['evidence']]
            if shared:
                parents.append({'candidate_id': oid, 'reassigned_evidence': shared,
                                'old_assessment': prior['assessment'], 'new_assessment': r['assessment']})
        require(bool(parents), 'New numeric candidate has no source-evidence parent')
        split_links.append({'candidate_id': cid, 'parents': parents})
    old_records = lines(old_extract / 'accepted.jsonl') + lines(old_extract / 'review_required.jsonl')
    new_records = lines(new_extract / 'accepted.jsonl') + lines(new_extract / 'review_required.jsonl')
    grouped = [defaultdict(list), defaultdict(list)]
    for group, records in zip(grouped, (old_records, new_records)):
        for r in records:
            group[occurrence(r)].append(r)
    texts = {}; changes = []
    for key in sorted(grouped[0].keys() | grouped[1].keys()):
        a, b = grouped[0][key], grouped[1][key]
        if [meaning(r) for r in a] == [meaning(r) for r in b]:
            continue
        raw, pointer, body_sha = key
        body = read(raw)['reviews'][int(pointer.rsplit('/', 1)[1])]['text_raw']
        from crawler.everytime_collect.raw import digest
        require(digest(body.encode('utf-8')) == body_sha, 'Review body differs')
        rules = []
        if any(r.get('score_scale_note') for r in b):
            rules.append({'rule': 'paired_score_scale_conversion', 'evidence': [e for r in b for e in r.get('score_scale_note', {}).get('evidence', [])]})
        causal = list(re.finditer(r'(?:중간(?:고사)?|기말(?:고사)?)\s*(?:은|는)\s*(?:중간(?:고사)?|기말(?:고사)?)\s*(?:이|가)\s*(?:어려워서|쉬워서)', body))
        if causal:
            rules.append({'rule': 'causal_assessment_reference', 'evidence': [{'start': m.start(), 'end': m.end(), 'text': m.group()} for m in causal]})
        ordinal = [e for r in a for e in r['candidates'] if e['rule'] == 'multiple_unlabelled_values' and re.search(r'\d+\s*차', e['text'])]
        if ordinal:
            rules.append({'rule': 'numbered_assessment_boundary', 'evidence': ordinal})
        require(bool(rules), 'Unexplained semantic change outside confirmed rule families')
        for r in b:
            check_evidence(r, body)
        change_id = digest((raw + pointer).encode())[:24]
        changes.append({'change_id': change_id, 'source': a[0]['source'] if a else b[0]['source'],
                        'course_title': (a or b)[0]['course_title'], 'rules': rules,
                        'before': a, 'after': b})
        texts[change_id] = body
    old_excluded = lines(old_extract / 'excluded.jsonl'); new_excluded = lines(new_extract / 'excluded.jsonl')
    require([{k: v for k, v in r.items() if k != 'rule_version'} for r in old_excluded] ==
            [{k: v for k, v in r.items() if k != 'rule_version'} for r in new_excluded], 'Excluded review behavior changed')
    affected_old = set(removed) | {r['candidate_id'] for r in shared_changes} | {
        p['candidate_id'] for link in split_links for p in link['parents']}
    content_rows = [r for r in triaged if r['requires_content_review']]
    summary = {
        'old_numeric_candidates': len(old), 'new_numeric_candidates': len(new),
        'unchanged_numeric_candidates': len(old.keys() & new.keys()) - len(shared_changes),
        'affected_old_numeric_candidates': len(affected_old), 'changed_raw_reviews': len(changes),
        'removed_numeric_candidates': len(removed), 'added_split_numeric_candidates': len(added),
        'assessment_split_operations': len({p['candidate_id'] for link in split_links for p in link['parents']}),
        'shared_candidate_value_changes': len(value_changes), 'shared_candidate_identity_changes': len(identity_changes),
        'scale_withheld_old_numeric_candidates': len(set(removed) & scale_held.keys()),
        'scale_review_packets': len(scale_packets), 'triage_units': len(triaged), 'triage_counts': counts,
        'content_review_units': len(content_rows),
        'content_review_unique_raw_reviews': len({occurrence(r['candidate']['extraction']) for r in content_rows}),
        'term_only_units': counts['term_missing_only'], 'all_units_human_unreviewed': len(triaged),
        'review_required': {'old_numeric': old_summary['review_required_candidates'], 'new_numeric': new_summary['review_required_candidates'],
                            'old_all_extraction_records': oe['output_rows']['review_required'], 'new_all_extraction_records': ne['output_rows']['review_required']},
        'raw_reviews_verified': ne['counts']['reviews'], 'raw_snapshot_unchanged': True,
        'raw_files_verified': sum(Path(f).name == 'raw.json' for f in ne['input_snapshot']),
        'excluded_reviews_unchanged': len(new_excluded), 'database_write_count': 0,
        'term_proposals_applied': 0, 'human_approvals': 0,
        'limitations': ['Triage is rule-based routing, not human approval or a measured semantic error rate.',
                       'Content-review count excludes term-only routing; unresolved dates may still require people.',
                       'Other mention-only and excluded reviews are outside the 332-candidate review scope.'],
        'input_files': inputs,
    }
    comparison = {'removed': [{'candidate_id': cid, 'held_in_packet': scale_held[cid], 'original': old[cid]} for cid in removed],
                  'added_split_candidates': split_links, 'shared_candidate_changes': shared_changes,
                  'value_changed_ids': value_changes, 'identity_changed_ids': identity_changes}
    require(all(sha(f) == h for f, h in inputs.items()), 'Sources changed during audit')
    destination.mkdir()
    write_new(destination / 'summary.json', summary)
    write_new(destination / 'comparison.json', comparison)
    write_jsonl(destination / 'changed_reviews.jsonl', changes)
    write_jsonl(destination / 'triage.jsonl', triaged)
    for category in CATEGORIES:
        write_jsonl(destination / (category + '.jsonl'), [r for r in triaged if r['category'] == category])
    write_new(destination / 'policy.json', {'categories': list(CATEGORIES), 'priority_order': ['score_scale_ambiguous', 'multiple_observations_needs_split', 'assessment_ambiguous', 'other_review_required', 'term_missing_only', 'structure_clean'],
        'temporal_reasons': sorted(TEMPORAL), 'identity_reasons': sorted(IDENTITY), 'human_review_status': 'unreviewed',
        'structure_clean_definition': 'No detected structural, value, mapping, or term issues; not an approval.',
        'term_missing_only_definition': 'Only temporal reasons remain; value correctness has not been independently human-validated.'})
    with (destination / 'review.html').open('x', encoding='utf-8') as stream:
        stream.write(render(summary, changes, texts, triaged)); stream.flush(); os.fsync(stream.fileno())
    require(all(sha(f) == h for f, h in inputs.items()), 'Sources changed before audit commit')
    write_new(destination / 'manifest.json', {'state': 'complete', 'files': {p.name: sha(p) for p in destination.iterdir()}})
    return {k: v for k, v in summary.items() if k != 'input_files'}


def render(summary, changes, texts, triaged):
    def pretty(value):
        return '<pre>' + escape(json.dumps(value, ensure_ascii=False, indent=2)) + '</pre>'
    parts = ['<!doctype html><html lang="ko"><meta charset="utf-8"><title>Priority A extractor 품질 비교</title>',
             '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">',
             '<style>body{font:16px system-ui;max-width:1100px;margin:32px auto;padding:16px;line-height:1.6}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f6f8;padding:16px}details{border:1px solid #aaa;padding:12px;margin:12px 0}summary{cursor:pointer}td,th{padding:8px;border:1px solid #aaa}table{border-collapse:collapse}</style>',
             '<h1>Priority A extractor 0.1.6 → 0.1.7</h1><p>5,753개 원문 재처리 · 신규 수집 없음 · DB 쓰기 없음</p>',
             '<p>분류는 작업 순서를 위한 자동 triage입니다. 모든 후보는 사람이 승인하지 않은 상태입니다. '
             'term_missing_only는 날짜 연결 대상이며, 그 날짜를 자동 확정하지 않았습니다. 척도 보류 묶음은 numeric 후보와 별도로 셉니다.</p>',
             pretty({k: v for k, v in summary.items() if k != 'input_files'}), '<h2>확인된 변경과 원문</h2>']
    for change in changes:
        parts += ['<details><summary>' + escape(change['course_title']) + '</summary>', pretty(change),
                  '<h3>변경하지 않은 원문</h3><pre>' + escape(texts[change['change_id']]) + '</pre></details>']
    parts += ['<h2>분류별 후보</h2>']
    for category in CATEGORIES:
        entries = [r for r in triaged if r['category'] == category]
        parts += ['<h3>' + category + f' ({len(entries)})</h3>']
        for row in entries:
            rec = row['candidate']['extraction']
            title = f"{rec['course_title']} · {rec['instructor']} · {rec['assessment']['raw_label']} · {row['candidate_id']}"
            parts += ['<details><summary>' + escape(title) + '</summary>', pretty(row), '</details>']
    return ''.join(parts) + '</html>'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--old', required=True); parser.add_argument('--new', required=True); parser.add_argument('--output', required=True)
    args = parser.parse_args()
    print(json.dumps(audit(args.old, args.new, args.output), ensure_ascii=False))


if __name__ == '__main__':
    main()
