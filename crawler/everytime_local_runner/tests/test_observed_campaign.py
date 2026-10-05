"""Synthetic, no browser/network: provenance and unapproved catalog separation."""
import json
from pathlib import Path
import tempfile
import subprocess
import unittest
from unittest.mock import patch
from crawler.everytime_collect.raw import ObservationError
from crawler.everytime_local_runner import campaign,observed_campaign as oc
from crawler.everytime_local_runner.storage import write_new,sha,archive_batch,finalize

class ObservedCampaignTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);self.root=Path(temp.name)
        for module in (campaign,oc):
            p=patch.object(module,'ROOT',self.root);p.start();self.addCleanup(p.stop)
        self.target={'url':'https://everytime.kr/lecture/view/12345','title':'합성강의','instructor':'합성교수'}
        self.evidence=self.root/'evidence.json'
        write_new(self.evidence,{'search':{'candidates':[dict(self.target,position=1)]}})
        identity=self.root/'remaining_identity_source_comparison_01.json'
        write_new(identity,{'items':[{'item_id':'C1','course':{'title':'합성강의','instructor':'미정'},
                                     'evidence_file':str(self.evidence),'evidence_sha256':sha(self.evidence)}]})
        coverage=self.root/'remaining_observed_url_coverage_01.json'
        write_new(coverage,{'source_sha256':sha(identity)})
        self.proposal=self.root/'proposal.json'
        write_new(self.proposal,{'source_sha256':sha(coverage),'observed_targets':[{'target':self.target,'catalog_items':['C1']}]})
        self.master=self.root/'new';self.shard=self.root/'new_O_0001'

    def test_separate_scope_never_approves_catalog_and_never_overwrites(self):
        result=oc.create(self.proposal,self.master,expected_count=1)
        self.assertEqual(result['pending'],1)
        entry=campaign.pending(self.shard)[0]
        self.assertFalse(entry['catalog_mapping_approved'])
        self.assertEqual(entry['target']['instructor'],'합성교수')
        before=sha(self.master/'plan.json')
        with self.assertRaises(ObservationError):oc.create(self.proposal,self.master,expected_count=1)
        self.assertEqual(sha(self.master/'plan.json'),before)

    def test_url_not_observed_rejected_before_output(self):
        p=json.loads(self.proposal.read_text());p['observed_targets'][0]['target']['url']='https://everytime.kr/lecture/view/9999'
        self.proposal.write_text(json.dumps(p))
        with self.assertRaises(ObservationError):oc.create(self.proposal,self.master,expected_count=1)
        self.assertFalse(self.master.exists())

    def test_observed_provenance_changed_blocks_resume(self):
        oc.create(self.proposal,self.master,expected_count=1)
        self.evidence.write_bytes(self.evidence.read_bytes()+b' ')
        with self.assertRaises(ObservationError):campaign.pending(self.shard)

    def test_duplicate_url_and_scope_count_rejected(self):
        with self.assertRaises(ObservationError):oc.create(self.proposal,self.master,expected_count=2)
        p=json.loads(self.proposal.read_text());p['observed_targets']*=2
        self.proposal.write_text(json.dumps(p))
        with self.assertRaises(ObservationError):oc.create(self.proposal,self.master,expected_count=2)

    def test_record_rejects_other_target_before_reading_raw(self):
        oc.create(self.proposal,self.master,expected_count=1)
        run=self.root/'run'
        write_new(run/'run_report.json',{'ui_observation':{'target':dict(self.target,instructor='다른교수')}})
        with self.assertRaises(ObservationError):oc.record(self.shard,'O00001',run)
        self.assertEqual(campaign.summary(self.shard)['recorded'],0)

    def test_full_record_audit_and_resume_preserve_unapproved_mapping(self):
        oc.create(self.proposal,self.master,expected_count=1)
        fixture=Path(__file__).resolve().parents[2]/'everytime_collect/tests/fake_browser.cjs'
        events=json.loads(subprocess.run(['node',str(fixture)],capture_output=True,check=True).stdout)['small']
        run=self.root/'archive'
        for event in events:
            if event['type']=='batch':
                write_new(run/'incoming'/f'event_{event["batch"]:03d}.json',event)
                archive_batch(run,event['batch'],root=self.root)
        write_new(run/'incoming/ui_report.json',events[-1]['report']);finalize(run,root=self.root)
        receipt=oc.record(self.shard,'O00001',run)
        self.assertEqual(receipt['status'],'complete');self.assertFalse(receipt['catalog_mapping_approved'])
        self.assertEqual(campaign.pending(self.shard),[])
        self.assertEqual(oc.audit(self.shard,self.root/'audit.json')['reviews'],3)
        self.assertTrue(oc.master_summary(self.master)['collection_complete'])
        raw=run/'batch_001/raw.json';raw.write_bytes(raw.read_bytes()+b' ')
        with self.assertRaises(ObservationError):oc.audit(self.shard,self.root/'bad_audit.json')
