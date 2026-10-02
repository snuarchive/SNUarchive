"""Offline A/B/C prioritization. Exact catalog labels only; no browser or extractor."""
from collections import Counter, defaultdict
from pathlib import Path
import argparse
import json
import re
import zipfile
import xml.etree.ElementTree as ET

from .full_queue import Campaign, read, sha, now
from .matching import write_new_json
from crawler.everytime_collect.run_v2 import require


def read_statistics_xlsx(path):
    ns = {'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    relns = {'r':'http://schemas.openxmlformats.org/package/2006/relationships'}
    with zipfile.ZipFile(path) as z:
        workbook = ET.fromstring(z.read('xl/workbook.xml'))
        sheets = workbook.findall('s:sheets/s:sheet',ns)
        require(len(sheets)==1 and sheets[0].get('name')=='시험점수 통계량', 'Unexpected XLSX sheets')
        relationships = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        rel_id = sheets[0].get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
        target = next(r.get('Target') for r in relationships.findall('r:Relationship',relns) if r.get('Id')==rel_id)
        target = target.lstrip('/') if target.startswith('/') else 'xl/'+target
        strings=[]
        if 'xl/sharedStrings.xml' in z.namelist():
            strings=[''.join(t.text or '' for t in s.iter('{'+ns['s']+'}t')) for s in ET.fromstring(z.read('xl/sharedStrings.xml'))]
        rows=[]
        for row in ET.fromstring(z.read(target)).findall('s:sheetData/s:row',ns):
            values={}
            for cell in row:
                require(cell.find('s:f',ns) is None, 'Formula requires separate evaluation; do not read as raw statistics')
                value=cell.findtext('s:v',None,ns)
                if cell.get('t')=='s':value=strings[int(value)]
                elif cell.get('t')=='inlineStr':value=''.join(t.text or '' for t in cell.findall('.//s:t',ns))
                values[re.sub(r'\d+$','',cell.get('r'))]=value
            if int(row.get('r'))==1:
                require(values=={'A':'교수','B':'강의','C':'통계량'}, 'Unexpected XLSX headers')
                continue
            if not any(v is not None for v in values.values()):continue
            require(isinstance(values.get('A'),str) and isinstance(values.get('B'),str), 'Missing source course identity')
            rows.append({'sheet':sheets[0].get('name'),'row':int(row.get('r')),
                         'title':values['B'],'instructor':values['A'],'statistics_text':values.get('C')})
        return rows


def candidate_norm(value):
    # Used only to flag ambiguity, never to confirm a catalog association.
    return re.sub(r'\s+','',value or '').lower()


def map_catalog(title,instructor,catalog):
    exact=[c for c in catalog if c['title']==title and c['instructor']==instructor]
    unknown=not instructor or instructor.strip() in ('','미정','담당교수','-','Staff','STAFF')
    if len(exact)==1 and not unknown:return 'matched',exact[0],[], 'one_exact_original_title_and_instructor'
    near=[c for c in catalog if candidate_norm(c['title'])==candidate_norm(title) and
          (candidate_norm(c['instructor'])==candidate_norm(instructor) or unknown)]
    if exact or near or unknown:
        return 'ambiguous_mapping',None,exact or near,'unknown_or_multiple_identity' if unknown or len(exact)>1 else 'spelling_difference_only_candidate'
    same_title=[c for c in catalog if candidate_norm(c['title'])==candidate_norm(title)]
    return 'missing',None,same_title,'title_exists_but_requested_instructor_absent' if same_title else 'no_catalog_identity_candidate'


def create_priority_plan(catalog_path,xlsx_path,numeric_path,previous_campaign,destination):
    destination=Path(destination)
    require(not destination.exists(), 'Use a new destination; preserve previous queues')
    catalog=json.loads(Path(catalog_path).read_text(encoding='utf-8'))
    previous=Campaign(previous_campaign)
    require(sha(catalog_path)==previous.manifest['catalog_sha256'], 'Catalog differs from audited campaign')
    old=previous.results();old_by_key={r['input']['course_key']:r for r in old.values()}
    require(len(old_by_key)==len(old), 'Repeated old course identity')
    for r in old.values():
        if r['run_report']:require(sha(r['run_report'])==r['report_sha256'], 'Previous report checksum mismatch')
        for raw in r['raw_files']:require(sha(raw['path'])==raw['sha256'], 'Previous raw checksum mismatch')
    statistics=read_statistics_xlsx(xlsx_path)
    numeric=json.loads(Path(numeric_path).read_text(encoding='utf-8'))
    xgroups=defaultdict(list);ngroups=defaultdict(list)
    for row in statistics:xgroups[(row['title'],row['instructor'])].append(row['row'])
    for index,row in enumerate(numeric,1):
        require(all(k in row for k in ('강의명','교수','댓글')), 'Numeric JSON shape changed')
        ngroups[(row['강의명'],row['교수'])].append(index)
    sources={'catalog':{'path':str(Path(catalog_path).resolve()),'sha256':sha(catalog_path)},
        'xlsx':{'path':str(Path(xlsx_path).resolve()),'sha256':sha(xlsx_path),'sheet':'시험점수 통계량'},
        'numeric_json':{'path':str(Path(numeric_path).resolve()),'sha256':sha(numeric_path)},
        'previous_manifest':{'path':str(previous.root/'manifest.json'),'sha256':sha(previous.root/'manifest.json')}}
    entries=[];used=set();candidate_holds=defaultdict(list)
    def append(priority,pair,course=None):
        title,instructor=pair
        if priority=='C':
            status,candidates,reason='matched',[],'remaining_catalog_course'
            require(course is not None, 'Missing catalog course')
        else:status,course,candidates,reason=map_catalog(title,instructor,catalog)
        key=course['course_key'] if course else None
        if key:
            require(key not in used, 'Two priority sources claim one catalog course')
            used.add(key)
        ordinal=sum(e['priority']==priority for e in entries)+1
        item_id=f'{priority}{ordinal:04d}'
        for c in candidates:
            if status=='ambiguous_mapping':candidate_holds[c['course_key']].append(item_id)
        existing=old_by_key.get(key)
        existing_match_path=previous.folder(existing['position'])/'match.json' if existing else None
        existing_match=read(existing_match_path) if existing_match_path else None
        entry={'item_id':item_id,'priority':priority,'course_key':key,
            'course_key_role':'queue_dedup_and_matching_candidate_only_not_database_id',
            'catalog_mapping':status,'mapping_reason':reason,'catalog_course':course,
            'catalog_title':course['title'] if course else None,'catalog_instructor':course['instructor'] if course else None,
            'original_title':title if priority!='C' else None,'original_instructor':instructor if priority!='C' else None,
            'has_statistics_xlsx':pair in xgroups,'has_numeric_review_json':pair in ngroups,
            'xlsx_rows':xgroups.get(pair,[]),'numeric_json_entries':ngroups.get(pair,[]),
            'offerings':course['offerings'] if course else [],'catalog_candidates':candidates,
            'previous_result':existing,'previous_result_path':str(previous.folder(existing['position'])/'result.json') if existing else None,
            'previous_result_sha256':sha(previous.folder(existing['position'])/'result.json') if existing else None,
            'previous_match':existing_match,
            'everytime_match_status':existing['match_status'] if existing else None,
            'everytime_collection_status':existing['collection_status'] if existing else 'not_started',
            'everytime_url':existing['url'] if existing else None,
            'state':'completed' if existing and existing['collection_status']=='complete' else existing['status'] if existing else
                    status if status!='matched' else 'pending_search',
            'source_references':{'xlsx':sources['xlsx'] if pair in xgroups else None,'numeric_json':sources['numeric_json'] if pair in ngroups else None}}
        entries.append(entry)
    for pair in xgroups:append('A',pair)
    for pair in ngroups:
        if pair not in xgroups:append('B',pair)
    for c in catalog:
        if c['course_key'] not in used:append('C',(c['title'],c['instructor']),c)
    for e in entries:e['mapping_review_holds']=candidate_holds.get(e['course_key'],[])
    require(len(used)==len(catalog), 'Catalog coverage incomplete')
    summary={'created_at':now(),'sources':sources,'execution_scope':'A_only',
        'full_campaign_preserved':str(previous.root),'full_campaign_halt_preserved':previous.stop_state(),
        'xlsx_rows':len(statistics),'xlsx_unique_pairs':len(xgroups),'numeric_json_records':len(numeric),'numeric_json_unique_pairs':len(ngroups),
        'priority_counts':dict(Counter(e['priority'] for e in entries)),
        'catalog_mapping_counts':{p:dict(Counter(e['catalog_mapping'] for e in entries if e['priority']==p)) for p in ('A','B','C')},
        'reused_prior_results_by_priority':dict(Counter(e['priority'] for e in entries if e['previous_result'])),
        'reused_complete_by_priority':dict(Counter(e['priority'] for e in entries if e['state']=='completed')),
        'unique_catalog_keys':len(used),'total_priority_items':len(entries),
        'limits':{'inputs_per_batch':50,'search_scrolls':12,'search_candidates':160,'search_wait_ms':2000,'search_seconds':60,
                  'collector_scrolls':12,'collector_batches':20,'reviews_per_batch':20,'comparison_files':20,'repeated_transfer_failures_per_batch':2},
        'matching_policy':'Exact original title+instructor only; normalized equivalence is ambiguous_mapping; same title with a different person is missing.',
        'priority_order':'A before B before C; C execution not authorized in this run'}
    write_new_json(destination/'manifest.json',summary)
    write_new_json(destination/'source_statistics.json',{'source':sources['xlsx'],'rows':statistics})
    for priority in ('A','B','C'):
        group=[e for e in entries if e['priority']==priority]
        for start in range(0,len(group),50):
            write_new_json(destination/priority/f'batch_{start//50+1:04d}.json',{'priority':priority,'entries':group[start:start+50]})
    write_new_json(destination/'result_mapping.json',[{'item_id':e['item_id'],'priority':e['priority'],'course_key':e['course_key'],
                   'state':e['state'],'previous_result_path':e['previous_result_path'],'previous_result_sha256':e['previous_result_sha256']} for e in entries if e['previous_result']])
    return summary


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--catalog',default='public/courses.json');p.add_argument('--xlsx',default='crawler/data/private/everytime_시험점수_통계량.xlsx')
    p.add_argument('--numeric-json',default='crawler/data/private/everytime_강의평_숫자포함_전체 (1).json')
    p.add_argument('--previous-campaign',required=True);p.add_argument('--output',required=True)
    a=p.parse_args();print(json.dumps(create_priority_plan(a.catalog,a.xlsx,a.numeric_json,a.previous_campaign,a.output),ensure_ascii=False))
