"""Offline regressions on the 14 full, untouched, previously reviewed bodies.

The private followup is deliberately not a checked-in fixture. In this workspace
all fourteen tests run; clean checkouts without private data explicitly skip them.
The original, old error, expected correction, reason and exact source hashes are
also exported together in quality_A_semantic_018_*/regression_cases.json.
"""
import json
from pathlib import Path
import unittest

from crawler.everytime_local_runner.stats_adapter import extract_raw_review
from crawler.everytime_local_runner.storage import sha
from crawler.everytime_stats.models import digest
from crawler.everytime_stats.validate import check_evidence
from crawler.tests.test_followup_semantic_regressions import CASES

FOLLOWUP = Path(__file__).resolve().parents[1] / 'output/everytime_local_runner/followup_A_20261002_02/confirmed_issues.jsonl'


class FullOriginalFollowupRegressions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not FOLLOWUP.exists():
            raise unittest.SkipTest('Private followup_A source fixture is not present; synthetic regressions still run')
        cls.cases = {r['candidate_id']: r for r in (json.loads(line) for line in FOLLOWUP.read_text(encoding='utf-8').splitlines())}
        assert len(cls.cases) == 14


for case in CASES:
    def run(self, case=case):
        previous = self.cases[case['id']]
        old = previous['original_triage']['candidate']['extraction']; s = old['source']
        self.assertEqual(sha(s['file']), s['file_sha256'])
        doc = json.loads(Path(s['file']).read_text(encoding='utf-8'))
        index = int(s['json_pointer'].split('/')[-1]); body = doc['reviews'][index]['text_raw']
        self.assertEqual(digest(body.encode('utf-8')), s['comment_sha256'])
        rows = extract_raw_review(doc, index, s['file'], s['file_sha256'], complete=True)['records']
        field = case['field']; before_evidence = [e for e in old['evidence'] if e.get('field') == field]
        matching = [r for r in rows if any(e['start'] == b['start'] and e['end'] == b['end'] and e.get('field') == field
                                         for e in r['evidence'] for b in before_evidence) and r['statistics'][field] is not None]
        if case['expected'] is None:
            self.assertEqual(matching, [], case['reason'])
            for b in before_evidence:
                self.assertTrue(any(e['start'] <= b['start'] and b['end'] <= e['end'] for r in rows for e in r['candidates']), 'Rejected evidence was lost')
        else:
            self.assertEqual(len(matching), 1)
            r = matching[0]
            self.assertEqual(r['statistics'][field], case['expected'])
            self.assertEqual((r['assessment']['kind'], r['assessment']['number'], r['scope'], r['component']), case['identity'])
            for f, value in case.get('keep', {}).items():
                self.assertEqual(r['statistics'][f], value)
        for r in rows:
            check_evidence(r, body)
    run.__doc__ = f"Full original {case['id']}: {case['old']} -> {case['expected']}; {case['reason']}"
    setattr(FullOriginalFollowupRegressions, 'test_' + case['name'], run)


if __name__ == '__main__':
    unittest.main()
