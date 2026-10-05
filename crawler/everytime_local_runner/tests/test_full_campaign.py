"""Full-scope planning and immutable receipts; synthetic, no browser/site use."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from crawler.everytime_collect.raw import ObservationError
from crawler.everytime_local_runner import full_campaign as full
from crawler.everytime_local_runner.storage import write_new, sha


class FullCampaignTests(unittest.TestCase):
    def setUp(self):
        self.courses=[dict(course_key=str(n), title='same title', instructor='person'+str(n)) for n in range(3)]
        self.entries=[dict(item_id=p+'0001',priority=p,catalog_mapping='matched',catalog_course=c) for p,c in zip('ABC',self.courses)]

    def test_all_priorities_preserved_and_same_title_different_professors_not_merged(self):
        entries,extra=full.assemble(self.courses,self.entries,{'0':{'status':'complete'}})
        self.assertEqual([e['priority'] for e in entries],list('ABC'))
        self.assertEqual(len(entries),3); self.assertFalse(extra)
        self.assertIsNotNone(entries[0]['reuse']); self.assertIsNone(entries[1]['reuse'])

    def test_subset_is_not_full_catalog_success(self):
        with self.assertRaises(ObservationError):full.assemble(self.courses,self.entries[:1],{})

    def test_duplicates_and_changed_catalog_are_rejected(self):
        with self.assertRaises(ObservationError):full.assemble(self.courses,self.entries+self.entries[:1],{})
        changed=deepcopy(self.entries); changed[0]['catalog_course']['instructor']='another'
        with self.assertRaises(ObservationError):full.assemble(self.courses,changed,{})

    def test_missing_original_label_is_a_sidecar_not_guessed_course(self):
        extra=dict(item_id='A0002',priority='A',catalog_mapping='missing',catalog_course=None)
        entries,holds=full.assemble(self.courses,self.entries+[extra],{})
        self.assertEqual(len(entries),3);self.assertEqual(holds,[extra])

    def test_unrelated_reuse_is_rejected(self):
        with self.assertRaises(ObservationError):full.assemble(self.courses,self.entries,{'other':{}})

    def test_partial_legacy_is_not_reused_as_complete(self):
        self.assertIsNone(full.legacy_reuse({'previous_result':{'collection_status':'partial'}}))

    def test_receipt_mutation_rejected_and_incomplete_checkpoint_does_not_erase_prior(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);receipt=root/'receipt.json'
            write_new(receipt,{'status':'partial','item_id':'B0001'})
            write_new(root/'checkpoints/00001.json',{'plan_sha256':'sealed','results':{'B0001':{'file':str(receipt),'sha256':sha(receipt)}}})
            (root/'checkpoints/00002.json').write_text('{')
            spec={'root':str(root),'plan_sha256':'sealed','item_ids':['B0001']}
            self.assertEqual(full.states(spec)['B0001']['status'],'partial')
            receipt.write_text('{}')
            with self.assertRaises(ObservationError):full.states(spec)

    def test_partial_catalog_is_not_reported_complete(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);write_new(root/'reuse.json',{'a':{'status':'complete','reviews_saved':2}})
            plan={'catalog_count':2,'reuse_file':str(root/'reuse.json'),'shards':[{}],'catalog_mapping_holds':0}
            with patch.object(full,'verify',return_value=plan),patch.object(full,'states',return_value={'b':{'status':'partial','reviews_saved':1}}):
                plan['shards'][0]={'priority':'B','root':'synthetic'}
                result=full.summary(root)
            self.assertTrue(result['first_pass_finished']);self.assertFalse(result['collection_complete'])
            self.assertEqual(result['unresolved_count'],1)


if __name__=='__main__':unittest.main()
