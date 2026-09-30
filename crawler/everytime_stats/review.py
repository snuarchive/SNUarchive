"""Build private, comment-grouped review material without validating its truth.

The extractor's ``status`` and the human review statuses have different meanings.
Every human review status starts as ``unreviewed``, including accepted extraction
records. No source, extraction result, or human correction is changed here.
"""
from collections import Counter
from copy import deepcopy
import random

from .models import ALL_FIELDS
from .validate import candidate_tier, check_evidence


REVIEW_STATUSES = (
    "value_review_status", "assessment_review_status", "term_review_status",
)


def _statuses():
    return dict.fromkeys(REVIEW_STATUSES, "unreviewed")


def _numeric(record):
    return candidate_tier(record) != "mention_only"


def _check_spans(items, text):
    for item in items:
        start, end = item["start"], item["end"]
        if not 0 <= start < end <= len(text) or text[start:end] != item["text"]:
            raise ValueError("Review material evidence span does not match the original comment")


def _review_comment(comment, result):
    source = comment.source()
    candidates = []
    for record in result["records"]:
        if record["source"] != source:
            raise ValueError("Review candidate source does not match its comment")
        check_evidence(record, comment.text)
        candidate = deepcopy(record)
        candidate.update(_statuses())
        links = {}
        for field in ALL_FIELDS:
            value = record["observed_max"] if field == "observed_max" else record["statistics"][field]
            if value is None:
                continue
            links[field] = {
                "value": value,
                "evidence_indices": [
                    index for index, item in enumerate(record["evidence"])
                    if item.get("field") == field and item.get("value") == value
                ],
            }
        candidate["value_evidence_links"] = links
        candidates.append(candidate)
    excluded = result["excluded"]
    if excluded is not None:
        if excluded["source"] != source:
            raise ValueError("Excluded source does not match its comment")
        _check_spans(excluded.get("evidence", []), comment.text)
    _check_spans(result["non_score_evidence"], comment.text)
    return {
        "review_schema_version": 1,
        "source": source,
        "course_title": comment.title,
        "instructor": comment.instructor,
        "original_text": comment.text,
        "extraction_classification": result["classification"],
        "numeric_candidates": sum(_numeric(record) for record in result["records"]),
        "candidates": candidates,
        "excluded": deepcopy(excluded),
        "non_score_evidence": deepcopy(result["non_score_evidence"]),
        **_statuses(),
    }


def build_review_materials(comments, results, *, seed=20260930, sample_size=5,
                           reserved_pointers=()):
    """Return review queue, separate omission samples, and dynamic counts.

    ``results`` maps each input Comment.pointer to its extract_comment result.
    Queue entries contain every record from a comment with at least one populated
    statistic or observed maximum. A record's ``value_evidence_links`` refers to
    zero-based indices in that same record's unchanged ``evidence`` list, whose
    Unicode code-point offsets are checked against ``original_text``.

    The two omission pools are disjoint from the numeric queue: comments that
    have only mention candidates, and excluded comments. Reserved pointers only
    limit these samples, never the complete numeric queue. Sampling comments is
    a review aid, not an estimate of the corpus's accuracy or completeness.
    """
    if not isinstance(sample_size, int) or sample_size < 0:
        raise ValueError("sample_size must be a non-negative integer")
    comments = list(comments)
    pointers = {comment.pointer for comment in comments}
    if len(pointers) != len(comments):
        raise ValueError("Duplicate comment pointers in review input")
    if set(results) != pointers:
        raise ValueError("Review results must cover exactly the input comment pointers")
    reserved = set(reserved_pointers)
    queue = []
    pools = {"mention_only": [], "excluded": []}
    tiers = Counter({"quartiles_or_average": 0, "bounds_only": 0})
    for comment in sorted(comments, key=lambda item: (item.course_index, item.comment_index)):
        result = results[comment.pointer]
        # Validate links even for comments that the omission sample will not select.
        entry = _review_comment(comment, result)
        if entry["numeric_candidates"]:
            queue.append(entry)
            tiers.update(candidate_tier(record) for record in result["records"] if _numeric(record))
        elif result["records"]:
            pools["mention_only"].append(entry)
        elif result["classification"] == "excluded" and result["excluded"] is not None:
            pools["excluded"].append(entry)
        else:
            raise ValueError("Comment has neither candidates nor an explicit exclusion")
    groups, eligible_counts = {}, {}
    rng = random.Random(seed)
    for name, pool in pools.items():
        eligible = [item for item in pool if item["source"]["json_pointer"] not in reserved]
        eligible_counts[name] = len(eligible)
        groups[name] = rng.sample(eligible, min(sample_size, len(eligible)))
    return {
        "queue": queue,
        "omission_samples": {
            "seed": seed,
            "sample_size": sample_size,
            "selection_rule": "Distinct comments sampled separately from mention-only and excluded pools; numeric comments and reserved pointers are ineligible. Samples do not establish completeness.",
            "groups": groups,
        },
        "summary": {
            "numeric_candidates": sum(entry["numeric_candidates"] for entry in queue),
            "numeric_comments": len(queue),
            "numeric_course_instructor_pairs": len({(entry["course_title"], entry["instructor"]) for entry in queue}),
            "numeric_candidate_tiers": dict(tiers),
            "all_candidates_in_numeric_comments": sum(len(entry["candidates"]) for entry in queue),
            "review_status_initialization": "unreviewed",
            "value_link_indexing": "Zero-based indices within each candidate's evidence list; offsets are Unicode code points in the original comment.",
            "omission_sampling": {
                "group_counts": {name: len(pool) for name, pool in pools.items()},
                "eligible_counts": eligible_counts,
                "sampled_counts": {name: len(items) for name, items in groups.items()},
                "reserved_comments": len(pointers & reserved),
            },
            "validation_note": "These are extraction candidates prepared for human review, not verified exam statistics. Numeric review does not establish omission recall.",
        },
    }
