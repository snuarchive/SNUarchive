"""Read verified Priority A raw archives with the versioned offline extractor.

Enrollment metadata is provenance only. It is never prepended to review text or
used to fill an assessment's year/semester. Existing extractor abstentions stay.
"""
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
import argparse
import json
import os

from crawler.everytime_collect.raw import read_document, digest
from crawler.everytime_collect.run_v2 import require
from crawler.everytime_stats.extract import RULE_VERSION, extract_comment
from crawler.everytime_stats.evaluate import code_fingerprint
from .campaign import committed_snapshot, plan, read
from .storage import ROOT, write_new, sha, load_archive
from .archived_files import read_bytes


@dataclass(frozen=True)
class RawReview:
    title: str
    instructor: str
    text: str
    file_name: str
    file_sha256: str
    review_index: int
    page_url: str
    enrollment_term_raw: str | None
    enrollment_field_evidence: dict | None
    collection_complete: bool

    @property
    def pointer(self):
        return f'/reviews/{self.review_index}'

    def source(self):
        return {'type': 'everytime_browser_raw', 'file': self.file_name, 'file_sha256': self.file_sha256,
                'json_pointer': self.pointer, 'comment_sha256': digest(self.text.encode('utf-8')),
                'source_url': self.page_url, 'enrollment_term_raw': self.enrollment_term_raw,
                'enrollment_field_evidence': self.enrollment_field_evidence,
                'enrollment_is_assessment_term': False, 'collection_complete': self.collection_complete}


def extract_raw_review(doc, index, file_name, file_hash, *, complete):
    review = doc['reviews'][index]
    comment = RawReview(doc['course']['title_raw'], doc['course']['instructor_raw'], review['text_raw'],
                        file_name, file_hash, index, doc['capture']['page_url'], review['enrollment_term_raw'],
                        review['field_evidence'].get('enrollment_term_raw'), complete)
    # Passing untouched body text is the temporal boundary; no collector date is
    # supplied to the parser, even when it would make more records accepted.
    result = extract_comment(comment)
    return result


def extract_campaign(campaign, destination):
    campaign, destination = Path(campaign).resolve(), Path(destination).resolve()
    require(destination.parent == ROOT.resolve() and not destination.exists(), 'Use new isolated extraction output')
    p = plan(campaign)
    entries = {e['item_id']: e for e in p['entries']}
    snapshot, checkpoint = committed_snapshot(campaign)
    require(any(v.get('report') for _, v in snapshot.values()), 'No verified Priority A raw archives available')
    inputs = {str(campaign / 'plan.json'): sha(campaign / 'plan.json'), str(checkpoint.resolve()): sha(checkpoint)}
    archives = []
    for item_id, (receipt, value) in snapshot.items():
        if value['status'] in ('complete', 'empty', 'partial') and value.get('report'):
            inputs[str(receipt.resolve())] = sha(receipt)
            archives.append({'item_id': item_id, 'course': entries[item_id]['course'], 'report': value['report']})
    return extract_archives(archives, inputs, destination, priority='A', remaining=len(entries) - len(snapshot))


def extract_archives(archives, inputs, destination, *, priority, remaining):
    """Extract a fixed verified archive selection; never follow a moving queue."""
    destination = Path(destination).resolve()
    require(destination.parent == ROOT.resolve() and not destination.exists(), 'Use new isolated extraction output')
    require(len({a['course']['course_key'] for a in archives}) == len(archives), 'Repeated course archive')
    outputs = {'accepted': [], 'review_required': [], 'excluded': []}
    counts, classifications, enrollment_coverage = Counter(), Counter(), Counter()
    references = []
    for archive in archives:
        item_id = archive['item_id']
        report_path = Path(archive['report'])
        _, verified = load_archive(report_path)
        inputs.update(verified)
        report = read(report_path)
        course = archive['course']
        require(report['ui_observation']['target']['title'] == course['title'] and
                report['ui_observation']['target']['instructor'] == course['instructor'], 'Course archive differs from Priority A entry')
        complete = report['ui_observation']['status'] == 'complete'
        counts['courses'] += 1
        counts['complete_courses' if complete else 'partial_courses'] += 1
        for batch in report['batches']:
            if batch['raw_sha256'] is None:
                continue
            raw = report_path.parent / batch['directory'] / 'raw.json'
            raw_bytes = read_bytes(raw)
            doc = read_document(raw_bytes)
            require(digest(raw_bytes) == batch['raw_sha256'], 'Raw changed during extraction')
            for index, review in enumerate(doc['reviews']):
                result = extract_raw_review(doc, index, str(raw.resolve()), digest(raw_bytes), complete=complete)
                counts['reviews'] += 1
                enrollment_coverage['present' if review['enrollment_term_raw'] is not None else 'missing'] += 1
                classifications[result['classification']] += 1
                for record in result['records']:
                    record['priority_reference'] = {'item_id': item_id, 'course_key': course['course_key'],
                                                    'course_key_role': 'matching_identifier_not_database_id'}
                    outputs[record['status']].append(record)
                    if record['year'] is None or record['semester'] is None:
                        counts['candidates_with_unresolved_term'] += 1
                if result['excluded']:
                    outputs['excluded'].append(result['excluded'])
                references.append({'item_id': item_id, 'raw': str(raw.resolve()), 'sha256': digest(raw_bytes),
                                   'review_index': index, 'classification': result['classification'],
                                   'assessment_candidates': len(result['records'])})
    destination.mkdir(parents=True, exist_ok=False)
    for name, values in outputs.items():
        with (destination / f'{name}.jsonl').open('x', encoding='utf-8', newline='\n') as stream:
            for value in values:
                stream.write(json.dumps(value, ensure_ascii=False, allow_nan=False) + '\n')
            stream.flush()
            os.fsync(stream.fileno())
    write_new(destination / 'review_sources.json', references)
    require(all(sha(file) == checksum for file, checksum in inputs.items()), 'An extraction source changed')
    summary = {'rule_version': RULE_VERSION, 'extractor_code': code_fingerprint(), 'input_snapshot': inputs,
               'priority': priority, 'counts': dict(counts), 'review_classifications': dict(classifications),
               'output_rows': {key: len(values) for key, values in outputs.items()},
               'enrollment_term_coverage': dict(enrollment_coverage),
               'temporal_policy': 'Only review body evidence is passed to extractor; enrollment term never fills year/semester',
               'database_imported': False, 'raw_merged_or_deleted': False,
               'remaining_unprocessed_items_at_snapshot': remaining,
               'validation_scope': 'Versioned extractor rules plus raw/evidence checks; not human-reviewed ground truth'}
    write_new(destination / 'summary.json', summary)
    write_new(destination / 'manifest.json', {'files': {f.name: sha(f) for f in destination.iterdir() if f.is_file()}})
    return {key: summary[key] for key in ('rule_version', 'counts', 'output_rows', 'remaining_unprocessed_items_at_snapshot')}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--campaign', required=True)
    p.add_argument('--output', required=True)
    a = p.parse_args()
    print(json.dumps(extract_campaign(a.campaign, a.output), ensure_ascii=False))


if __name__ == '__main__':
    main()
