"""Materialize term links and assistant screening without changing candidates."""
from collections import Counter
from copy import deepcopy
from html import escape
from pathlib import Path
import argparse
import json
import os

from crawler.everytime_collect.raw import digest, read_document
from crawler.everytime_collect.run_v2 import require
from .campaign import read
from .candidate_review import verify_spans
from .import_candidates import candidate, write_jsonl
from .quality_audit import lines, packet
from .storage import ROOT, sha, write_new
from .term_linker import link


def screening(row, text, decision):
    r = row['candidate']['extraction']
    require(decision['candidate_id'] == row['candidate_id'] and decision['comment_sha256'] == digest(text.encode('utf-8')),
            'Screening source differs')
    require(decision['reviewer_role'] == 'assistant' and decision['coverage'] == 'evidence_context_screening', 'Not a human approval')
    verify_spans(decision['evidence'], text)
    for finding in decision.get('findings', []):
        verify_spans(finding['evidence'], text)
        require(finding['severity'] in ('confirmed_semantic_issue', 'review_proposal'), 'Invalid finding severity')
        require(bool(finding['reason']) and bool(finding['code']), 'Finding needs a reason')
    return {'candidate_id': row['candidate_id'], 'original_triage': deepcopy(row),
            'assistant_screening': deepcopy(decision), 'human_review_status': 'unreviewed',
            'ready_for_database_write': False, 'canonical_extraction_modified': False,
            'requires_human_decision': True}


def build(quality, prior_review, annotations, destination):
    quality, prior_review, annotations, destination = map(lambda p: Path(p).resolve(), (quality, prior_review, annotations, destination))
    require(destination.parent == ROOT.resolve() and not destination.exists(), 'Use a new followup output')
    summary, inputs = packet(quality)
    _, prior_inputs = packet(prior_review); inputs.update(prior_inputs)
    raw_annotations = read(annotations)
    require(raw_annotations['author_role'] == 'assistant' and raw_annotations['quality_manifest_sha256'] == sha(quality / 'manifest.json'), 'Annotations target another dataset')
    inputs[str(annotations)] = sha(annotations)
    inputs[str(Path(__file__).resolve())] = sha(__file__)
    inputs[str(Path(__file__).with_name('term_linker.py'))] = sha(Path(__file__).with_name('term_linker.py'))
    prior = {d['candidate_id']: d for d in read(prior_review / 'decisions.json')['decisions'] if 'term' in d}
    decisions = {d['candidate_id']: d for d in raw_annotations['decisions']}
    require(len(decisions) == len(raw_annotations['decisions']), 'Duplicate screening decision')
    rows = lines(quality / 'triage.jsonl')
    content_ids = {r['candidate_id'] for r in rows if r['requires_content_review']}
    require(set(decisions) == content_ids, 'Every content item needs its own screening record')
    documents, texts, term_rows, content_rows = {}, {}, [], []
    for row in rows:
        record = row['candidate']['extraction']; source = record['source']; path = source['file']
        require(path in inputs and sha(path) == source['file_sha256'], 'Unverified raw source')
        if path not in documents:
            documents[path] = read_document(Path(path).read_bytes())
        index = int(source['json_pointer'].rsplit('/', 1)[1]); doc = documents[path]
        checked = candidate(record, doc, index)
        require(checked['review_fingerprints'] == row['candidate']['review_fingerprints'], 'Fingerprint mismatch')
        text = doc['reviews'][index]['text_raw']; texts[row['candidate_id']] = text
        if row['category'] == 'term_missing_only':
            term_rows.append({'candidate_id': row['candidate_id'], 'original_triage': deepcopy(row),
                              'term_link': link(record, text, prior.get(row['candidate_id'])),
                              'human_review_status': 'unreviewed', 'ready_for_database_write': False})
        if row['requires_content_review']:
            content_rows.append(screening(row, text, decisions[row['candidate_id']]))
    require(len(term_rows) == 143 and len(content_rows) == 188, 'Unexpected Priority A followup scope')
    statuses = Counter(r['term_link']['status'] for r in term_rows)
    dispositions = Counter(r['assistant_screening']['disposition'] for r in content_rows)
    confirmed = [r for r in content_rows if any(f['severity'] == 'confirmed_semantic_issue' for f in r['assistant_screening'].get('findings', []))]
    findings = [f for r in content_rows for f in r['assistant_screening'].get('findings', [])]
    info = {'input_triage_units': len(rows), 'term_link_items': len(term_rows), 'term_status_counts': dict(statuses),
            'complete_body_term_links': statuses['full_literal_body_term'],
            'literal_semester_links': sum(r['term_link']['linked_semester'] is not None for r in term_rows),
            'new_literal_semester_links': sum(r['term_link']['linked_semester'] is not None and r['original_triage']['candidate']['extraction']['semester'] is None for r in term_rows),
            'content_screened': len(content_rows), 'screening_scope': 'assistant evidence-context screening; not full human adjudication',
            'screening_dispositions': dict(dispositions), 'confirmed_semantic_issue_candidates': len(confirmed),
            'finding_codes': dict(Counter(f['code'] for f in findings)),
            'content_human_decisions_pending': len(content_rows), 'term_items_not_fully_linked': len(term_rows) - statuses['full_literal_body_term'],
            'human_approvals': 0, 'canonical_candidates_modified': 0, 'raw_modified': 0, 'database_write_count': 0,
            'extractor_changed_in_this_step': False, 'B_expansion': {'proceed': False,
                'reason': 'A still has unresolved assessment dates and source-confirmed semantic defects; expansion would increase the unresolved queue.'},
            'input_files': inputs}
    require(all(sha(f) == h for f, h in inputs.items()), 'Input changed during review')
    destination.mkdir()
    write_jsonl(destination / 'term_links.jsonl', term_rows)
    write_jsonl(destination / 'content_screening.jsonl', content_rows)
    write_jsonl(destination / 'confirmed_issues.jsonl', confirmed)
    write_new(destination / 'screening_decisions.json', raw_annotations)
    write_new(destination / 'summary.json', info)
    with (destination / 'review.html').open('x', encoding='utf-8', newline='\n') as stream:
        stream.write(render(info, term_rows, content_rows, texts)); stream.flush(); os.fsync(stream.fileno())
    require(all(sha(f) == h for f, h in inputs.items()), 'Inputs changed before completion')
    write_new(destination / 'manifest.json', {'state': 'complete', 'files': {f.name: sha(f) for f in destination.iterdir()}})
    return {k: v for k, v in info.items() if k != 'input_files'}


def render(info, term_rows, content_rows, texts):
    def pretty(v):
        return '<pre>' + escape(json.dumps(v, ensure_ascii=False, indent=2)) + '</pre>'
    parts = ['<!doctype html><html lang="ko"><meta charset="utf-8"><title>Priority A 날짜 연결과 의미 검토</title>',
             '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">',
             '<style>body{font:16px system-ui;max-width:1100px;margin:32px auto;padding:16px;line-height:1.6}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f6f8;padding:16px}details{border:1px solid #aaa;padding:12px;margin:12px 0}summary{cursor:pointer}.issue{border:2px solid #b33}</style>',
             '<h1>Priority A 날짜 연결과 의미 검토</h1><p>모든 항목은 사람 미승인 상태입니다. '
             'assistant의 근거 대조와 수정 제안은 기존 후보·DB 값을 바꾸지 않습니다. 두 자리 연도 확장, 겨울 연도 귀속, 수강학기 복사는 적용하지 않았습니다.</p>',
             pretty({k: v for k, v in info.items() if k != 'input_files'}), '<h2>내용 검토 — 오류 확인 항목 우선</h2>']
    for row in sorted(content_rows, key=lambda r: (not any(f['severity'] == 'confirmed_semantic_issue' for f in r['assistant_screening'].get('findings', [])), r['assistant_screening']['disposition'], r['candidate_id'])):
        record = row['original_triage']['candidate']['extraction']; cid = row['candidate_id']
        parts += ['<details><summary>' + escape(f"{record['course_title']} · {record['instructor']} · {row['assistant_screening']['disposition']} · {cid}") + '</summary>',
                  pretty(row), '<h3>변경 없는 원문</h3><pre>' + escape(texts[cid]) + '</pre></details>']
    parts += ['<h2>날짜 연결</h2>']
    for row in sorted(term_rows, key=lambda r: (r['term_link']['status'] == 'no_body_term', r['term_link']['status'], r['candidate_id'])):
        record = row['original_triage']['candidate']['extraction']; cid = row['candidate_id']
        parts += ['<details><summary>' + escape(f"{record['course_title']} · {record['instructor']} · {row['term_link']['status']} · {cid}") + '</summary>',
                  pretty(row), '<h3>변경 없는 원문</h3><pre>' + escape(texts[cid]) + '</pre></details>']
    return ''.join(parts) + '</html>'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('quality', 'prior-review', 'annotations', 'output'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.quality, args.prior_review, args.annotations, args.output), ensure_ascii=False))


if __name__ == '__main__':
    main()
