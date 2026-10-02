"""Synthetic queue/identity/scope checks. These do not access Everytime."""
from copy import deepcopy
import json
import subprocess
import unittest
from urllib.parse import urlencode

from crawler.everytime_collect.raw import ObservationError
from crawler.everytime_match.batch_queue import select_pilot, build_queue
from crawler.everytime_match.batch_execution import finish_queue
from crawler.everytime_match.matching import match_course, validate_search


def candidate(title='합성 강의', professor='교수 A', number=1, position=1):
    return {'position': position, 'url': f'https://everytime.kr/lecture/view/{number}',
            'title': title, 'instructor': professor}


def evidence(title='합성 강의', candidates=None, initial=None):
    cs = [candidate(title)] if candidates is None else candidates
    n = len(cs)
    initial = n if initial is None else initial
    state = {'count': n, 'top': 0, 'height': 800, 'client': 800, 'at_bottom': True}
    trace = [dict(state, count=initial)]
    if initial != n: trace.append(dict(state))
    if n: trace += [dict(state), dict(state)]
    return {'evidence_version': 2, 'school': '에브리타임\n서울대', 'query': title, 'mode': 'name',
            'page_url': 'https://everytime.kr/lecture/search?' + urlencode({'keyword': title, 'condition': 'name'}),
            'observed_at': '2026-10-01T00:00:00Z', 'candidates': cs,
            'list_locator': 'div.lectures > a.lecture', 'title_locator': ':scope > div.name',
            'instructor_locator': ':scope > div.professor', 'geometry': {'top': 0, 'height': 800, 'client': 800},
            'initial_candidate_count': initial, 'scrolls': len(trace)-1,
            'scope': {'max_scrolls': 12, 'max_candidates': 160, 'wait_ms': 2000,
                      'trace': trace, 'ui_end': True, 'bottom_confirmations': 2 if n else 0},
            'empty_text': None if n else '검색된 강의가 없습니다',
            'empty_evidence': None if n else {'text': '검색된 강의가 없습니다',
                'locator': 'div.lectures > div.alert > p.noresult', 'visible': True}}


def pilot():
    courses = [{'course_key': str(i), 'title': f'합성 강의 {i}', 'instructor': '교수 A'} for i in range(20)]
    searches = [evidence(c['title'], [candidate(c['title'], number=i+1)]) for i,c in enumerate(courses)]
    return courses, searches


class QueueTests(unittest.TestCase):
    def test_selection_is_explicit_and_bounded(self):
        cs, _ = pilot()
        self.assertEqual(select_pilot(cs, [c['course_key'] for c in cs]), cs)
        for keys in [[], [str(i) for i in range(19)], [str(i) for i in range(31)], ['0']*20]:
            with self.assertRaises(ObservationError): select_pilot(cs, keys)

    def test_twenty_unique_matches(self):
        cs, es = pilot(); q = build_queue(cs, es)
        self.assertEqual(q['counts'], {'matched': 20, 'ambiguous': 0, 'not_found': 0})
        self.assertEqual(len(q['collection_queue']), 20)
        self.assertEqual(q['identity_conflicts'], [])

    def test_tail_candidate_beyond_twenty(self):
        cs = [candidate(professor=f'교수 {i}', number=i+1, position=i+1) for i in range(128)]
        c = {'course_key': 'tail', 'title': '합성 강의', 'instructor': '교수 127'}
        r = match_course(c, evidence(candidates=cs, initial=20))
        self.assertEqual(r['matched_candidate']['position'], 128)

    def test_initial_over_twenty_preserved(self):
        cs = [candidate(professor=f'교수 {i}', number=i+1, position=i+1) for i in range(37)]
        e = evidence(candidates=cs)
        validate_search(e)
        self.assertEqual(e['initial_candidate_count'], 37)

    def test_actual_empty_contract_and_loading_failure(self):
        c = {'course_key':'x','title':'합성 강의','instructor':'교수 A'}
        self.assertEqual(match_course(c, evidence(candidates=[]))['status'], 'not_found')
        for field, value in [('empty_evidence', None), ('empty_text', '로딩 중')]:
            e = evidence(candidates=[]); e[field] = value
            with self.assertRaises(ObservationError): match_course(c, e)
        e = evidence(candidates=[]); e['empty_evidence']['visible'] = False
        with self.assertRaises(ObservationError): match_course(c, e)

    def test_unknown_professor_even_on_empty_is_ambiguous(self):
        for p in [None, '', '  ', '미정', '담당교수']:
            c = {'course_key': 'x', 'title': '합성 강의', 'instructor': p}
            self.assertEqual(match_course(c, evidence(candidates=[]))['status'], 'ambiguous')

    def test_small_title_and_professor_differences_preserved(self):
        c = {'course_key': 'x', 'title': '합성 강의', 'instructor': '교수 A'}
        for field, value in [('title','합성강의'), ('title','합성 강의 '), ('instructor','교수A'), ('instructor','Professor A')]:
            e = evidence(); e['candidates'][0][field] = value
            r = match_course(c,e)
            self.assertEqual(r['status'],'ambiguous')
            self.assertEqual(r['search']['candidates'][0][field],value)

    def test_same_url_two_input_rows_held_for_review(self):
        cs, es = pilot(); cs[1].update(title=cs[0]['title'], instructor=cs[0]['instructor'])
        q = build_queue(cs, [es[0]]+es[2:])
        self.assertEqual(q['counts']['ambiguous'], 2)
        self.assertEqual(q['identity_conflicts'][0]['kind'], 'url_multiple_inputs')
        self.assertFalse(any(e['course_key'] in ('0','1') for e in q['collection_queue']))

    def test_same_input_multiple_exact_urls_never_queued(self):
        cs, es = pilot()
        es[0] = evidence(cs[0]['title'], [candidate(cs[0]['title']), candidate(cs[0]['title'],number=999,position=2)])
        q = build_queue(cs, es)
        self.assertEqual(q['input_multiple_exact_urls'], ['0'])
        self.assertEqual(q['review_queue'][0]['match']['reason'], 'multiple_exact_candidates')

    def test_review_queue_contains_ambiguous_and_not_found(self):
        cs, es = pilot(); cs[0]['instructor'] = '미정'; es[1] = evidence(cs[1]['title'], [])
        q = build_queue(cs,es)
        self.assertEqual(q['counts'], {'matched':18,'ambiguous':1,'not_found':1})
        self.assertEqual(len(q['review_queue']),2)

    def test_stop_retains_prior_decisions_and_unattempted_inputs(self):
        cs,es=pilot()
        with self.assertRaises(ObservationError): build_queue(cs,es[:3])
        q=build_queue(cs,es[:3],stop='login expired')
        self.assertEqual(q['status'],'stopped'); self.assertEqual(len(q['unattempted_inputs']),17)
        self.assertEqual(q['counts']['not_found'],0)

    def test_repeated_searches_not_cherry_picked(self):
        cs,es=pilot()
        with self.assertRaises(ObservationError): build_queue(cs,es+[deepcopy(es[0])])

    def test_scope_mismatch_and_limit_rejected(self):
        for mutate in [lambda e:e['scope'].update(ui_end=False),
                       lambda e:e['scope'].update(bottom_confirmations=1),
                       lambda e:e['scope']['trace'][-1].update(count=0),
                       lambda e:e.update(school='에브리타임 다른 대학'),
                       lambda e:e.update(scrolls=13),
                       lambda e:e.update(stop_reason='CAPTCHA')]:
            e=evidence();mutate(e)
            with self.assertRaises(ObservationError):validate_search(e)
        e=evidence(candidates=[candidate(number=i+1,position=i+1) for i in range(161)])
        with self.assertRaises(ObservationError):validate_search(e)

    def test_finalized_partial_is_not_zero_success_and_halts_following_reports(self):
        scenarios=json.loads(subprocess.run(['node','crawler/everytime_collect/tests/fake_browser.cjs'],
            capture_output=True,check=True).stdout)
        report=scenarios['loading_failed'][-1]['report']; target=report['target']
        cs,es=pilot();cs[0].update(title=target['title'],instructor=target['instructor'])
        es[0]=evidence(target['title'],[dict(target,position=1,url=target['url'].split('?')[0])])
        q=build_queue(cs,es)
        archive={'ui_observation':report,'reviews_saved':0,'review_failures':0,
                 'all_observed_rows_saved':False,'duplicate_candidates':{}}
        r=finish_queue(q,{'0':('synthetic',archive)})
        self.assertEqual(r['collection_summary'],{'complete':0,'partial':1,'pending':19,'reviews_saved':0,'review_failures':0})
        self.assertIsNone(r['collection_queue'][0]['match']['displayed_reviews'])
        with self.assertRaises(ObservationError):finish_queue(q,{'0':('synthetic',archive),'1':('synthetic',archive)})


if __name__ == '__main__': unittest.main()
