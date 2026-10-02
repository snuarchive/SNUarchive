import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from urllib.parse import urlencode

from crawler.everytime_collect.raw import ObservationError
from crawler.everytime_match.matching import (select_courses, match_course, collector_target,
                                             write_new_json, attach_collection)


def course(prof="교수 A"):
    return {"course_key": "synthetic", "title": "합성 강의", "instructor": prof}


def search(candidates=None):
    cs = candidates if candidates is not None else [
        {"position": 1, "url": "https://everytime.kr/lecture/view/1", "title": "합성 강의", "instructor": "교수 A"}]
    return {"page_url": "https://everytime.kr/lecture/search?" + urlencode({"keyword": "합성 강의", "condition": "name"}),
            "query": "합성 강의", "mode": "name", "observed_at": "2026-09-30T00:00:00Z",
            "candidates": cs, "list_locator": "div.lectures > a.lecture", "title_locator": ":scope > div.name",
            "instructor_locator": ":scope > div.professor", "empty_text": None,
            "geometry": {"top": 0, "height": 900, "client": 900}, "initial_candidate_count": len(cs), "scrolls": 0}


class MatchingTests(unittest.TestCase):
    def test_exact_identity_and_different_professor(self):
        e = search()
        e['candidates'].append(dict(e['candidates'][0], position=2, instructor='교수 B', url='https://everytime.kr/lecture/view/2'))
        r = match_course(course(), e)
        self.assertEqual(r['status'], 'matched')
        self.assertEqual(collector_target(r)['instructor'], '교수 A')

    def test_multiple_exact_candidates_not_collected(self):
        e = search()
        e['candidates'].append(dict(e['candidates'][0], position=2, url='https://everytime.kr/lecture/view/2'))
        r = match_course(course(), e)
        self.assertEqual(r['reason'], 'multiple_exact_candidates')
        with self.assertRaises(ObservationError): collector_target(r)

    def test_blank_unknown_professor_and_missing_site_professor(self):
        for p in [None, '', '미정', '담당교수', '-']:
            with self.subTest(p=p):
                r = match_course(course(p), search())
                self.assertEqual(r['status'], 'ambiguous')
        e = search(); e['candidates'][0]['instructor'] = None
        self.assertEqual(match_course(course(), e)['status'], 'ambiguous')

    def test_spelling_spaces_unicode_not_normalized(self):
        for text in ['합성강의', '합성 강의 ', '합성 강의(영어)']:
            e = search(); e['candidates'][0]['title'] = text
            r = match_course(course(), e)
            self.assertEqual(r['status'], 'ambiguous')
            self.assertEqual(r['search']['candidates'][0]['title'], text)
            self.assertEqual(r['input']['title'], '합성 강의')

    def test_explicit_empty_is_not_found(self):
        e = search([])
        # Synthetic evidence only: this text/locator was not observed live.
        e.update(empty_text='SYNTHETIC empty', empty_evidence={
            'text': 'SYNTHETIC empty', 'locator': '#synthetic-empty', 'visible': True})
        r = match_course(course(), e)
        self.assertEqual(r['status'], 'not_found')
        with self.assertRaises(ObservationError): collector_target(r)

    def test_loading_not_empty_success(self):
        with self.assertRaises(ObservationError): match_course(course(), search([]))

    def test_login_security_stop_not_not_found(self):
        for reason in ['login expired', 'security policy denied', 'rate limit', 'CAPTCHA']:
            e = search(); e['stop_reason'] = reason
            with self.assertRaises(ObservationError): match_course(course(), e)
        e = search(); e['page_url'] = 'https://everytime.kr/login'
        with self.assertRaises(ObservationError): match_course(course(), e)

    def test_untrusted_url_and_wrong_query(self):
        for url in ['https://everytime.kr.evil/lecture/view/1', 'http://everytime.kr/lecture/view/1',
                    'https://everytime.kr/lecture/view/1?foo=1']:
            e = search(); e['candidates'][0]['url'] = url
            with self.assertRaises(ObservationError): match_course(course(), e)
        e = search(); e['query'] = '다른 강의'
        with self.assertRaises(ObservationError): match_course(course(), e)

    def test_incomplete_and_candidate_limit(self):
        e = search(); e['geometry']['height'] = 2000
        self.assertEqual(match_course(course(), e)['status'], 'ambiguous')
        e = search(); e['candidates'] *= 51
        with self.assertRaises(ObservationError): match_course(course(), e)

    def test_bounded_selection_and_original_preservation(self):
        c = course(); c['instructor'] = ' 교수 A '
        self.assertEqual(select_courses([c], ['synthetic'])[0], c)
        for keys in [[], ['synthetic'] * 2, list(map(str, range(11))), ['missing']]:
            with self.assertRaises(ObservationError): select_courses([c], keys)

    def test_tampered_target_rejected(self):
        r = match_course(course(), search()); r['collector_target']['url'] = 'https://everytime.kr/lecture/view/2'
        with self.assertRaises(ObservationError): collector_target(r)

    def test_private_exclusive_write(self):
        with tempfile.TemporaryDirectory(dir='crawler/output') as d:
            p = Path(d)/'synthetic.json'
            write_new_json(p, {'synthetic': True})
            with self.assertRaises(FileExistsError): write_new_json(p, {})
        with self.assertRaises(ObservationError): write_new_json('public/should-not-exist.json', {})

    def test_existing_collector_complete_and_partial_reports(self):
        # Reuse the unchanged collector's synthetic browser, not live site data.
        result = subprocess.run(['node', 'crawler/everytime_collect/tests/fake_browser.cjs'],
                                capture_output=True, check=True)
        scenarios = json.loads(result.stdout)
        for scenario in ['small', 'multi', 'empty', 'interrupted', 'loading_failed']:
            report = scenarios[scenario][-1]['report']
            target = report['target']
            c = dict(course(), title=target['title'], instructor=target['instructor'])
            e = search([dict(target, position=1, url=target['url'].split('?')[0])])
            e['query'] = target['title']
            e['page_url'] = 'https://everytime.kr/lecture/search?' + urlencode({'keyword': e['query'], 'condition': 'name'})
            r = attach_collection(match_course(c, e), report, 'synthetic/run_report.json')
            self.assertEqual(r['collection_status'], report['status'])
            self.assertEqual(r['stored_reviews'], report['succeeded'])
            self.assertEqual(r['ui_end_confirmed'], report['ui_end_confirmed'])
            if scenario == 'loading_failed':
                self.assertEqual(r['collection_status'], 'partial')
                self.assertIsNone(r['initial_loaded'])

    def test_collection_report_cannot_cross_course(self):
        result = subprocess.run(['node', 'crawler/everytime_collect/tests/fake_browser.cjs'],
                                capture_output=True, check=True)
        report = json.loads(result.stdout)['small'][-1]['report']
        with self.assertRaises(ObservationError):
            attach_collection(match_course(course(), search()), report, 'synthetic/run_report.json')


if __name__ == '__main__':
    unittest.main()
