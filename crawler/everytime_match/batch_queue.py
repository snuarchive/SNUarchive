"""Immutable bounded pilot queue; no browser/network driver and no extractor invocation."""
from collections import defaultdict
from copy import deepcopy
from pathlib import Path
import argparse
import json

from crawler.everytime_collect.run_v2 import private_json, require
from .matching import match_course, collector_target, write_new_json

MAX_PILOT_COURSES = 30


def select_pilot(catalog, keys):
    require(20 <= len(keys) <= MAX_PILOT_COURSES and len(set(keys)) == len(keys),
            "Pilot requires 20..30 distinct explicit catalog keys")
    rows = []
    for key in keys:
        found = [c for c in catalog if c.get("course_key") == key]
        require(len(found) == 1, "Catalog key is missing or ambiguous")
        c = found[0]
        require(isinstance(c.get("title"), str) and c["title"].strip(), "Input title missing")
        require(c.get("instructor") is None or isinstance(c["instructor"], str), "Invalid input professor")
        rows.append(deepcopy(c))
    return rows


def build_queue(courses, searches, *, stop=None):
    require(20 <= len(courses) <= MAX_PILOT_COURSES, "Pilot scope exceeded")
    require(len({c['course_key'] for c in courses}) == len(courses), "Duplicate input key")
    by_query = defaultdict(list)
    for e in searches:
        require(e.get("evidence_version") == 2 and e.get("mode") == "name", "Pilot needs observed search v2")
        require(e['query'] in {c['title'] for c in courses}, "Search outside selected pilot")
        by_query[e['query']].append(e)
    require(all(len(v) == 1 for v in by_query.values()), "Repeated search evidence; do not select the convenient result")
    records, unattempted = [], []
    for c in courses:
        if c['title'] not in by_query:
            unattempted.append(deepcopy(c))
            continue
        records.append(match_course(c, by_query[c['title']][0]))
    require(not unattempted or isinstance(stop, str) and bool(stop), "Missing searches need a recorded interruption")
    owners = defaultdict(list)
    identities = defaultdict(list)
    for r in records:
        if r['status'] == 'matched':
            owners[collector_target(r)['url']].append(r)
            identities[(r['input']['title'], r['input'].get('instructor'))].append(r)
    conflicts = []
    for url, group in owners.items():
        if len(group) > 1:
            conflicts.append({'kind': 'url_multiple_inputs', 'url': url,
                              'course_keys': [r['input']['course_key'] for r in group]})
    for pair, group in identities.items():
        if len({r['collector_target']['url'] for r in group}) > 1:
            conflicts.append({'kind': 'input_multiple_urls', 'input_title': pair[0], 'input_instructor': pair[1],
                              'course_keys': [r['input']['course_key'] for r in group]})
    held = {k for conflict in conflicts for k in conflict['course_keys']}
    for r in records:
        if r['input']['course_key'] in held:
            r.update(status='ambiguous', reason='batch_identity_collision', collector_target=None,
                     collection_status='not_collected')
    collection, review = [], []
    for r in records:
        if r['status'] == 'matched':
            collection.append({'course_key': r['input']['course_key'], 'target': collector_target(r),
                               'state': 'queued', 'match': r})
        else:
            review.append({'course_key': r['input']['course_key'], 'state': 'needs_review', 'match': r})
    require(len({r['target']['url'] for r in collection}) == len(collection), "Queue URL collision")
    return {'queue_version': 1, 'input_count': len(courses), 'searched_inputs': len(records),
            'search_submissions': len(searches), 'status': 'stopped' if stop else 'ready', 'stop_reason': stop,
            'counts': {s: sum(r['status'] == s for r in records) for s in ('matched', 'ambiguous', 'not_found')},
            'collection_queue': collection, 'review_queue': review, 'unattempted_inputs': unattempted,
            'identity_conflicts': conflicts, 'input_multiple_exact_urls': [r['input']['course_key'] for r in records
                  if r['reason'] == 'multiple_exact_candidates'],
            'limits': {'input_courses': MAX_PILOT_COURSES, 'search_scrolls': 12, 'search_candidates': 160,
                       'search_wait_ms': 2000, 'search_total_seconds': 60, 'collector_scrolls': 12,
                       'collector_batches': 20, 'collector_batch_size': 20}}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--selection', required=True)
    p.add_argument('--searches', required=True)
    p.add_argument('--output', required=True, help='New private folder')
    p.add_argument('--stop-reason')
    a = p.parse_args()
    _, _, selection = private_json(a.selection)
    _, _, searches = private_json(a.searches)
    catalog = json.loads(Path(selection['catalog']).read_text(encoding='utf-8'))
    courses = select_pilot(catalog, [c['course_key'] for c in selection['courses']])
    require(courses == selection['courses'], 'Catalog changed since selection')
    queue = build_queue(courses, searches, stop=a.stop_reason)
    destination = Path(a.output)
    require(not destination.exists(), 'Queue folder exists; never overwrite')
    write_new_json(destination/'batch_queue.json', queue)
    write_new_json(destination/'collection_queue.json', queue['collection_queue'])
    write_new_json(destination/'review_queue.json', queue['review_queue'])
    print(json.dumps({'input_count': queue['input_count'], **queue['counts'], 'status': queue['status']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
