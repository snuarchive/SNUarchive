"""File-only audit of a completed shard; writes a new report, never raw data.

No browser, HTTP, extractor, database, or changes to campaign receipts.
The caller must explicitly supply the expected number of committed inputs.
"""
import argparse
import json
from collections import Counter
from pathlib import Path

from crawler.everytime_collect.run_v2 import require
from .campaign import committed_snapshot, read
from .storage import ROOT, load_archive, sha, write_new


def audit_shard(shard, output, *, expected_items):
    shard, output = Path(shard).resolve(), Path(output).resolve()
    require(shard.parent == ROOT.resolve(), 'Expected isolated local campaign')
    require(output.is_relative_to(ROOT.resolve()), 'Audit output must stay in local output')
    require(not output.exists(), 'Audit output already exists; never replace it')
    require(type(expected_items) is int and 1 <= expected_items <= 50, 'Invalid expected shard size')
    items, checkpoint = committed_snapshot(shard)
    require(len(items) == expected_items, 'Shard is incomplete or has unexpected input count')
    files = {str(checkpoint): sha(checkpoint)}
    states, holds, reviews = Counter(), {}, 0
    for item, (receipt, value) in items.items():
        files[str(receipt)] = sha(receipt)
        files.update(value['files'])
        status = value['status']
        states[status] += 1
        require(status in ('complete', 'empty', 'partial', 'needs_review', 'not_found'),
                'Unexpected terminal state; investigate before issuing a normal shard audit')
        if status in ('complete', 'empty', 'partial'):
            rows, raw_files = load_archive(value['report'])
            files.update(raw_files)
            ui = read(value['report'])['ui_observation']
            reviews += len(rows)
            if status == 'partial':
                holds[item] = {'status': status, 'reason': ui['termination_reason'],
                               'saved': len(rows), 'displayed': ui['displayed_total']['value']}
                require(ui['status'] == 'partial' and not ui['ui_end_confirmed'],
                        'Partial receipt disagrees with UI report')
            else:
                require(ui['status'] == 'complete' and ui['ui_end_confirmed'] and
                        len(rows) == ui['displayed_total']['value'], 'False completion/count claim')
                if status == 'empty':
                    require(not rows and ui['termination_reason'] == 'explicit_empty_list',
                            'Missing explicit empty-list evidence')
                else:
                    require(bool(rows) and ui['termination_reason'] == 'displayed_total_matched_and_bottom_stable'
                            and ui['bottom_confirmations'] >= 2 and ui['final_state']['at_bottom'],
                            'Missing complete-list bottom evidence')
        else:
            match = next((p for p in value['files'] if Path(p).name == 'match.json'), None)
            if match:
                decision = read(match)
                holds[item] = {'status': status, 'reason': decision['reason'],
                               'title': decision['input']['title'], 'instructor': decision['input']['instructor']}
            else:
                require(value['match_status'] == 'incomplete_search', 'Unexplained unresolved receipt')
                holds[item] = {'status': status, 'reason': value['reason'], 'receipt': str(receipt)}
    result = {'items': len(items), 'states': dict(states), 'reviews_saved': reviews,
              'holds': holds, 'verified_files': files, 'database_writes': 0}
    write_new(output, result)
    return {'items': len(items), 'states': dict(states), 'reviews': reviews,
            'hold_reasons': dict(Counter(h['reason'] for h in holds.values())),
            'verified_files': len(files), 'sha256': sha(output)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--shard', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--expected-items', required=True, type=int)
    args = parser.parse_args()
    print(json.dumps(audit_shard(args.shard, args.output, expected_items=args.expected_items), ensure_ascii=False))


if __name__ == '__main__':
    main()
