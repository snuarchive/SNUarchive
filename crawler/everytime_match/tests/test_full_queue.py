import json
from pathlib import Path
import tempfile
import unittest

from crawler.everytime_collect.raw import ObservationError
from crawler.everytime_match.full_queue import Campaign, create_campaign, failure_kind
from crawler.everytime_match.matching import write_new_json
from test_batch_queue import evidence, candidate


class FullQueueTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir='crawler/output')
        self.base=Path(self.tmp.name)
        self.catalog=self.base/'catalog.json'
        rows=[{'course_key':str(i),'title':f'합성 {i}','instructor':'교수 A'} for i in range(105)]
        write_new_json(self.catalog,rows)
        self.root=self.base/'campaign';self.manifest=create_campaign(self.catalog,self.root)
        self.c=Campaign(self.root)

    def tearDown(self):self.tmp.cleanup()

    def search(self,position,*,empty=False,url_number=None):
        title=self.c.entries[position]['title']
        path=self.base/f'search_{position}.json'
        write_new_json(path,evidence(title,[] if empty else [candidate(title,number=url_number or position)]))
        return path

    def test_full_catalog_partition_and_immutable_existing(self):
        self.assertEqual([b['input_count'] for b in self.manifest['batches']],[50,55])
        self.assertEqual(len(self.c.entries),105)
        with self.assertRaises(ObservationError):create_campaign(self.catalog,self.root)

    def test_not_found_checkpoint_skips_completed_on_restart(self):
        self.c.match(1,self.search(1,empty=True))
        resumed=Campaign(self.root)
        self.assertEqual(resumed.pending(1)[0]['position'],2)
        checkpoint=resumed.checkpoint(1)
        self.assertEqual(checkpoint['last_completed_input_position'],1)
        self.assertEqual(checkpoint['review_queues']['not_found'],[1])
        with self.assertRaises(ObservationError):resumed.begin(1)
        self.assertIsNone(resumed.stop_state())

    def test_missing_report_cannot_be_success_and_matched_resumes_collection(self):
        self.c.match(1,self.search(1))
        self.assertEqual(Campaign(self.root).pending(1)[0]['phase'],'collect')
        with self.assertRaises(ValueError):self.c.finish(1)

    def test_global_url_claim_prevents_cross_batch_duplicate_collection(self):
        self.c.match(1,self.search(1))
        r=self.c.match(51,self.search(51,url_number=1))
        self.assertEqual(r['status'],'ambiguous')
        self.assertIn('url_already_owned',r['reason'])
        self.assertEqual(self.c.results()[51]['status'],'ambiguous')

    def test_security_stops_immediately_and_cannot_auto_resume(self):
        self.c.finish(1,error='Access restriction displayed')
        self.assertEqual(self.c.stop_state()['kind'],'access_or_auth')
        with self.assertRaises(ObservationError):Campaign(self.root).pending(1)

    def test_repeat_failure_across_batches_stops_but_first_failure_preserved(self):
        self.c.finish(1,error='Course value missing or ambiguous')
        self.assertIsNone(self.c.stop_state())
        self.c.finish(51,error='Course value missing or ambiguous')
        self.assertEqual(self.c.stop_state()['patterns'],{'identity_structure':2})
        with self.assertRaises(ObservationError):self.c.begin(2)
        self.assertEqual(len(self.c.results()),2)

    def test_input_mutation_and_duplicate_keys_rejected(self):
        self.catalog.write_text('[]',encoding='utf-8')
        with self.assertRaises(ObservationError):Campaign(self.root)
        row={'course_key':'same','title':'x','instructor':'y'}
        self.catalog.write_text(json.dumps([row,row]),encoding='utf-8')
        with self.assertRaises(ObservationError):create_campaign(self.catalog,self.base/'other')

    def test_search_error_never_becomes_not_found(self):
        r=self.c.finish(1,error='Timeout waiting for cards')
        self.assertEqual(r['status'],'failed');self.assertIsNone(r['match_status'])
        self.assertEqual(r['error_kind'],'excessive_wait')

    def test_classifier_does_not_treat_limits_as_security(self):
        self.assertEqual(failure_kind('Search candidate limit; stop'),'execution_limit')
        self.assertEqual(failure_kind('Page changed or login expired'),'access_or_auth')
        self.assertEqual(failure_kind('Local transfer checksum mismatch'),'transfer_integrity')

    def test_recovered_pipeline_incident_and_second_partial_stop_restart(self):
        self.c.match(1,self.search(1,empty=True))
        evidence_path=self.base/'transfer_evidence.json'
        write_new_json(evidence_path,{'synthetic':True})
        self.c.record_incident(1,error_kind='transfer_integrity',error='Synthetic recovered transfer checksum mismatch',
                               evidence_paths=[evidence_path],recovered=True)
        self.assertIsNone(self.c.stop_state())
        self.assertEqual(self.c.results()[1]['status'],'not_found')
        self.c.match(2,self.search(2))
        self.c.finish(2,error='Synthetic repeated transfer checksum mismatch')
        self.assertEqual(self.c.stop_state()['patterns'],{'transfer_integrity':2})
        self.assertEqual(self.c.summary()['failure_patterns'],{'transfer_integrity':2})
        with self.assertRaises(ObservationError):Campaign(self.root).pending(1)
        with self.assertRaises(ObservationError):self.c.record_incident(2,error_kind='transfer_integrity',error='Duplicate')
        self.assertEqual(len(self.c.incidents()),1)

    def test_interrupted_capture_is_recovered_without_recollecting(self):
        self.c.match(1,self.search(1))
        self.c.begin_capture(1,self.base/'course_1')
        resumed=Campaign(self.root)
        self.assertEqual(resumed.pending(1)[0]['phase'],'recover')
        with self.assertRaises((ObservationError,FileExistsError)):
            resumed.begin_capture(1,self.base/'course_1')
        result=resumed.recover_capture(1)
        self.assertEqual(result['status'],'partial')
        self.assertEqual(result['stored_reviews'],0)
        self.assertEqual(result['error_kind'],'interrupted_capture')
        self.assertEqual(resumed.pending(1)[0]['position'],2)


if __name__=='__main__':unittest.main()
