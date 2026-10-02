"""Synthetic corruption and offline JS/Python protocol integration. No site access."""
import copy
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from crawler.everytime_collect.chunk_transfer import Receiver, wire, checked_manifest
from crawler.everytime_collect.raw import ObservationError

HERE = Path(__file__).parent


def transport(value, **overrides):
    options = dict(run_id='synthetic', course_url='https://everytime.kr/lecture/view/603889?tab=article',
                   batch_index=1, review_path=['reviews'], review_indices=list(range(1, len(value.get('reviews', [])) + 1)),
                   source_kind='transport_test', max_payload_bytes=512)
    options.update(overrides)
    process = subprocess.run(['node', str(HERE / 'transport_fixture.cjs')], input=wire({'value': value, 'options': options}),
                             capture_output=True, check=True)
    return json.loads(process.stdout)


class ChunkTransferTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.value = {'reviews': [{'text_raw': '한글 🙂 e\u0301 "인용"\n줄바꿈\\끝 ' * 18,
                                 'enrollment_term_raw': '25년 2학기 수강자', 'source_id': None} for _ in range(3)],
                     'evidence': ['메타데이터', None]}
        cls.fixture = transport(cls.value)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.receiver = self.new_receiver('case')

    def new_receiver(self, name):
        r = Receiver(self.root / name, roots=(self.root,))
        r.create(self.fixture['manifest'], run_id='synthetic', course_url='https://everytime.kr/lecture/view/603889?tab=article')
        return r

    def test_sha256_vectors_and_utf8_bounds(self):
        for p in self.fixture['chunks']:
            self.assertEqual(hashlib.sha256(p['payload'].encode('utf-8')).hexdigest(), p['browser_sha256'])
            self.assertEqual(len(p['payload'].encode('utf-8')), p['payload_byte_length'])
            self.assertLessEqual(p['payload_byte_length'], 512)
            json.loads(p['payload'])
        self.assertTrue(any(p['review_index_range'] is None for p in self.fixture['chunks']) or
                        any(p['review_index_range'] == [3, 3] for p in self.fixture['chunks']))

    def test_immutable_same_cache_retransmission_and_limit(self):
        self.assertEqual(self.fixture['retransmissions'], [self.fixture['chunks'][0]] * 2)
        self.assertTrue(self.fixture['limitDetected'])
        self.assertTrue(self.fixture['cacheImmutable'])

    def test_round_trip_keeps_identical_reviews(self):
        for p in self.fixture['chunks']:
            self.assertEqual(self.receiver.accept(p)['event'], 'accepted')
        self.assertEqual(self.receiver.finalize()['status'], 'transport_complete')
        actual = json.loads((self.receiver.directory / 'assembled.json').read_bytes())
        self.assertEqual(actual, self.value)
        self.assertEqual(len(actual['reviews']), 3)  # Never deduplicate identical text.

    def test_insert_delete_substitute_are_never_saved(self):
        for mutation in ('insert', 'delete', 'substitute'):
            with self.subTest(mutation=mutation):
                r = self.new_receiver(mutation)
                r.accept(self.fixture['chunks'][0])
                before = (r.directory / 'chunks/00000.json').read_bytes()
                p = copy.deepcopy(self.fixture['chunks'][1]); s = p['payload']
                pos = len(s) // 2
                p['payload'] = s[:pos] + ('X' if mutation != 'delete' else '') + s[pos + (mutation != 'insert'):]
                result = r.accept(p)
                self.assertEqual(result['event'], 'rejected')
                self.assertEqual(result['status'], 'partial')
                self.assertFalse((r.directory / 'chunks/00001.json').exists())
                self.assertEqual((r.directory / 'chunks/00000.json').read_bytes(), before)
                self.assertEqual(r.accept(self.fixture['chunks'][1])['event'], 'accepted')

    def test_missing_final_chunk_is_partial(self):
        for p in self.fixture['chunks'][:-1]: self.receiver.accept(p)
        result = self.receiver.finalize()
        self.assertEqual(result['event'], 'incomplete')
        self.assertEqual(result['missing_chunks'], [len(self.fixture['chunks']) - 1])
        self.assertFalse((self.receiver.directory / 'assembled.json').exists())

    def test_reordering_detected_before_write(self):
        result = self.receiver.accept(self.fixture['chunks'][1])
        self.assertEqual(result['reason'], 'missing_or_reordered_chunk')
        self.assertEqual(result['verified_chunks'], 0)
        self.assertEqual(self.receiver.accept(self.fixture['chunks'][0])['event'], 'accepted')

    def test_duplicate_is_detected_without_rewriting(self):
        p = self.fixture['chunks'][0]
        self.receiver.accept(p)
        path = self.receiver.directory / 'chunks/00000.json'
        old = path.stat().st_mtime_ns
        result = self.receiver.accept(p)
        self.assertEqual(result['event'], 'duplicate_ack')
        self.assertEqual(path.stat().st_mtime_ns, old)
        self.assertEqual(len(list(path.parent.glob('*.json'))), 1)

    def test_repeated_corruption_stops_batch(self):
        self.receiver.accept(self.fixture['chunks'][0])
        p = copy.deepcopy(self.fixture['chunks'][1]); p['payload'] += 'X'
        self.receiver.accept(p)
        state = self.receiver.accept(p)
        self.assertTrue(state['stopped'])
        self.assertEqual(state['integrity_failures'], 2)
        with self.assertRaises(ObservationError): self.receiver.accept(self.fixture['chunks'][1])
        self.assertEqual(state['verified_chunks'], 1)

    def test_cache_loss_preserves_valid_chunks_and_marks_recollection(self):
        self.receiver.accept(self.fixture['chunks'][0])
        state = self.receiver.cache_lost()
        self.assertTrue(state['requires_recollection'])
        self.assertTrue(state['stopped'])
        self.assertEqual(state['verified_chunks'], 1)

    def test_restart_verifies_disk_and_continues(self):
        self.receiver.accept(self.fixture['chunks'][0])
        resumed = Receiver(self.receiver.directory, roots=(self.root,))
        for p in self.fixture['chunks'][1:]: resumed.accept(p)
        self.assertEqual(resumed.finalize()['status'], 'transport_complete')

    def test_metadata_corruption_and_cross_run_are_rejected(self):
        for field, value in [('chunk_index', 1), ('course_url', 'https://everytime.kr/lecture/view/1'),
                             ('review_index_range', [9, 9]), ('final', True), ('total_chunks', 1),
                             ('browser_sha256', '0' * 64), ('text_offset', 100)]:
            with self.subTest(field=field):
                r = self.new_receiver(field); p = copy.deepcopy(self.fixture['chunks'][0]); p[field] = value
                self.assertEqual(r.accept(p)['event'], 'rejected')
                self.assertFalse(list((r.directory / 'chunks').glob('*.json')))

    def test_manifest_corruption_and_existing_output_rejected(self):
        m = copy.deepcopy(self.fixture['manifest']); m['payload'] += ' '
        with self.assertRaises(ObservationError): checked_manifest(m)
        with self.assertRaises(FileExistsError): self.new_receiver('case')

    def test_whole_source_digest_independently_verified(self):
        fixture = copy.deepcopy(self.fixture)
        m = json.loads(fixture['manifest']['payload']); m['source_sha256'] = '0' * 64
        envelope = {'payload': wire(m).decode(), 'payload_byte_length': len(wire(m)), 'sha256': hashlib.sha256(wire(m)).hexdigest()}
        r = Receiver(self.root / 'source', roots=(self.root,)); r.create(envelope, run_id=m['run_id'], course_url=m['course_url'])
        for p in fixture['chunks']:
            p['manifest_sha256'] = envelope['sha256']
            from crawler.everytime_collect.chunk_transfer import PACKET_KEYS
            p['packet_sha256'] = hashlib.sha256(wire([p[k] for k in PACKET_KEYS])).hexdigest()
            r.accept(p)
        self.assertEqual(r.finalize()['event'], 'source_mismatch')
        self.assertFalse((r.directory / 'assembled.json').exists())

    def test_storage_outside_private_roots_is_rejected(self):
        # CLI intentionally only permits fixed private roots.
        self.assertRaises(ObservationError, Receiver, self.root / 'outside')

    def test_malformed_tool_json_keeps_checkpoint_without_saving_payload(self):
        from crawler.everytime_collect import chunk_transfer
        self.receiver.accept(self.fixture['chunks'][0])
        for i, data in enumerate((b'{"broken"', b'x' * 16385)):
            r = self.new_receiver(f'wire_{i}')
            stdin = io.TextIOWrapper(io.BytesIO(data), encoding='utf-8')
            with patch.object(chunk_transfer, 'Receiver', return_value=r), patch('sys.stdin', stdin), \
                    patch('sys.argv', ['transport', 'accept', '--directory', str(r.directory)]), redirect_stdout(io.StringIO()):
                self.assertEqual(chunk_transfer.main(), 2)
            state = r._history()[-1]
            self.assertEqual(state['reason'], 'malformed_tool_packet')
            self.assertEqual(state['verified_chunks'], 0)
            self.assertFalse(list((r.directory / 'chunks').glob('*.json')))

    def test_empty_reviews_and_long_unicode_review(self):
        for value in ({'reviews': [], 'empty_evidence': 'synthetic only'},
                      {'reviews': [{'text_raw': '🙂한글' * 900}]}):
            fixture = transport(value, max_payload_bytes=256)
            m = json.loads(fixture['manifest']['payload'])
            path = self.root / ('empty' if not value['reviews'] else 'long')
            r = Receiver(path, roots=(self.root,)); r.create(fixture['manifest'], run_id=m['run_id'], course_url=m['course_url'])
            for p in fixture['chunks']: self.assertEqual(r.accept(p)['event'], 'accepted')
            self.assertEqual(r.finalize()['status'], 'transport_complete')
            self.assertEqual(json.loads((path / 'assembled.json').read_bytes()), value)


if __name__ == '__main__': unittest.main()
