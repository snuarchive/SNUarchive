"""Validate the proposed raw envelope, not an assumed Everytime response format."""
from datetime import datetime
import hashlib
import json
import re
from urllib.parse import parse_qsl, unquote, urlsplit

MAX_REVIEWS = 5
MAX_BROWSER_REVIEWS = 20
MAX_INPUT_BYTES = 2 * 1024 * 1024
SECRET_KEY = re.compile(r"password|passwd|cookie|authorization|token|session|csrf|secret|storagestate|localstorage|sessionstorage|headers|requestbody")
SECRET_TEXT = re.compile(r"(?im)(?:\b(?:cookie|set-cookie|authorization)\s*:|\b(?:access_token|refresh_token|csrf_token|sessionid|password)\s*[=:]|\bbearer\s+[A-Za-z0-9._-]{12,}|<\s*(?:html|script|input)\b)")


class ObservationError(ValueError):
    """Messages intentionally contain no source text or credential values."""


def digest(value):
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def _keys(value, expected, context):
    if not isinstance(value, dict) or set(value) != set(expected):
        raise ObservationError(f"Unexpected or missing envelope fields: {context}; preserve extra site fields under metadata")


def _string(value, context, nullable=False):
    if value is None and nullable:
        return
    if not isinstance(value, str) or not value.strip():
        raise ObservationError(f"Expected nonempty original string: {context}")


def _no_secrets(value):
    if isinstance(value, dict):
        for key, item in value.items():
            normalized = re.sub(r"[^a-z0-9]", "", key.lower())
            if SECRET_KEY.search(normalized):
                raise ObservationError("Session/credential or full-request fields cannot be archived")
            _no_secrets(item)
    elif isinstance(value, list):
        for item in value:
            _no_secrets(item)
    elif isinstance(value, str) and SECRET_TEXT.search(value):
        raise ObservationError("Possible credentials or full-page HTML: use only the review content region")


def read_json(data):
    if len(data) > MAX_INPUT_BYTES:
        raise ObservationError("Observation exceeds the small-sample input size limit")

    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ObservationError("Duplicate JSON object keys are not allowed")
            result[key] = value
        return result

    def invalid_constant(_value):
        raise ObservationError("Non-finite JSON numbers are not allowed")

    try:
        doc = json.loads(data.decode("utf-8"), object_pairs_hook=pairs, parse_constant=invalid_constant)
        canonical(doc)  # Also reject float overflow such as 1e999.
    except (UnicodeError, json.JSONDecodeError, OverflowError, RecursionError, ValueError) as error:
        if isinstance(error, ObservationError):
            raise
        raise ObservationError("Input must be finite, valid UTF-8 JSON") from None
    return doc


def read_document(data):
    doc = read_json(data)
    validate_document(doc)
    return doc


def validate_document(doc):
    _no_secrets(doc)
    _keys(doc, ("schema_version", "capture", "course", "reviews", "evidence"), "root")
    if type(doc["schema_version"]) is not int or doc["schema_version"] not in (1, 2):
        raise ObservationError("Unsupported raw schema version")
    browser_capture = doc["schema_version"] == 2
    cap = doc["capture"]
    _keys(cap, ("method", "observed_at", "page_url", "page_title", "coverage", "metadata"), "capture")
    method = "browser_dom_observation" if browser_capture else "manual_browser_observation"
    if cap["method"] != method:
        raise ObservationError("Capture method does not match the raw schema version")
    if cap["coverage"] != "sample":
        raise ObservationError("This stage only archives samples, not a complete course or corpus")
    _string(cap["observed_at"], "capture.observed_at")
    try:
        stamp = datetime.fromisoformat(cap["observed_at"].replace("Z", "+00:00"))
        if "T" not in cap["observed_at"] or stamp.utcoffset() is None:
            raise ValueError()
    except ValueError:
        raise ObservationError("observed_at requires an ISO timestamp including timezone") from None
    _string(cap["page_url"], "capture.page_url")
    try:
        url = urlsplit(cap["page_url"])
        if (url.scheme != "https" or not url.hostname or
                not (url.hostname == "everytime.kr" or url.hostname.endswith(".everytime.kr")) or
                url.username is not None or url.password is not None or url.port not in (None, 443)):
            raise ValueError()
    except ValueError:
        raise ObservationError("Expected an observed HTTPS Everytime URL without credentials") from None
    _no_secrets(unquote(cap["page_url"]))
    for name, _value in parse_qsl(url.query) + parse_qsl(url.fragment):
        if SECRET_KEY.search(re.sub(r"[^a-z0-9]", "", name.lower())):
            raise ObservationError("Session/credential parameters cannot be saved in a source URL")
    _string(cap["page_title"], "capture.page_title", nullable=True)
    if not isinstance(cap["metadata"], dict):
        raise ObservationError("capture.metadata must be an object")

    evidences = doc["evidence"]
    max_evidence = 50 if browser_capture else 30
    if not isinstance(evidences, list) or not 1 <= len(evidences) <= max_evidence:
        raise ObservationError("Invalid number of review-region evidence blocks")
    by_id = {}
    for ev in evidences:
        _keys(ev, ("id", "kind", "text", "locator"), "evidence")
        _string(ev["id"], "evidence.id")
        _string(ev["text"], "evidence.text")
        _string(ev["locator"], "evidence.locator", nullable=True)
        if ev["kind"] != "visible_text" or ev["id"] in by_id:
            raise ObservationError("Evidence needs a unique ID and visible_text kind")
        by_id[ev["id"]] = ev["text"]

    def reference(ref):
        _keys(ref, ("evidence_id", "start", "end"), "field_evidence reference")
        text = by_id.get(ref["evidence_id"]) if isinstance(ref["evidence_id"], str) else None
        a, b = ref["start"], ref["end"]
        if text is None or type(a) is not int or type(b) is not int or not 0 <= a < b <= len(text):
            raise ObservationError("Invalid evidence ID or Unicode code-point span")
        return text[a:b]

    def entity(value, core, mandatory, context):
        _keys(value, (*core, "metadata", "field_evidence"), context)
        if not isinstance(value["metadata"], dict) or not isinstance(value["field_evidence"], dict):
            raise ObservationError("metadata and field_evidence must be objects")
        required_refs = {name for name in core if value[name] is not None}
        if value["metadata"]:
            required_refs.add("metadata")
        if set(value["field_evidence"]) != required_refs:
            raise ObservationError("Every observed field needs evidence; unknown fields must be null")
        for name in core:
            _string(value[name], f"{context}.{name}", nullable=name not in mandatory)
            if value[name] is not None and reference(value["field_evidence"][name]) != value[name]:
                raise ObservationError("Raw field must exactly match its original evidence span")
        if value["metadata"]:
            reference(value["field_evidence"]["metadata"])

    entity(doc["course"], ("title_raw", "instructor_raw", "source_id"), ("title_raw", "instructor_raw"), "course")
    reviews = doc["reviews"]
    max_reviews = MAX_BROWSER_REVIEWS if browser_capture else MAX_REVIEWS
    if not isinstance(reviews, list) or not 1 <= len(reviews) <= max_reviews:
        raise ObservationError(f"Supply 1 to {max_reviews} complete reviews for one course; never silently truncate")
    for review in reviews:
        entity(review, ("source_id", "text_raw", "enrollment_term_raw", "created_at_raw", "updated_at_raw"), ("text_raw",), "review")
    if browser_capture:
        _validate_browser_capture(doc)


def _validate_browser_capture(doc):
    """Schema 2 retains legacy batches and verifies explicit v2 target identity."""
    from .target import course_urls, validate_target
    cap = doc["capture"]
    base, url = course_urls(cap["page_url"])
    if cap["page_url"] != url or cap["metadata"].get("overview_page_url") != base:
        raise ObservationError("Browser article and overview URLs must identify the same course")
    report = cap["metadata"].get("collection")
    _keys(report, ("adapter", "requested_limit", "loaded_count", "attempted", "succeeded", "failed",
                   "not_attempted_loaded", "failures", "complete_course"), "collection")
    if report["adapter"] not in ("everytime_visible_dom_v1", "everytime_visible_dom_v2") or report["complete_course"] is not False:
        raise ObservationError("Unsupported browser adapter or completeness claim")
    if report["adapter"] == "everytime_visible_dom_v2":
        target = validate_target(cap["metadata"].get("target"))
        if target != {"url": url, "title": doc["course"]["title_raw"], "instructor": doc["course"]["instructor_raw"]}:
            raise ObservationError("Raw labels do not match the explicit target")
        if cap["metadata"].get("scope") != {"filter": "전체", "sort": "등록순", "locator": "div.article_tab > div.header button"}:
            raise ObservationError("Unverified review scope")
        if "list_window" not in cap["metadata"]:
            raise ObservationError("Generalized adapter requires physical list positions")
        if any(r[k] is not None for r in doc["reviews"] for k in ("source_id", "created_at_raw", "updated_at_raw")):
            raise ObservationError("This adapter has not observed review IDs or timestamps")
    for key in ("requested_limit", "loaded_count", "attempted", "succeeded", "failed", "not_attempted_loaded"):
        if type(report[key]) is not int or report[key] < 0:
            raise ObservationError("Collection counts must be nonnegative integers")
    if not 1 <= report["requested_limit"] <= MAX_BROWSER_REVIEWS:
        raise ObservationError("Browser capture limit must be between 1 and 20")
    if (report["attempted"] != min(report["loaded_count"], report["requested_limit"]) or
            report["succeeded"] != len(doc["reviews"]) or
            report["succeeded"] + report["failed"] != report["attempted"] or
            report["not_attempted_loaded"] != report["loaded_count"] - report["attempted"]):
        raise ObservationError("Collection counts do not agree with the saved reviews")
    window = cap["metadata"].get("list_window")
    if window is not None:
        _keys(window, ("start_position", "end_position", "dom_loaded_count"), "list window")
        if (any(type(v) is not int for v in window.values()) or
                not 1 <= window["start_position"] <= window["end_position"] <= window["dom_loaded_count"] or
                window["end_position"] - window["start_position"] + 1 != report["loaded_count"]):
            raise ObservationError("Invalid DOM list window for this raw batch")
    failures = report["failures"]
    if not isinstance(failures, list) or len(failures) != report["failed"]:
        raise ObservationError("Each failed row needs a failure record")
    seen = set()
    for failure in failures:
        _keys(failure, ("list_position", "reason"), "collection failure")
        index = failure["list_position"]
        if type(index) is not int or not 1 <= index <= report["attempted"] or index in seen:
            raise ObservationError("Invalid failure row position")
        if failure["reason"] not in ("body_missing_or_ambiguous", "body_empty_or_hidden", "term_ambiguous", "term_unrecognized"):
            raise ObservationError("Unknown row failure reason")
        seen.add(index)


def fingerprints(doc, review):
    """Local comparison keys, never Everytime IDs or DB identifiers."""
    course = doc["course"]
    host = urlsplit(doc["capture"]["page_url"]).hostname
    identity = (host, "supplied_course_id", course["source_id"]) if course["source_id"] is not None else (
        host, "exact_page_url_and_labels", doc["capture"]["page_url"], course["title_raw"], course["instructor_raw"])
    content = {k: review[k] for k in ("text_raw", "enrollment_term_raw", "created_at_raw", "updated_at_raw", "metadata")}
    return {"course_comparison_sha256": digest(canonical(identity)),
            "course_identity_basis": identity[1], "supplied_review_id": review["source_id"],
            "body_sha256": digest(review["text_raw"].encode("utf-8")), "content_sha256": digest(canonical(content))}


def duplicate_relation(left, right):
    if left["course_comparison_sha256"] != right["course_comparison_sha256"]:
        return None
    a, b = left["supplied_review_id"], right["supplied_review_id"]
    same_content = left["content_sha256"] == right["content_sha256"]
    if a is not None and b is not None:
        if a != b:
            return None
        return "source_id_match_same_content" if same_content else "source_id_match_changed_content"
    return "possible_duplicate_without_both_ids" if same_content else None
