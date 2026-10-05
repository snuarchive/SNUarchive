"""Offline audit of one immutable Priority A checkpoint; prints counts only."""
from collections import Counter
from pathlib import Path
import argparse
import json

from crawler.everytime_collect.raw import read_document, canonical
from crawler.everytime_collect.run_v2 import require
from .campaign import committed_snapshot, plan, read
from .storage import ROOT, write_new, sha, load_archive


def audit(campaign, destination):
    campaign, destination = Path(campaign).resolve(), Path(destination).resolve()
    require(destination.parent == ROOT.resolve() and not destination.exists(), 'Use a new audit output')
    p = plan(campaign)
    snapshot, checkpoint = committed_snapshot(campaign)
    states, counts, terms, urls = Counter(), Counter(), Counter(), Counter()
    items, unresolved = [], []
    source_files = {str(campaign/'plan.json'): sha(campaign/'plan.json'), str(checkpoint): sha(checkpoint)}
    for entry in p['entries']:
        item = entry['item_id']
        if item not in snapshot:
            states['pending'] += 1
            unresolved.append({'item_id': item, 'status': 'pending'})
            continue
        receipt, value = snapshot[item]
        source_files[str(receipt)] = sha(receipt)
        states[value['status']] += 1
        counts['reused_computer_use_courses'] += bool(value.get('reused'))
        counts['adopted_validated_courses'] += bool(value.get('adopted_after_baseline_validation'))
        if value['status'] not in ('complete', 'empty'):
            unresolved.append({'item_id': item, 'status': value['status'], 'match_status': value.get('match_status'),
                               'reason': value.get('reason'), 'report': value.get('report')})
        if not value.get('report'):
            continue
        report_file = Path(value['report'])
        report = read(report_file)
        records, files = load_archive(report_file)
        source_files.update(files)
        ui = report['ui_observation']
        require(ui['target']['title'] == entry['course']['title'] and
                ui['target']['instructor'] == entry['course']['instructor'], 'Audit course differs from catalog')
        require(len(records) == value['reviews_saved'], 'Receipt review count differs from archive')
        if value['status'] in ('complete', 'empty'):
            require(ui['status'] == 'complete' and ui['displayed_total']['value'] == len(records), 'Complete count mismatch')
        counts['reviews_saved_or_reused'] += len(records)
        unique = Counter(canonical(r['fingerprint']) for r in records)
        duplicates = sum(n-1 for n in unique.values())
        counts['duplicate_review_occurrences_within_course'] += duplicates
        terms.update('missing' if r['enrollment_term_raw'] is None else 'present' for r in records)
        urls[ui['target']['url']] += 1
        for batch in report['batches']:
            if batch['raw_sha256'] is None:
                continue
            doc = read_document((report_file.parent/batch['directory']/'raw.json').read_bytes())
            for review in doc['reviews']:
                require(all(review[field] is None for field in ('source_id','created_at_raw','updated_at_raw')),
                        'Unobserved review ID or timestamps were filled')
                require('text_raw' in review['field_evidence'], 'Review body evidence missing')
                if review['enrollment_term_raw'] is not None:
                    require('enrollment_term_raw' in review['field_evidence'], 'Term evidence missing')
        items.append({'item_id': item, 'status': value['status'], 'target': ui['target'],
                      'displayed_count': ui['displayed_total']['value'] if ui['displayed_total'] else None,
                      'saved_count': len(records), 'duplicate_occurrences': duplicates,
                      'report': str(report_file), 'report_sha256': sha(report_file),
                      'termination_reason': ui['termination_reason'], 'limits': ui['limits']})
    require(sum(states.values()) == len(p['entries']) == 229, 'Priority A audit coverage mismatch')
    require(all(sha(file) == checksum for file, checksum in source_files.items()), 'Audit sources changed')
    result = {'priority':'A', 'checkpoint': str(checkpoint), 'states': dict(states), 'counts':dict(counts),
              'enrollment_term_coverage':dict(terms), 'duplicate_source_urls': {url:n for url,n in urls.items() if n>1},
              'raw_schema_and_field_evidence_validated':True, 'review_id_and_timestamps_still_null':True,
              'checksum_validation':'passed', 'database_writes':0,
              'baseline_source_files':p['baseline_files'], 'source_files':source_files}
    write_new(destination/'summary.json', result)
    write_new(destination/'courses.json', items)
    write_new(destination/'unresolved.json', unresolved)
    write_new(destination/'manifest.json', {'files':{f.name:sha(f) for f in destination.iterdir() if f.is_file()}})
    return {key:result[key] for key in ('states','counts','enrollment_term_coverage','checksum_validation')}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--campaign',required=True)
    parser.add_argument('--output',required=True)
    a=parser.parse_args()
    print(json.dumps(audit(a.campaign,a.output),ensure_ascii=False))


if __name__=='__main__':
    main()
