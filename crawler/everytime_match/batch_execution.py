"""Attach existing private collector archives to an immutable pilot queue."""
from copy import deepcopy
import argparse
import json

from crawler.everytime_collect.run_v2 import private_json, require
from .matching import attach_collection, write_new_json


def finish_queue(queue, reports, *, stop_reason=None):
    """reports maps course_key to (private report path, finalized collector archive)."""
    require(queue['status'] == 'ready' and 20 <= queue['input_count'] <= 30, 'Not a ready pilot')
    entries = queue['collection_queue']
    require(set(reports) <= {e['course_key'] for e in entries}, 'Report outside collection queue')
    result = deepcopy(queue)
    stopped = None
    gap = False
    complete = partial = total = failures = 0
    for e in result['collection_queue']:
        key = e['course_key']
        if key not in reports:
            e['state'] = 'pending'
            gap = True
            continue
        require(not gap and not stopped, 'Report after a gap/interruption; do not silently resume')
        path, archive = reports[key]
        report = archive['ui_observation']
        e['match'] = attach_collection(e['match'], report, path)
        require(archive['reviews_saved'] == report['succeeded'] and
                archive['review_failures'] == report['failed'], 'Archive counts differ from UI report')
        all_saved = report['final_loaded'] is not None and archive['reviews_saved'] == report['final_loaded'] and archive['review_failures'] == 0
        require(archive['all_observed_rows_saved'] is all_saved, 'Archive completeness flag disagrees')
        require(report['status'] != 'complete' or all_saved, 'Complete report has unsaved rows')
        e.update(state=report['status'], run_report=str(path), stored_reviews=archive['reviews_saved'],
                 duplicate_candidates=deepcopy(archive['duplicate_candidates']), all_observed_rows_saved=all_saved)
        total += archive['reviews_saved']
        failures += archive['review_failures']
        if report['status'] == 'complete':
            complete += 1
        else:
            partial += 1
            stopped = {'course_key': key, 'reason': report['stop_error'] or report['termination_reason']}
    require(not gap or stopped or stop_reason, 'Unexecuted queue needs a stop reason')
    result.update(status='stopped' if stopped or stop_reason else 'complete',
                  stop_reason=stopped or stop_reason,
                  collection_summary={'complete': complete, 'partial': partial,
                      'pending': len(entries) - complete - partial, 'reviews_saved': total,
                      'review_failures': failures})
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--queue', required=True)
    p.add_argument('--report', action='append', default=[])
    p.add_argument('--output', required=True)
    p.add_argument('--stop-reason')
    a = p.parse_args()
    _, _, queue = private_json(a.queue)
    require(len(a.report) <= 30, 'Too many course reports')
    by_target = {e['target']['url'] + '?tab=article': e['course_key'] for e in queue['collection_queue']}
    require(len(by_target) == len(queue['collection_queue']), 'Queue URL collision')
    reports = {}
    for value in a.report:
        path, _, archive = private_json(value)
        require(path.name == 'run_report.json', 'Use a finalized collector run report')
        key = by_target.get(archive['ui_observation']['target']['url'])
        require(key is not None and key not in reports, 'Unknown or repeated collector report')
        reports[key] = (str(path), archive)
    result = finish_queue(queue, reports, stop_reason=a.stop_reason)
    write_new_json(a.output, result)
    print(json.dumps(result['collection_summary'], ensure_ascii=False))


if __name__ == '__main__':
    main()
