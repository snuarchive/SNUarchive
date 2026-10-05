"""Synthetic end-to-end archive beyond CU limits; no live-site assertions."""
import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from crawler.everytime_collect.raw import ObservationError
from crawler.everytime_collect.run_v2 import validate_report as validate_legacy
from crawler.everytime_local_runner.storage import archive_batch, finalize, load_archive, sha, write_new
from crawler.everytime_local_runner.local_run_v2 import validate_report, validate_event


class ExtendedStorageTests(unittest.TestCase):
    def test_extended_archive_counts_duplicates_checksums_and_no_overwrite(self):
        fixture=Path(__file__).with_name('extended_fixture.cjs')
        events=json.loads(subprocess.run(['node',str(fixture)],capture_output=True,check=True).stdout)
        report=events[-1]['report']
        validate_report(report)
        with self.assertRaises(ObservationError): validate_legacy(report)
        forged=copy.deepcopy(report);forged['displayed_total']['value']+=1
        with self.assertRaises(ObservationError): validate_report(forged)
        for key,value in [('max_batches',201),('max_scrolls',301)]:
            forged=copy.deepcopy(report);forged['limits'][key]=value
            with self.assertRaises(ObservationError): validate_report(forged)
        forged=copy.deepcopy(report);forged['limits']['comparison_files']=20
        with self.assertRaises(ObservationError): validate_report(forged)
        forged=copy.deepcopy(events[0]);forged['batch']=201
        with self.assertRaises(ObservationError): validate_event(forged)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);run=root/'synthetic'
            for event in events:
                if event['type']=='batch':
                    write_new(run/'incoming'/f'event_{event["batch"]:03d}.json',event)
                    archive_batch(run,event['batch'],root=root)
            write_new(run/'incoming/ui_report.json',report)
            manifest=finalize(run,root=root)
            self.assertEqual(manifest['status'],'complete_for_observed_ui')
            self.assertEqual(manifest['details']['duplicate_candidates']['within_run_reviews'],1)
            rows,_=load_archive(run/'run_report.json')
            self.assertEqual(len(rows),1348)
            for name,checksum in manifest['files'].items(): self.assertEqual(sha(run/name),checksum)
            before=sha(run/'run_report.json')
            with self.assertRaises(FileExistsError): finalize(run,root=root)
            self.assertEqual(sha(run/'run_report.json'),before)
