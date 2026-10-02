"""Offline size/repetition audit of existing batch_event.json files; no collection.

Run with --source-root <private course directory> --output <NEW private folder>.
Saved transfer assemblies are test copies, never production raw or queue results.
"""
import argparse
import json
from pathlib import Path

from crawler.everytime_collect.archive import PRIVATE, OUTPUT
from crawler.everytime_collect.chunk_transfer import Receiver, wire, write_new
from crawler.everytime_collect.raw import digest
from crawler.everytime_collect.run_v2 import require, validate_event
from crawler.everytime_collect.tests.test_chunk_transfer import transport
from crawler.everytime_collect.transfer import unpack


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--rounds', type=int, default=5)
    args = parser.parse_args()
    require(3 <= args.rounds <= 10, 'Repeat between 3 and 10 times')
    for path in (args.source_root.resolve(), args.output.resolve()):
        require(any(path.is_relative_to(r.resolve()) and path != r.resolve() for r in (PRIVATE, OUTPUT)), 'Private paths required')
    paths = sorted(args.source_root.glob('*/batch_*/batch_event.json'))
    require(1 <= len(paths) <= 20, 'Use explicitly bounded existing batches')
    args.output.mkdir(parents=True, exist_ok=False)
    report = {'site_reads': 0, 'scope': 'offline JS -> Python; not a cua tool handoff',
              'rounds': args.rounds, 'events': [], 'received_chunks': 0, 'mismatches': 0,
              'chunk_payload_limit': 1024, 'reviews_per_round': 0}
    for i, path in enumerate(paths):
        original = path.read_bytes()
        event = json.loads(original)
        validate_event(event)
        window = event['window']
        failed = {f['list_position'] for f in event['collection']['failures']}
        positions = [p for p in range(window['start_position'], window['end_position'] + 1)
                     if p - window['start_position'] + 1 not in failed]
        url = event['observation']['capture']['page_url']
        # transport() accepts arbitrary JSON; explicitly select the batch review path.
        options = dict(run_id=f'benchmark_{i:02d}', course_url=url, batch_index=event['batch'],
                       review_path=['observation', 'reviews'], review_indices=positions,
                       source_kind='batch_event', max_payload_bytes=1024)
        fixture = transport(event, **options)
        require(json.loads(unpack(fixture['legacy'])) == event, 'Legacy decode changed data')
        chunks = fixture['chunks']
        m = json.loads(fixture['manifest']['payload'])
        review_spans = [p['review_index_range'] for p in chunks]
        entry = {'source_file': str(path), 'original_file_sha256': digest(original), 'source_utf8_bytes': m['source_byte_length'],
                 'reviews': len(positions), 'chunk_count': len(chunks),
                 'legacy_base64_characters': len(fixture['legacy']['payload']), 'legacy_wire_bytes': len(wire(fixture['legacy'])),
                 'plain_payload_bytes': sum(p['payload_byte_length'] for p in chunks),
                 'plain_wire_bytes': len(wire(fixture['manifest'])) + sum(len(wire(p)) for p in chunks),
                 'max_payload_bytes': max(p['payload_byte_length'] for p in chunks),
                 'metadata_only_chunks': sum(s is None for s in review_spans),
                 'max_reviews_intersected': max((s[1] - s[0] + 1 for s in review_spans if s), default=0)}
        for round_index in range(args.rounds):
            r = Receiver(args.output / f'round_{round_index + 1}' / f'event_{i:02d}')
            r.create(fixture['manifest'], run_id=m['run_id'], course_url=url)
            for p in chunks:
                state = r.accept(p)
                report['received_chunks'] += 1
                report['mismatches'] += state['event'] != 'accepted'
                require(state['event'] == 'accepted', 'Benchmark integrity failure; stop')
            require(r.finalize()['status'] == 'transport_complete', 'Assembly incomplete')
            require(json.loads((r.directory / 'assembled.json').read_bytes()) == event, 'Round trip changed data')
        require(path.read_bytes() == original, 'Existing source was modified')
        report['events'].append(entry)
        report['reviews_per_round'] += len(positions)
    report['totals'] = {k: sum(e[k] for e in report['events']) for k in
                        ('source_utf8_bytes', 'legacy_wire_bytes', 'plain_payload_bytes', 'plain_wire_bytes', 'chunk_count')}
    synthetic = {'reviews': [{'text_raw': '한글 🙂 "인용"\n줄바꿈 ' * 20,
                              'enrollment_term_raw': '합성 수강학기', 'source_id': None} for _ in range(3)]}
    test = transport(synthetic, max_payload_bytes=1024)
    require(json.loads(unpack(test['legacy'])) == synthetic, 'Synthetic legacy mismatch')
    report['synthetic_comparison'] = {'source_utf8_bytes': json.loads(test['manifest']['payload'])['source_byte_length'],
        'legacy_wire_bytes': len(wire(test['legacy'])), 'plain_payload_bytes': sum(p['payload_byte_length'] for p in test['chunks']),
        'plain_wire_bytes': len(wire(test['manifest'])) + sum(len(wire(p)) for p in test['chunks']),
        'chunk_count': len(test['chunks']), 'identical_reviews_preserved': 3}
    report['note'] = 'Observed test counts only; not an estimate of environment-wide error probability.'
    write_new(args.output / 'benchmark.json', wire(report))
    print(json.dumps({k: v for k, v in report.items() if k != 'events'}, ensure_ascii=False))


if __name__ == '__main__': main()
