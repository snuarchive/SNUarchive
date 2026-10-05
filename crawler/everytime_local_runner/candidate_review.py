"""Offline evidence audit and assistant proposals, never human approval or DB input.

Original candidates remain byte-for-byte in their input dataset. This derivative
keeps each original object, scoped annotations and a local HTML review packet.
Abbreviated years are proposals with declared assumptions, not silently filled
assessment dates. Enrollment metadata is never a date inference source.
"""
from collections import Counter
from copy import deepcopy
from html import escape
from pathlib import Path
import argparse
import json
import re

from crawler.everytime_collect.raw import digest, read_document
from crawler.everytime_collect.run_v2 import require
from crawler.everytime_stats.validate import check_evidence
from .campaign import read
from .import_candidates import candidate, write_jsonl
from .storage import ROOT, sha, write_new

VERSION = '1.0.0'
# Discovery only. A temporal-looking token can describe another course, an old
# exam, a future offering, or even a score. It never assigns year/semester.
TERM_HINT = re.compile(
    r'(?<![\d.])(?:\d{2,4}\s*(?:년|학년|[-]\s*[12](?![\d.])|[-]S)|'
    r'\d{2,4}\s*(?:여름|겨울))|[12]\s*학기|여름|겨울', re.I)
IDENTITY_ISSUES = {'missing_assessment', 'missing_number', 'unsupported_numbered_kind',
                   'uncertain_assessment_scope', 'partial_assessment_scope', 'composite_assessment_scope'}


def span(text, start, end):
    return {'start': start, 'end': end, 'text': text[start:end]}


def verify_spans(items, text):
    require(isinstance(items, list) and bool(items), 'Decision requires original-body evidence')
    for item in items:
        start, end = item.get('start'), item.get('end')
        require(type(start) is int and type(end) is int and 0 <= start < end <= len(text), 'Invalid evidence span')
        require(item.get('text') == text[start:end], 'Annotation evidence differs from raw text')


def verify_decision(decision, row, text):
    require(decision.get('candidate_id') == row['candidate_id'] and
            decision.get('comment_sha256') == digest(text.encode('utf-8')), 'Annotation source mismatch')
    require(set(decision) <= {'candidate_id', 'comment_sha256', 'term', 'assessment', 'concerns'}, 'Unknown annotation field')
    for key in ('term', 'assessment'):
        if key not in decision:
            continue
        part = decision[key]
        verify_spans(part.get('evidence'), text)
        require(isinstance(part.get('reason'), str) and part['reason'].strip(), 'Annotation requires rationale')
        if key == 'term':
            require(part['status'] in ('proposed_from_body', 'partial_from_body', 'unresolved'), 'Invalid term status')
            year, semester = part.get('proposed_year'), part.get('proposed_semester')
            require(year is None or type(year) is int and 1980 <= year <= 2200, 'Invalid proposed year')
            require(semester is None or type(semester) is int and 1 <= semester <= 4, 'Invalid proposed semester')
            require(isinstance(part.get('assumptions'), list), 'Declare term interpretation assumptions')
            populated = sum(v is not None for v in (year, semester))
            require(populated == {'proposed_from_body': 2, 'partial_from_body': 1, 'unresolved': 0}[part['status']], 'Term status/value mismatch')
        else:
            require(part['status'] in ('proposed_identity', 'split_required', 'retain_unresolved'), 'Invalid assessment status')
            if part['status'] == 'proposed_identity':
                proposed = part.get('proposed')
                require(isinstance(proposed, dict) and proposed.get('kind') in ('midterm', 'final') and
                        proposed.get('number') is None and proposed.get('scope') == 'whole', 'Unsupported identity proposal')
            else:
                require(part.get('proposed') is None, 'Unresolved assessment cannot replace identity')
    for concern in decision.get('concerns', []):
        require(isinstance(concern.get('code'), str) and bool(concern.get('note')), 'Invalid concern')
        verify_spans(concern.get('evidence'), text)


def review_candidate(row, text, decision=None):
    record = row['extraction']
    require(digest(text.encode('utf-8')) == record['source']['comment_sha256'], 'Review body changed')
    check_evidence(record, text)
    require(row['human_review_status'] == 'unreviewed' and row['ready_for_database_write'] is False,
            'Expected unreviewed candidate')
    if decision is not None:
        verify_decision(decision, row, text)
    reasons = sorted(set(record['review_reasons']) & IDENTITY_ISSUES)
    labels = [e for e in record['context_evidence'] if e.get('field') == 'assessment']
    assessment_status = 'needs_identity_review' if reasons or not labels else 'label_evidence_present'
    result = {
        'review_schema_version': 1, 'review_rule_version': VERSION,
        'candidate_id': row['candidate_id'], 'original_candidate': deepcopy(row),
        'verification': {'body_sha256_checked': True, 'extraction_evidence_checked': True,
                         'value_semantics_human_approved': False},
        'term_review': deepcopy(decision['term']) if decision and 'term' in decision else {
            'status': 'no_scoped_proposal', 'proposed_year': None, 'proposed_semester': None,
            'reason': 'No assistant-scoped body evidence; original dates remain unchanged.',
            'assumptions': [], 'evidence': []},
        'assessment_review': {'structural_status': assessment_status, 'original_issues': reasons,
                              'label_evidence': deepcopy(labels),
                              'assistant_proposal': deepcopy(decision.get('assessment')) if decision else None},
        'term_discovery_hints': [span(text, m.start(), m.end()) for m in TERM_HINT.finditer(text)],
        'assistant_concerns': deepcopy(decision.get('concerns', [])) if decision else [],
        'assistant_annotation_present': decision is not None,
        'human_review_status': 'unreviewed', 'ready_for_database_write': False,
        'enrollment_term_imputed': False,
    }
    return result


def render_html(rows, texts, summary):
    """Self-contained read-only packet. No remote assets, forms or write buttons."""
    parts = ['<!doctype html><html lang="ko"><meta charset="utf-8">',
             '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">',
             '<title>Priority A 후보 근거 검토</title>',
             '<style>body{font:16px system-ui;max-width:1100px;margin:32px auto;padding:16px;line-height:1.6}',
             'pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f6f8;padding:16px}',
             'details{border:1px solid #bbb;margin:12px 0;padding:12px}summary{cursor:pointer}',
             '.note{color:#614200}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px}</style>',
             '<h1>Priority A 후보 근거 검토</h1>',
             '<p>기존 추출값은 보존했습니다. 아래 연도·학기·평가 수정은 assistant 제안이며 사람의 검토 완료가 아닙니다. '
             '원문 수강학기는 시험 시기로 복사하지 않았습니다. DB 쓰기 가능 항목은 0건입니다.</p>',
             '<p>학기 코드: 1=1학기, 2=여름, 3=2학기, 4=겨울. 짧은 연도는 세기 확장 가정과 겨울 학년도 해석을 확인해야 합니다.</p>',
             '<pre>' + escape(json.dumps(summary['counts'], ensure_ascii=False, indent=2)) + '</pre>']
    ordered = sorted(rows, key=lambda r: (not r['assistant_annotation_present'], r['candidate_id']))
    for row in ordered:
        original = row['original_candidate']; rec = original['extraction']; cid = row['candidate_id']
        title = f"{rec['course_title']} · {rec['instructor']} | {rec['assessment']['raw_label']} | {cid}"
        parts += [f'<details id="{escape(cid, quote=True)}"><summary>{escape(title)}</summary>',
                  '<h2>검토안</h2><pre>' + escape(json.dumps({k: row[k] for k in
                    ('term_review', 'assessment_review', 'assistant_concerns')}, ensure_ascii=False, indent=2)) + '</pre>',
                  '<h2>기존 후보</h2><pre>' + escape(json.dumps(original, ensure_ascii=False, indent=2)) + '</pre>',
                  '<h2>원문 (변경 없음)</h2><pre>' + escape(texts[cid]) + '</pre></details>']
    return ''.join(parts) + '</html>'


def build(dataset, decisions_file, destination):
    dataset, decisions_file, destination = map(lambda p: Path(p).resolve(), (dataset, decisions_file, destination))
    require(dataset.parent == ROOT.resolve(), 'Expected local runner candidate dataset')
    require(destination.parent == ROOT.resolve() and not destination.exists(), 'Use a new review output directory')
    manifest_path = dataset / 'manifest.json'
    manifest, source_summary, decisions = read(manifest_path), read(dataset / 'summary.json'), read(decisions_file)
    require(decisions.get('author_role') == 'assistant' and decisions.get('version') == 1, 'Expected assistant annotation file')
    require(decisions.get('source_manifest_sha256') == sha(manifest_path), 'Decisions target a different dataset')
    inputs = {**source_summary['input_files'], **{str(dataset / f): h for f, h in manifest['files'].items()},
              str(manifest_path): sha(manifest_path), str(decisions_file): sha(decisions_file),
              str(Path(__file__).resolve()): sha(__file__)}
    require(all(sha(f) == h for f, h in inputs.items()), 'Review inputs changed or checksum mismatch')
    annotations = {}
    for decision in decisions['decisions']:
        require(decision['candidate_id'] not in annotations, 'Duplicate annotation candidate')
        annotations[decision['candidate_id']] = decision
    originals = [json.loads(line) for line in (dataset / 'import_candidates.jsonl').read_text(encoding='utf-8').splitlines()]
    ids = [r['candidate_id'] for r in originals]
    require(len(set(ids)) == len(ids) and set(annotations) <= set(ids), 'Unknown or duplicate candidate ID')
    rows, texts, docs = [], {}, {}
    for row in originals:
        source = row['extraction']['source']; raw = Path(source['file'])
        require(str(raw) in inputs and sha(raw) == source['file_sha256'], 'Unpinned or changed raw source')
        if str(raw) not in docs:
            docs[str(raw)] = read_document(raw.read_bytes())
        require(re.fullmatch(r'/reviews/\d+', source['json_pointer']), 'Invalid raw review pointer')
        index = int(source['json_pointer'].rsplit('/', 1)[1]); doc = docs[str(raw)]
        verified = candidate(row['extraction'], doc, index)
        require(verified['review_fingerprints'] == row['review_fingerprints'], 'Candidate fingerprint mismatch')
        text = doc['reviews'][index]['text_raw']; texts[row['candidate_id']] = text
        rows.append(review_candidate(row, text, annotations.get(row['candidate_id'])))
    counts = {
        'candidates': len(rows), 'unique_raw_reviews': len({(r['extraction']['source']['file'], r['extraction']['source']['json_pointer']) for r in originals}),
        'assistant_annotated': len(annotations),
        'term_review': dict(Counter(r['term_review']['status'] for r in rows)),
        'assessment_structural_review': dict(Counter(r['assessment_review']['structural_status'] for r in rows)),
        'assessment_assistant_proposals': dict(Counter(r['assessment_review']['assistant_proposal']['status'] for r in rows if r['assessment_review']['assistant_proposal'])),
        'concerns': dict(Counter(c['code'] for r in rows for c in r['assistant_concerns'])),
        'new_year_proposals': sum(r['term_review']['proposed_year'] is not None and r['original_candidate']['extraction']['year'] is None for r in rows),
        'new_semester_proposals': sum(r['term_review']['proposed_semester'] is not None and r['original_candidate']['extraction']['semester'] is None for r in rows),
        'human_approved': 0, 'ready_for_database_write': 0,
    }
    summary = {'version': 1, 'rule_version': VERSION, 'source_dataset': str(dataset), 'counts': counts,
               'input_files': inputs, 'original_candidates_modified': 0, 'raw_reviews_modified': 0,
               'enrollment_term_imputed': False, 'database_write_count': 0,
               'limitations': ['Assistant proposals are not approved values.', 'All original extractor abstentions remain.',
                              'No omission-recall audit of excluded or mention-only reviews in this step.',
                              'Term discovery hints are not semantic evidence of the assessment date.']}
    require(all(sha(f) == h for f, h in inputs.items()), 'Input changed during review')
    destination.mkdir()
    write_jsonl(destination / 'candidate_reviews.jsonl', rows)
    write_jsonl(destination / 'assistant_proposals.jsonl', [r for r in rows if r['assistant_annotation_present']])
    write_new(destination / 'decisions.json', decisions)
    write_new(destination / 'summary.json', summary)
    with (destination / 'review.html').open('x', encoding='utf-8', newline='\n') as stream:
        stream.write(render_html(rows, texts, summary))
        stream.flush()
        import os
        os.fsync(stream.fileno())
    files = {p.name: sha(p) for p in destination.iterdir() if p.is_file()}
    require(all(sha(f) == h for f, h in inputs.items()), 'Input changed before review commit')
    # Only a complete manifest marks this packet usable; interrupted files stay.
    write_new(destination / 'manifest.json', {'files': files, 'state': 'complete'})
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset', required=True)
    parser.add_argument('--decisions', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    result = build(args.dataset, args.decisions, args.output)
    print(json.dumps(result['counts'], ensure_ascii=False))


if __name__ == '__main__':
    main()
