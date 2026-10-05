"""Build a local review/import candidate dataset. No DB client or writes.

Extractor acceptance is not human approval. Keep every candidate and conflict,
leave all database identities and contributor/provenance policy unresolved.
"""
from collections import Counter, defaultdict
from copy import deepcopy
from decimal import Decimal
from pathlib import Path
import argparse
import json
import os
import re

from crawler.everytime_collect.raw import canonical, digest, fingerprints, read_document
from crawler.everytime_collect.run_v2 import require
from crawler.everytime_stats.models import FIELDS
from crawler.everytime_stats.validate import check_evidence, validate_record, candidate_tier
from .storage import ROOT, sha, write_new
from .full_campaign import read  # Corpus manifests can exceed the small browser observation limit.
from .schema_contract import SCHEMA_FILE, SCHEMA_SHA256, SCHEMA_PROFILE, verify_schema, assessment_projection


def database_shape_issues(record):
    """Mirror the user-selected root SQL contract without inventing DB values."""
    reasons = []
    year, semester = record['year'], record['semester']
    if type(year) is not int or not 1980 <= year <= 2200:
        reasons.append('database_year_unresolved_or_out_of_range')
    if type(semester) is not int or not 1 <= semester <= 4:
        reasons.append('database_semester_unresolved_or_out_of_range')
    _, assessment_issues = assessment_projection(record['assessment'])
    reasons.extend(assessment_issues)
    for name, value in record['statistics'].items():
        if value is not None:
            decimal = Decimal(str(value))
            if not decimal.is_finite() or abs(decimal) > Decimal('9999.99') or decimal != decimal.quantize(Decimal('.01')):
                reasons.append('database_numeric_precision_' + name)
    if not any(value is not None for value in record['statistics'].values()):
        reasons.append('no_mappable_population_statistic')
    return reasons


def candidate(record, doc, review_index):
    """Validate unchanged evidence and preserve nullable values and original status."""
    review = doc['reviews'][review_index]
    require(record['course_title'] == doc['course']['title_raw'] and record['instructor'] == doc['course']['instructor_raw'],
            'Candidate course differs from raw')
    source = record['source']
    require(source['source_url'] == doc['capture']['page_url'] and
            source['enrollment_term_raw'] == review['enrollment_term_raw'], 'Candidate provenance differs from raw')
    require(source['comment_sha256'] == digest(review['text_raw'].encode('utf-8')), 'Review text checksum differs')
    check_evidence(record, review['text_raw'])
    checked = validate_record(deepcopy(record))
    require(checked['status'] == record['status'] and checked['review_reasons'] == record['review_reasons'],
            'Candidate no longer satisfies extractor validation')
    reasons = set(record['review_reasons']) | set(database_shape_issues(record))
    if not source['collection_complete']:
        reasons.add('partial_collection')
    label, assessment_issues = assessment_projection(record['assessment'])
    return {'candidate_schema_version': 2, 'candidate_id': record['record_id'], 'extraction': deepcopy(record),
            'target_schema': {'profile': SCHEMA_PROFILE, 'sha256': SCHEMA_SHA256},
            'review_fingerprints': fingerprints(doc, review), 'candidate_tier': candidate_tier(record),
            'dataset_review_reasons': sorted(reasons), 'human_review_status': 'unreviewed',
            'duplicate_group_ids': [], 'conflict_group_ids': [],
            'database_mapping': {'course_id': None, 'assessment_id': None, 'type_id': None,
                                 'contributor_id': None, 'source': None, 'source_report_id': None},
            'database_projection': {'assessment_type_label': label,
                                    'stat_reports': {'year': record['year'], 'semester': record['semester'],
                                                     **deepcopy(record['statistics']), 'note': None},
                                    'original_assessment': deepcopy(record['assessment'])},
            'import_blockers': ['human_review_pending', 'database_identity_resolution_required',
                               'source_attribution_policy_required', *assessment_issues],
            'ready_for_database_write': False}


def annotate_groups(rows):
    """Flag multiplicity and disagreements; never combine or drop source rows."""
    by_review, by_values, by_sitting = defaultdict(list), defaultdict(list), defaultdict(list)
    for row in rows:
        r, fp = row['extraction'], row['review_fingerprints']
        source = r['source']
        occurrence = (source['file'], source['json_pointer'])
        by_review[(fp['course_comparison_sha256'], fp['content_sha256'])].append((row, occurrence))
        identity = (r['priority_reference']['course_key'], r['year'], r['semester'],
                    r['assessment']['kind'], r['assessment']['number'], r['scope'], r['component'])
        # Unknown dates are not evidence that two reports describe the same exam.
        if r['year'] is None or r['semester'] is None or r['assessment']['kind'] is None:
            continue
        by_sitting[identity].append(row)
        by_values[canonical([identity, r['statistics'], r['observed_max']])].append(row)
    groups = []
    def add(kind, members, *, fields=None):
        ids = sorted(r['candidate_id'] for r in members)
        group_id = digest(canonical([kind, ids]))[:24]
        groups.append({'group_id': group_id, 'kind': kind, 'candidate_ids': ids, 'fields': fields or [],
                       'resolution': 'unreviewed', 'automatically_merged_or_deleted': False})
        for row in members:
            key = 'conflict_group_ids' if kind == 'conflicting_population_values' else 'duplicate_group_ids'
            row[key].append(group_id)
            row['dataset_review_reasons'] = sorted(set(row['dataset_review_reasons']) | {kind})
    for members in by_review.values():
        if len({occurrence for _, occurrence in members}) > 1:
            add('possible_duplicate_review', [row for row, _ in members])
    for members in by_values.values():
        if len(members) > 1:
            add('possible_duplicate_statistic', members)
    for members in by_sitting.values():
        fields = [field for field in FIELDS if len({Decimal(str(row['extraction']['statistics'][field]))
                  for row in members if row['extraction']['statistics'][field] is not None}) > 1]
        if fields:
            add('conflicting_population_values', members, fields=fields)
    return groups


def write_jsonl(path, rows):
    with Path(path).open('x', encoding='utf-8', newline='\n') as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + '\n')
        stream.flush()
        os.fsync(stream.fileno())


def build(extraction, destination):
    extraction, destination = Path(extraction).resolve(), Path(destination).resolve()
    schema_inputs = verify_schema()
    require(extraction.parent == ROOT.resolve(), 'Expected isolated extractor output')
    require(destination.parent == ROOT.resolve() and not destination.exists(), 'Use new candidate output')
    manifest = read(extraction / 'manifest.json')
    require(all(sha(extraction / file) == checksum for file, checksum in manifest['files'].items()), 'Extraction checksum mismatch')
    summary = read(extraction / 'summary.json')
    require(all(sha(file) == checksum for file, checksum in summary['input_snapshot'].items()), 'Extraction sources changed')
    inputs = {**summary['input_snapshot'],
              **{str(extraction / file): checksum for file, checksum in manifest['files'].items()},
              str(extraction / 'manifest.json'): sha(extraction / 'manifest.json'),
              **schema_inputs}
    documents, rows, mention_rows, excluded = {}, [], [], []
    for bucket in ('accepted', 'review_required', 'excluded'):
        file = extraction / (bucket + '.jsonl')
        inputs[str(file)] = sha(file)
        for line in file.read_text(encoding='utf-8').splitlines():
            record = json.loads(line)
            if bucket == 'excluded':
                excluded.append(record)
                continue
            source = record['source']
            raw = Path(source['file'])
            if str(raw) not in documents:
                require(sha(raw) == source['file_sha256'] == summary['input_snapshot'][str(raw)], 'Unverified raw source')
                documents[str(raw)] = read_document(raw.read_bytes())
            require(source['file_sha256'] == summary['input_snapshot'][str(raw)], 'Candidate raw reference changed')
            pointer = re.fullmatch(r'/reviews/(\d+)', source['json_pointer'])
            require(pointer is not None, 'Invalid raw review pointer')
            row = candidate(record, documents[str(raw)], int(pointer[1]))
            (mention_rows if row['candidate_tier'] == 'mention_only' else rows).append(row)
    require(len({r['candidate_id'] for r in rows + mention_rows}) == len(rows + mention_rows), 'Repeated candidate IDs')
    groups = annotate_groups(rows)
    auto_validated = [r for r in rows if not r['dataset_review_reasons']]
    review_required = [r for r in rows if r['dataset_review_reasons']]
    destination.mkdir(parents=True, exist_ok=False)
    for name, values in [('import_candidates', rows), ('auto_validated', auto_validated),
                         ('review_required', review_required), ('mention_review', mention_rows), ('excluded', excluded)]:
        write_jsonl(destination / (name + '.jsonl'), values)
    write_new(destination / 'duplicate_conflict_groups.json', groups)
    reason_counts = Counter(reason for row in rows for reason in row['dataset_review_reasons'])
    result = {'priority': summary['priority'], 'source_extraction': str(extraction), 'input_files': inputs,
              'raw_review_count': summary['counts']['reviews'], 'candidate_count': len(rows),
              'auto_validated_candidates': len(auto_validated), 'review_required_candidates': len(review_required),
              'mention_only_candidates': len(mention_rows), 'excluded_reviews': len(excluded),
              'review_reasons': dict(reason_counts), 'duplicate_conflict_groups': len(groups),
              'database_write_count': 0, 'database_client_used': False, 'ready_for_database_write': 0,
              'course_key_is_database_id': False, 'enrollment_term_imputed': False,
              'human_review_status': 'unreviewed', 'schema_reference_sha256': SCHEMA_SHA256,
              'target_schema_profile': SCHEMA_PROFILE, 'schema_reference_file': str(SCHEMA_FILE),
              'candidate_schema_version': 2,
              'remaining_unprocessed_items': summary['remaining_unprocessed_items_at_snapshot']}
    require(all(sha(file) == checksum for file, checksum in inputs.items()), 'Candidate inputs changed')
    write_new(destination / 'summary.json', result)
    write_new(destination / 'manifest.json', {'files': {f.name: sha(f) for f in destination.iterdir() if f.is_file()}})
    return {k: result[k] for k in ('candidate_count', 'auto_validated_candidates', 'review_required_candidates',
            'mention_only_candidates', 'duplicate_conflict_groups', 'database_write_count')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--extraction', required=True)
    parser.add_argument('--output', required=True)
    a = parser.parse_args()
    print(json.dumps(build(a.extraction, a.output), ensure_ascii=False))


if __name__ == '__main__':
    main()
