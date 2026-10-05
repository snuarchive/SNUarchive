"""Synthetic extended normal-UI search evidence; never approves fuzzy identity."""
from copy import deepcopy
import unittest
from urllib.parse import urlencode
from crawler.everytime_collect.raw import ObservationError
from crawler.everytime_match.tests.test_batch_queue import evidence,candidate
from crawler.everytime_match.matching import validate_search as legacy_validate
from crawler.everytime_local_runner.local_matching import match_course,validate_search,collector_target

class ExtendedMatchingTests(unittest.TestCase):
    def sample(self):
        cs=[candidate(title=f'다른강의{i}',number=i+1,position=i+1) for i in range(180)]
        cs[-1]['title']='합성 강의'
        e=evidence(candidates=cs,initial=20)
        e.update(evidence_version=3,mode='professor',query='교수 A')
        e['page_url']='https://everytime.kr/lecture/search?'+urlencode({'keyword':'교수 A','condition':'professor'})
        e['scope'].update(max_scrolls=60,max_candidates=800)
        return {'title':'합성 강의','instructor':'교수 A'},e

    def test_tail_exact_identity_and_legacy_rejection(self):
        course,e=self.sample()
        with self.assertRaises(ObservationError):legacy_validate(e)
        result=match_course(course,e)
        self.assertEqual(result['status'],'matched')
        self.assertTrue(collector_target(result)['url'].endswith('/180'))

    def test_unconfirmed_changed_scope_duplicate_url_and_wrong_query_rejected(self):
        course,e=self.sample()
        for mutate in [lambda x:x['scope'].update(ui_end=False),
                       lambda x:x['scope'].update(max_candidates=801),
                       lambda x:x['scope'].update(bottom_confirmations=1),
                       lambda x:x['candidates'][0].update(url=x['candidates'][-1]['url']),
                       lambda x:x.update(mode='name')]:
            bad=deepcopy(e);mutate(bad)
            with self.assertRaises(ObservationError):validate_search(bad)

    def test_unknown_or_nonexact_or_multiple_never_approved(self):
        course,e=self.sample()
        for title in ['합성강의','없는 강의']:
            self.assertEqual(match_course(dict(course,title=title),e)['status'],'ambiguous')
        e['candidates'][0]['title']=course['title']
        self.assertEqual(match_course(course,e)['reason'],'multiple_exact_candidates')

    def test_legacy_search_unchanged(self):
        result=match_course({'title':'합성 강의','instructor':'교수 A'},evidence())
        self.assertEqual(result['status'],'matched')
