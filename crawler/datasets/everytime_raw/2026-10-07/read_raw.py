"""Portable raw reader/verifier. Python standard library only; no network/DB.

Default iteration skips exact repeat-capture references, not repeated reviews
inside a capture. Use --include-repeat-captures to inspect the preserved whole.
"""
import argparse
from collections import Counter
from contextlib import ExitStack
from functools import lru_cache
import gzip
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile


def require(condition,message):
    if not condition:raise ValueError(message)


def sha_bytes(value):return hashlib.sha256(value).hexdigest()
def sha_file(path):
    with Path(path).open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def jsonl(path):
    with gzip.open(path,'rt',encoding='utf8') as stream:
        for line in stream:yield json.loads(line)


class RawDataset:
    def __init__(self,root):
        self.root=Path(root)
        self.files={r['sha256']:r for r in jsonl(self.root/'raw_files.jsonl.gz')}
        self.stack=ExitStack();self.zips={}
        self.document=lru_cache(maxsize=32)(self._document)
    def __enter__(self):return self
    def __exit__(self,*args):self.document.cache_clear();self.stack.close()
    def _document(self,sha):
        item=self.files[sha];name=item['archive']
        if Path(name).name!=name:raise ValueError('Invalid archive reference')
        if name not in self.zips:self.zips[name]=self.stack.enter_context(ZipFile(self.root/name))
        value=self.zips[name].read(item['member'])
        if sha_bytes(value)!=sha or len(value)!=item['bytes']:raise ValueError('Delivered raw checksum mismatch')
        return json.loads(value)
    def captures(self):return jsonl(self.root/'captures.jsonl.gz')
    def reviews(self,include_repeat_captures=False,lecture_url=None):
        for capture in self.captures():
            if not include_repeat_captures and not capture['selected_representative']:continue
            if lecture_url and capture['canonical_url']!=lecture_url.split('?')[0].rstrip('/'):continue
            for ref in capture['reviews']:
                raw=self.document(ref['file_sha256'])
                obj=raw
                for p in ref['json_pointer'].strip('/').split('/'):
                    obj=obj[int(p)] if isinstance(obj,list) else obj[p]
                if sha_bytes(obj['text_raw'].encode('utf8'))!=ref['body_sha256']:raise ValueError('Review checksum mismatch')
                if obj['enrollment_term_raw']!=ref['enrollment_term_raw']:raise ValueError('Enrollment term differs')
                yield {'capture_id':capture['capture_id'],'capture_status':capture['status'],
                       'selected_representative':capture['selected_representative'],
                       'course_title':capture['course_title'],'instructor':capture['instructor'],
                       'source_url':capture['source_url'],'review_reference':ref,'raw_review':obj}
    def verify(self):
        manifest=json.loads((self.root/'manifest.json').read_text(encoding='utf8'))
        for name,expected in manifest['files'].items():
            if Path(name).name!=name or sha_file(self.root/name)!=expected:raise ValueError('Package checksum mismatch: '+name)
        registry=list(jsonl(self.root/'raw_files.jsonl.gz'))
        require(len(registry)==len(self.files),'Duplicate raw registry entry')
        expected_members={}
        for item in registry:expected_members.setdefault(item['archive'],set()).add(item['member'])
        for name,members in expected_members.items():
            require(Path(name).name==name,'Invalid archive name')
            with ZipFile(self.root/name) as archive:
                require(len(archive.namelist())==len(members) and set(archive.namelist())==members,'Archive members differ')
        for sha in self.files:self.document(sha)
        counts=Counter();capture_ids=set();selected=0;selected_ids=set()
        for c in self.captures():
            if c['capture_id'] in capture_ids:raise ValueError('Repeated capture ID')
            capture_ids.add(c['capture_id']);counts[c['status']]+=1
            if len(c['reviews'])!=c['reviews_saved']:raise ValueError('Capture count mismatch')
            if c['selected_representative']:selected+=1;selected_ids.add(c['capture_id'])
        all_count=sum(1 for _ in self.reviews(True));representative=sum(1 for _ in self.reviews())
        summary=json.loads((self.root/'summary.json').read_text(encoding='utf8'))
        require(all_count==summary['all_review_occurrences'],'All review count differs')
        require(representative==summary['selected_review_occurrences'],'Selected review count differs')
        require(len(capture_ids)==summary['capture_count'] and selected==summary['representative_capture_count'],'Capture count differs')
        require(dict(counts)==summary['capture_statuses'],'Capture statuses differ')
        require(len(self.files)==summary['unique_raw_documents'],'Raw document count differs')
        require(sum(r['bytes'] for r in registry)==summary['raw_bytes'],'Raw byte count differs')
        groups=list(jsonl(self.root/'capture_groups.jsonl.gz'))
        members=[m for g in groups for m in g['members']]
        require(len(members)==len(capture_ids) and set(members)==capture_ids,'Dedup group coverage differs')
        require({g['representative'] for g in groups}==selected_ids,'Representative selection differs')
        require(sum(g['excluded_repeat_occurrences'] for g in groups)==all_count-representative,'Excluded occurrence count differs')
        require(sum(1 for _ in jsonl(self.root/'uncertain_capture_pairs.jsonl.gz'))==summary['uncertain_capture_pairs'],'Uncertain capture count differs')
        catalog=list(jsonl(self.root/'course_catalog.jsonl.gz'));outcomes=list(jsonl(self.root/'catalog_outcomes.jsonl.gz'))
        require(len(catalog)==len(outcomes)==summary['catalog_combinations'],'Catalog size differs')
        require(dict(Counter(r['status'] for r in outcomes))==summary['catalog_outcomes'],'Catalog statuses differ')
        return {'verified':True,'raw_documents':len(self.files),'captures':len(capture_ids),
                'all_review_occurrences':all_count,'selected_review_occurrences':representative,
                'catalog_combinations':len(catalog),'raw_bytes_preserved':summary['raw_documents_preserved_byte_for_byte'],
                'masked_reviews':summary.get('masked_reviews',0),
                'local_originals_preserved':summary.get('local_originals_preserved',True)}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',default=str(Path(__file__).parent))
    parser.add_argument('--verify',action='store_true')
    parser.add_argument('--include-repeat-captures',action='store_true')
    parser.add_argument('--lecture-url')
    parser.add_argument('--limit',type=int,default=1)
    args=parser.parse_args()
    with RawDataset(args.root) as data:
        if args.verify:print(json.dumps(data.verify(),ensure_ascii=False))
        else:
            if args.limit<=0:parser.error('--limit must be positive')
            for i,row in enumerate(data.reviews(args.include_repeat_captures,args.lecture_url)):
                print(json.dumps(row,ensure_ascii=False))
                if i+1>=args.limit:break
