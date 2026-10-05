"""Synthetic candidate tests; no browser, HTTP or database connection."""
from copy import deepcopy
import unittest
from crawler.everytime_collect.raw import digest, ObservationError
from crawler.everytime_local_runner.stats_adapter import extract_raw_review
from crawler.everytime_local_runner.import_candidates import candidate, annotate_groups, database_shape_issues


def fixture(text, filename='synthetic/raw.json'):
    doc = {'course': {'title_raw': '합성강의', 'instructor_raw': '합성교수', 'source_id': None},
           'capture': {'page_url': 'https://everytime.kr/lecture/view/12345?tab=article'},
           'reviews': [{'source_id': None, 'text_raw': text, 'enrollment_term_raw': '25년 1학기 수강자',
                        'created_at_raw': None, 'updated_at_raw': None, 'metadata': {}, 'field_evidence': {}}]}
    r = extract_raw_review(doc, 0, filename, digest(filename.encode()), complete=True)['records'][0]
    r['priority_reference'] = {'course_key': 'synthetic-key', 'item_id': 'A0001'}
    return doc, r


class ImportCandidateTests(unittest.TestCase):
    def test_nulls_zero_and_observed_max_preserved_without_db_ids(self):
        doc, r = fixture('중간 Q1 0 평균 44 Max 83')
        before = deepcopy(r)
        row = candidate(r, doc, 0)
        self.assertEqual(r, before)
        self.assertEqual(row['extraction']['statistics']['q1'], 0)
        self.assertIsNone(row['extraction']['statistics']['q2'])
        self.assertIsNone(row['extraction']['statistics']['max_score'])
        self.assertEqual(row['extraction']['observed_max'], 83)
        self.assertIsNone(row['extraction']['year'])
        self.assertTrue(all(value is None for value in row['database_mapping'].values()))
        self.assertFalse(row['ready_for_database_write'])

    def test_tampered_text_and_evidence_rejected(self):
        doc, r = fixture('2024년 2학기\n중간 평균 44 만점 100')
        bad = deepcopy(doc)
        bad['reviews'][0]['text_raw'] += 'changed'
        with self.assertRaises(ObservationError):
            candidate(r, bad, 0)
        r['evidence'][0]['text'] = 'wrong'
        with self.assertRaises(ValueError):
            candidate(r, doc, 0)

    def test_parser_acceptance_is_not_human_approval(self):
        doc, r = fixture('2024년 2학기\n중간 평균 44 만점 100')
        row = candidate(r, doc, 0)
        self.assertEqual(row['extraction']['status'], 'accepted')
        self.assertEqual(row['dataset_review_reasons'], [])
        self.assertEqual(row['human_review_status'], 'unreviewed')
        self.assertFalse(row['ready_for_database_write'])

    def test_duplicate_reviews_and_conflicts_flagged_without_merging(self):
        rows = []
        for text, filename in [('2024년 2학기\n중간 평균 44 만점 100', 'a.json'),
                               ('2024년 2학기\n중간 평균 44 만점 100', 'b.json'),
                               ('2024년 2학기\n중간 평균 45 만점 100', 'c.json')]:
            doc, r = fixture(text, filename)
            rows.append(candidate(r, doc, 0))
        groups = annotate_groups(rows)
        self.assertEqual(len(rows), 3)
        self.assertEqual({g['kind'] for g in groups}, {'possible_duplicate_review', 'possible_duplicate_statistic', 'conflicting_population_values'})
        self.assertTrue(all(row['conflict_group_ids'] for row in rows))

    def test_unknown_terms_never_group_as_same_exam(self):
        rows = []
        for i, text in enumerate(['중간 평균 44', '중간 평균 45']):
            doc, r = fixture(text, f'{i}.json')
            rows.append(candidate(r, doc, 0))
        self.assertEqual(annotate_groups(rows), [])

    def test_database_precision_is_flagged_without_rounding(self):
        _, r = fixture('2024년 2학기\n중간 평균 44.123')
        self.assertIn('database_numeric_precision_average', database_shape_issues(r))
        self.assertEqual(r['statistics']['average'], 44.123)


if __name__ == '__main__':
    unittest.main()
