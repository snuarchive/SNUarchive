"""Offline immutable execution snapshot for a priority plan; no collection."""
from collections import Counter
from pathlib import Path
import argparse
import json

from crawler.everytime_collect.raw import validate_document
from crawler.everytime_collect.run_v2 import require, validate_report
from .full_queue import Campaign, now, read, sha
from .matching import write_new_json


def snapshot(root, destination, interrupted_reports=()):
    root=Path(root); plan=read(root/'queue/manifest.json')
    require(not Path(destination).exists(), 'Snapshot exists; choose a new destination')
    for source in plan['sources'].values():
        require(sha(source['path'])==source['sha256'], 'Priority source checksum mismatch')
    entries=[e for p in sorted((root/'queue/A').glob('batch_*.json')) for e in read(p)['entries']]
    mappings={m['item_id']:m for m in read(root/'A_execution_mapping.json')}
    campaign=Campaign(root/'A_campaign'); results=campaign.results()
    ui_reports={}
    for path in interrupted_reports:
        ui=read(path);validate_report(ui)
        require(ui['status']=='partial','Supplemental observation must remain partial')
        ui_reports[ui['target']['url']]={'report':ui,'path':str(Path(path).resolve()),'sha256':sha(path)}
    output=[]
    for entry in entries:
        mapping=mappings.get(entry['item_id']); result=None;match=None
        if mapping:
            require(mapping['course_key']==entry['course_key'],'Priority mapping key differs')
            position=mapping['position'];result=results.get(position)
            match_path=campaign.folder(position)/'match.json'
            if match_path.exists():
                match=read(match_path)
                require(sha(match['search_path'])==match['search_sha256'],'Search checksum mismatch')
        result=result or entry.get('previous_result')
        if not match:match=entry.get('previous_match')
        raw_refs=result['raw_files'] if result else []
        terms=reviews=0
        for raw in raw_refs:
            require(sha(raw['path'])==raw['sha256'],'Stored raw checksum mismatch')
            doc=read(raw['path']);validate_document(doc)
            require(len(doc['reviews'])==raw['reviews'],'Raw review count mismatch')
            reviews+=len(doc['reviews'])
            terms+=sum(r['enrollment_term_raw'] is not None for r in doc['reviews'])
        if result:require(reviews==result['stored_reviews'],'Saved review total mismatch')
        url=result['url'] if result else match['target']['url'] if match and match['target'] else None
        supplemental=ui_reports.get(url+'?tab=article') if url else None
        display=result['displayed_reviews'] if result else None
        if supplemental:
            ui=supplemental['report']
            require(ui['target']['title']==entry['catalog_title'] and ui['target']['instructor']==entry['catalog_instructor'],
                    'Interrupted identity differs')
            display=ui['displayed_total']['value'] if ui['displayed_total'] else None
        output.append(dict(entry, execution_position=mapping['position'] if mapping else None,
            execution_result=result,everytime_url=url,everytime_match_status=match['status'] if match else None,
            everytime_collection_status=result['collection_status'] if result else 'not_started',
            state='completed' if result and result['collection_status']=='complete' else result['status'] if result else entry['state'],
            displayed_reviews=display,stored_reviews=reviews,reviews_with_enrollment_term=terms,
            ui_end_confirmed=bool(result and result['ui_end_confirmed']),interrupted_ui_observation=supplemental))
    matching=Counter(e['everytime_match_status'] or 'not_attempted' for e in output)
    collection=Counter(e['everytime_collection_status'] for e in output)
    summary={'generated_at':now(),'priority_A_inputs':len(output),'xlsx_rows':plan['xlsx_rows'],
        'catalog_mapping':dict(Counter(e['catalog_mapping'] for e in output)),
        'everytime_matching':dict(matching),'collection':dict(collection),
        'stored_reviews':sum(e['stored_reviews'] for e in output),
        'reviews_with_enrollment_term':sum(e['reviews_with_enrollment_term'] for e in output),
        'old_66_results_reused_in_A':sum(e['previous_result'] is not None for e in output),
        'old_66_results_reused_in_priority_plan':plan['reused_prior_results_by_priority'],
        'remaining_executable_A':sum(e['catalog_mapping']=='matched' and not e['execution_result'] for e in output),
        'stop':campaign.stop_state(),'checksum_errors':campaign.failure_counts()['transfer_integrity'],
        'priority_counts':plan['priority_counts'],'B_C_collection_started':False,'extractor_executed':False}
    write_new_json(Path(destination)/'summary.json',summary)
    for start in range(0,len(output),50):
        write_new_json(Path(destination)/f'A_{start//50+1:04d}.json',{'entries':output[start:start+50]})
    write_new_json(Path(destination)/'review_queues.json',{
        state:[e['item_id'] for e in output if e['state']==state]
        for state in ('ambiguous_mapping','missing','ambiguous','not_found','partial','failed')})
    return summary


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',required=True);parser.add_argument('--output',required=True)
    parser.add_argument('--interrupted-report',action='append',default=[])
    args=parser.parse_args()
    print(json.dumps(snapshot(args.root,args.output,args.interrupted_report),ensure_ascii=False))
