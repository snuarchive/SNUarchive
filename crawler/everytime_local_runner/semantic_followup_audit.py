"""Offline 0.1.8 comparison against immutable 0.1.7 and followup_A evidence.

Candidate lineage uses exact source occurrence and retained evidence, not title,
position in a file, or numerical coincidence. This produces review queues, never
human approvals. Existing extraction, followup and raw artifacts are read only.
"""
import argparse
import json
from collections import Counter, defaultdict
from html import escape
from pathlib import Path

from crawler.everytime_collect.run_v2 import require
from crawler.everytime_stats.models import digest
from crawler.everytime_stats.validate import check_evidence
from .candidate_review import verify_spans
from .campaign import read
from .import_candidates import write_jsonl
from .quality_audit import lines, meaning as original_meaning, occurrence, packet, triage as prior_triage
from .storage import ROOT, sha, write_new

CATEGORIES = ('structure_clean', 'term_missing_only', 'approximate_or_bound', 'malformed_numeric',
              'assessment_ambiguous', 'score_scale_ambiguous', 'multiple_observations_needs_split',
              'other_review_required')
VALUE_KEYS = ('statistics', 'observed_max', 'assessment', 'scope', 'component', 'year', 'semester')
APPROXIMATE = {'approximate_or_bound', 'approximate_value', 'uncertain_value', 'hypothetical_value'}


def meaning(record):
    def strip_version(value):
        if isinstance(value, dict):
            return {k: strip_version(v) for k, v in value.items() if k != 'rule_version'}
        if isinstance(value, list):
            return [strip_version(v) for v in value]
        return value
    return strip_version(original_meaning(record))


def numeric(r):
    return any(v is not None for v in r['statistics'].values()) or r['observed_max'] is not None


def active_evidence(r):
    return [e for e in r['evidence'] if e.get('value') is not None and
            (r['observed_max'] if e.get('field') == 'observed_max' else r['statistics'].get(e.get('field'))) == e['value']]


def token(e):
    return e['start'], e['end'], e.get('field'), e.get('value')


def successors(old, new_records):
    """Return retained value owners, or exact-ID/withheld-evidence successors."""
    local = [r for r in new_records if occurrence(old) == occurrence(r)]
    evidence = {token(e) for e in active_evidence(old)}
    owners = [r for r in local if evidence & {token(e) for e in active_evidence(r)}]
    stable = [r for r in owners if r['record_id'] == old['record_id'] and
              evidence <= {token(e) for e in active_evidence(r)}]
    if stable:
        # "중간/기말 모두" may legitimately share the same evidence span.
        # An unchanged owner is not a split into both pre-existing records.
        return stable
    if owners:
        return owners
    same_id = [r for r in local if r['record_id'] == old['record_id']]
    if same_id:
        return same_id
    return [r for r in local if any(c['start'] <= e['start'] and e['end'] <= c['end']
                                  for c in r['candidates'] for e in active_evidence(old))]


def triage(row):
    result = prior_triage(row)
    r = row['extraction']; reasons = set(row['dataset_review_reasons'])
    if 'malformed_numeric' in reasons:
        result['category'] = 'malformed_numeric'
    elif result['category'] != 'score_scale_ambiguous' and reasons & APPROXIMATE:
        result['category'] = 'approximate_or_bound'
    elif 'question_level_maximum' in reasons:
        result['category'] = 'assessment_ambiguous'
    result['requires_content_review'] = result['category'] not in ('structure_clean', 'term_missing_only')
    result['route'] = 'content_review' if result['requires_content_review'] else 'term_linker' if result['category'] == 'term_missing_only' else 'approval_queue'
    result['classification_is_human_approval'] = False
    return result


def body_for(r, cache):
    s = r['source']
    if s['file'] not in cache:
        require(sha(s['file']) == s['file_sha256'], 'Raw file changed')
        cache[s['file']] = read(s['file'])
    text = cache[s['file']]['reviews'][int(s['json_pointer'].rsplit('/', 1)[1])]['text_raw']
    require(digest(text.encode('utf-8')) == s['comment_sha256'], 'Raw text changed')
    return text


def identity_matches(r, proposal):
    aliases = {'assessment_kind': 'kind', 'assessment_number': 'number'}
    for key, value in proposal.items():
        key = aliases.get(key, key)
        actual = r['assessment'].get(key) if key in ('kind', 'number') else r.get(key)
        if actual != value:
            return False
    return True


def issue_resolved(old, records, finding):
    proposal = dict(finding['proposed_change'])
    field = proposal.pop('withhold_field', proposal.pop('withhold_whole_exam_field', None))
    links = successors(old, records)
    if field:
        erroneous = {token(e) for e in active_evidence(old) if e['field'] == field}
        if any(erroneous & {token(e) for e in active_evidence(r)} for r in records):
            return False
        # The evidence must remain in a withheld packet; dropping a record is
        # not a semantic fix. Match actual spans, including the qualifier.
        for e in active_evidence(old):
            if e['field'] == field and not any(c['start'] <= e['start'] and e['end'] <= c['end']
                                               for r in links for c in r['candidates']):
                return False
    if proposal.get('scope') == 'unresolved':
        proposal['scope'] = 'unknown'
    return bool(links) and (not proposal or all(identity_matches(r, proposal) for r in links))


def audit(old_path, new_path, followup_path, destination):
    old_path, new_path, followup_path, destination = [Path(p).resolve() for p in (old_path, new_path, followup_path, destination)]
    require(all(p.parent == ROOT.resolve() for p in (old_path, new_path, followup_path, destination)), 'Use isolated output paths')
    require(not destination.exists(), 'Output must be new')
    osummary, oi = packet(old_path); nsummary, ni = packet(new_path); _, fi = packet(followup_path)
    oe, oei = packet(osummary['source_extraction']); ne, nei = packet(nsummary['source_extraction'])
    require(oe['input_snapshot'] == ne['input_snapshot'], 'Raw snapshots differ')
    require(ne['counts']['reviews'] == 5753 and oe['rule_version'] == '0.1.7' and ne['rule_version'] == '0.1.8', 'Wrong campaign or versions')
    inputs = {**oi, **ni, **fi, **oei, **nei, str(Path(__file__).resolve()): sha(__file__)}
    old_rows = lines(old_path / 'import_candidates.jsonl')
    new_numeric = lines(new_path / 'import_candidates.jsonl')
    new_all = new_numeric + lines(new_path / 'mention_review.jsonl')
    new_by_id = {r['candidate_id']: r for r in new_all}
    old_by_id = {r['candidate_id']: r for r in old_rows}
    groups = defaultdict(list)
    for row in new_all:
        groups[occurrence(row['extraction'])].append(row['extraction'])
    links = {row['candidate_id']: successors(row['extraction'], groups[occurrence(row['extraction'])]) for row in old_rows}
    require(all(links.values()), 'An old numeric candidate lost all evidence successors')
    core_ids = {r['candidate_id'] for r in new_numeric}
    core_ids.update(r['record_id'] for rr in links.values() for r in rr)
    core_ids.update(r['candidate_id'] for r in new_all if r['extraction'].get('score_scale_note'))
    triaged = [triage(r) for r in new_all if r['candidate_id'] in core_ids]
    all_triaged = [triage(r) for r in new_all]
    counts = {k: sum(r['category'] == k for r in triaged) for k in CATEGORIES}

    transitions, removed_fields, attributions, merges = [], [], [], []
    parent_map = defaultdict(set)
    cache = {}
    for row in old_rows:
        old = row['extraction']; target = links[row['candidate_id']]
        local = groups[occurrence(old)]
        exact = {token(e) for r in local for e in active_evidence(r)}
        lost = []
        for e in active_evidence(old):
            if token(e) not in exact:
                lost.append(e)
                removed_fields.append({'candidate_id': row['candidate_id'], 'field': e['field'], 'old_value': e['value'],
                                       'new_value': None, 'evidence': e,
                                       'successors': [r['record_id'] for r in target],
                                       'withholding_evidence': [c for r in target for c in r['candidates'] if c['start'] <= e['start'] and e['end'] <= c['end']]})
        moved = []
        for r in target:
            if numeric(r):
                parent_map[r['record_id']].add(row['candidate_id'])
            if active_evidence(r) and any(old[k] != r[k] for k in ('assessment', 'scope', 'component')):
                common = {token(e) for e in active_evidence(old)} & {token(e) for e in active_evidence(r)}
                if common:
                    moved.append(r['record_id'])
        if moved:
            attributions.append({'candidate_id': row['candidate_id'], 'successors': moved,
                                 'before': {k: old[k] for k in ('assessment', 'scope', 'component')},
                                 'after': [{k: r[k] for k in ('record_id', 'assessment', 'scope', 'component', 'context_evidence')} for r in target if r['record_id'] in moved]})
        transitions.append({'candidate_id': row['candidate_id'], 'successors': [r['record_id'] for r in target],
                            'old_numeric': True, 'new_numeric': any(numeric(r) for r in target),
                            'nulled_fields': sorted({e['field'] for e in lost}), 'attribution_changed': bool(moved),
                            'source': old['source'], 'original': row,
                            'new': [new_by_id[r['record_id']] for r in target]})
    for cid, parents in parent_map.items():
        if len(parents) > 1:
            merges.append({'candidate_id': cid, 'parents': sorted(parents), 'reason': 'Retained evidence now shares an explicit assessment; not a DB merge'})
    split = [x for x in transitions if sum(numeric(r['extraction']) for r in x['new']) > 1]

    screening, regressions = [], []
    for row in lines(followup_path / 'content_screening.jsonl'):
        old = row['original_triage']['candidate']['extraction']; decision = row['assistant_screening']
        body = body_for(old, cache); local = groups[occurrence(old)]; target = successors(old, local)
        require(target, 'A screened case lost its evidence')
        verify_spans(decision['evidence'], body)
        for f in decision['findings']:
            verify_spans(f['evidence'], body)
        same_values = len(target) == 1 and all(old[k] == target[0][k] for k in VALUE_KEYS)
        same_meaning = len(target) == 1 and meaning(old) == meaning(target[0])
        disposition = decision['disposition']
        resolved = None; improved = False
        if disposition == 'confirmed_semantic_issue':
            resolved = all(issue_resolved(old, local, f) for f in decision['findings'])
            require(resolved, 'A confirmed defect remains: ' + row['candidate_id'])
            regressions.append({'candidate_id': row['candidate_id'], 'original_text': body,
                                'original_source': old['source'], 'old_incorrect_extraction': old,
                                'expected_result_and_reason': decision['findings'],
                                'actual_successors': target, 'resolved': resolved})
        elif disposition == 'retained_fields_supported':
            require(same_values and same_meaning, 'Regression in supported case: ' + row['candidate_id'])
        elif disposition == 'assistant_proposal_needs_human_review':
            proposals = [f['proposed_change'] for f in decision['findings'] if f.get('proposed_change')]
            improved = not same_values and bool(proposals) and all(any(identity_matches(r, p) for r in target) for p in proposals)
        screening.append({'candidate_id': row['candidate_id'], 'previous_disposition': disposition,
                          'previous_screening': decision, 'successors': [r['record_id'] for r in target],
                          'retained_values_identity_terms_unchanged': same_values, 'all_meaning_fields_unchanged': same_meaning,
                          'confirmed_issue_resolved': resolved, 'proposal_automatically_improved': improved,
                          'still_requires_human_review': True, 'human_review_status': 'unreviewed',
                          'ready_for_database_write': False})
    require(len(regressions) == 14 and len(screening) == 188, 'Incomplete reviewed-case coverage')

    old_records = lines(Path(osummary['source_extraction']) / 'accepted.jsonl') + lines(Path(osummary['source_extraction']) / 'review_required.jsonl')
    old_groups = defaultdict(list)
    for r in old_records:
        old_groups[occurrence(r)].append(r)
    changed_reviews = []
    for key in sorted(old_groups.keys() | groups.keys()):
        before, after = old_groups[key], groups[key]
        # JSONL separates numeric and mention records, so compare by stable ID.
        if sorted([meaning(r) for r in before], key=lambda r: json.dumps(r, sort_keys=True)) == sorted([meaning(r) for r in after], key=lambda r: json.dumps(r, sort_keys=True)):
            continue
        body = body_for((before or after)[0], cache)
        for r in after:
            check_evidence(r, body)
        previous_reasons = {c['rule'] for r in before for c in r['candidates']}
        rules = sorted({c['rule'] for r in after for c in r['candidates']} - previous_reasons)
        if any(x['source'] == (before or after)[0]['source'] and x['attribution_changed'] for x in transitions):
            rules.append('explicit_clause_or_scope_correction')
        # Smaller evidence/record changes can accompany the same guard.
        require(rules, 'Unexplained change outside reviewed rule families')
        require({(r['year'], r['semester']) for r in before} == {(r['year'], r['semester']) for r in after}, 'Temporal inference changed')
        changed_reviews.append({'source': (before or after)[0]['source'], 'original_text': body,
                                'rules': rules, 'before': before, 'after': after})
    old_excluded = lines(Path(osummary['source_extraction']) / 'excluded.jsonl')
    new_excluded = lines(Path(nsummary['source_extraction']) / 'excluded.jsonl')
    require([{k:v for k,v in r.items() if k != 'rule_version'} for r in old_excluded] ==
            [{k:v for k,v in r.items() if k != 'rule_version'} for r in new_excluded], 'Exclusion behavior changed')
    content = [r for r in triaged if r['requires_content_review']]
    affected = [x for x in transitions if len(x['new']) != 1 or meaning(x['original']['extraction']) != meaning(x['new'][0]['extraction'])]
    nids = {r['candidate_id'] for r in new_numeric}
    summary = {
        'rule_version': '0.1.8', 'old_numeric_candidates': len(old_rows), 'new_numeric_candidates': len(new_numeric),
        'numeric_ids_disappeared': len(old_by_id.keys() - nids), 'numeric_ids_added': len(nids - old_by_id.keys()),
        'old_numeric_candidates_affected': len(affected), 'withheld_old_numeric_candidates': sum(not x['new_numeric'] for x in transitions),
        'false_exact_fields_removed': len(removed_fields), 'old_candidates_with_nulled_fields': len({r['candidate_id'] for r in removed_fields}),
        'assessment_or_scope_attribution_corrections': len(attributions),
        'assessment_kind_or_number_corrections': sum(any(a['assessment']['kind'] != x['before']['assessment']['kind'] or a['assessment']['number'] != x['before']['assessment']['number'] for a in x['after']) for x in attributions),
        'assessment_split_operations': len(split), 'assessment_merge_operations': len(merges),
        'changed_raw_reviews': len(changed_reviews), 'confirmed_issues_fixed': sum(r['resolved'] for r in regressions),
        'previous_screened_cases_rechecked': len(screening),
        'previous_proposals': sum(r['previous_disposition'] == 'assistant_proposal_needs_human_review' for r in screening),
        'proposals_automatically_improved': sum(r['proposal_automatically_improved'] for r in screening),
        'previous_supported_cases_preserved': sum(r['previous_disposition'] == 'retained_fields_supported' and r['all_meaning_fields_unchanged'] for r in screening),
        'screening_recheck_counts': dict(Counter((r['previous_disposition'] + ('/unchanged' if r['all_meaning_fields_unchanged'] else '/changed')) for r in screening)),
        'triage_units': len(triaged), 'triage_counts': counts,
        'triage_numeric_units': sum(r['numeric_candidate'] for r in triaged),
        'triage_withheld_units': sum(not r['numeric_candidate'] for r in triaged),
        'content_review_units': len(content), 'content_review_unique_raw_reviews': len({occurrence(r['candidate']['extraction']) for r in content}),
        'term_only_units': counts['term_missing_only'], 'all_units_human_unreviewed': len(triaged),
        'other_mention_only_units': len(all_triaged) - len(triaged),
        'all_extraction_record_triage_counts': dict(Counter(r['category'] for r in all_triaged)),
        'review_required': {'old_numeric': osummary['review_required_candidates'], 'new_numeric': nsummary['review_required_candidates'],
                            'old_all_extraction_records': oe['output_rows']['review_required'], 'new_all_extraction_records': ne['output_rows']['review_required'],
                            'new_review_reasons_on_previously_numeric': sum(bool(set(r['extraction']['review_reasons']) - set(x['original']['extraction']['review_reasons'])) for x in transitions for r in x['new']),
                            'newly_review_required_from_accepted': 0},
        'raw_reviews_verified': ne['counts']['reviews'], 'raw_files_verified': sum(Path(f).name == 'raw.json' for f in ne['input_snapshot']),
        'raw_snapshot_unchanged': True, 'excluded_reviews_unchanged': len(new_excluded),
        'human_approvals': 0, 'database_write_count': 0, 'term_proposals_applied': 0,
        'scope': 'Numeric candidate lineage plus withheld successors and prior scale packet. Other mention-only records have a separate full-extraction triage, not a claimed content review.',
        'limitations': ['Routing is not approval. The term-only queue also needs verification before use.',
                       'Fourteen known defects and 36 previously supported cases are not an independent accuracy/recall estimate.',
                       'The 24 proposals are not approvals and parser feature expansion was intentionally deferred.'],
        'input_files': inputs,
    }
    comparison = {'transitions': transitions, 'nulled_fields': removed_fields, 'attribution_changes': attributions,
                  'split_operations': split, 'merge_operations': merges,
                  'disappeared_numeric_ids': sorted(old_by_id.keys() - nids), 'new_numeric_ids': sorted(nids - old_by_id.keys())}
    require(all(sha(f) == h for f, h in inputs.items()), 'Input changed during audit')
    destination.mkdir()
    for name, data in [('summary.json', summary), ('comparison.json', comparison), ('regression_cases.json', regressions)]:
        write_new(destination / name, data)
    for name, data in [('triage', triaged), ('all_extraction_triage', all_triaged), ('rechecked_188', screening), ('changed_reviews', changed_reviews)]:
        write_jsonl(destination / (name + '.jsonl'), data)
    for category in CATEGORIES:
        write_jsonl(destination / (category + '.jsonl'), [r for r in triaged if r['category'] == category])
    html = render(summary, changed_reviews, screening)
    with (destination / 'review.html').open('x', encoding='utf-8') as stream:
        stream.write(html)
    write_new(destination / 'manifest.json', {'files': {p.name: sha(p) for p in destination.iterdir() if p.is_file()}})
    return {k: v for k, v in summary.items() if k != 'input_files'}


def render(summary, changes, screening):
    show = lambda value: escape(json.dumps(value, ensure_ascii=False, indent=2))
    sections = ''.join('<details><summary>' + escape((r['before'] or r['after'])[0]['course_title']) +
                       ' — ' + escape(', '.join(r['rules'])) + '</summary><pre>' + escape(r['original_text']) +
                       '</pre><h3>Before</h3><pre>' + show(r['before']) + '</pre><h3>After</h3><pre>' + show(r['after']) + '</pre></details>' for r in changes)
    return ('<!doctype html><meta charset="utf-8"><title>Priority A 0.1.8 audit</title>'
            '<style>body{max-width:1100px;margin:30px auto;font-family:system-ui}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{border:1px solid #ccc;padding:12px;margin:12px 0}</style>'
            '<h1>Priority A — 0.1.7 → 0.1.8</h1><p>Offline derivative; all human statuses remain unreviewed. No DB writes.</p><pre>' +
            show({k:v for k,v in summary.items() if k != 'input_files'}) + '</pre>' + sections +
            '<h2>188 case recheck</h2><pre>' + show(screening) + '</pre>')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--old', required=True); parser.add_argument('--new', required=True)
    parser.add_argument('--followup', required=True); parser.add_argument('--output', required=True)
    args = parser.parse_args()
    print(json.dumps(audit(args.old, args.new, args.followup, args.output), ensure_ascii=False))


if __name__ == '__main__':
    main()
