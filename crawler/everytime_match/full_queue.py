"""Offline, append-only full-catalog queue. Browser traffic stays in approved cua_repl."""
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
import argparse
import hashlib
import json

from crawler.everytime_collect.run_v2 import private_json, require, stamp, validate_report
from .matching import match_course, collector_target, write_new_json

TERMINAL = {'matched', 'ambiguous', 'not_found', 'partial', 'failed'}
SECURITY = ('login', 'captcha', 'security', 'policy', 'access restriction', 'access denied',
            'rate limit', 'too many requests', '로그인', '접근 제한', '보안 정책')


def now():
    return datetime.now(timezone.utc).isoformat()


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    return private_json(path)[2]


def failure_kind(reason):
    text = (reason or '').lower()
    if any(s in text for s in SECURITY): return 'access_or_auth'
    if 'transfer' in text and 'checksum' in text: return 'transfer_integrity'
    if 'course value' in text or 'course label' in text: return 'identity_structure'
    if 'identity differs' in text: return 'identity_mismatch'
    if 'search' in text and ('changed' in text or 'missing' in text or 'scope' in text): return 'search_structure'
    if 'count' in text or 'total_mismatch' in text: return 'count_mismatch'
    if 'limit' in text: return 'execution_limit'
    if 'timeout' in text or 'wait' in text: return 'excessive_wait'
    if 'list' in text or 'body_' in text or 'term_' in text: return 'review_structure'
    return 'other_error'


def create_campaign(catalog_path, destination, batch_size=50):
    require(type(batch_size) is int and 50 <= batch_size <= 100, 'Batch size must be 50..100')
    destination = Path(destination)
    require(not destination.exists(), 'Campaign exists; resume instead of overwriting')
    data = Path(catalog_path).read_bytes()
    catalog = json.loads(data)
    require(isinstance(catalog, list) and len(catalog) > 0, 'Empty catalog')
    require(len({c['course_key'] for c in catalog}) == len(catalog), 'Duplicate catalog keys; cannot create stable checkpoint')
    for c in catalog:
        require(isinstance(c['title'], str) and bool(c['title'].strip()) and
                (c.get('instructor') is None or isinstance(c['instructor'], str)), 'Invalid catalog labels')
    groups = [catalog[i:i+batch_size] for i in range(0, len(catalog), batch_size)]
    if len(groups) > 1 and len(groups[-1]) < 50 and len(groups[-2]) + len(groups[-1]) <= 100:
        groups[-2].extend(groups.pop())
    identities = defaultdict(list)
    for c in catalog: identities[(c['title'], c.get('instructor'))].append(c['course_key'])
    batches, position = [], 1
    for number, courses in enumerate(groups, 1):
        path = destination/'batches'/f'{number:04d}'/'inputs.json'
        entries = [{'position': position+i, 'course': c} for i,c in enumerate(courses)]
        write_new_json(path, {'batch': number, 'entries': entries})
        batches.append({'number': number, 'input_count': len(courses), 'start': position,
                        'end': position+len(courses)-1, 'path': str(path.resolve()), 'sha256': sha(path)})
        position += len(courses)
    manifest = {'version': 1, 'created_at': now(), 'catalog_path': str(Path(catalog_path).resolve()),
                'catalog_sha256': hashlib.sha256(data).hexdigest(), 'input_count': len(catalog),
                'batch_size': batch_size, 'batches': batches,
                'duplicate_input_identities': [keys for keys in identities.values() if len(keys)>1],
                'limits': {'search_candidates':160,'search_scrolls':12,'search_wait_ms':2000,
                    'search_seconds':60,'collector_scrolls':12,'collector_batches':20,'reviews_per_batch':20,
                    'comparison_files':20,'repeated_error_threshold':2}}
    write_new_json(destination/'manifest.json', manifest)
    return manifest


class Campaign:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.manifest = read(self.root/'manifest.json')
        require(sha(self.manifest['catalog_path']) == self.manifest['catalog_sha256'], 'Catalog changed; do not silently resume')
        self.entries = {}
        self.batch_for = {}
        for b in self.manifest['batches']:
            require(sha(b['path']) == b['sha256'], 'Batch input changed')
            for e in read(b['path'])['entries']:
                self.entries[e['position']] = e['course']
                self.batch_for[e['position']] = b['number']

    def folder(self, position):
        require(position in self.entries, 'Position outside catalog')
        return self.root/'batches'/f'{self.batch_for[position]:04d}'/'entries'/f'{position:05d}'

    def results(self):
        return {int(p.parent.name): read(p) for p in self.root.glob('batches/*/entries/*/result.json')}

    def owners(self):
        owners = {}
        for p in self.root.glob('batches/*/entries/*/match.json'):
            r = read(p)
            if r['status'] == 'matched':
                url = r['target']['url']
                require(url not in owners, 'Existing duplicate URL claims; stop')
                owners[url] = r['position']
        return owners

    def incidents(self):
        return [read(p) for p in sorted((self.root/'incidents').glob('*.json'))]

    def record_incident(self, position, *, error_kind, error, evidence_paths=(), recovered=False):
        """Record a recovered pipeline failure without rewriting a completed course result.

        Do not also record an incident for a failure already represented by result.json.
        """
        self.folder(position)
        require(error_kind in ('transfer_integrity', 'access_or_auth'), 'Unsupported pipeline incident')
        result = self.results().get(position)
        require(not result or result.get('error_kind') != error_kind, 'Failure already recorded in result')
        record = {'position':position, 'error_kind':error_kind, 'error':str(error),
                  'recovered':bool(recovered), 'recorded_at':now(),
                  'evidence':[{'path':str(Path(p).resolve()), 'sha256':sha(p)} for p in evidence_paths]}
        write_new_json(self.root/'incidents'/f'{position:05d}_{error_kind}.json',record)
        self.checkpoint(self.batch_for[position])
        return record

    def failure_counts(self):
        return Counter(r['error_kind'] for r in [*self.results().values(), *self.incidents()] if r.get('error_kind'))

    def stop_state(self):
        counts = self.failure_counts()
        if counts['access_or_auth']: return {'kind':'access_or_auth','count':counts['access_or_auth']}
        repeated = {k:n for k,n in counts.items() if n >= 2}
        return {'kind':'repeated_failure','patterns':repeated} if repeated else None

    def pending(self, batch):
        require(not self.stop_state(), 'Campaign halted; do not automatically resume a restriction/repeated failure')
        done = self.results()
        return [{'position':p,'course':c,'phase':'recover' if (self.folder(p)/'capture_started.json').exists()
                 else 'collect' if (self.folder(p)/'match.json').exists() else 'search'}
                for p,c in self.entries.items() if self.batch_for[p] == batch and p not in done]

    def begin_capture(self, position, destination):
        self.begin(position)
        match = read(self.folder(position)/'match.json')
        require(match['status'] == 'matched', 'Only matched inputs may collect')
        destination = Path(destination).resolve()
        require(not destination.exists(), 'Capture destination exists; recover instead of collecting again')
        record = {'position':position, 'started_at':now(), 'output':str(destination)}
        write_new_json(self.folder(position)/'capture_started.json', record)
        return record

    def recover_capture(self, position):
        """No browser work on restart: finalize existing evidence or preserve as partial."""
        self.begin(position)
        record = read(self.folder(position)/'capture_started.json')
        output = Path(record['output'])
        report = output/'run_report.json'
        if report.exists(): return self.finish(position, report)
        return self.finish(position, error='Interrupted capture; existing batches retained without recollection',
                           error_type='interrupted_capture', partial_raw=sorted(output.glob('batch_*/raw.json')))

    def begin(self, position):
        require(not self.stop_state(), 'Campaign halted')
        folder = self.folder(position)
        require(not (folder/'result.json').exists(), 'Completed input must be skipped')
        path = folder/'started.json'
        if not path.exists(): write_new_json(path, {'position':position,'course_key':self.entries[position]['course_key'],'started_at':now()})
        return read(path)

    def match(self, position, search_path, *, historical_report=None):
        self.begin(position)
        e = read(search_path)
        require(e.get('evidence_version') == 2 or historical_report is not None, 'Full queue requires validated UI search v2')
        r = match_course(self.entries[position], e)
        target = collector_target(r) if r['status']=='matched' else None
        if historical_report is not None:
            archived = read(historical_report);ui=archived['ui_observation'];validate_report(ui)
            require(target is not None and ui['status']=='complete' and
                    ui['target']==dict(target,url=target['url']+'?tab=article'), 'Historical import is not verified complete')
        reason = r['reason']
        if target and target['url'] in self.owners():
            reason = 'url_already_owned_by_input_' + str(self.owners()[target['url']])
            r['status'], target = 'ambiguous', None
        if any(self.entries[position]['course_key'] in keys for keys in self.manifest['duplicate_input_identities']):
            reason, r['status'], target = 'duplicate_catalog_identity', 'ambiguous', None
        record = {'position':position,'course_key':self.entries[position]['course_key'], 'status':r['status'],
                  'reason':reason,'target':target,'search_path':str(Path(search_path).resolve()),
                  'search_sha256':sha(search_path),'observed_candidates':len(e['candidates']),'matched_at':now()}
        write_new_json(self.folder(position)/'match.json', record)
        if record['status'] != 'matched': self.finish(position)
        return record

    def finish(self, position, report_path=None, *, error=None, error_type=None, partial_raw=()):
        started = self.begin(position)
        folder = self.folder(position)
        match = read(folder/'match.json') if (folder/'match.json').exists() else None
        if match:
            require(sha(match['search_path']) == match['search_sha256'], 'Stored search changed')
        result = {'position':position,'input':self.entries[position], 'started_at':started['started_at'],
                  'finished_at':now(),'match_status':match['status'] if match else None,
                  'match_path':str(folder/'match.json') if match else None,
                  'url':match['target']['url'] if match and match['target'] else None,
                  'status':match['status'] if match else 'failed','collection_status':'not_collected',
                  'displayed_reviews':None,'stored_reviews':0,'raw_files':[], 'run_report':None,
                  'ui_end_confirmed':False,'error_kind':None,'error':None}
        if report_path:
            require(match and match['status']=='matched', 'Only matched inputs may collect')
            archive = read(report_path); ui = archive['ui_observation']; validate_report(ui)
            target = dict(match['target'],url=match['target']['url']+'?tab=article')
            require(ui['target'] == target and archive['reviews_saved']==ui['succeeded'], 'Archive identity/count mismatch')
            for b in archive['batches']:
                if b['raw_sha256'] is None: continue
                raw = Path(report_path).parent/b['directory']/'raw.json'
                require(sha(raw)==b['raw_sha256'], 'Archived raw checksum mismatch')
                result['raw_files'].append({'path':str(raw.resolve()),'sha256':b['raw_sha256'],'reviews':b['reviews_saved']})
            require(sum(f['reviews'] for f in result['raw_files'])==archive['reviews_saved'], 'Raw totals mismatch')
            result.update(status='matched' if ui['status']=='complete' else 'partial',collection_status=ui['status'],
                          displayed_reviews=ui['displayed_total']['value'] if ui['displayed_total'] else None,
                          stored_reviews=archive['reviews_saved'],run_report=str(Path(report_path).resolve()),
                          report_sha256=sha(report_path),ui_end_confirmed=ui['ui_end_confirmed'],
                          duplicate_candidates=archive['duplicate_candidates'])
            if ui['status'] != 'complete': error = ui['stop_error'] or ui['termination_reason']
        elif match and match['status']=='matched' and not error:
            raise ValueError('Matched input needs a collector report or explicit error')
        if error:
            if not report_path:
                result.update(status='partial' if match and match['status']=='matched' else 'failed',collection_status='partial' if match else 'failed')
                for raw_path in partial_raw:
                    raw=read(raw_path)
                    require(match and raw['capture']['metadata']['target']==dict(match['target'],url=match['target']['url']+'?tab=article'), 'Partial raw belongs to different course')
                    result['raw_files'].append({'path':str(Path(raw_path).resolve()),'sha256':sha(raw_path),'reviews':len(raw['reviews'])})
                result['stored_reviews']=sum(x['reviews'] for x in result['raw_files'])
            result.update(error=str(error),error_kind=error_type or failure_kind(error))
        require(result['status'] in TERMINAL, 'Nonterminal result')
        write_new_json(folder/'result.json', result)
        self.checkpoint(self.batch_for[position])
        return result

    def checkpoint(self, batch):
        results = self.results();positions=[p for p in self.entries if self.batch_for[p]==batch]
        local=[results[p] for p in positions if p in results]
        last=positions[0]-1
        for p in positions:
            if p not in results: break
            last=p
        ordinal=len(list((self.root/'batches'/f'{batch:04d}'/'checkpoints').glob('*.json')))+1
        pending=[p for p in positions if p not in results]
        summary={'batch':batch,'recorded_at':now(),'input_positions':positions,
                 'started_at':min((r['started_at'] for r in local),default=None),
                 'ended_at':now() if not pending or self.stop_state() else None,
                 'state':'complete' if not pending else 'stopped' if self.stop_state() else 'in_progress',
                 'last_completed_input_position':last,'pending_positions':pending,
                 'status_counts':dict(Counter(r['status'] for r in local)),
                 'match_counts':dict(Counter(r['match_status'] or 'unclassified' for r in local)),
                 'reviews_saved':sum(r['stored_reviews'] for r in local),'stop':self.stop_state(),
                 'pipeline_incidents':self.incidents(),
                 'results':[{'position':r['position'],'status':r['status'],'url':r['url'],
                    'displayed_reviews':r['displayed_reviews'],'stored_reviews':r['stored_reviews'],
                    'raw_files':r['raw_files'],'error_kind':r['error_kind'],'error':r['error']} for r in local],
                 'review_queues':{s:[r['position'] for r in local if r['status']==s]
                                  for s in ('ambiguous','not_found','partial','failed')}}
        write_new_json(self.root/'batches'/f'{batch:04d}'/'checkpoints'/f'{ordinal:05d}.json',summary)
        return summary

    def summary(self):
        rows=list(self.results().values());counts=Counter(r['status'] for r in rows)
        complete=[r for r in rows if r['collection_status']=='complete']
        return {'total_inputs':self.manifest['input_count'],'processed':len(rows),
                'remaining':self.manifest['input_count']-len(rows),'status_counts':dict(counts),
                'match_counts':dict(Counter(r['match_status'] or 'unclassified' for r in rows)),
                'collected_courses':len(complete),'reviews_saved':sum(r['stored_reviews'] for r in rows),
                'empty_courses':sum(r['stored_reviews']==0 for r in complete),
                'most_reviews':max(complete,key=lambda r:r['stored_reviews'],default=None),
                'human_review':sum(counts[s] for s in ('ambiguous','not_found','partial','failed')),
                'failure_patterns':dict(self.failure_counts()),'pipeline_incidents':self.incidents(),
                'duplicate_input_groups':self.manifest['duplicate_input_identities'],
                'stop':self.stop_state()}


def main():
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='command',required=True)
    init=sub.add_parser('init');init.add_argument('--catalog',default='public/courses.json');init.add_argument('--output',required=True);init.add_argument('--batch-size',type=int,default=50)
    for name in ('pending','match','finish','checkpoint','summary','begin-capture','recover-capture'):
        s=sub.add_parser(name);s.add_argument('--root',required=True)
        if name in ('pending','checkpoint'):s.add_argument('--batch',type=int,required=True)
        if name in ('match','finish','begin-capture','recover-capture'):s.add_argument('--position',type=int,required=True)
        if name=='begin-capture':s.add_argument('--output',required=True)
        if name=='match':s.add_argument('--search',required=True)
        if name=='finish':
            s.add_argument('--report');s.add_argument('--error');s.add_argument('--error-type');s.add_argument('--partial-raw',action='append',default=[])
    a=p.parse_args()
    if a.command=='init':
        r=create_campaign(a.catalog,a.output,a.batch_size);r={k:r[k] for k in ('input_count','batch_size','created_at')}
    else:
        c=Campaign(a.root)
        if a.command=='pending':r=c.pending(a.batch)
        elif a.command=='match':r=c.match(a.position,a.search)
        elif a.command=='finish':r=c.finish(a.position,a.report,error=a.error,error_type=a.error_type,partial_raw=a.partial_raw)
        elif a.command=='begin-capture':r=c.begin_capture(a.position,a.output)
        elif a.command=='recover-capture':r=c.recover_capture(a.position)
        elif a.command=='checkpoint':r=c.checkpoint(a.batch)
        else:r=c.summary()
    print(json.dumps(r,ensure_ascii=False))


if __name__=='__main__':main()
