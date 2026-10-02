"""Offline selection and matching only; the browser remains user-authorized UI."""
import argparse
import json
from pathlib import Path

from .matching import select_courses, match_course, collector_target, write_new_json
from crawler.everytime_collect.run_v2 import private_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", default="public/courses.json")
    parser.add_argument("--course-key", action="append", required=True, help="Explicit catalog entry, at most 10")
    parser.add_argument("--observations", required=True, help="Private JSON array returned by normal search UI")
    parser.add_argument("--output", required=True, help="New private JSON file; never overwritten")
    args = parser.parse_args()
    catalog = json.loads(Path(args.catalog).read_text(encoding="utf-8"))
    _, _, evidence = private_json(args.observations)
    courses = select_courses(catalog, args.course_key)
    records = []
    for course in courses:
        searches = [e for e in evidence if e.get("mode") == "name" and e.get("query") == course["title"]]
        if len(searches) != 1:
            parser.error("Provide exactly one recorded title search for each selected title; no implicit retries")
        record = match_course(course, searches[0])
        if record["status"] == "matched":
            collector_target(record)
        records.append(record)
    write_new_json(args.output, records)
    print(json.dumps({"attempted": len(records), **{s: sum(r["status"] == s for r in records)
                      for s in ("matched", "ambiguous", "not_found")}}, ensure_ascii=False))


if __name__ == "__main__":
    main()
