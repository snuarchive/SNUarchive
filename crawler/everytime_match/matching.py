"""Conservative matching of explicit catalog samples to observed UI candidates."""
from copy import deepcopy
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
import json

from crawler.everytime_collect.target import course_urls
from crawler.everytime_collect.raw import _no_secrets
from crawler.everytime_collect.run_v2 import validate_report, require, stamp

MAX_COURSES = 10
MAX_CANDIDATES = 50
PILOT_MAX_CANDIDATES = 160
UNKNOWN_INSTRUCTORS = {"", "미정", "담당교수", "-", "Staff", "STAFF"}


def select_courses(catalog, course_keys):
    """Resolve explicit catalog keys. Never supply an implicit full-catalog mode."""
    require(1 <= len(course_keys) <= MAX_COURSES, "Select 1..10 explicit catalog entries")
    require(len(set(course_keys)) == len(course_keys), "Repeated input course key")
    selected = []
    for key in course_keys:
        rows = [c for c in catalog if c.get("course_key") == key]
        require(len(rows) == 1, "Catalog key missing or ambiguous")
        row = rows[0]
        require(isinstance(row.get("title"), str) and bool(row["title"].strip()), "Missing course title")
        require(row.get("instructor") is None or isinstance(row["instructor"], str), "Invalid instructor")
        selected.append(deepcopy(row))
    return selected


def validate_search(evidence):
    """An error/loading/blocked page is never a successful empty search."""
    _no_secrets(evidence)
    require(stamp(evidence.get("observed_at")), "Missing observation time")
    require(not evidence.get("stop_reason"), "Search interrupted; stop the session")
    u = urlsplit(evidence["page_url"])
    require(u.scheme == "https" and u.netloc == "everytime.kr" and u.path == "/lecture/search"
            and not u.fragment, "Not the normal Everytime search page")
    params = parse_qs(u.query, keep_blank_values=True)
    require(params == {"keyword": [evidence["query"]], "condition": [evidence["mode"]]}
            and evidence["mode"] in {"name", "professor"}, "Search query/scope mismatch")
    require(evidence["list_locator"] == "div.lectures > a.lecture" and
            evidence["title_locator"] == ":scope > div.name" and
            evidence["instructor_locator"] == ":scope > div.professor", "Unknown search card fields")
    version = evidence.get("evidence_version", 1)
    require(version in (1, 2), "Unknown search evidence version")
    candidate_limit = PILOT_MAX_CANDIDATES if version == 2 else MAX_CANDIDATES
    candidates = evidence["candidates"]
    require(isinstance(candidates, list) and len(candidates) <= candidate_limit, "Candidate limit exceeded")
    for index, c in enumerate(candidates, 1):
        require(c["position"] == index, "Candidate position mismatch")
        base, _ = course_urls(c["url"])
        require(c["url"] == base, "Search candidate is not an observed overview URL")
        require(isinstance(c["title"], str) and bool(c["title"]), "Missing candidate title")
        require(c["instructor"] is None or isinstance(c["instructor"], str), "Invalid candidate professor")
    g = evidence["geometry"]
    require(all(type(g[k]) in (int, float) and g[k] >= 0 for k in ("top", "height", "client"))
            and g["client"] > 0, "Missing search viewport evidence")
    require(type(evidence["scrolls"]) is int and 0 <= evidence["scrolls"] <= (12 if version == 2 else 2), "Search scroll limit exceeded")
    require(type(evidence["initial_candidate_count"]) is int and
            0 <= evidence["initial_candidate_count"] <= len(candidates), "Search list changed unexpectedly")
    if not candidates:
        # Zero cards alone never prove an empty search. Version 2 uses the
        # text and locator observed in the 2026-10-01 bounded live pilot.
        empty = evidence.get("empty_evidence")
        require(isinstance(empty, dict) and empty.get("text") == evidence.get("empty_text")
                and bool(empty.get("text")) and bool(empty.get("locator"))
                and empty.get("visible") is True, "No explicit empty-search evidence; do not classify not_found")
    else:
        require(evidence.get("empty_text") is None, "Contradictory empty search")
    if version == 2:
        require(evidence.get("school", "").split() == ["에브리타임", "서울대"], "Search is not the observed SNU UI")
        if not candidates:
            require(evidence['empty_text'] == '검색된 강의가 없습니다' and
                    evidence['empty_evidence']['locator'] == 'div.lectures > div.alert > p.noresult',
                    'Empty search differs from observed UI')
        scope = evidence["scope"]
        require(scope["max_scrolls"] == 12 and scope["max_candidates"] == 160 and scope["wait_ms"] == 2000,
                "Search limits changed")
        trace = scope["trace"]
        require(len(trace) == evidence["scrolls"] + 1 and trace[0]["count"] == evidence["initial_candidate_count"]
                and trace[-1]["count"] == len(candidates), "Search trace counts disagree")
        require({k: trace[-1][k] for k in ("top", "height", "client")} == g, "Search geometry differs from trace")
        idle, previous_count = 0, None
        for state in trace:
            require(type(state["count"]) is int and 0 <= state["count"] <= candidate_limit, "Invalid search count")
            require(previous_count is None or state["count"] >= previous_count, "Search list shrank")
            require(all(type(state[k]) in (int, float) and state[k] >= 0 for k in ("top", "height", "client"))
                    and state["client"] > 0, "Invalid search geometry")
            bottom = state["height"] - state["client"] - state["top"] <= 2
            require(state["at_bottom"] is bottom, "Invalid search bottom evidence")
            idle = idle + 1 if bottom and state["count"] == previous_count else 0
            previous_count = state["count"]
        require(scope["bottom_confirmations"] == idle and scope["ui_end"] is True,
                "Unconfirmed search scope")
        require((bool(candidates) and idle >= 2) or (not candidates and trace[-1]["at_bottom"]),
                "Search end was not observed")


def match_course(course, evidence):
    validate_search(evidence)
    expected_query = course["title"] if evidence["mode"] == "name" else course.get("instructor")
    require(evidence["query"] == expected_query, "Evidence belongs to a different catalog query")
    result = {"input": deepcopy(course), "search": deepcopy(evidence), "status": None,
              "reason": None, "matched_candidate": None, "collector_target": None,
              "collection_status": "not_collected", "displayed_reviews": None,
              "stored_reviews": None, "collection_report": None}
    candidates = evidence["candidates"]
    instructor = course.get("instructor")
    exact = [c for c in candidates if c["title"] == course["title"] and c["instructor"] == instructor]
    g = evidence["geometry"]
    at_bottom = g["height"] - g["client"] - g["top"] <= 2
    if instructor is None or instructor.strip() in UNKNOWN_INSTRUCTORS:
        result.update(status="ambiguous", reason="input_instructor_unknown")
    elif not candidates:
        result.update(status="not_found", reason="observed_empty_normal_search")
    elif not at_bottom or len(candidates) == (PILOT_MAX_CANDIDATES if evidence.get("evidence_version") == 2 else MAX_CANDIDATES):
        result.update(status="ambiguous", reason="search_scope_incomplete_or_limit")
    elif len(exact) == 1:
        chosen = deepcopy(exact[0])
        result.update(status="matched", reason="one_exact_title_and_instructor_in_observed_search",
                      matched_candidate=chosen,
                      collector_target={k: chosen[k] for k in ("url", "title", "instructor")},
                      collection_status="pending")
    elif len(exact) > 1:
        result.update(status="ambiguous", reason="multiple_exact_candidates")
    else:
        result.update(status="ambiguous", reason="candidates_present_but_identity_not_exact")
    return result


def collector_target(record):
    """Recompute the decision before handing observed labels to the existing collector."""
    verified = match_course(record["input"], record["search"])
    require(verified["status"] == "matched" and record["status"] == "matched", "Only matched courses may be collected")
    require(record["collector_target"] == verified["collector_target"], "Target differs from search evidence")
    return deepcopy(verified["collector_target"])


def attach_collection(record, report, report_path):
    expected = collector_target(record)
    validate_report(report)
    _, url = course_urls(expected["url"])
    require(report["target"] == dict(expected, url=url), "Collector report is for another matched course")
    result = deepcopy(record)
    result.update(collection_status=report["status"],
                  displayed_reviews=report["displayed_total"]["value"] if report["displayed_total"] else None,
                  stored_reviews=report["succeeded"], collection_report=str(report_path),
                  initial_loaded=report["initial_loaded"], batches=report["batches"],
                  failures=report["failed"], stop_reason=report["stop_error"],
                  termination_reason=report["termination_reason"], ui_end_confirmed=report["ui_end_confirmed"])
    return result


def write_new_json(path, value):
    """Reports/search evidence are private and immutable, just like collector output."""
    path = Path(path).resolve()
    roots = [Path(r).resolve() for r in ("crawler/data/private", "crawler/output")]
    require(any(path.is_relative_to(r) and path != r for r in roots), "Matching output must be private")
    _no_secrets(value)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
