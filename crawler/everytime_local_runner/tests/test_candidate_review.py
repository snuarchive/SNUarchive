"""Synthetic/offline review tests; no browser or database connections."""
from copy import deepcopy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from crawler.everytime_collect.raw import digest, ObservationError
from crawler.everytime_local_runner import candidate_review as review
from crawler.everytime_local_runner.import_candidates import candidate, write_jsonl
from crawler.everytime_local_runner.storage import sha, write_new
from crawler.everytime_local_runner.tests.test_import_candidates import fixture


def sample(text='26-1 기준\n중간 평균 44 만점 100'):
    doc, record = fixture(text)
    return candidate(record, doc, 0), text


def annotation(row, text):
    return {'candidate_id': row['candidate_id'], 'comment_sha256': digest(text.encode()),
            'term': {'status': 'proposed_from_body', 'proposed_year': 2026, 'proposed_semester': 1,
                     'reason': 'Synthetic explicitly scoped body header.',
                     'assumptions': ['two_digit_year_expansion_requires_confirmation'],
                     'evidence': [review.span(text, 0, 4)]}}


class CandidateReviewTests(unittest.TestCase):
    def test_body_proposal_does_not_mutate_or_approve_original(self):
        row, text = sample(); before = deepcopy(row)
        result = review.review_candidate(row, text, annotation(row, text))
        self.assertEqual(row, before)
        self.assertEqual(result['original_candidate'], before)
        self.assertIsNone(result['original_candidate']['extraction']['year'])
        self.assertEqual(result['term_review']['proposed_year'], 2026)
        self.assertEqual(result['human_review_status'], 'unreviewed')
        self.assertFalse(result['ready_for_database_write'])

    def test_enrollment_and_past_future_tokens_never_fill_date(self):
        for text in ['중간 평균 44', '2028년 1학기에 다음 개설 예정.\n중간 평균 44',
                     '21년도 다른 과목 기출 참고.\n중간 평균 44']:
            row, text = sample(text)
            result = review.review_candidate(row, text)
            self.assertIsNone(result['term_review']['proposed_year'])
            self.assertIsNone(result['term_review']['proposed_semester'])
            self.assertFalse(result['enrollment_term_imputed'])

    def test_identity_labels_do_not_resolve_number_or_scope(self):
        for text in ('시험 평균 44', '중간1 평균 44', '중간 객관식 평균 44'):
            row, text = sample(text)
            result = review.review_candidate(row, text)
            self.assertEqual(result['assessment_review']['structural_status'], 'needs_identity_review')
            self.assertIsNone(result['assessment_review']['assistant_proposal'])

    def test_observed_max_not_promoted_or_conflict_removed(self):
        row, text = sample('중간 평균 44 최고점 83')
        result = review.review_candidate(row, text)
        record = result['original_candidate']['extraction']
        self.assertEqual(record['observed_max'], 83)
        self.assertIsNone(record['statistics']['q4'])
        self.assertIsNone(record['statistics']['max_score'])
        self.assertIn('observed_max_q4_mapping_unresolved', record['review_reasons'])

    def test_hash_span_and_body_tampering_rejected(self):
        row, text = sample()
        for modify in (lambda d: d.update(comment_sha256='0' * 64),
                       lambda d: d['term']['evidence'][0].update(text='not original'),
                       lambda d: d['term']['evidence'][0].update(start=-1),
                       lambda d: d.update(human_review_status='approved')):
            decision = annotation(row, text); modify(decision)
            with self.assertRaises(ObservationError):
                review.review_candidate(row, text, decision)
        with self.assertRaises(ObservationError):
            review.review_candidate(row, text + 'changed')

    def test_partial_or_ambiguous_term_cannot_claim_complete(self):
        row, text = sample(); decision = annotation(row, text)
        decision['term'].update(status='unresolved')
        with self.assertRaises(ObservationError):
            review.review_candidate(row, text, decision)
        decision['term'].update(status='partial_from_body', proposed_semester=None)
        self.assertIsNone(review.review_candidate(row, text, decision)['term_review']['proposed_semester'])

    def test_split_is_only_proposal_original_conflict_remains(self):
        row, text = sample('중간 평균 44 평균 45')
        decision = {'candidate_id': row['candidate_id'], 'comment_sha256': digest(text.encode()),
                    'assessment': {'status': 'split_required', 'proposed': None,
                                   'reason': 'Synthetic unresolved boundary.',
                                   'evidence': [review.span(text, 0, len(text))]}}
        result = review.review_candidate(row, text, decision)
        self.assertEqual(result['original_candidate'], row)
        self.assertFalse(result['ready_for_database_write'])

    def test_html_escapes_source_and_embeds_no_active_content(self):
        row, text = sample('중간 평균 44\n</pre><script>alert(1)</script>')
        result = review.review_candidate(row, text)
        html = review.render_html([result], {row['candidate_id']: text}, {'counts': {}})
        self.assertNotIn('<script>', html)
        self.assertIn('&lt;script&gt;', html)
        self.assertIn("default-src 'none'", html)


class ReviewBuildTests(unittest.TestCase):
    def setup_files(self, root):
        raw = root / 'raw.json'; doc, rec = fixture('26-1 기준\n중간 평균 44 만점 100')
        write_new(raw, doc)
        rec['source'].update(file=str(raw), file_sha256=sha(raw))
        row = candidate(rec, doc, 0)
        dataset = root / 'dataset'; dataset.mkdir()
        write_jsonl(dataset / 'import_candidates.jsonl', [row])
        write_new(dataset / 'summary.json', {'input_files': {str(raw): sha(raw)}})
        write_new(dataset / 'manifest.json', {'files': {p.name: sha(p) for p in dataset.iterdir()}})
        decision = root / 'decisions.json'
        write_new(decision, {'version': 1, 'author_role': 'assistant', 'source_manifest_sha256': sha(dataset / 'manifest.json'),
                             'decisions': [annotation(row, doc['reviews'][0]['text_raw'])]})
        return dataset, decision, raw, row

    def test_complete_manifest_checksums_and_exclusive_output(self):
        with TemporaryDirectory() as tmp, patch.object(review, 'read_document', side_effect=json.loads):
            root = Path(tmp).resolve(); dataset, decision, raw, row = self.setup_files(root)
            with patch.object(review, 'ROOT', root):
                output = root / 'output'; result = review.build(dataset, decision, output)
                self.assertEqual(result['counts']['candidates'], 1)
                manifest = json.loads((output / 'manifest.json').read_text())
                self.assertTrue(all(sha(output / f) == h for f, h in manifest['files'].items()))
                saved = json.loads((output / 'candidate_reviews.jsonl').read_text(encoding='utf8'))
                self.assertEqual(saved['original_candidate'], row)
                with self.assertRaises(ObservationError):
                    review.build(dataset, decision, output)

    def test_changed_source_rejected_before_creating_output(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); dataset, decision, raw, _ = self.setup_files(root)
            raw.write_bytes(raw.read_bytes() + b' ')
            with patch.object(review, 'ROOT', root), self.assertRaises(ObservationError):
                review.build(dataset, decision, root / 'output')
            self.assertFalse((root / 'output').exists())

    def test_interruption_preserves_inputs_and_leaves_no_complete_manifest(self):
        with TemporaryDirectory() as tmp, patch.object(review, 'read_document', side_effect=json.loads):
            root = Path(tmp).resolve(); dataset, decision, raw, _ = self.setup_files(root)
            inputs = [*dataset.iterdir(), raw, decision]; hashes = {p: sha(p) for p in inputs}
            count = 0
            def interrupted(path, rows):
                nonlocal count
                count += 1
                if count == 2:
                    raise OSError('synthetic interrupted write')
                write_jsonl(path, rows)
            with patch.object(review, 'ROOT', root), patch.object(review, 'write_jsonl', side_effect=interrupted):
                with self.assertRaises(OSError):
                    review.build(dataset, decision, root / 'output')
            self.assertTrue((root / 'output' / 'candidate_reviews.jsonl').exists())
            self.assertFalse((root / 'output' / 'manifest.json').exists())
            self.assertTrue(all(sha(p) == h for p, h in hashes.items()))


if __name__ == '__main__':
    unittest.main()
