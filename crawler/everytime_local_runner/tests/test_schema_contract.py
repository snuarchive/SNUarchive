"""Synthetic projection tests. No database connection or SQL execution."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

from crawler.everytime_local_runner.schema_contract import (
    assessment_projection, verify_schema, SCHEMA_FILE, SCHEMA_SHA256, ASSESSMENT_LABELS,
)
from crawler.everytime_local_runner.import_candidates import candidate, database_shape_issues
from crawler.everytime_local_runner.tests.test_import_candidates import fixture


class RootSchemaContractTests(unittest.TestCase):
    def test_exact_eight_labels_without_assuming_seeded_database_ids(self):
        inputs = [('midterm', None), ('final', None), ('exam', 1), ('exam', 2),
                  ('exam', 3), ('quiz', None), ('assignment', None), ('other', None)]
        for pair, expected in zip(inputs, ASSESSMENT_LABELS):
            self.assertEqual(assessment_projection(dict(zip(('kind', 'number'), pair))), (expected, []))

    def test_numbered_observations_are_not_collapsed_to_another_identity(self):
        for kind, number in [('exam', 4), ('exam', 6), ('quiz', 2), ('assignment', 1), ('midterm', 1)]:
            original = {'kind': kind, 'number': number}; before = deepcopy(original)
            label, issues = assessment_projection(original)
            self.assertIsNone(label)
            self.assertIn('database_assessment_unresolved_or_invalid', issues)
            self.assertEqual(original, before)

    def test_unknown_assessment_never_becomes_other(self):
        for kind, number in [(None, None), ('exam', None), ('exam', True), ('unknown', None)]:
            label, issues = assessment_projection({'kind': kind, 'number': number})
            self.assertIsNone(label); self.assertTrue(issues)

    def test_root_mapping_uses_assessment_id_and_stat_report_term(self):
        doc, record = fixture('2024년 2학기\n중간 평균 44 만점 100')
        row = candidate(record, doc, 0)
        self.assertEqual(row['candidate_schema_version'], 2)
        self.assertEqual(row['target_schema']['sha256'], SCHEMA_SHA256)
        self.assertEqual(set(row['database_mapping']),
                         {'course_id', 'assessment_id', 'type_id', 'contributor_id', 'source', 'source_report_id'})
        self.assertTrue(all(v is None for v in row['database_mapping'].values()))
        self.assertEqual(row['database_projection']['assessment_type_label'], '중간')
        self.assertEqual(row['database_projection']['stat_reports']['year'], 2024)
        self.assertEqual(row['database_projection']['stat_reports']['semester'], 3)
        self.assertFalse(row['ready_for_database_write'])
        self.assertEqual(row['human_review_status'], 'unreviewed')

    def test_raw_term_is_not_used_to_fill_missing_exam_term(self):
        doc, record = fixture('중간 평균 44')
        row = candidate(record, doc, 0)
        self.assertIsNone(row['database_projection']['stat_reports']['year'])
        self.assertIsNone(row['database_projection']['stat_reports']['semester'])
        self.assertEqual(row['extraction']['source']['enrollment_term_raw'], '25년 1학기 수강자')

    def test_highest_observed_score_is_not_the_possible_maximum(self):
        doc, record = fixture('중간 평균 44 Max 83')
        row = candidate(record, doc, 0)
        self.assertEqual(row['extraction']['observed_max'], 83)
        self.assertIsNone(row['database_projection']['stat_reports']['max_score'])
        self.assertIsNone(row['database_projection']['stat_reports']['q4'])

    def test_changed_or_missing_sql_stops_candidate_generation(self):
        with tempfile.TemporaryDirectory() as folder:
            changed = Path(folder) / 'changed.sql'
            changed.write_text('CREATE TABLE wrong (id INT);', encoding='utf-8')
            for p in (changed, Path(folder) / 'missing.sql'):
                with self.assertRaises(ValueError): verify_schema(p)

    def test_selected_local_sql_matches_reviewed_contract_when_available(self):
        if not SCHEMA_FILE.exists(): self.skipTest('User-selected external SQL is absent')
        self.assertEqual(verify_schema(), {str(SCHEMA_FILE.resolve()): SCHEMA_SHA256})


if __name__ == '__main__':
    unittest.main()
