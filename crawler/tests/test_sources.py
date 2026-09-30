import json
from pathlib import Path
import tempfile
import unittest

from crawler.everytime_stats.sources import load_comments


class SourceTests(unittest.TestCase):
    def read(self, text):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "synthetic.json"
            path.write_text(text, encoding="utf-8-sig")
            return load_comments(path)

    def test_counts_keep_cross_course_duplicate_occurrences(self):
        rows = [
            {"교수": "가", "강의명": "예시 1", "댓글": ["합성 문장", "합성 문장"]},
            {"교수": "가", "강의명": "예시1", "댓글": ["합성 문장"]},
        ]
        comments, report = self.read(json.dumps(rows, ensure_ascii=False))
        self.assertEqual(report["comments"], 3)
        self.assertEqual(report["unique_comment_texts"], 1)
        self.assertEqual(report["normalized_unique_titles"], 1)
        self.assertEqual(comments[2].pointer, "/1/댓글/0")

    def test_duplicate_json_keys_fail(self):
        with self.assertRaises(ValueError):
            self.read('[{"교수":"가","교수":"나","강의명":"합성","댓글":[]}]')

    def test_wrong_container_is_not_silently_skipped(self):
        with self.assertRaises(ValueError):
            self.read(json.dumps([{"교수": "가", "강의명": "합성", "댓글": "문장"}]))


if __name__ == "__main__":
    unittest.main()
