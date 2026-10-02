"""Append-only, private transport receiver. Never opens a browser or archives raw.

Usage: python -m crawler.everytime_collect.chunk_transfer --help
Untrusted packets enter via stdin, never via an unverified on-disk payload file.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sys

from .archive import PRIVATE, OUTPUT
from .raw import ObservationError, _keys, _no_secrets, digest, read_json, validate_document
from .run_v2 import require, validate_event

FORMAT = 'plain-json-chunks-v1'
PACKET_KEYS = ('format', 'run_id', 'course_url', 'batch_index', 'manifest_sha256',
               'chunk_index', 'total_chunks', 'final', 'review_index_range', 'text_offset',
               'payload_byte_length', 'browser_sha256', 'payload')
MANIFEST_KEYS = ('format', 'run_id', 'course_url', 'batch_index', 'source_kind', 'total_chunks',
                 'max_payload_bytes', 'source_byte_length', 'source_sha256', 'review_path', 'review_indices')


def wire(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def number(value, low, high):
    return type(value) is int and low <= value <= high


def sha(value):
    return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None


def write_new(path, data):
    with path.open('xb') as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())


def checked_manifest(envelope):
    _keys(envelope, ('payload', 'payload_byte_length', 'sha256'), 'chunk manifest envelope')
    require(isinstance(envelope['payload'], str), 'Invalid manifest payload')
    data = envelope['payload'].encode('utf-8')
    require(len(data) <= 4096 and len(data) == envelope['payload_byte_length'] and
            digest(data) == envelope['sha256'], 'Manifest checksum mismatch')
    m = read_json(data)
    _keys(m, MANIFEST_KEYS, 'chunk manifest')
    require(m['format'] == FORMAT and isinstance(m['run_id'], str) and
            re.fullmatch('[A-Za-z0-9_-]{1,80}', m['run_id']) is not None, 'Invalid run identity')
    require(isinstance(m['course_url'], str) and re.fullmatch(
        r'https://everytime\.kr/lecture/view/[1-9][0-9]*(\?tab=article)?', m['course_url']) is not None,
        'Invalid course URL')
    require(number(m['batch_index'], 1, 20) and number(m['total_chunks'], 1, 10000) and
            number(m['max_payload_bytes'], 256, 2048) and number(m['source_byte_length'], 1, 2 * 1024 * 1024)
            and sha(m['source_sha256']), 'Unbounded transfer')
    require(m['source_kind'] in ('batch_event', 'raw_observation', 'transport_test'), 'Unknown source kind')
    indices = m['review_indices']
    require(isinstance(indices, list) and len(indices) <= 20 and all(number(i, 1, 10**7) for i in indices)
            and indices == sorted(set(indices)), 'Invalid review indices')
    require(isinstance(m['review_path'], list) and all(isinstance(k, str) for k in m['review_path']), 'Invalid review path')
    _no_secrets(m)
    return m


class Receiver:
    """Single writer. A new checkpoint is written after every accepted/rejected packet.

    Two integrity failures stop this batch. At most two retry requests per chunk;
    a duplicate valid packet is detected and ACKed without rewriting its file.
    """
    def __init__(self, directory, *, roots=(PRIVATE, OUTPUT)):
        self.directory = Path(directory).resolve()
        require(any(self.directory.is_relative_to(Path(r).resolve()) and self.directory != Path(r).resolve()
                    for r in roots), 'Transport storage must be private')

    def create(self, envelope, *, run_id, course_url):
        m = checked_manifest(envelope)
        require((m['run_id'], m['course_url']) == (run_id, course_url), 'Unexpected transfer identity')
        self.directory.mkdir(parents=True, exist_ok=False)
        (self.directory / 'chunks').mkdir()
        (self.directory / 'checkpoints').mkdir()
        write_new(self.directory / 'manifest.json', wire(envelope))
        return self._checkpoint('created')

    def _manifest(self):
        envelope = read_json((self.directory / 'manifest.json').read_bytes())
        return checked_manifest(envelope), envelope['sha256']

    def _check_packet(self, p):
        _keys(p, (*PACKET_KEYS, 'packet_sha256'), 'chunk packet')
        m, manifest_hash = self._manifest()
        require(isinstance(p['payload'], str), 'payload_type')
        data = p['payload'].encode('utf-8')
        require(number(p['payload_byte_length'], 1, m['max_payload_bytes']) and
                len(data) == p['payload_byte_length'], 'payload_length')
        require(digest(data) == p['browser_sha256'], 'payload_sha256')
        require(digest(wire([p[k] for k in PACKET_KEYS])) == p['packet_sha256'], 'packet_sha256')
        require(p['manifest_sha256'] == manifest_hash and all(p[k] == m[k] for k in
                ('format', 'run_id', 'course_url', 'batch_index', 'total_chunks')), 'packet_identity')
        require(number(p['chunk_index'], 0, m['total_chunks'] - 1) and type(p['final']) is bool and
                p['final'] == (p['chunk_index'] == m['total_chunks'] - 1), 'packet_index')
        require(number(p['text_offset'], 0, 2 * 1024 * 1024), 'packet_offset')
        scope = p['review_index_range']
        require(scope is None or (isinstance(scope, list) and len(scope) == 2 and
                all(number(i, 1, 10**7) and i in m['review_indices'] for i in scope) and scope[0] <= scope[1]),
                'packet_review_range')
        fragment = read_json(data)
        _keys(fragment, ('fragment',), 'plain JSON fragment')
        require(isinstance(fragment['fragment'], str) and bool(fragment['fragment']), 'empty_fragment')
        # Reject invalid UTF-8 / unpaired surrogates before saving any packet.
        fragment['fragment'].encode('utf-8')
        return fragment['fragment']

    def _received(self):
        records = []
        offset = 0
        for i, path in enumerate(sorted((self.directory / 'chunks').glob('*.json'))):
            p = read_json(path.read_bytes())
            fragment = self._check_packet(p)
            require(path.name == f'{i:05d}.json' and p['chunk_index'] == i and p['text_offset'] == offset,
                    'Stored chunk sequence damaged; keep partial')
            offset += len(fragment.encode('utf-16-le')) // 2
            records.append(p)
        return records

    def _history(self):
        return [read_json(p.read_bytes()) for p in sorted((self.directory / 'checkpoints').glob('*.json'))]

    def _checkpoint(self, event, *, reason=None, stopped=False, recollect=False, diagnostic=None):
        m, _ = self._manifest()
        history = self._history()
        received = self._received()
        failures = sum(h['event'] == 'rejected' for h in history) + (event == 'rejected')
        stopped = stopped or failures >= 2 or any(h['stopped'] for h in history)
        complete = event == 'assembled' or any(h['event'] == 'assembled' for h in history)
        state = {'run_id': m['run_id'], 'course_url': m['course_url'], 'batch_index': m['batch_index'],
                 'time': datetime.now(timezone.utc).isoformat(), 'event': event, 'reason': reason, 'diagnostic': diagnostic,
                 'status': 'transport_complete' if complete else 'partial',
                 'verified_chunks': len(received), 'total_chunks': m['total_chunks'],
                 'missing_chunks': list(range(len(received), m['total_chunks'])),
                 'next_chunk_index': len(received) if len(received) < m['total_chunks'] else None,
                 'integrity_failures': failures, 'stopped': stopped,
                 'requires_recollection': recollect or any(h['requires_recollection'] for h in history),
                 'retry_only_from_same_cache': not stopped and not complete,
                 'max_retries_per_chunk': 2, 'repeated_failure_stop_threshold': 2}
        write_new(self.directory / 'checkpoints' / f'{len(history):05d}.json', wire(state))
        return state

    def accept(self, packet):
        history = self._history()
        require(not any(h['stopped'] for h in history), 'Stopped transport; do not reread site')
        require(not any(h['event'] == 'assembled' for h in history), 'Transport already assembled')
        received = self._received()
        try:
            fragment = self._check_packet(packet)
            index = packet['chunk_index']
            if index < len(received):
                require(packet == received[index], 'conflicting_duplicate')
                return self._checkpoint('duplicate_ack', reason='Already verified; no file rewritten')
            require(index == len(received), 'missing_or_reordered_chunk')
            expected_offset = sum(len(read_json(p['payload'].encode('utf-8'))['fragment'].encode('utf-16-le')) // 2 for p in received)
            require(packet['text_offset'] == expected_offset, 'fragment_offset')
        except (ObservationError, UnicodeError) as error:
            # Never persist the rejected packet or source text, including in error logs.
            diagnostic = None
            if isinstance(packet, dict) and isinstance(packet.get('payload'), str):
                try:
                    data = packet['payload'].encode('utf-8')
                    diagnostic = {'expected_byte_length': packet.get('payload_byte_length') if type(packet.get('payload_byte_length')) is int else None,
                                  'actual_byte_length': len(data),
                                  'expected_sha256': packet.get('browser_sha256') if sha(packet.get('browser_sha256')) else None,
                                  'actual_sha256': digest(data)}
                except UnicodeError:
                    pass
            return self._checkpoint('rejected', reason=str(error) if isinstance(error, ObservationError) else 'invalid_utf8', diagnostic=diagnostic)
        write_new(self.directory / 'chunks' / f'{index:05d}.json', wire(packet))
        return self._checkpoint('accepted')

    def cache_lost(self):
        return self._checkpoint('cache_unavailable', reason='Same observation cannot be retransmitted; recollection needs separate authorization',
                                stopped=True, recollect=True)

    def finalize(self):
        try:
            return self._assemble()
        except (ObservationError, UnicodeError):
            return self._checkpoint('source_validation_failed', reason='Batch validation failed; no raw archived', stopped=True)

    def _assemble(self):
        require(not any(h['stopped'] for h in self._history()), 'Stopped transport remains partial')
        m, _ = self._manifest()
        received = self._received()
        if len(received) != m['total_chunks']:
            return self._checkpoint('incomplete', reason='Missing chunks; no assembled file written')
        data = ''.join(read_json(p['payload'].encode('utf-8'))['fragment'] for p in received).encode('utf-8')
        if len(data) != m['source_byte_length'] or digest(data) != m['source_sha256']:
            return self._checkpoint('source_mismatch', reason='Full batch SHA-256/length mismatch', stopped=True)
        doc = read_json(data)
        _no_secrets(doc)
        reviews = doc
        for key in m['review_path']:
            require(isinstance(reviews, dict) and key in reviews, 'Review path missing')
            reviews = reviews[key]
        require(isinstance(reviews, list) and len(reviews) == len(m['review_indices']), 'Review count mismatch')
        if m['source_kind'] == 'batch_event':
            validate_event(doc)
            require(doc['batch'] == m['batch_index'], 'Source batch identity differs')
            obs = doc['observation']
            require(obs is not None and obs['capture']['page_url'] == m['course_url'], 'Source course differs')
            window = doc['window']
            failed = {f['list_position'] for f in doc['collection']['failures']}
            require(m['review_path'] == ['observation', 'reviews'] and m['review_indices'] ==
                    [i for i in range(window['start_position'], window['end_position'] + 1)
                     if i - window['start_position'] + 1 not in failed], 'Source review positions differ')
        elif m['source_kind'] == 'raw_observation':
            validate_document(doc)
            require(doc['capture']['page_url'] == m['course_url'] and m['review_path'] == ['reviews'], 'Source course differs')
        assembled = self.directory / 'assembled.json'
        if assembled.exists():
            require(assembled.read_bytes() == data, 'Existing assembly differs; never overwrite')
        else:
            write_new(assembled, data)
        return self._checkpoint('assembled')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('start', 'accept', 'finalize', 'cache-lost'))
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--run-id')
    parser.add_argument('--course-url')
    args = parser.parse_args()
    receiver = Receiver(args.directory)
    try:
        if args.command in ('start', 'accept'):
            incoming = sys.stdin.buffer.read(16385)
            try:
                require(len(incoming) <= 16384, 'Tool packet too large')
                packet = read_json(incoming)
            except ObservationError:
                if args.command == 'accept':
                    print(json.dumps(receiver._checkpoint('rejected', reason='malformed_tool_packet')))
                    return 2
                raise
            result = receiver.create(packet, run_id=args.run_id, course_url=args.course_url) if args.command == 'start' else receiver.accept(packet)
        else:
            result = receiver.finalize() if args.command == 'finalize' else receiver.cache_lost()
        print(json.dumps(result, ensure_ascii=False))
        return 2 if result['event'] in ('rejected', 'incomplete', 'cache_unavailable', 'source_mismatch', 'source_validation_failed') else 0
    except (ObservationError, OSError, UnicodeError):
        print('ERROR: transport rejected; preserve verified chunks and keep course partial', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
