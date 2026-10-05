"""Separate, abstaining term evidence linker. Never edit extraction or approval.

Assistant scope hints point into the original body. Their proposed numeric years
are deliberately ignored. A short year, winter year basis, or enrollment label
never supplies a resolved assessment year.
"""
import re

from crawler.everytime_collect.raw import digest
from crawler.everytime_collect.run_v2 import require
from crawler.everytime_stats.validate import check_evidence
from .candidate_review import verify_spans

VERSION = '1.0.0'
TOKEN = re.compile(
    r'(?<![\dA-Za-z.])(?P<year>\d{4}|\d{2})\s*(?P<year_label>학년|년)?\s*'
    r'(?P<term>[12]\s*학기|여름(?:\s*계절)?(?:\s*학기)?|겨울(?:\s*계절)?(?:\s*학기)?|[-]\s*[12SW](?![\dA-Za-z]))'
    r'|(?P<season>여름(?:\s*계절)?(?:\s*학기)?|겨울(?:\s*계절)?(?:\s*학기)?)', re.I)
DISCOVERY = re.compile(r'(?<![\d.])\d{2,4}\s*(?:년|학년|[-]\s*[12SW](?![\dA-Za-z]))|[12]\s*학기|여름|겨울', re.I)
HEADER = re.compile(r'^\s*\d{4}\s*년\s*(?:[12]\s*학기|여름(?:\s*학기)?|겨울(?:\s*학기)?)\s*(?:기준|수강(?:생|자)?(?:입니다\.?)?)?\s*$')


def tokens(text, start=0):
    result = []
    for match in TOKEN.finditer(text):
        raw_term = re.sub(r'\s', '', match['term'] or match['season']).upper()
        semester = {'1학기': 1, '2학기': 3, '-1': 1, '-2': 3, '-S': 2, '-W': 4}.get(raw_term)
        if raw_term.startswith('여름'):
            semester = 2
        if raw_term.startswith('겨울'):
            semester = 4
        result.append({'start': start + match.start(), 'end': start + match.end(), 'text': match.group(),
                       'year_token': match['year'], 'year_label': match['year_label'],
                       'semester_literal': semester})
    return result


def link(record, text, hint=None):
    require(digest(text.encode('utf-8')) == record['source']['comment_sha256'], 'Term source hash mismatch')
    check_evidence(record, text)
    discovery = [{'start': m.start(), 'end': m.end(), 'text': m.group()} for m in DISCOVERY.finditer(text)]
    result = {'version': VERSION, 'candidate_id': record['record_id'],
              'linked_year': None, 'linked_semester': None, 'body_discovery': discovery,
              'scoped_tokens': [], 'scope_evidence': [], 'blocked_inferences': [],
              'scope_basis': None, 'status': 'no_scoped_body_term' if discovery else 'no_body_term',
              'enrollment_term_used': False, 'prior_numeric_proposal_applied': False,
              'human_review_status': 'unreviewed', 'ready_for_database_write': False}
    assumptions = []
    if hint:
        require(hint['comment_sha256'] == record['source']['comment_sha256'], 'Scope hint source mismatch')
        part = hint['term']; verify_spans(part['evidence'], text)
        result['scope_evidence'] = part['evidence']
        result['scope_basis'] = 'assistant_scope_hint_not_human_approval'
        if part['status'] == 'unresolved':
            result['status'] = 'unrelated_or_unscoped_reference'
            result['blocked_inferences'] = ['date_not_bound_to_this_assessment']
            return result
        assumptions = part.get('assumptions', [])
    else:
        first_line = text.splitlines()[0] if text.splitlines() else ''
        if not HEADER.fullmatch(first_line):
            return result
        result['scope_basis'] = 'literal_full_year_header'
        result['scope_evidence'] = [{'start': 0, 'end': len(first_line), 'text': first_line}]
    scoped = [t for ev in result['scope_evidence'] for t in tokens(ev['text'], ev['start'])]
    result['scoped_tokens'] = scoped
    if not scoped:
        result['status'] = 'no_parseable_scoped_term'
        return result
    years = {t['year_token'] for t in scoped if t['year_token'] is not None}
    semesters = {t['semester_literal'] for t in scoped if t['semester_literal'] is not None}
    blocks = []
    if len(years) > 1 or len(semesters) > 1:
        blocks.append('conflicting_body_terms')
    short = any(len(y) == 2 for y in years)
    if short:
        blocks.append('short_year_century_not_inferred')
    if any(t['year_label'] == '학년' for t in scoped):
        blocks.append('nonstandard_year_wording')
    if any('dash_2' in assumption for assumption in assumptions):
        blocks.append('semester_encoding_ambiguous')
    winter = 4 in semesters
    if winter:
        blocks.append('winter_academic_vs_calendar_year_not_inferred')
    if len(semesters) == 1 and not {'conflicting_body_terms', 'semester_encoding_ambiguous'} & set(blocks):
        result['linked_semester'] = next(iter(semesters))
    if len(years) == 1 and not blocks:
        year = int(next(iter(years)))
        if 1980 <= year <= 2200:
            result['linked_year'] = year
    if not years:
        blocks.append('year_absent_from_scoped_body')
    result['blocked_inferences'] = blocks
    result['status'] = ('full_literal_body_term' if result['linked_year'] is not None and result['linked_semester'] is not None
                        else 'ambiguous_term_encoding' if 'semester_encoding_ambiguous' in blocks or 'nonstandard_year_wording' in blocks
                        else 'abbreviated_year_requires_review' if short
                        else 'winter_year_basis_requires_review' if winter and years
                        else 'semester_only_year_missing' if result['linked_semester'] is not None
                        else 'unresolved_body_term')
    return result
