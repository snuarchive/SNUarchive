"""Offline synthetic priority mapping tests; never access Everytime."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from crawler.everytime_collect.raw import ObservationError
from crawler.everytime_match.full_queue import Campaign, create_campaign, sha
from crawler.everytime_match.matching import write_new_json
from crawler.everytime_match.priority_queue import create_priority_plan, map_catalog
from crawler.everytime_match.priority_report import snapshot
from test_batch_queue import evidence, candidate


class PriorityQueueTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir='crawler/output')
        self.base = Path(self.tmp.name)
        self.courses = [{'course_key':str(i), 'title':f'강의 {i}', 'instructor':'교수 A',
                         'offerings':[{'year':2024,'semester':1},{'year':2025,'semester':1}]}
                        for i in range(6)]
        self.catalog = self.base/'catalog.json'
        write_new_json(self.catalog,self.courses)
        self.old = self.base/'old'
        create_campaign(self.catalog,self.old)
        self.xlsx = self.base/'source.xlsx'
        self.xlsx.write_bytes(b'synthetic source, reader mocked for grouping test')
        self.numeric = self.base/'numeric.json'
        write_new_json(self.numeric,[{'강의명':f'강의 {i}','교수':'교수 A','댓글':['synthetic']}
                                    for i in (0,1,2)])
        self.rows = [{'title':'강의 0','instructor':'교수 A','row':r,'statistics_text':'합성 통계'}
                     for r in (2,3)]

    def tearDown(self):
        self.tmp.cleanup()

    def build(self,destination=None):
        with patch('crawler.everytime_match.priority_queue.read_statistics_xlsx',return_value=self.rows):
            return create_priority_plan(self.catalog,self.xlsx,self.numeric,self.old,destination or self.base/'new')

    def entries(self):
        return [e for p in sorted((self.base/'new').glob('[ABC]/batch_*.json'))
                for e in json.loads(p.read_text(encoding='utf-8'))['entries']]

    def test_exact_only_and_original_labels_preserved(self):
        self.assertEqual(map_catalog('강의 0','교수 A',self.courses)[0],'matched')
        for title,professor in [('강의0','교수 A'),('강의 0','교수A'),('강의 0','교수 a')]:
            status,course,candidates,_=map_catalog(title,professor,self.courses)
            self.assertEqual(status,'ambiguous_mapping');self.assertIsNone(course)
            self.assertEqual(candidates[0]['course_key'],'0')
        self.assertEqual(map_catalog('강의 0','다른 교수',self.courses)[0],'missing')
        self.assertEqual(map_catalog('없는 강의','교수 A',self.courses)[0],'missing')

    def test_unknown_and_duplicate_identity_never_confirmed(self):
        for professor in ('','미정',None,'Staff'):
            self.assertEqual(map_catalog('강의 0',professor,self.courses)[0],'ambiguous_mapping')
        duplicate=[self.courses[0],dict(self.courses[0],course_key='other')]
        self.assertEqual(map_catalog('강의 0','교수 A',duplicate)[0],'ambiguous_mapping')

    def test_row_grouping_priority_exclusion_and_all_offerings(self):
        result=self.build();entries=self.entries()
        self.assertEqual(result['priority_counts'],{'A':1,'B':2,'C':3})
        self.assertEqual(result['xlsx_rows'],2)
        self.assertEqual(entries[0]['xlsx_rows'],[2,3])
        self.assertEqual(entries[0]['numeric_json_entries'],[1])
        self.assertEqual(len({e['course_key'] for e in entries}),6)
        self.assertEqual(entries[0]['offerings'],self.courses[0]['offerings'])
        self.assertEqual(entries[0]['original_title'],'강의 0')
        self.assertIn('not_database_id',entries[0]['course_key_role'])

    def test_ambiguous_source_held_and_not_used_as_catalog_claim(self):
        self.rows=[{'title':'강의0','instructor':'교수 A','row':2,'statistics_text':'synthetic'}]
        self.build();entries=self.entries()
        self.assertIsNone(entries[0]['course_key'])
        self.assertEqual(entries[0]['state'],'ambiguous_mapping')
        mapped=next(e for e in entries if e['course_key']=='0')
        self.assertEqual(mapped['priority'],'B')
        self.assertEqual(mapped['mapping_review_holds'],['A0001'])

    def test_previous_not_found_ambiguous_partial_carried_without_mutation(self):
        c=Campaign(self.old)
        searches=[evidence('강의 0',[]),evidence('강의 1',[candidate('강의 1','다른 교수',2)]),
                  evidence('강의 2',[candidate('강의 2',number=3)])]
        for i,search in enumerate(searches,1):
            path=self.base/f'search{i}.json';write_new_json(path,search);c.match(i,path)
        c.finish(3,error='Synthetic interruption',error_type='interrupted_capture')
        before={str(p):sha(p) for p in self.old.rglob('*') if p.is_file()}
        self.build();entries=self.entries()
        for i,status in enumerate(('not_found','ambiguous','partial')):
            e=next(e for e in entries if e['course_key']==str(i))
            self.assertEqual(e['state'],status)
            self.assertEqual(e['previous_result_sha256'],sha(e['previous_result_path']))
        self.assertEqual(before,{str(p):sha(p) for p in self.old.rglob('*') if p.is_file()})

    def test_new_destination_and_catalog_hash_are_mandatory(self):
        self.build()
        with self.assertRaises(ObservationError):self.build()
        self.catalog.write_text('[]',encoding='utf-8')
        with self.assertRaises(ObservationError):self.build(self.base/'another')

    def test_complete_reuse_keeps_raw_reference_and_rejects_hash_changes(self):
        c=Campaign(self.old)
        path=self.base/'search.json'
        write_new_json(path,evidence('강의 0',[candidate('강의 0')]))
        c.match(1,path)
        raw=self.base/'old_raw.json';report=self.base/'old_report.json'
        write_new_json(raw,{'synthetic':True,'reviews':[]})
        write_new_json(report,{'synthetic':True})
        record={'position':1,'input':self.courses[0],'status':'matched',
                'match_status':'matched','collection_status':'complete',
                'url':'https://everytime.kr/lecture/view/1',
                'run_report':str(report.resolve()),'report_sha256':sha(report),
                'raw_files':[{'path':str(raw.resolve()),'sha256':sha(raw),'reviews':0}]}
        write_new_json(c.folder(1)/'result.json',record)
        self.build();entry=self.entries()[0]
        self.assertEqual(entry['state'],'completed')
        self.assertEqual(entry['previous_result']['raw_files'],record['raw_files'])
        self.assertEqual(len(list((self.base/'new').rglob('raw.json'))),0)
        raw.write_text('{"changed":true}',encoding='utf-8')
        with self.assertRaisesRegex(ObservationError,'checksum mismatch'):
            self.build(self.base/'reject_changed_raw')
        self.assertFalse((self.base/'reject_changed_raw').exists())

    def test_execution_snapshot_distinguishes_missing_pending_and_not_found(self):
        root=self.base/'execution'
        self.rows.append({'title':'없는 강의','instructor':'교수 A','row':4,'statistics_text':'synthetic'})
        self.build(root/'queue')
        executable=self.base/'a_catalog.json';write_new_json(executable,[self.courses[0]])
        create_campaign(executable,root/'A_campaign')
        write_new_json(root/'A_execution_mapping.json',[{'position':1,'item_id':'A0001','course_key':'0'}])
        before=snapshot(root,root/'before')
        self.assertEqual(before['everytime_matching'],{'not_attempted':2})
        self.assertEqual(before['remaining_executable_A'],1)
        path=self.base/'empty_search.json';write_new_json(path,evidence('강의 0',[]))
        Campaign(root/'A_campaign').match(1,path)
        after=snapshot(root,root/'after')
        self.assertEqual(after['everytime_matching'],{'not_found':1,'not_attempted':1})
        self.assertEqual(after['collection'],{'not_collected':1,'not_started':1})
        self.assertEqual(after['catalog_mapping'],{'matched':1,'missing':1})
        self.assertEqual(after['remaining_executable_A'],0)
        with self.assertRaises(ObservationError):snapshot(root,root/'after')


if __name__=='__main__':unittest.main()
